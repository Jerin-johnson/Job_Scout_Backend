# ADR 0013: Split job list, detail, and vector storage additively

Last verified against commit `f4b536709b1154acf5d88a0e7ce9c58ec19be1b7` plus working-tree changes on 2026-10-17.

## As built (verified in code)

Additive models and local-guarded migration scripts exist; no production migration was run.

## Target design (not built yet)

Removing old inline fields is a later, separately reviewed rollout.

Status: accepted for a reversible local-first rollout. No production migration is authorized.

## Context

List, search, and matching need compact job fields; descriptions and vectors are much larger and are not needed on every list query. Existing `jobs` records and readers already use inline fields.

## Decision

Introduce `job_details` and `job_vectors` as additive collections. Keep old `rawDescription`, `requirements`, and embedding fields during rollout. Reads can fall back to legacy values. Store legacy vector metadata as `legacy` / `unknown` rather than inferring a provider. Run only the loopback-guarded report/apply commands against local development data. No vectors are newly generated.

## Rollback

Roll back application code and retain the additive collections. Do not unset legacy fields or drop the new collections without separate approval.

## Limits

No benchmark or migration report against production has run. BSON/index/RAM impact remains Unverified until representative measurements are captured.
