#!/usr/bin/env python3
"""Validate journal-health/v1 fixtures against JSON Schemas and canonical hash vectors."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

CONTRACTS_ROOT = Path(__file__).resolve().parents[1]
V1_ROOT = CONTRACTS_ROOT / "journal-health" / "v1"
FIXTURES_DIR = V1_ROOT / "fixtures"
SCHEMAS_DIR = V1_ROOT / "schemas"
VECTORS_FILE = V1_ROOT / "test-vectors" / "canonical-hashes.json"

RECORD_SCHEMAS = {
    "daily_metrics": "daily_metrics.json",
    "metric_day_snapshot": "metric_day_snapshot.json",
    "sleep_night": "sleep_night.json",
    "nap": "nap.json",
    "meal": "meal.json",
    "activity": "activity.json",
    "body_measurement": "body_measurement.json",
    "event": "event.json",
    "mood": "mood.json",
    "note": "note.json",
}

HASH_INPUT_FIELD = {
    "daily_metrics": "data",
    "metric_day_snapshot": "payload",
    "sleep_night": "night",
    "nap": "payload",
    "meal": "payload",
    "activity": "activity",
    "body_measurement": "payload",
    "event": "payload",
    "mood": "payload",
    "note": "payload",
}


def canonical_json(obj: object) -> str:
    """RFC 8785/JCS for the contract's I-JSON fixtures.

    `json.dumps(sort_keys=True)` is deliberately insufficient: Python sorts
    Unicode scalar values and preserves ``1.0``, while JCS sorts UTF-16 units
    and emits ECMAScript's shortest number representation.
    """
    if obj is None:
        return "null"
    if obj is True:
        return "true"
    if obj is False:
        return "false"
    if isinstance(obj, str):
        return json.encoder.encode_basestring(obj)
    if isinstance(obj, int):
        return str(obj)
    if isinstance(obj, float):
        return _jcs_float(obj)
    if isinstance(obj, list):
        return "[" + ",".join(canonical_json(item) for item in obj) + "]"
    if isinstance(obj, dict):
        keys = sorted(obj, key=lambda key: key.encode("utf-16be"))
        return "{" + ",".join(
            f"{canonical_json(key)}:{canonical_json(obj[key])}" for key in keys
        ) + "}"
    raise TypeError(f"unsupported JSON value: {type(obj)!r}")


def _jcs_float(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError("JCS does not permit non-finite numbers")
    if value == 0:
        return "0"
    raw = repr(value).replace("E", "e")
    if "e" not in raw:
        return raw[:-2] if raw.endswith(".0") else raw
    mantissa, exponent_text = raw.split("e", 1)
    exponent = int(exponent_text)
    digits = mantissa.replace(".", "")
    sign = "" if not digits.startswith("-") else "-"
    digits = digits.removeprefix("-")
    point = (mantissa.find(".") if "." in mantissa else len(mantissa))
    if sign:
        point -= 1
    point += exponent
    if -6 <= point - 1 < 21:
        if point <= 0:
            return sign + "0." + "0" * -point + digits
        if point >= len(digits):
            return sign + digits + "0" * (point - len(digits))
        return sign + digits[:point] + "." + digits[point:]
    mantissa = mantissa[:-2] if mantissa.endswith(".0") else mantissa
    return f"{mantissa}e{'+' if exponent >= 0 else ''}{exponent}"


def content_hash(obj: object) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


def load_json(path: Path) -> object:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def validate_with_jsonschema(instance: object, schema_path: Path) -> list[str]:
    try:
        import jsonschema
        from jsonschema import Draft202012Validator
    except ImportError:
        return []

    schema = load_json(schema_path)
    validator = Draft202012Validator(schema)
    return [f"{e.message} @ {list(e.path)}" for e in validator.iter_errors(instance)]


def basic_validate(instance: dict, record_type: str) -> list[str]:
    errors: list[str] = []
    required = ["id", "source", "revision", "createdAtUtc", "updatedAtUtc", "naturalKey"]
    for field in required:
        if field not in instance:
            errors.append(f"missing required field: {field}")

    # type-specific required fields
    type_fields = {
        "daily_metrics": ["localDate", "data", "contentHash"],
        "metric_day_snapshot": ["localDate", "metricName", "payload", "contentHash"],
        "sleep_night": ["wakeDate", "night", "contentHash"],
        "nap": ["localDate", "payload"],
        "meal": ["localDate", "payload"],
        "activity": ["localDate", "activity", "contentHash"],
        "body_measurement": ["localDate", "payload", "contentHash"],
        "event": ["localDate", "payload"],
        "mood": ["localDate", "payload"],
        "note": ["localDate", "payload"],
    }
    for field in type_fields.get(record_type, []):
        if field not in instance:
            errors.append(f"missing type field: {field}")

    if record_type == "activity" and instance.get("source") == "garmin":
        if not instance.get("externalId"):
            errors.append("garmin activity requires externalId")
        nk = instance.get("naturalKey", {})
        if not nk.get("externalId"):
            errors.append("garmin activity naturalKey requires externalId")

    if record_type == "nap" and instance.get("source") == "garmin":
        if not instance.get("externalKey"):
            errors.append("garmin nap requires externalKey")

    if record_type == "metric_day_snapshot":
        nk = instance.get("naturalKey", {})
        for k in ("localDate", "metricName", "source", "coverage", "contentHash"):
            if k not in nk:
                errors.append(f"metric naturalKey missing: {k}")

    hash_field = HASH_INPUT_FIELD.get(record_type)
    if hash_field and "contentHash" in instance:
        payload = instance.get(hash_field)
        if payload is not None:
            expected = content_hash(payload)
            if instance["contentHash"] != expected:
                errors.append(
                    f"contentHash mismatch: expected {expected}, got {instance['contentHash']}"
                )

    return errors


def validate_fixtures() -> int:
    failures = 0
    for record_type, schema_file in RECORD_SCHEMAS.items():
        fixture_path = FIXTURES_DIR / f"{record_type}.json"
        if not fixture_path.is_file():
            print(f"FAIL missing fixture: {fixture_path.name}")
            failures += 1
            continue

        instance = load_json(fixture_path)
        if not isinstance(instance, dict):
            print(f"FAIL {fixture_path.name}: root must be object")
            failures += 1
            continue

        schema_path = SCHEMAS_DIR / schema_file
        schema_errors = validate_with_jsonschema(instance, schema_path)
        basic_errors = basic_validate(instance, record_type)
        errors = schema_errors or basic_errors

        if errors:
            failures += 1
            print(f"FAIL {fixture_path.name}:")
            for err in errors:
                print(f"  - {err}")
        else:
            print(f"OK   {fixture_path.name}")

    return failures


def validate_hash_vectors() -> int:
    failures = 0
    data = load_json(VECTORS_FILE)
    for vector in data.get("vectors", []):
        vid = vector.get("id", "?")
        inp = vector["input"]
        expected_canonical = vector["canonical"]
        expected_hash = vector["sha256"]
        actual_canonical = canonical_json(inp)
        actual_hash = content_hash(inp)
        if actual_canonical != expected_canonical:
            failures += 1
            print(f"FAIL vector {vid}: canonical mismatch")
            print(f"  expected: {expected_canonical}")
            print(f"  actual:   {actual_canonical}")
        elif actual_hash != expected_hash:
            failures += 1
            print(f"FAIL vector {vid}: hash mismatch")
            print(f"  expected: {expected_hash}")
            print(f"  actual:   {actual_hash}")
        else:
            print(f"OK   vector {vid}")
    return failures


def main() -> int:
    print("=== fixtures ===")
    fixture_failures = validate_fixtures()
    print("=== canonical hash vectors ===")
    vector_failures = validate_hash_vectors()
    total = fixture_failures + vector_failures
    if total:
        print(f"\n{total} failure(s)")
        return 1
    print("\nAll checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
