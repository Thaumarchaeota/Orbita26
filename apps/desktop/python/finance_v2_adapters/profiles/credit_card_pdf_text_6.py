"""Six-column credit-card PDF text profile; rows that do not align stay visible failures."""

from __future__ import annotations

import io
import re

from ..contract import AmountObservation
from .common import AdapterFailure, ProfileOutput, coverage, make_date, occurrence, raw_field

PROFILE_ID = "credit-card-pdf-text-6/v1"
PROFILE_REVISION = "1"
DETECTED_FORMAT = "pdf"
DATE = r"(?:20\d{2}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2})"
NUMBER = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
ROW = re.compile(
    rf"^\s*(?P<trade>{DATE})\s+(?P<posting>{DATE})\s+"
    rf"(?P<description>.+?)\s+(?P<settlement>{NUMBER})\s+"
    rf"(?P<card>(?:\*{{1,8}})?\d{{4}})\s+"
    rf"(?P<location>{NUMBER}(?:\([A-Za-z]{{2,4}}\))?)\s*$"
)
HEADER = re.compile(r"^\s*交易日\s+记账日\s+交易摘要\s+人民币金额\s+卡号末四位\s+交易地金额\s*$")


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
    global_line = 0
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
                global_line += 1
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
                            failures=("pdf_credit_card_line_unrecognized",),
                            raw_record_text=line,
                        )
                    )
                    if len(occurrences) > request.limits.occurrences:
                        raise AdapterFailure("resource_occurrence_limit", DETECTED_FORMAT)
                    continue
                values = match.groupdict()
                settlement_text = values["settlement"]
                location_text = values["location"]
                suffix_match = re.search(r"\(([A-Za-z]{2,4})\)$", location_text)
                raw_fields = (
                    raw_field("记录原文", line, source_type="pdf_text_line"),
                    raw_field("交易日", values["trade"], source_type="pdf_text"),
                    raw_field("记账日", values["posting"], source_type="pdf_text"),
                    raw_field("交易摘要", values["description"], source_type="pdf_text"),
                    raw_field("人民币金额", settlement_text, source_type="pdf_text"),
                    raw_field("卡号末四位", values["card"], source_type="pdf_text"),
                    raw_field("交易地金额", location_text, source_type="pdf_text"),
                )
                amounts = (
                    AmountObservation("人民币金额", settlement_text, "settlement_amount", "CNY"),
                    AmountObservation(
                        "交易地金额",
                        location_text[: suffix_match.start()] if suffix_match else location_text,
                        "transaction_location_amount",
                        suffix_match.group(1) if suffix_match else None,
                    ),
                )
                account_hint = values["card"]
                row = occurrence(
                    locator=locator,
                    discriminator=f"pdf-line:{page_number}:{line_number}",
                    fields=raw_fields,
                    binding=request.binding_snapshot,
                    account_hint=account_hint,
                    amounts=amounts,
                    dates=(
                        *make_date("交易日", values["trade"], "trade_date", "day"),
                        *make_date("记账日", values["posting"], "posting_date", "day"),
                    ),
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
        warnings=("denominator_unavailable", "yearless_dates_remain_yearless"),
        denominator_unit=None,
        declared_count=None,
    )
