"""Version 1 bounded one-unit protocol. Assets use a host-created staging path."""
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

from garmin_lib import (
    connect_with_token,
    fetch_activities,
    fetch_activities_with_evidence,
    map_metric_snapshot,
    map_daily,
    map_sleep,
    map_body_measurement,
    token_file_path,
)
from garmin_normalize import (
    _map_daily_summary,
    _map_series_entry,
    _map_sleep,
    _map_naps,
    _map_body_measurement,
    _map_activity,
)

PROTOCOL_VERSION = 1
MAX_CONTROL_FRAME = 1024 * 1024
UNIT_KINDS = {
    "fetch_daily_class", "discover_activity_list", "fetch_activity_summary",
    "fetch_activity_detail", "fetch_activity_original",
}
OUTCOMES = {
    "complete", "no_data", "empty_unverified", "incomplete", "retryable_failure",
    "terminal_failure", "rate_limited", "token_invalid", "cancelled",
}
MAX_REUSE_ENTRIES = 300
MAX_REUSE_BYTES = 512 * 1024
MAX_REUSE_ENTRY_BYTES = 256 * 1024


class ProviderRateLimited(Exception):
    status_code = 429


class RateLimitGuard:
    """Keep swallowed provider 429s sticky across legacy mapping helpers (§20.3)."""
    def __init__(self, client, state=None):
        self._client = client
        self._state = state if state is not None else [False]

    def check_rate_limit(self):
        if self._state[0]:
            raise ProviderRateLimited()

    def __getattr__(self, name):
        value = getattr(self._client, name)
        if name == "client":
            return RateLimitGuard(value, self._state)
        if not callable(value):
            return value
        def guarded(*args, **kwargs):
            self.check_rate_limit()
            try:
                return value(*args, **kwargs)
            except Exception as exc:
                status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
                if status == 429 or type(exc).__name__ in {"GarminConnectTooManyRequestsError", "GarthTooManyRequestsError"}:
                    self._state[0] = True
                    raise ProviderRateLimited() from None
                raise
        return guarded


def encoded_size(value):
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def reusable_entry(entry):
    return (isinstance(entry, dict) and entry.get("completeness") == "complete"
            and entry.get("parserVersion") == 2 and isinstance(entry.get("payload"), dict)
            and isinstance(entry.get("contentHash"), str) and bool(entry["contentHash"])
            and encoded_size(entry) <= MAX_REUSE_ENTRY_BYTES)


def budget_optional_entries(response):
    """Optional reuse may be omitted; the authoritative unit/list must stay intact."""
    used = count = 0
    candidates = []
    for entry in response.get("relatedEntries", []):
        candidates.append((entry, None))
    for item in (response.get("payload") or {}).get("activities", []):
        if "normalizedEntry" in item:
            candidates.append((item["normalizedEntry"], item))
    response.pop("relatedEntries", None)
    for _, item in candidates:
        if item is not None:
            item.pop("normalizedEntry", None)
    for entry, item in candidates:
        size = encoded_size(entry)
        if not reusable_entry(entry) or count >= MAX_REUSE_ENTRIES or used + size > MAX_REUSE_BYTES:
            continue
        if item is None:
            response.setdefault("relatedEntries", []).append(entry)
        else:
            item["normalizedEntry"] = entry
        if encoded_size(response) > MAX_CONTROL_FRAME:
            if item is None:
                response["relatedEntries"].pop()
            else:
                item.pop("normalizedEntry", None)
            continue
        used += size
        count += 1
    return response


def read_frame(stream):
    header = stream.read(36)
    if len(header) != 36:
        raise ValueError("invalid frame header")
    length = struct.unpack(">I", header[:4])[0]
    if not 0 < length <= MAX_CONTROL_FRAME:
        raise ValueError("control frame exceeds limit")
    payload = stream.read(length)
    if len(payload) != length or stream.read(1):
        raise ValueError("truncated, duplicate, or trailing frame")
    if hashlib.sha256(payload).digest() != header[4:]:
        raise ValueError("control frame checksum mismatch")
    request = json.loads(payload.decode("utf-8"))
    if request.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("unsupported protocolVersion")
    if request.get("unitKind") not in UNIT_KINDS:
        raise ValueError("unsupported unitKind")
    for field in ("requestId", "jobId", "workItemId", "dataDirKey"):
        if not isinstance(request.get(field), str) or not request[field]:
            raise ValueError("missing " + field)
    if not isinstance(request.get("cancellationGeneration"), int):
        raise ValueError("missing cancellationGeneration")
    return request


