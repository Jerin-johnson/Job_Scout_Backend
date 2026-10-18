# ADR 0016: Evaluate matching by ranking constraints

Last verified against commit `f4b536709b1154acf5d88a0e7ce9c58ec19be1b7` plus working-tree changes on 2026-10-17.

## As built (verified in code)

`npm run eval:match-rank-gate` compares v2/v3/v4 on relevant-versus-irrelevant pairs and 14 India-versus-US eligibility pairs. The current fixture run passes all pairs for all three versions, so no challenger improves ranking over v2. `npm run eval:jobs-phase3` remains a separate score calibration report.

## Target design (not built yet)

The evaluator does not yet include an independently hand-labeled 300-job relevance set; current pairwise fixtures are regression controls, not a production-quality benchmark.

Status: implemented as a comparison script; lexical-v2 remains the default.

Absolute score changes across score versions are not comparable when weights or calibration change. The ship gate should compare pairwise order constraints: relevant jobs outrank irrelevant controls, and a job eligible for the applicant's country outranks an otherwise similar country-ineligible posting. Report score calibration separately from rank quality. Keep lexical-v2 as default until v3/v4 pass all existing fixtures and 14 US-only controls without breaking any pairwise assertion.

This ADR does not assert that a newer version passed the ship gate.
