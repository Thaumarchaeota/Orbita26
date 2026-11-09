"""Six-field bank PDF text profile. Balance remains a non-event anchor."""

from __future__ import annotations

import io
import re

from ..contract import AmountObservation
from .common import AdapterFailure, ProfileOutput, coverage, make_date, occurrence, raw_field

PROFILE_ID = "cmb-bank-pdf-text-6/v1"
PROFILE_REVISION = "1"
DETECTED_FORMAT = "pdf"
NUMBER = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
ROW = re.compile(
    rf"^\s*(?P<date>20\d{{2}}[-/.]\d{{1,2}}[-/.]\d{{1,2}})\s+"
    rf"(?P<commodity>[A-Za-z]{{3}}|人民币|港币|美元|日元|欧元)\s+"
    rf"(?P<amount>{NUMBER})\s+(?P<balance>{NUMBER})\s+(?P<tail>\S.*)$"
)
HEADER = re.compile(r"^\s*记账日期\s+货币\s+交易金额\s+联机余额\s+交易摘要\s+对手信息\s*$")


def detect_format(data: bytes) -> str:
    return "pdf" if data.startswith(b"%PDF-") else "unknown"


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
            recognized = 0
            failed = 0
            for line_number, line in enumerate(text.splitlines(), start=1):
                if not line.strip() or HEADER.match(line):
                    continue
                locator = f"pdf/page/{page_number}/line/{line_number}"
                match = ROW.match(line)
                if not match:
                    failed += 1
                    occurrences.append(
                        occurrence(
                            locator=locator,
                            discriminator=f"pdf-line:{page_number}:{line_number}",
                            fields=(raw_field("record_text", line, source_type="pdf_text_line"),),
                            binding=request.binding_snapshot,
                            status="failure",
                            failures=("pdf_bank_line_unrecognized",),
                            raw_record_text=line,
                        )
                    )
                    if len(occurrences) > request.limits.occurrences:
                        raise AdapterFailure("resource_occurrence_limit", DETECTED_FORMAT)
                    continue
                values = match.groupdict()
                fields = (
                    raw_field("记录原文", line, source_type="pdf_text_line"),
                    raw_field("记账日期", values["date"], source_type="pdf_text"),
                    raw_field("货币", values["commodity"], source_type="pdf_text"),
                    raw_field("交易金额", values["amount"], source_type="pdf_text"),
                    raw_field("联机余额", values["balance"], source_type="pdf_text"),
                    raw_field("交易摘要及对手信息原文", values["tail"], source_type="pdf_text_unsegmented"),
                )
                row = occurrence(
                    locator=locator,
                    discriminator=f"pdf-line:{page_number}:{line_number}",
                    fields=fields,
                    binding=request.binding_snapshot,
                    amounts=(
                        AmountObservation("交易金额", values["amount"], "account_posting_amount", values["commodity"]),
                        AmountObservation("联机余额", values["balance"], "balance_anchor", values["commodity"]),
                    ),
                    dates=make_date("记账日期", values["date"], "posting_date", "day"),
                    raw_text_bytes=len(line.encode("utf-8")),
                    raw_record_text=line,
                )
                occurrences.append(row)
                recognized += 1
                if len(occurrences) > request.limits.occurrences:
                    raise AdapterFailure("resource_occurrence_limit", DETECTED_FORMAT)
            coverage_items.append(
                coverage(
                    "page",
                    f"pdf/page/{page_number}",
                    "recognized" if failed == 0 else "partial",
                    text_characters=str(len(text)),
                    transaction_lines=str(recognized),
                    unclassified_lines=str(failed),
                )
            )
    finally:
        pdf.close()
    if not coverage_items:
        raise AdapterFailure("pdf_empty", DETECTED_FORMAT)
    failed = any(row.status == "failure" for row in occurrences) or any(
        unit.status in {"partial", "unsupported", "failed"} for unit in coverage_items
    )
    return ProfileOutput(
        DETECTED_FORMAT,
        "partial_with_failures" if failed else "complete",
        tuple(coverage_items),
        tuple(occurrences),
        warnings=("denominator_unavailable", "description_tail_not_split_without_boundary"),
        denominator_unit=None,
        declared_count=None,
    )