def write_frame(stream, response):
    response = budget_optional_entries(response)
    payload = json.dumps(response, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if not 0 < len(payload) <= MAX_CONTROL_FRAME:
        raise ValueError("response frame exceeds limit")
    stream.write(struct.pack(">I", len(payload)))
    stream.write(hashlib.sha256(payload).digest())
    stream.write(payload)
    stream.flush()


def original_staging_target(request):
    """Accept only an existing regular file under Rust's dataDir-bound staging folder."""
    if request["unitKind"] != "fetch_activity_original":
        return None
    root = Path(request["dataDirRoot"]).resolve(strict=True)
    target = Path(request["stagingPath"]).resolve(strict=True)
    staging = (root / "health" / "activities" / ".staging").resolve(strict=True)
    if staging.parent != (root / "health" / "activities").resolve(strict=True):
        raise ValueError("invalid staging root")
    if target.parent != staging or not target.is_file():
        raise ValueError("staging file must be pre-created by Rust")
    return target


def response_for(request, outcome="terminal_failure", **fields):
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request["requestId"],
        "jobId": request["jobId"],
        "workItemId": request["workItemId"],
        "unitKind": request["unitKind"],
        "dataDirKey": request["dataDirKey"],
        "cancellationGeneration": request["cancellationGeneration"],
        "outcome": outcome,
        "payload": None,
        **fields,
    }


def fetch_unit(request, token_dir):
    """Fetch and normalize exactly one requested core unit using the saved token."""
    kind = request["unitKind"]
    target = request.get("target") or {}
    local_date = target.get("localDate")
    if kind != "discover_activity_list" and (not isinstance(local_date, str) or len(local_date) != 10):
        return response_for(request, "terminal_failure", errorCode="invalid_target")
    client, reason, _message = connect_with_token(token_dir, token_file_path(token_dir))
    if client is None:
        code = str(reason or "token_invalid")
        if code == "rate_limited":
            return response_for(request, "rate_limited", errorCode="rate_limited")
        return response_for(request, "token_invalid" if code in {"no_token", "token_invalid"} else "terminal_failure",
                            errorCode="token_invalid" if code in {"no_token", "token_invalid"} else "token_unavailable")
    client = RateLimitGuard(client)

    if kind == "fetch_daily_class":
        class_id = target.get("classId")
        entry = None
        if class_id == "health_day_summary":
            daily = map_daily(client, local_date)
            entry = _map_daily_summary(daily)
        elif class_id in {
            "health_day_sample_hr", "health_day_sample_stress", "health_day_sample_body_battery",
            "health_day_sample_spo2", "health_day_sample_respiration", "health_day_sample_hrv",
            "health_day_sample_steps",
        }:
            classes = {
                "hr": "health_day_sample_hr", "stress": "health_day_sample_stress",
                "body_battery": "health_day_sample_body_battery", "spo2": "health_day_sample_spo2",
                "respiration": "health_day_sample_respiration", "hrv": "health_day_sample_hrv",
                "steps_cumulative": "health_day_sample_steps",
            }
            metric = next(metric for metric, mapped_class in classes.items() if mapped_class == class_id)
            snapshot = map_metric_snapshot(client, local_date, metric)
            client.check_rate_limit()
            entry = _map_series_entry(snapshot) if snapshot.get("sampleCount", 0) > 0 else None
            if entry is None:
                entry = {"classId": class_id, "localDate": local_date, "completeness": "empty"}
        elif class_id in {"sleep_night", "nap"}:
            routine = map_sleep(client, local_date)
            client.check_rate_limit()
            related = []
            other_mapper = _map_naps if class_id == "sleep_night" else _map_sleep
            # The sibling mapping cannot invalidate the requested unit, and vice versa.
            if routine is not None:
                try:
                    other = other_mapper(routine)
                    if reusable_entry(other):
                        related.append(other)
                except Exception:
                    pass
            try:
                entry = (_map_sleep(routine) if class_id == "sleep_night" else _map_naps(routine)) if routine is not None else {
                    "classId": class_id, "localDate": local_date, "completeness": "empty"
                }
            except Exception:
                return response_for(request, "retryable_failure", errorCode="normalize_failed", relatedEntries=related)
        elif class_id == "body_comp_on_day":
            measurement = map_body_measurement(client, local_date)
            entry = _map_body_measurement(measurement) if measurement else {
                "classId": class_id, "localDate": local_date, "completeness": "empty"
            }
        else:
            return response_for(request, "terminal_failure", errorCode="unsupported_class")
        client.check_rate_limit()
        related = locals().get("related", [])
        if entry.get("completeness") == "complete":
            return response_for(request, "complete", payload=entry, contentHash=entry.get("contentHash"), relatedEntries=related)
        return response_for(request, "empty_unverified", payload=entry, relatedEntries=related)

    if kind == "fetch_activity_summary":
        activity_id = target.get("externalId")
        if not isinstance(activity_id, str) or not activity_id:
            return response_for(request, "terminal_failure", errorCode="invalid_target")
        activities, evidence = fetch_activities_with_evidence(client, local_date, local_date)
        client.check_rate_limit()
        if isinstance(activities, dict):
            activities = activities.get("activities", [])
        match = next((a for a in activities or [] if str(a.get("activityId") or a.get("activityIdDTO") or a.get("id")) == activity_id), None)
        if match is None:
            return response_for(request, "no_data" if evidence.get("complete") else "incomplete")
        entry = _map_activity({"date": local_date, "externalId": activity_id, "summary": match}, core_only=True)
        return response_for(request, "complete", payload=entry, contentHash=entry.get("contentHash"))

    if kind == "discover_activity_list":
        from_date, to_date = target.get("fromDate"), target.get("toDate")
        if not isinstance(from_date, str) or not isinstance(to_date, str):
            return response_for(request, "terminal_failure", errorCode="invalid_target")
        activities, evidence = fetch_activities_with_evidence(client, from_date, to_date)
        client.check_rate_limit()
        ids = []
        for activity in activities:
            external_id = activity.get("activityId") or activity.get("activityIdDTO") or activity.get("id")
            local = activity.get("startTimeLocal") or activity.get("startTimeGMT") or ""
            if external_id is not None and isinstance(local, str) and len(local) >= 10:
                item = {"externalId": str(external_id), "localDate": local[:10]}
                ids.append(item)
        if len(ids) != len(activities):
            evidence["complete"] = False
            evidence["invalidActivityIdentity"] = True
        unique = {item["externalId"]: item for item in ids}
        if len(unique) != len(ids):
            evidence["complete"] = False
            evidence["duplicateActivityIds"] = True
        outcome = "complete" if evidence["complete"] else "incomplete"
        used = count = 0
        if outcome == "complete":
            for activity, item in zip(activities, ids):
                if count >= MAX_REUSE_ENTRIES or used >= MAX_REUSE_BYTES:
                    break
                try:
                    entry = _map_activity({"date": item["localDate"], "externalId": item["externalId"], "summary": activity}, core_only=True)
                    size = encoded_size(entry)
                    if reusable_entry(entry) and used + size <= MAX_REUSE_BYTES:
                        item["normalizedEntry"] = entry
                        used += size
                        count += 1
                except Exception:
                    pass
        return budget_optional_entries(response_for(request, outcome, payload={"activities": list(unique.values()), "evidence": evidence}))

    # Detail and Original remain explicitly unsupported until their own bounded asset
    # staging/commit path is implemented. Daily core never dispatches these kinds.
    return response_for(request, "terminal_failure", errorCode="unit_kind_unsupported")


