"""Exact 13-column wallet CSV profile; no encoding or delimiter guessing."""

from __future__ import annotations

import csv
import io

from ..contract import AmountObservation, ExternalId
from .common import (
    AdapterFailure,
    ProfileOutput,
    coverage,
    make_date,
    occurrence,
    raw_field,
)

PROFILE_ID = "wallet-csv-13/v1"
PROFILE_REVISION = "1"
DETECTED_FORMAT = "csv"
HEADERS = (
    "交易时间",
    "交易分类",
    "交易对方",
    "对方账号",
    "商品说明",
    "收/支",
    "金额",
    "收/付款方式",
    "交易状态",
    "交易订单号",
    "商家订单号",
    "备注",
    "",
)
FIELD_NAMES = HEADERS[:-1] + ("column_13",)


def detect_format(data: bytes) -> str:
    if not data:
        return "unknown"
    try:
        data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return "unknown"
    return "csv"


def parse(request) -> ProfileOutput:
    try:
        text = request.source_bytes.decode("utf-8-sig", errors="strict")
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=",", strict=True)
        records: list[tuple[list[str], int, int]] = []
        physical_line = 0
        for logical, row in enumerate(reader, start=1):
            end_line = reader.line_num
            start_line = physical_line + 1
            physical_line = end_line
            records.append((row, start_line, end_line))
            if logical > request.limits.occurrences + 1:
                raise AdapterFailure("resource_occurrence_limit", DETECTED_FORMAT)
    except UnicodeDecodeError:
        raise AdapterFailure("unsupported_csv_encoding", DETECTED_FORMAT)
    except csv.Error:
        raise AdapterFailure("malformed_csv", DETECTED_FORMAT)
    if not records or tuple(records[0][0]) != HEADERS:
        return ProfileOutput(
            DETECTED_FORMAT,
            "unsupported",
            (coverage("csv", "csv/header", "unsupported"),),
            (),
            warnings=("header_not_exact",),
            error_code="unsupported_csv_header",
        )

    occurrences = []
    coverage_items = [coverage("csv", "csv/header", "recognized", columns="13")]
    for ordinal, (row, start_line, end_line) in enumerate(records[1:], start=1):
        locator = f"csv/record/{ordinal};lines/{start_line}-{end_line}"
        if len(row) > len(FIELD_NAMES):
            fields = tuple(
                raw_field(f"column_{index + 1}", value, source_type="csv_text")
                for index, value in enumerate(row)
            )
            occurrences.append(
                occurrence(
                    locator=locator,
                    discriminator=f"csv-record:{ordinal}",
                    fields=fields,
                    binding=request.binding_snapshot,
                    status="failure",
                    failures=("csv_extra_columns",),
                )
            )
            continue
        fields = tuple(
            raw_field(
                FIELD_NAMES[index],
                row[index] if index < len(row) else None,
                present=index < len(row),
                source_type="csv_text",
            )
            for index in range(len(FIELD_NAMES))
        )
        amount_text = row[6] if len(row) > 6 else ""
        via_hint = row[7] if len(row) > 7 and row[7] else None
        dates = make_date("交易时间", row[0] if row else None, "wallet_transaction_time", "source_precision")
        warnings = ("short_record_missing_cells",) if len(row) < len(FIELD_NAMES) else ()
        status = "failure" if len(row) < len(FIELD_NAMES) else "success"
        failures = ("csv_missing_trailing_cells",) if status == "failure" else ()
        occurrences.append(
            occurrence(
                locator=locator,
                discriminator=f"csv-record:{ordinal}",
                fields=fields,
                binding=request.binding_snapshot,
                via_hint=via_hint,
                amounts=(AmountObservation("金额", amount_text, "wallet_event_amount"),) if amount_text else (),
                dates=dates,
                external_ids=tuple(
                    ExternalId(namespace, row[index])
                    for index, namespace in ((9, "wallet.transaction_order"), (10, "wallet.merchant_order"))
                    if len(row) > index and row[index]
                ),
                direction=row[5] if len(row) > 5 else None,
                status_text=row[8] if len(row) > 8 else None,
                status=status,
                failures=failures,
                warnings=warnings,
            )
        )
    if not records[1:]:
        coverage_items.append(coverage("csv", "csv/records", "recognized", count="0"))
    return ProfileOutput(
        DETECTED_FORMAT,
        "partial_with_failures" if any(row.status == "failure" for row in occurrences) else "complete",
        tuple(coverage_items),
        tuple(occurrences),
        warnings=("denominator_unavailable",),
        denominator_unit=None,
        declared_count=None,
    )
