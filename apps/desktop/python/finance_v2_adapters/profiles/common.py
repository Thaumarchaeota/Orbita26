"""Shared profile primitives. Every source value stays lexical text."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Iterable

from ..contract import (
    AmountObservation,
    BindingSnapshot,
    BindingValue,
    DateObservation,
    ExternalId,
    Occurrence,
    RawField,
    UntrustedObservation,
    UnitCoverage,
)


@dataclass(frozen=True)
class ProfileOutput:
    detected_format: str
    status: str
    coverage: tuple[UnitCoverage, ...]
    occurrences: tuple[Occurrence, ...]
    warnings: tuple[str, ...] = ()
    denominator_unit: str | None = None
    declared_count: str | None = None
    error_code: str | None = None


class AdapterFailure(Exception):
    def __init__(self, code: str, detected_format: str = "unknown") -> None:
        self.code = code
        self.detected_format = detected_format
        super().__init__(code)


def raw_field(
    name: str,
    value: str | None,
    *,
    present: bool = True,
    source_type: str | None = None,
    cached_value_text: str | None = None,
) -> RawField:
    if not present:
        return RawField(name, "missing", None, source_type, cached_value_text)
    if value is None or value == "":
        return RawField(name, "empty", None, source_type, cached_value_text)
    return RawField(name, "text", value, source_type, cached_value_text)


def account_binding(
    snapshot: BindingSnapshot, hint: str | None
) -> BindingValue:
    status, stable_id = snapshot.resolve_account(hint)
    return BindingValue(status, hint, stable_id, snapshot.revision)


def via_binding(snapshot: BindingSnapshot, hint: str | None) -> BindingValue:
    status, stable_id = snapshot.resolve_via(hint)
    return BindingValue(status, hint, stable_id, snapshot.revision)


def occurrence(
    *,
    locator: str,
    discriminator: str,
    fields: Iterable[RawField],
    binding: BindingSnapshot,
    account_hint: str | None = None,
    via_hint: str | None = None,
    amounts: Iterable[AmountObservation] = (),
    dates: Iterable[DateObservation] = (),
    external_ids: Iterable[ExternalId] = (),
    untrusted_observations: Iterable[UntrustedObservation] = (),
    direction: str | None = None,
    status_text: str | None = None,
    status: str = "success",
    failures: Iterable[str] = (),
    warnings: Iterable[str] = (),
    raw_text_bytes: int | None = None,
    raw_record_text: str | None = None,
) -> Occurrence:
    ordered_fields = tuple(fields)
    if raw_text_bytes is None:
        raw_text_bytes = len(
            " | ".join(
                f"{field.name}={field.value_text or ''}" for field in ordered_fields
            ).encode("utf-8")
        )
    account_result = account_binding(binding, account_hint)
    via_result = via_binding(binding, via_hint) if via_hint is not None else None
    effective_status = status
    warning_list = list(warnings)
    if account_result.status != "matched" and effective_status == "success":
        effective_status = "unresolved"
        warning_list.append(f"account_binding_{account_result.status}")
    if via_result and via_result.status != "matched" and effective_status == "success":
        effective_status = "unresolved"
        warning_list.append(f"via_binding_{via_result.status}")
    failure_list = tuple(failures)
    if failure_list:
        effective_status = "failure"
    return Occurrence(
        locator=locator,
        occurrence_discriminator=discriminator,
        raw_fields=ordered_fields,
        raw_record_text=raw_record_text,
        amount_observations=tuple(amounts),
        date_observations=tuple(dates),
        external_ids=tuple(external_ids),
        untrusted_observations=tuple(untrusted_observations),
        source_direction_text=direction,
        source_status_text=status_text,
        account_binding=account_result,
        via_binding=via_result,
        status=effective_status,
        failure_codes=failure_list,
        warnings=tuple(warning_list),
        raw_text_bytes=raw_text_bytes,
    )


def content_digest(data: bytes) -> str:
    return sha256(data).hexdigest()


def parseable_amount(text: str) -> bool:
    """True only for finite base-10 numbers; used for quality warnings, not L0."""
    from decimal import Decimal, InvalidOperation

    try:
        value = Decimal(text.replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        return False
    return value.is_finite()


def limit_occurrences(rows: list[Occurrence], limit: int) -> None:
    if len(rows) > limit:
        raise AdapterFailure("resource_occurrence_limit")


def coverage(unit: str, locator: str, status: str, **details: str) -> UnitCoverage:
    return UnitCoverage(unit, locator, status, tuple(sorted(details.items())))


def make_date(field: str, raw: str | None, role: str, precision: str) -> tuple[DateObservation, ...]:
    if raw is None or raw == "":
        return ()
    return (DateObservation(field, raw, role, precision),)
