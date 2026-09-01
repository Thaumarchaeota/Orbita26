# Canonical JSON rules (journal-health/v1)

Normative rules for serializing JSON prior to SHA-256 content hashing. Equivalent to [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785) with the Orbita-specific hash input selections below.

## 1. Serialization

| Rule | Requirement |
| --- | --- |
| Encoding | UTF-8 without BOM |
| Object keys | Lexicographically sorted by UTF-16 code unit (not host-language UTF-8/string order) |
| Whitespace | None between tokens |
| Numbers | RFC 8785 / ECMAScript shortest IEEE-754 representation; a positive scientific exponent has `+` (for example `1e+21`); use fixed notation for `[1e-6, 1e21)` |
| Strings | JSON escape rules; non-ASCII allowed unescaped in UTF-8 |
| Arrays | Preserve element order (array order is significant) |
| `null` | Literal `null` |
| Booleans | `true` / `false` lowercase |
| Timestamps in payloads | Unix epoch **seconds** as JSON integers unless a field explicitly requires RFC 3339 strings |

## 2. Hash algorithm

```
contentHash = lowercase_hex( SHA-256( canonical_utf8_bytes ) )
```

## 3. Hash input per record type

| `recordType` | Hash input object | Notes |
| --- | --- | --- |
| `daily_metrics` | `data` field only | Excludes `fetchedAt`, envelope, `naturalKey` |
| `metric_day_snapshot` | `payload` (`samples`, `coverage`, optional `parserRev`) | Sample array order preserved |
| `sleep_night` | `night` object | Stages, score, sleep timestamps |
| `nap` | `payload` object | `start`, `end`, `duration`, optional fields |
| `meal` | `payload` object | Slot, text, kcal, items |
| `activity` | `activity` object | Sport, duration, metrics |
| `body_measurement` | `payload` object | weightKg, externalId, source |
| `event` | `payload` object | at, remark |
| `mood` | `payload` object | primary, data |
| `note` | `payload` object | title, body, at |

Types without a content hash (`meal`, `event`, `mood`, `note`) still carry `naturalKey` on the wire; conflict detection uses `revision` + full snapshot equality.

## 4. Natural keys (not hashed)

Natural keys identify facts for server-side deduplication. They are **copied into** `SyncChange.naturalKey` and the snapshot but are not part of the hash input unless they also appear inside the hash input object.

| `recordType` | Natural key fields |
| --- | --- |
| `daily_metrics` | `localDate`, `source` |
| `metric_day_snapshot` | `localDate`, `metricName`, `source`, `coverage`, `contentHash` |
| `sleep_night` | `wakeDate`, `source` |
| `nap` (garmin) | `localDate`, `source`, `externalKey` |
| `nap` (manual) | `id` |
| `meal` | `id` |
| `activity` (garmin) | `externalId` |
| `activity` (manual) | `id` |
| `body_measurement` | `localDate`, `source`, `contentHash` |
| `event`, `mood`, `note` | `id` |

### Garmin `externalKey` for naps

```
externalKey = "garmin:{start}:{end}:{duration}"
```

where `start`, `end`, `duration` are integer epoch seconds / seconds from `payload`.

## 5. RFC 3339 envelope timestamps

Envelope fields use UTC with second precision:

```
YYYY-MM-DDTHH:MM:SSZ
```

Examples: `2026-01-15T08:00:00Z`. Sub-second fractions are prohibited on the wire in v1.

## 6. Reference implementation requirement

```python
Implementations MUST use an RFC 8785 (JCS) implementation, or an implementation
proved against the cross-language vectors. Generic JSON serializers (including
Python `json.dumps(sort_keys=True)`) are not conforming because their string-key
order and floating-point formatting can differ from JCS.
```

## 7. Prohibited in hash input

- `fetchedAt`, `createdAtUtc`, `updatedAtUtc`, `deletedAtUtc`
- Envelope metadata (`id`, `revision`, `source` on the outer snapshot)
- Transport fields (`opId`, `baseServerVersion`, `origin`)
- Excluded domains per [`../excluded-domains.json`](../excluded-domains.json)
