"""One-request stdin/stdout bridge for the Finance v2 source parser.

This module accepts bounded JSON on stdin, calls the pure bytes-in/value-out
parser once, and emits exactly one bounded JSON response on stdout.
"""

from __future__ import annotations

import base64
import binascii
import json
import sys
from typing import Any

from .artifact import parse_artifact
from .contract import CONTRACT_VERSION, BindingSnapshot, ParseRequest
from .profiles import PROFILE_REVISIONS, PROFILES

MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_REQUEST_BYTES = 90 * 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
MAX_BASE64_BYTES = 4 * ((MAX_SOURCE_BYTES + 2) // 3)
REQUEST_KEYS = {
    "contract_version",
    "artifact_id",
    "source_bytes_base64",
    "detected_media_type",
    "profile_id",
    "profile_revision",
    "binding_snapshot",
}
BINDING_KEYS = {
    "revision",
    "account_hint_to_ids",
    "via_hint_to_ids",
    "artifact_account_ids",
    "artifact_via_ids",
}
FORMATS = {"csv", "xlsx", "pdf", "unknown"}


class BridgeInputError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise BridgeInputError("duplicate_json_key")
        result[key] = value
    return result


def _reject_non_json_constant(_: str) -> None:
    raise BridgeInputError("invalid_json_constant")


def _string(value: Any, field: str, *, nonblank: bool = True) -> str:
    if not isinstance(value, str) or (nonblank and not value.strip()):
        raise BridgeInputError(f"invalid_{field}")
    return value


def _string_array(value: Any, field: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise BridgeInputError(f"invalid_{field}")
    return tuple(_string(item, field) for item in value)


def _mapping_array(value: Any, field: str) -> tuple[tuple[str, tuple[str, ...]], ...]:
    if not isinstance(value, list):
        raise BridgeInputError(f"invalid_{field}")
    mappings = []
    for pair in value:
        if not isinstance(pair, list) or len(pair) != 2:
            raise BridgeInputError(f"invalid_{field}")
        hint = _string(pair[0], field)
        ids = _string_array(pair[1], field)
        mappings.append((hint, ids))
    return tuple(mappings)


def _binding_snapshot(value: Any) -> BindingSnapshot:
    if not isinstance(value, dict) or set(value) != BINDING_KEYS:
        raise BridgeInputError("invalid_binding_snapshot_schema")
    return BindingSnapshot(
        revision=_string(value["revision"], "binding_revision"),
        account_hint_to_ids=_mapping_array(value["account_hint_to_ids"], "account_mapping"),
        via_hint_to_ids=_mapping_array(value["via_hint_to_ids"], "via_mapping"),
        artifact_account_ids=_string_array(value["artifact_account_ids"], "artifact_account_ids"),
        artifact_via_ids=_string_array(value["artifact_via_ids"], "artifact_via_ids"),
    )


def _decode_request(request_bytes: bytes) -> ParseRequest:
    try:
        value = json.loads(
            request_bytes.decode("utf-8", errors="strict"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_non_json_constant,
        )
    except BridgeInputError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BridgeInputError("invalid_request_json")
    if not isinstance(value, dict) or set(value) != REQUEST_KEYS:
        raise BridgeInputError("invalid_request_schema")
    if value["contract_version"] != CONTRACT_VERSION:
        raise BridgeInputError("unsupported_contract_version")

    artifact_id = _string(value["artifact_id"], "artifact_id")
    profile_id = _string(value["profile_id"], "profile_id")
    profile_revision = _string(value["profile_revision"], "profile_revision")
    media_type = _string(value["detected_media_type"], "detected_media_type")
    if media_type not in FORMATS:
        raise BridgeInputError("unsupported_detected_media_type")
    encoded = _string(value["source_bytes_base64"], "source_bytes_base64", nonblank=False)
    try:
        encoded_ascii = encoded.encode("ascii", errors="strict")
    except UnicodeEncodeError:
        raise BridgeInputError("invalid_source_bytes_base64")
    if len(encoded_ascii) > MAX_BASE64_BYTES:
        raise BridgeInputError("source_bytes_too_large")
    try:
        source_bytes = base64.b64decode(encoded_ascii, validate=True)
    except (binascii.Error, ValueError):
        raise BridgeInputError("invalid_source_bytes_base64")
    if len(source_bytes) > MAX_SOURCE_BYTES:
        raise BridgeInputError("source_bytes_too_large")

    profile = PROFILES.get(profile_id)
    if profile is not None and profile_revision != PROFILE_REVISIONS[profile_id]:
        raise BridgeInputError("unsupported_profile_revision")
    actual_format = profile.detect_format(source_bytes) if profile is not None else "unknown"
    if actual_format != media_type:
        raise BridgeInputError("detected_media_type_mismatch")
    return ParseRequest(
        artifact_id=artifact_id,
        source_bytes=source_bytes,
        profile_id=profile_id,
        profile_revision=profile_revision,
        binding_snapshot=_binding_snapshot(value["binding_snapshot"]),
        contract_version=CONTRACT_VERSION,
    )


def _encode_bounded(value: dict[str, Any]) -> bytes | None:
    encoder = json.JSONEncoder(ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    output = bytearray()
    for chunk in encoder.iterencode(value):
        encoded = chunk.encode("ascii")
        if len(output) + len(encoded) + 1 > MAX_RESPONSE_BYTES:
            return None
        output.extend(encoded)
    output.extend(b"\n")
    return bytes(output)


def _response(ok: bool, *, result: dict[str, Any] | None = None, error: str | None = None) -> bytes:
    envelope: dict[str, Any] = {"contract_version": CONTRACT_VERSION, "ok": ok}
    if ok:
        envelope["result"] = result
    else:
        envelope["error"] = error or "bridge_internal_error"
    encoded = _encode_bounded(envelope)
    if encoded is None and ok:
        encoded = _encode_bounded(
            {"contract_version": CONTRACT_VERSION, "ok": False, "error": "response_too_large"}
        )
    if encoded is None:
        # The fixed error envelope is far below the cap; this is defensive only.
        return b'{"contract_version":"finance-v2-source/1","ok":false,"error":"bridge_internal_error"}\n'
    return encoded


def _run(request_bytes: bytes) -> bytes:
    try:
        request = _decode_request(request_bytes)
    except BridgeInputError as error:
        return _response(False, error=error.code)
    except Exception:
        # Includes parser/library edge cases while reading hostile JSON; never echo details.
        return _response(False, error="invalid_request_json")
    try:
        result = parse_artifact(request)
        return _response(True, result=result.to_dict())
    except Exception:
        # Never return parser exception text: it could contain source material.
        return _response(False, error="bridge_internal_error")


def main() -> int:
    try:
        request_bytes = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    except Exception:
        response = _response(False, error="stdin_read_failed")
    else:
        if len(request_bytes) > MAX_REQUEST_BYTES:
            response = _response(False, error="request_too_large")
        else:
            response = _run(request_bytes)
    try:
        sys.stdout.buffer.write(response)
        sys.stdout.buffer.flush()
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
