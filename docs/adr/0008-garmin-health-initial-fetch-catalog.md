# Garmin Health initial fetch catalog separates summaries, series, and measurements

- Status: Accepted
- Date: 2026-08-29

## Context

Orbita's existing Garmin connector only keeps a small daily summary, a sleep summary and cycling activity summaries. The v0.0.18 Health redesign needs a deliberate non-Activity data boundary without treating Garmin Connect's private, device-dependent responses as a guaranteed public contract.

## Decision

The initial Garmin Health fetch catalog is:

1. daily health summary;
2. all-day heart rate, stress, Body Battery, respiration and SpO2 series;
3. sleep detail and HRV data;
4. hydration;
5. weight/body-composition measurements;
6. blood pressure as an optional capability probe only.

The catalog excludes Activity/FIT detail. All imported Garmin facts are read-only in Orbita. A value is stored with its returned timestamp and source coverage; missing samples, unsupported endpoints and unavailable device data remain distinguishable from numeric zero.

The initial implementation must first perform a bounded, read-only today-and-yesterday capability probe against the installed client library and the user's account. It must not trigger SSO, retry storms, data writes, or automatic historical backfill. The probe determines field shape, cadence, availability, UTC+8 interpretation and a safe rate budget before UI or historical fetch commitments are made.

## Consequences

- Health gains an explicit Garmin time-series layer, separate from manual Health records and Journal records.
- SpO2, respiration and HRV can be preserved when supplied, but their absence is expected rather than an error.
- Blood pressure cannot be presented as watch-measured: it is generally manually entered into Garmin Connect or supplied by another device, and remains outside the first visible Health UI unless separately approved.
- Future synchronization should move a metric-day snapshot/coverage unit, not create an outbox item for every sample.

## Alternatives considered

1. Keep only daily aggregates: rejected because it prevents meaningful intraday Health review.
2. Fetch every exposed Garmin endpoint immediately: rejected because capability, privacy, data volume and product relevance vary substantially.
3. Treat activity/FIT streams as all-day health series: rejected because they have a distinct activity/archive lifecycle.

## Open questions

- Which of the initial series is visible in the first Health UI after the capability probe?
- What historical window and refresh cadence respect Garmin rate limits?
- Whether blood pressure ever belongs in Orbita Health and, if so, what privacy/medical-data safeguards are required.
