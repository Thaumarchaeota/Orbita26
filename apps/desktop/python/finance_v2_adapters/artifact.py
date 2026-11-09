"""Bytes-only dispatcher for isolated Finance v2 adapters."""

from __future__ import annotations

from hashlib import sha256
import json
from dataclasses import replace

from .contract import (
    CONTRACT_VERSION,
    BindingSnapshot,
    DEFAULT_LIMITS,
    ParseRequest,
    ParseResult,
    QualityReport,
)
from .profiles import PROFILE_REVISIONS, PROFILES
from .profiles.common import AdapterFailure, ProfileOutput
from .quality import make_quality


def parse_artifact(request: ParseRequest) -> ParseResult:
    """Parse one immutable byte artifact; never opens paths or persists output."""
    _validate_request(request)
    raw = request.source_bytes
    digest = sha256(raw).hexdigest()
    byte_length = len(raw)
    profile = PROFILES.get(request.profile_id)
    if profile is None:
        return _empty_result(request, digest, byte_length, "unknown", "unsupported_profile")
    if request.profile_revision != PROFILE_REVISIONS[request.profile_id]:
        return _empty_result(
            request,
            digest,
            byte_length,
            profile.DETECTED_FORMAT,
            "unsupported_profile_revision",
        )

    if byte_length > request.limits.artifact_bytes:
        return _empty_result(request, digest, byte_length, profile.DETECTED_FORMAT, "resource_artifact_bytes")
    detected = profile.detect_format(raw)
    if detected == "unknown":
        return _empty_result(request, digest, byte_length, detected, "unsupported_container")
    if detected != profile.DETECTED_FORMAT:
        return _empty_result(request, digest, byte_length, detected, "profile_format_mismatch")

    try:
        output: ProfileOutput = profile.parse(request)
    except AdapterFailure as error:
        return _empty_result(
            request,
            digest,
            byte_length,
            error.detected_format or detected,
            error.code,
        )
    except Exception:
        # Do not expose parser exception text, which can contain source content.
        return _empty_result(request, digest, byte_length, detected, "adapter_parse_error")

    normalized_occurrences = []
    for row in output.occurrences:
        for field in row.raw_fields:
            field_bytes = len((field.value_text or "").encode("utf-8"))
            if field_bytes > request.limits.raw_field_bytes:
                return _empty_result(request, digest, byte_length, detected, "resource_raw_field_bytes")
            cached_bytes = len((field.cached_value_text or "").encode("utf-8"))
            if cached_bytes > request.limits.raw_field_bytes:
                return _empty_result(request, digest, byte_length, detected, "resource_raw_field_bytes")
        raw_text = _s1_raw_text(row)
        raw_size = len(raw_text.encode("utf-8"))
        if raw_size > request.limits.raw_text_bytes:
            return _empty_result(request, digest, byte_length, detected, "resource_raw_text_bytes")
        normalized_occurrences.append(replace(row, raw_text_bytes=raw_size))
    normalized_occurrences = tuple(normalized_occurrences)
    quality = make_quality(
        normalized_occurrences,
        output.coverage,
        denominator_unit=output.denominator_unit,
        declared_count=output.declared_count,
        warnings=output.warnings,
        completeness_forced_unproven=output.declared_count is None,
    )
    result_status = output.status
    if (quality.failure_count or quality.unresolved_count or quality.coverage_issue_count) and result_status == "complete":
        result_status = "partial_with_failures"
    return ParseResult(
        contract_version=CONTRACT_VERSION,
        artifact_id=request.artifact_id,
        sha256=digest,
        byte_length=byte_length,
        detected_format=output.detected_format,
        profile_id=request.profile_id,
        profile_revision=request.profile_revision,
        binding_revision=request.binding_snapshot.revision,
        status=result_status,  # type: ignore[arg-type]
        coverage=output.coverage,
        quality=quality,
        occurrences=normalized_occurrences,
        error_code=output.error_code,
    )


