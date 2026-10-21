# IrowzScout matching and ranking design

**Current implementation:** deterministic lexical-v2.1 default with bounded indexed candidate retrieval; no LLM or vectors in the scoring hot path. It retains v2 weights and changes only the handling of explicitly confirmed zero-year experience when a job states a minimum. See [AI matching engine](06-job-matching-engine.md) and `src/domain/services/jobs/matching.ts`. The weights below distinguish current v2 concepts from an independently proposed evaluation design; never change weights without a versioned fixture gate.

Last verified against commit `19a9e22951fe449e40690b88248c5db499eda809` for the matching source reference.

## As built (verified in code)

The `MATCH_SCORE_WEIGHTS` constant in `src/domain/services/jobs/matching.ts` assigns skill 40, title 20, experience 15, location 15, salary 5 and recency 5. The shipped default and bounded retrieval behavior are described in [06-job-matching-engine.md](06-job-matching-engine.md).

## Target design (not built yet)

The staged retrieval and evaluation guidance below does not alter the scoring implementation or its weights.

## Retrieval stages

1. **Hard safety/eligibility filters:** active and not expired; source policy eligible; explicit country/work authorization constraints only when evidence exists; required professional licenses when explicitly required. Unknown stays unknown rather than being treated as a negative.
2. **Structured retrieval:** occupation/title family, country/eligible countries, location/remote mode, employment type, and known salary range. Use compound Mongo indexes and field projection.
3. **Lexical candidate generation:** indexed title/skill/company `searchTokens`, normalized aliases, bounded typo expansion; cap at the configured candidate budget (current docs state 400) and bounded recent fallback. Do not load the full catalog.
4. **Deterministic ranking:** score each candidate using saved profile facts and normalized job attributes. Cache by profile version, job content/version and scorer version.
5. **Explanation:** produce templates from score evidence: matched skills, title/family, seniority/experience, known location/eligibility, compatible disclosed salary, and post date. Optional LLM paraphrase can only summarize these facts and cannot change score or assert unsupported requirements.

## Feature design for evaluation

The current lexical-v2.1 code retains the v2 weights for skills (40), title (20), experience (15), location (15), salary (5), and recency (5), normalized to a 100-point scale. v4 is a separately versioned experiment that adds occupation, seniority, eligibility; keep it parked unless the repository's ship gate passes. Unknown or missing attributes should be neutral; known ineligible location/license can hard-block only with explicit evidence.

For each feature `f`, calculate a bounded normalized match value in `[0,1]`; aggregate as `score = round(Σ weight_f × match_f)`. For example, a candidate with skill 0.8, title 0.9, experience 0.7, location 1.0, salary unknown (neutral 0.5), recency 0.8 gets `32 + 18 + 10.5 + 15 + 2.5 + 4 = 82` under the **current v2 weights**. Unknown-salary neutrality is only illustrative; verify actual scorer treatment before changing/quoting a production score.

## Signal definitions

- **Skills:** exact normalized/alias overlap, with evidence from explicit candidate facts and job requirements. Separate required and preferred terms where available.
- **Title/occupation:** title normalization plus occupation family and synonyms; do not equate broad family with exact role.
- **Experience/seniority:** compare explicit years and level ranges; never infer a hard minimum from vague phrases.
- **Location:** country eligibility and remote scope first; commute proximity only when both locations are precise and user requests it.
- **Salary:** compare only known comparable currency/cadence values; absent or incomparable figures are neutral.
- **Recency/freshness:** bounded decay from original posted/updated date and source last-check state; repeated polling must not make stale jobs look new.

## Quality and fairness evaluation

Use an independent, stratified human-labeled sample across source, occupation, geography, seniority and remote/on-site modes. Labels: relevant, maybe, irrelevant, explicitly ineligible, stale/closed. Hide user identity from labelers. Split train/eval by employer and time so duplicates do not leak. Report:

- NDCG@10 and MRR for top-rank usefulness;
- Precision@5/10 and recall@50;
- coverage / zero-result rate by occupation-country cohort;
- ineligible exposure rate and unknown-eligibility share;
- calibration: observed relevance by score band;
- freshness error and duplicate rate;
- latency p50/p95, candidates examined, Mongo docs examined, cache rate.

Do not tune on the holdout set; define a minimum sample per cohort and show confidence intervals. Compare v2 vs candidate versions on identical fixtures and real anonymized labels. Ship only if no existing fixture regresses outside an approved tolerance and intended cohorts improve.

## Cost and latency

Retrieval and scoring are CPU/database work, with no per-job model spend. Run search as a bounded indexed query and scoring over at most a few hundred documents. Optional embeddings cost only when new/changed jobs are embedded; cache by content hash and provider/model/dimension. Optional explanation spend should be opt-in, small, rate-limited and separately ledgered. Never put an LLM call inside ranking just to imitate an opaque competitor score.

## Verification

Current v2 weight constants and versioning were checked in `src/domain/services/jobs/matching.ts`; bounded retrieval and LLM-free behavior were cross-checked against `docs/ai/06-job-matching-engine.md`. The sample calculation is illustrative, not a production score. `npm run docs:check` validates local documentation structure.