def main():
    try:
        request = read_frame(sys.stdin.buffer)
        # Keep credentials out of the control frame. Rust passes only the existing token
        # directory as a process argument, and this adapter never enters the SSO flow.
        token_dir = os.environ.get("ORBITA_GARMIN_TOKEN_DIR", "")
        if len(sys.argv) == 3 and sys.argv[1] == "--token-dir":
            token_dir = sys.argv[2]
        if not token_dir:
            response = response_for(request, "token_invalid", errorCode="token_invalid")
        elif request["unitKind"] in {"fetch_activity_detail", "fetch_activity_original"}:
            if request["unitKind"] == "fetch_activity_original":
                original_staging_target(request)
            response = response_for(request, "terminal_failure", errorCode="unit_kind_unsupported")
        else:
            response = fetch_unit(request, str(Path(token_dir).expanduser().resolve()))
        write_frame(sys.stdout.buffer, response)
        return 0
    except Exception as exc:
        # stdout stays framed and machine-readable, including malformed requests.
        request = locals().get("request")
        if isinstance(request, dict) and all(k in request for k in (
            "requestId", "jobId", "workItemId", "unitKind", "dataDirKey", "cancellationGeneration"
        )):
            status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
            if status == 429:
                outcome, code = "rate_limited", "rate_limited"
            elif status in (401, 403):
                outcome, code = "token_invalid", "token_invalid"
            else:
                outcome, code = "retryable_failure", "fetch_failed"
            write_frame(sys.stdout.buffer, response_for(request, outcome, errorCode=code))
        else:
            # No trustworthy request identity means Rust will reject this diagnostic frame;
            # it is still bounded and never leaks exception text or source payload.
            invalid = {"requestId": "invalid", "jobId": "invalid", "workItemId": "invalid",
                       "unitKind": "fetch_daily_class", "dataDirKey": "invalid",
                       "cancellationGeneration": 0}
            write_frame(sys.stdout.buffer, response_for(invalid, "terminal_failure", errorCode="protocol_invalid"))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
