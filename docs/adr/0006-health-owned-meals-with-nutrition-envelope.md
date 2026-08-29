# Health owns meals; nutrition remains an extensible meal attribute

- Status: Accepted
- Date: 2026-08-29

## Context

Orbita previously embedded meals inside the mixed-source `daily` JSON container. This makes a meal's product ownership, Garmin merge behavior, editing rights and future synchronization ambiguous. During the v0.0.18 redesign, there was also a plausible alternative: treat the meal narrative as Orbita Journal while treating calories and nutrients as separate Orbita Health records.

## Decision

For the v0.0.18 initial model, a meal is an **Orbita Health** record. It is an independently addressable manual fact, not a `daily` container field.

A meal stores its occurrence details (date/time, meal slot, foods, description and note) and has a reserved structured `nutrition` envelope. The envelope may contain calories and optional nutrient values such as protein, carbohydrate and fat. Its presence does not require automatic calculation, an AI estimate, a separate nutrition log or a user-visible nutrient editor in the initial release.

Health daily views and the Panel's intake side may aggregate a meal's nutrition values. They must not duplicate those values into a second mutable daily summary. A future, separately planned `nutrition_adjustment` Health record may represent supplements or nutrition that cannot be attributed to a meal; it is not part of v0.0.18.

## Consequences

- Meal CRUD, ownership, revision and future sync are per meal, rather than a mixed `daily` JSON overwrite.
- Garmin daily metrics remain independent, Garmin-owned Health facts and cannot overwrite meals.
- Insight Journal initially manages events and moods; it does not own meals.
- The data model can add nutrition functionality later without moving meals across domains or creating two competing calorie truths.

## Alternatives considered

1. Keep meals in the `daily` container: rejected because it preserves the mixed-source overwrite and ownership problem.
2. Make meals Journal records and nutrition separate Health records: deferred. It models the concepts well but introduces lifecycle, deletion, edit and double-counting rules before a real need is established.
3. Put all meal and nutrition data in Health: accepted for the initial release, with a nested nutrition envelope rather than a second record.

## Open questions

- Which nutrition fields, units and sources are exposed in the first Meal editor?
- When is a separate `nutrition_adjustment` record justified?
- Whether nutrition values can be imported or AI-estimated, and how their uncertainty is shown.
