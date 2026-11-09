"""Small deterministic quality-report helpers; never treats missing denominators as proof."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
from typing import Iterable

from .contract import AmountObservation, Occurrence, QualityReport, UnitCoverage


def make_quality(
    occurrences: Iterable[Occurrence],
    coverage: Iterable[UnitCoverage],
    *,
    denominator_unit: str | None = None,
    declared_count: str | None = None,
    warnings: Iterable[str] = (),
    completeness_forced_unproven: bool = True,
) -> QualityReport:
    rows = tuple(occurrences)
    units = tuple(coverage)
    failures = tuple(
        (row.locator, code)
        for row in rows
        for code in row.failure_codes
    )
    failures += tuple(
        (unit.locator, f"coverage:{unit.status}")
        for unit in units
        if unit.status in {"unsupported", "failed", "missing", "partial"}
    )
    success_count = sum(row.status == "success" for row in rows)
    unresolved_count = sum(row.status == "unresolved" for row in rows)
    failure_count = sum(row.status == "failure" for row in rows)
    coverage_issue_count = sum(
        unit.status in {"unsupported", "failed", "missing", "partial"} for unit in units
    )
    amount_totals = _amount_totals(rows)
    if failures or coverage_issue_count:
        completeness = "partial"
    elif completeness_forced_unproven or declared_count is None:
        completeness = "unproven"
    else:
        completeness = "profile_checked"
    return QualityReport(
        denominator_status="available" if declared_count is not None else "unavailable",
        denominator_unit=denominator_unit,
        declared_count=declared_count,
        completeness=completeness,
        success_count=success_count,
        unresolved_count=unresolved_count,
        failure_count=failure_count,
        coverage_issue_count=coverage_issue_count,
        warnings=tuple(warnings),
        failures=failures,
        amount_totals=amount_totals,
    )


def _amount_totals(
    rows: tuple[Occurrence, ...],
) -> tuple[tuple[str, str, str, str, str], ...]:
    buckets: dict[tuple[str, str, str, str], Decimal] = {}
    for row in rows:
        if row.status == "failure":
            continue
        account_id = (
            row.account_binding.stable_id
            if row.account_binding and row.account_binding.status == "matched"
            else "unbound"
        )
        direction = row.source_direction_text or "unprovided"
        for item in row.amount_observations:
            commodity = item.source_commodity_text or "unprovided"
            try:
                normalized = item.amount_text.strip()
                if not re.fullmatch(r"[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?", normalized):
                    continue
                value = Decimal(normalized.replace(",", ""))
            except (InvalidOperation, AttributeError):
                continue
            sign = (
                "negative"
                if normalized.startswith("-") or value < 0
                else "positive"
                if normalized.startswith("+") or value > 0
                else "zero"
            )
            key = (account_id, direction, sign, f"{commodity}|{item.role}")
            buckets[key] = buckets.get(key, Decimal(0)) + value
    return tuple(
        (account_id, direction, sign, commodity_role, format(value, "f"))
        for (account_id, direction, sign, commodity_role), value in sorted(buckets.items())
    )
