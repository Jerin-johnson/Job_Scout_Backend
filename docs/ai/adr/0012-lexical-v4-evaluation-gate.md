# ADR 0012: Keep lexical-v4 evaluation-only

Last verified against commit `1dcc456` with the Phase 3 working-tree changes on 2026-10-17.

## As built (verified in code)

## Context

The Phase 3 experiment adds occupation, seniority and explicit eligibility evidence to matching. The score calculation intentionally uses different weights from lexical-v2.

## Decision

Keep lexical-v2 as the active default. Do not change score weights, existing fixtures or thresholds to make v4 pass. Eligibility contributes neutrally when the profile has no applicant country or a listing has no supported eligibility evidence.

## Evidence

`npm run eval:jobs-phase3` reports 15/15 existing fixtures below their v2 score after the eligibility-neutrality correction (14 by 4 points, HR by 13; resume-role typo by 10 and delivery by 5 in the current full fixture output). Existing explicit US-only controls pass 14/14 and India persona eligibility/US-control cases pass 10/10. The weighted v4 delta on common fixtures is primarily skills -8, experience -2.75 and location -2.55 to -3, partly offset by occupation +8. The eligibility correction removed the old -2 penalty when country evidence was absent but cannot correct the weight reallocations. V4 fails the no-regression gate.

## Consequences

V4 is not selectable in production configuration and is not presented as improved overall. Any future proposal must explain the score behavior and pass unchanged fixtures plus the India-first controls before changing the active version.

## Target design (not built yet)

Re-evaluate v4 only after changes are proposed to the scoring model with new labeled fixtures and non-regression tests. Do not alter v2/v3 weights as part of that evaluation.