def _validate_request(request: ParseRequest) -> None:
    if not isinstance(request, ParseRequest):
        raise TypeError("request must be ParseRequest")
    if not isinstance(request.artifact_id, str):
        raise ValueError("artifact_id must be text")
    if not isinstance(request.binding_snapshot, BindingSnapshot):
        raise TypeError("binding_snapshot must be BindingSnapshot")
    if not isinstance(request.profile_id, str) or not isinstance(request.profile_revision, str):
        raise ValueError("profile id and revision must be text")
    if request.contract_version != CONTRACT_VERSION:
        raise ValueError("unsupported contract version")
    if not request.artifact_id.strip():
        raise ValueError("artifact_id must not be blank")
    if not request.profile_revision.strip():
        raise ValueError("profile_revision must not be blank")
    if not isinstance(request.binding_snapshot.revision, str) or not request.binding_snapshot.revision.strip():
        raise ValueError("binding revision must not be blank")
    for mappings in (request.binding_snapshot.account_hint_to_ids, request.binding_snapshot.via_hint_to_ids):
        for pair in mappings:
            if not isinstance(pair, tuple) or len(pair) != 2:
                raise ValueError("binding snapshot mapping must be a (hint, IDs) pair")
            key, ids = pair
            if not isinstance(key, str) or not key.strip() or not isinstance(ids, tuple):
                raise ValueError("binding snapshot contains an invalid mapping")
            if any(not isinstance(stable_id, str) or not stable_id.strip() for stable_id in ids):
                raise ValueError("binding snapshot contains a blank ID")
    if any(not isinstance(stable_id, str) or not stable_id.strip() for stable_id in (
        *request.binding_snapshot.artifact_account_ids,
        *request.binding_snapshot.artifact_via_ids,
    )):
        raise ValueError("binding snapshot contains a blank ID")
    if not isinstance(request.source_bytes, bytes):
        raise TypeError("source_bytes must be immutable bytes")
    if not isinstance(request.limits, type(DEFAULT_LIMITS)):
        raise TypeError("limits must be ResourceLimits")
    _validate_limits(request.limits)


def _validate_limits(limits) -> None:
    for name, maximum in DEFAULT_LIMITS.__dict__.items():
        value = getattr(limits, name)
        if not isinstance(value, int) or value <= 0 or value > maximum:
            raise ValueError(f"invalid resource limit: {name}")


def _empty_result(
    request: ParseRequest,
    digest: str,
    byte_length: int,
    detected: str,
    error_code: str,
) -> ParseResult:
    quality = QualityReport(
        denominator_status="unavailable",
        denominator_unit=None,
        declared_count=None,
        completeness="unproven",
        success_count=0,
        unresolved_count=0,
        failure_count=1,
        coverage_issue_count=0,
        failures=(("artifact", error_code),),
    )
    return ParseResult(
        contract_version=CONTRACT_VERSION,
        artifact_id=request.artifact_id,
        sha256=digest,
        byte_length=byte_length,
        detected_format=detected,
        profile_id=request.profile_id,
        profile_revision=request.profile_revision,
        binding_revision=request.binding_snapshot.revision,
        status="unsupported" if error_code.startswith("unsupported") or error_code == "profile_format_mismatch" else "failed",
        coverage=(),
        quality=quality,
        error_code=error_code,
    )


def _json_string(value: str) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return encoded.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def _s1_raw_text(row) -> str:
    if row.raw_record_text is not None:
        return _json_string(row.raw_record_text)
    pieces = []
    for field in row.raw_fields:
        key = _json_string(field.name)
        if field.value_kind == "missing":
            value = "<missing>"
        else:
            value = _json_string(field.value_text or "")
        pieces.append(f"{key}={value}")
    if len(pieces) == 1 and row.raw_fields[0].name == "record_text":
        return pieces[0].split("=", 1)[1]
    return " | ".join(pieces)
