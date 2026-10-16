# ADR 10: Owner-confirmed career profile and deterministic suggestions

Last verified against commit `3b3d1bb` on 2026-10-16.

## As built (verified in code)

Backend schema validation and owner-scoped APIs use the existing Profile document and static catalogs. Profile suggestions do not persist automatically.

**Status:** Accepted for Gate 2 implementation

The career profile is an additive field on the existing owner-scoped Profile document. The API validates bounded fields and uses profile version checks. Suggestions are derived from existing resume facts and from small static role/place catalogs; they are never auto-saved. There are no language defaults. The frontend provides the single explicit-save form, role/place suggestions, experience confirmation/fresher choice, compensation units, completeness prompts, and retains user edits on 409 stale-version responses. Resume AI processing uses a separate explicit, versioned consent record.

Role labels remain free text. Canonical role IDs and exact aliases are suggestions only. Place aliases are versioned, normalize Unicode accents/case/punctuation/whitespace, and do not use fuzzy matching or silently convert user input. City/region pairs must agree; ambiguous place names request confirmation. `Remote` and `Anywhere in India` are explicit options.

Monthly compensation is annualized by multiplying by 12 only when currencies match. Hourly and unknown periods and mismatched currencies are not compared. No exchange-rate service is used.

Career profile reads and writes remain within the existing MongoDB profile collection. No new paid service, dependency, database, or external data set is introduced. Migration is report-only until separately approved.

## Target design (not built yet)

Future profile additions require an additive schema change, frontend contract test, version-conflict handling, and privacy review before any profile fields are added to model context.
