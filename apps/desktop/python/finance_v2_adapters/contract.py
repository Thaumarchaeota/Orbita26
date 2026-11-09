"""Immutable value contract for source extraction; contains no accounting Amount type."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

CONTRACT_VERSION = "finance-v2-source/1"


@dataclass(frozen=True)
class ResourceLimits:
    artifact_bytes: int = 64 * 1024 * 1024
    zip_entries: int = 4096
    zip_uncompressed_bytes: int = 256 * 1024 * 1024
    zip_entry_bytes: int = 64 * 1024 * 1024
    zip_compression_ratio: int = 200
    xlsx_sheets: int = 100
    xlsx_rows_per_sheet: int = 100_000
    xlsx_nonempty_cells: int = 2_000_000
    pdf_pages: int = 500
    pdf_text_characters: int = 20_000_000
    pdf_page_characters: int = 250_000
    occurrences: int = 250_000
    raw_field_bytes: int = 1024 * 1024
    raw_text_bytes: int = 2 * 1024 * 1024


DEFAULT_LIMITS = ResourceLimits()


@dataclass(frozen=True)
class BindingSnapshot:
    """Exact, already-confirmed mappings captured for one parse operation."""

    revision: str
    account_hint_to_ids: tuple[tuple[str, tuple[str, ...]], ...] = ()
    via_hint_to_ids: tuple[tuple[str, tuple[str, ...]], ...] = ()
    artifact_account_ids: tuple[str, ...] = ()
    artifact_via_ids: tuple[str, ...] = ()

    def resolve_account(self, hint: str | None) -> tuple[str, str | None]:
        if hint is None:
            return self._resolve_default(self.artifact_account_ids)
        return self._resolve_map(hint, self.account_hint_to_ids)

    def resolve_via(self, hint: str | None) -> tuple[str, str | None]:
        if hint is None:
            return self._resolve_default(self.artifact_via_ids)
        return self._resolve_map(hint, self.via_hint_to_ids)

    @staticmethod
    def _resolve_default(ids: tuple[str, ...]) -> tuple[str, str | None]:
        if len(ids) == 1:
            return "matched", ids[0]
        return ("ambiguous", None) if len(ids) > 1 else ("unresolved", None)

    @staticmethod
    def _resolve_map(
        hint: str, mappings: tuple[tuple[str, tuple[str, ...]], ...]
    ) -> tuple[str, str | None]:
        matches = [ids for key, ids in mappings if key == hint]
        if not matches:
            return "unresolved", None
        if len(matches) != 1 or len(matches[0]) != 1:
            return "ambiguous", None
        return "matched", matches[0][0]


@dataclass(frozen=True)
class ParseRequest:
    artifact_id: str
    source_bytes: bytes
    profile_id: str
    profile_revision: str
    binding_snapshot: BindingSnapshot
    contract_version: str = CONTRACT_VERSION
    limits: ResourceLimits = DEFAULT_LIMITS


@dataclass(frozen=True)
class RawField:
    name: str
    value_kind: Literal["text", "empty", "missing"]
    value_text: str | None = None
    source_type: str | None = None
    cached_value_text: str | None = None


@dataclass(frozen=True)
class AmountObservation:
    field: str
    amount_text: str
    role: str
    source_commodity_text: str | None = None
    reliability: str = "source_text"


@dataclass(frozen=True)
class DateObservation:
    field: str
    raw_text: str
    role: str
    precision: str
    source_timezone: str | None = None


@dataclass(frozen=True)
class ExternalId:
    namespace: str
    value_text: str


@dataclass(frozen=True)
class UntrustedObservation:
    """Formula provenance only; never a confirmed semantic source observation."""

    field: str
    semantic_role: str
    formula_text: str
    cached_value_text: str | None
    cache_present: bool
    trust: Literal["untrusted_formula_cache"] = "untrusted_formula_cache"


@dataclass(frozen=True)
class BindingValue:
    status: Literal["matched", "unresolved", "ambiguous"]
    source_hint: str | None
    stable_id: str | None
    binding_revision: str


@dataclass(frozen=True)
class Occurrence:
    locator: str
    occurrence_discriminator: str
    raw_fields: tuple[RawField, ...]
    raw_record_text: str | None = None
    amount_observations: tuple[AmountObservation, ...] = ()
    date_observations: tuple[DateObservation, ...] = ()
    external_ids: tuple[ExternalId, ...] = ()
    untrusted_observations: tuple[UntrustedObservation, ...] = ()
    source_direction_text: str | None = None
    source_status_text: str | None = None
    account_binding: BindingValue | None = None
    via_binding: BindingValue | None = None
    status: Literal["success", "unresolved", "failure"] = "success"
    failure_codes: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    raw_text_bytes: int = 0


@dataclass(frozen=True)
class UnitCoverage:
    unit: str
    locator: str
    status: str
    details: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class QualityReport:
    denominator_status: str
    denominator_unit: str | None
    declared_count: str | None
    completeness: str
    success_count: int
    unresolved_count: int
    failure_count: int
    coverage_issue_count: int = 0
    warnings: tuple[str, ...] = ()
    failures: tuple[tuple[str, str], ...] = ()
    amount_totals: tuple[tuple[str, str, str, str, str], ...] = ()


@dataclass(frozen=True)
class ParseResult:
    contract_version: str
    artifact_id: str
    sha256: str
    byte_length: int
    detected_format: str
    profile_id: str
    profile_revision: str
    binding_revision: str
    status: Literal["complete", "partial_with_failures", "unsupported", "failed"]
    coverage: tuple[UnitCoverage, ...]
    quality: QualityReport
    occurrences: tuple[Occurrence, ...] = ()
    error_code: str | None = None

    def to_dict(self) -> dict[str, object]:
        from dataclasses import asdict

        return asdict(self)
