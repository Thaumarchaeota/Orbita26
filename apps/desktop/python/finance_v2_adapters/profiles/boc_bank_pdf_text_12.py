"""Twelve-column bank PDF table profile with page-complete coverage reporting."""

from __future__ import annotations

import io

from ..contract import AmountObservation
from .common import AdapterFailure, ProfileOutput, coverage, make_date, occurrence, raw_field

PROFILE_ID = "boc-bank-pdf-text-12/v1"
PROFILE_REVISION = "1"
DETECTED_FORMAT = "pdf"
HEADERS = (
    "记账日期",
    "记账时间",
    "币别",
    "金额",
    "余额",
    "交易名称",
    "渠道",
    "网点名称",
    "附言",
    "对方账户名",
    "对方卡号/账号",
    "对方开户行",
)


def detect_format(data: bytes) -> str:
    return "pdf" if data.startswith(b"%PDF-") else "unknown"


def _cell_text(value) -> str | None:
    return None if value is None else str(value)


def parse(request) -> ProfileOutput:
    try:
        import pdfplumber
    except ImportError:
        raise AdapterFailure("dependency_pdfplumber_missing", DETECTED_FORMAT)
    try:
        pdf = pdfplumber.open(io.BytesIO(request.source_bytes))
    except Exception:
        raise AdapterFailure("unreadable_or_encrypted_pdf", DETECTED_FORMAT)
    occurrences = []
    coverage_items = []
    total_chars = 0
    header_seen = False
    try:
        if len(pdf.pages) > request.limits.pdf_pages:
            raise AdapterFailure("resource_pdf_pages", DETECTED_FORMAT)
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            total_chars += len(text)
            if len(text) > request.limits.pdf_page_characters or total_chars > request.limits.pdf_text_characters:
                raise AdapterFailure("resource_pdf_text_characters", DETECTED_FORMAT)
            if not text.strip():
                coverage_items.append(coverage("page", f"pdf/page/{page_number}", "unsupported", reason="no_text_layer"))
                continue
            if text.count("\n") > request.limits.occurrences:
                raise AdapterFailure("resource_pdf_lines", DETECTED_FORMAT)
            page_rows = 0
            page_failures = 0
            recognized_tables = 0
            for table_index, table in enumerate(page.extract_tables() or (), start=1):
                rows = list(table)
                if not rows:
                    continue
                first = tuple(_cell_text(value) or "" for value in rows[0])
                if first == HEADERS:
                    header_seen = True
                    recognized_tables += 1
                    data_rows = rows[1:]
                else:
                    page_failures += 1
                    continue
                for row_number, row in enumerate(data_rows, start=2 if first == HEADERS else 1):
                    locator = f"pdf/page/{page_number}/table/{table_index}/row/{row_number}"
                    if len(row) != len(HEADERS):
                        page_failures += 1
                        occurrences.append(
                            occurrence(
                                locator=locator,
                                discriminator=f"pdf-table:{page_number}:{table_index}:{row_number}",
                                fields=(raw_field("record_text", " | ".join(_cell_text(x) or "" for x in row)),),
                                binding=request.binding_snapshot,
                                status="failure",
                                failures=("pdf_boc_table_row_width",),
                            )
                        )
                        if len(occurrences) > request.limits.occurrences:
                            raise AdapterFailure("resource_occurrence_limit", DETECTED_FORMAT)
                        continue
                    values = tuple(_cell_text(value) for value in row)
                    if not any(value not in (None, "") for value in values):
                        continue
                    if sum(len((value or "").encode("utf-8")) for value in values) > request.limits.raw_text_bytes:
                        raise AdapterFailure("resource_raw_text_bytes", DETECTED_FORMAT)
                    fields = tuple(
                        raw_field(header, value, source_type="pdf_table_cell")
                        for header, value in zip(HEADERS, values)
                    )
                    tail_hint = values[6]
                    row_failures = []
                    if not values[0]:
                        row_failures.append("pdf_boc_posting_date_missing")
                    if not values[3]:
                        row_failures.append("pdf_boc_posting_amount_missing")
                    row_value = occurrence(
                        locator=locator,
                        discriminator=f"pdf-table:{page_number}:{table_index}:{row_number}",
                        fields=fields,
                        binding=request.binding_snapshot,
                        via_hint=tail_hint,
                        amounts=(
                            AmountObservation("金额", values[3] or "", "account_posting_amount", values[2]),
                            AmountObservation("余额", values[4] or "", "balance_anchor", values[2]),
                        ) if values[3] or values[4] else (),
                        dates=(
                            *make_date("记账日期", values[0], "posting_date", "day"),
                            *make_date("记账时间", values[1], "posting_time", "source_precision"),
                        ),
                        status="failure" if row_failures else "success",
                        failures=row_failures,
                    )
                    occurrences.append(row_value)
                    page_rows += 1
                    if len(occurrences) > request.limits.occurrences:
                        raise AdapterFailure("resource_occurrence_limit", DETECTED_FORMAT)
            if recognized_tables == 0:
                page_failures += 1
            coverage_items.append(
                coverage(
                    "page",
                    f"pdf/page/{page_number}",
                    "recognized" if page_failures == 0 else "partial",
                    text_characters=str(len(text)),
                    recognized_tables=str(recognized_tables),
                    transaction_rows=str(page_rows),
                    unrecognized_tables=str(page_failures),
                )
            )
    finally:
        pdf.close()
    if not coverage_items:
        raise AdapterFailure("pdf_empty", DETECTED_FORMAT)
    if not header_seen:
        return ProfileOutput(
            DETECTED_FORMAT,
            "unsupported",
            tuple(coverage_items),
            tuple(occurrences),
            warnings=("exact_header_not_found",),
            error_code="unsupported_pdf_boc_header",
        )
    return ProfileOutput(
        DETECTED_FORMAT,
        "partial_with_failures" if any(row.status == "failure" for row in occurrences) or any(unit.status == "partial" for unit in coverage_items) else "complete",
        tuple(coverage_items),
        tuple(occurrences),
        warnings=("denominator_unavailable", "posting_timestamp_is_not_transaction_time"),
        denominator_unit=None,
        declared_count=None,
    )
