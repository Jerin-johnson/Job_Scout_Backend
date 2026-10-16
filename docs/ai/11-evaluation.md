# 11 — Evaluation

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Run npm test for unit and MongoDB-memory-server integration tests. Job coverage includes 15 role-family fixtures, a realistic profile with no role facts and free-text location, typo suggestion confirmation, and 421-job capped retrieval where an older relevant job is retained. Interview fixtures are in evals/interviewFixtures.js and tests/interview.test.js covers modes, evaluator expectations, injection delimiters and output schema. Resume extraction and frontend markdown security have fixture/unit tests.

The active matching version defaults to lexical-v2. Run `npm run eval:match-versions` to see named v2/v3 fixture scores, bands, and deltas. Live dev profile diagnostics are in ../JOB_MATCHING.md; all 392 candidates were below Fair, so this is an honest catalog/profile mismatch, not evidence for weight tuning. Prompts other than interview sessions lack central versions. No consolidated chat-generation quality dataset or human-rated score baseline exists in this checkout.

## Target design (not built yet)

Version every prompt/score change, publish eval results with the change, and block merges on representative regressions. Add human-reviewed cases for occupation, country eligibility, multilingual facts, short answers and adversarial inputs. Separate deterministic correctness from subjective generation quality.

**Unverified:** human-rated baseline, provider parity, multilingual performance and population-wide quality. Build a consented, privacy-reviewed evaluation set before making quality claims.
## Matching version gate

The fixture evaluator is `npm run eval:match-versions`; it reports deterministic lexical-v2 and lexical-v3 scores, bands, and deltas for named existing and India-first profile fixtures. Default selection remains lexical-v2 until the approved non-regression/improvement gate passes. The evaluator does not retune weights or call a model.
