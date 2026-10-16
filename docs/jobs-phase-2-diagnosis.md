# Phase 2 diagnosis: profile, classification, eligibility, and currency

Status: **Step 1 diagnosis only**. Parts B–E are not implemented in this step. Findings are from the backend working tree based on commit `d089af6` and the sibling frontend source inspected on 2026-10-16. The actual frontend directory currently has no Git metadata.

## Part B — structured career profile

### What exists

- `src/models/Profile.js` stores resume-grounded `roles`, `skills`, `education`, and a small `preferences` object: target roles, USD minimum salary, preferred location strings/country codes, occupation codes, and work mode. Role dates are present; explicit years of experience, seniority, and licenses/certifications are not modeled on the profile.
- `src/models/Resume.js` stores the private resume object key, file metadata, encrypted extracted text, and fact counts. `resumeParserService` uses the existing LLM pipeline to extract source-grounded roles, skills, and education; the grounding step rejects facts that cannot be found in the resume text. There is no separate location, authorization, relocation, licence, or certification extractor.
- Existing preference writes increment `Profile.version`, invalidate candidate context, increment `User.profileVersion`, and enqueue match refresh. Match cache keys include `profileVersion`; refresh records are keyed by that version.
- Target-role typo suggestions and a confirmation endpoint already exist. The Jobs page has a basic preference form but no full Career profile step or completeness meter.

### Add in Part B

Add a versioned additive `careerProfile` subdocument (preserving all legacy preference fields) for years of experience, seniority, home country/city, structured target places, country-specific work authorization, relocation willingness, expected compensation with currency/period, and relevant licences/certifications. Store source and confirmation metadata per value so resume-derived suggestions remain distinguishable from user-confirmed facts. Keep target roles as normalized, removable tags. Prefill only missing/unconfirmed values from existing profile facts; derive experience from existing role dates deterministically where possible. Ask the user to confirm gaps and never overwrite confirmed values.

Save in one validated operation, bump both profile and user versions, invalidate candidate context, and enqueue refresh through the existing match-refresh service. Map new structured values to legacy fields while old match readers remain active. Deploy additive schema/API/UI first; no data rewrite is needed for existing records. Rollback is to disable the new form/endpoint and retain additive fields; do not delete values users have entered.

## Part C — job occupation classification

### What exists

- `cleanNormalizedJob` computes `features` at ingestion using `extractJobFeatures`; feature fields include title tokens, skills, a lightweight title-derived occupation hint, experience, seniority, licenses, and eligibility hints.
- Remotive `category` and Jobicy `jobIndustry` are stored as source-prefixed `occupationCodes`; there is no shared taxonomy mapping. Remote OK has no equivalent normalized occupation mapping in this code.
- The current heuristic recognizes only a handful of broad families. Existing live diagnostics found 800/848 current jobs in `other/uncategorized`; current occupation fields are not a confidence-scored, canonical classification.
- `scripts/backfill-job-features.js` is an existing batch backfill, but it has only scanned/updated counts and does not create the requested per-source family report, sample of 30, or rollback snapshot.

### Add in Part C

Create a deterministic classifier contract with `normalizedTitle`, canonical `occupation`, `occupationConfidence`, `featuresVersion`, and provenance for the rule that matched. Order rules as source-category mapping, title dictionary, tags/dictionary, then curated synonyms; leave ambiguous jobs unknown. Include the specified non-IT families even when feeds have little coverage. Report unclassified share by source.

Add a dry-run backfill that streams and batches the existing 848/current catalog without changing embeddings or raw descriptions. Report total and per-source family counts, unclassified share, and exactly 30 public job samples. Apply only after reviewing that report. Before apply, snapshot the old classification fields by job `_id`; rollback restores those fields and leaves all unrelated job data untouched. Re-run the dry-run after rollback to verify counts. Lazy LLM classification remains unbuilt and deferred; if proposed later, only opened jobs, globally cached by content hash, plan-gated, and separately approved.

## Part D — eligibility and location

### What exists

- `Job.structuredLocation` already has country code, region, city, remote scope, eligible country codes, and work authorization fields. `remoteScope` can be `unknown`.
- Remotive sets remote scope to unknown and does not derive eligible country codes. Jobicy only marks obvious “anywhere/worldwide” locations worldwide. The title/description heuristic emits eligibility hints but does not normalize them into structured eligibility.
- A small hand-written city alias map exists in `discoveryGraph.js` (including Cochin/Kochi and Trivandrum/Thiruvananthapuram). It is not an offline gazetteer and does not cover Kerala districts comprehensively.
- Current retrieval admits unknown eligibility in a country-constrained query, and the location tier can treat remote+unknown as a location fallback. The matcher labels eligibility unknown, but UI wording must not imply that unknown means eligible.

### Add in Part D

Use a conservative parser to populate explicit country/region, work mode, remote scope, eligible-country list, sponsorship, and confidence. Unknown remains explicit and must not be presented as eligible. Matching should hide explicit country exclusions by default, with an opt-in override and the requested “Not open to applicants from {country}” message. Preserve the existing location fallback ranking for unknowns while visually separating “unknown eligibility” from “eligible”.

Do not add a gazetteer yet. Verify the exact dataset licence/attribution and distribution constraints, especially for India states and Kerala districts, and get approval before adding any data. A small reviewed alias config is the no-dataset interim option. If a gazetteer is approved later, version the data and classifier and keep original location text for auditability.

## Part E — INR and currency

### What exists

- Jobs have legacy `salaryRange` plus `compensation.originalText`, amount, currency, pay period, and normalized annual values/currency/date. Ingestion currently normalizes USD/year values only.
- Profile preferences store `minimumSalaryUsd`; the discovery filter retains non-USD salary rows as unknown, but score calculation currently compares `normalizedAnnualMax` to the USD preference without checking `normalizedCurrency`. That can produce a misleading salary-fit score and must be corrected when currency support is built.
- There is no daily FX source/cache or user display-currency preference. Salary-not-disclosed jobs are retained by the matcher unless other filters remove them.

### Add in Part E

Add user expected salary with original currency and period, preserving `minimumSalaryUsd` as a compatibility fallback. Store conversions separately from source amounts with rate source, rate date, and target currency. Convert at most once per currency/date and cache the rate in existing Mongo/Redis; never fetch FX from a request path. Display the original amount next to an approximate converted value; show “Salary not disclosed” when absent. Salary fit only contributes when both values can be compared in the same currency and period.

No FX source is selected or enabled in this diagnosis. Terms must be reviewed and reported before choosing one. A new paid service, database, package, or recurring external dependency is out of scope.

## Phase order and migration gate

Part B adds additive profile fields/API and UI; Part C adds deterministic classifier fields and dry-run-first batched backfill. Part D follows with conservative eligibility parsing and a separate gazetteer approval gate. Part E adds rate metadata/cache only after FX terms review. Each phase keeps legacy reads working, includes old/new behavior tests, and ships its own dry-run/rollback notes. Part F calibration still requires the user to confirm role, country, and target location and provide 10 genuinely fitting jobs. No Part B–E schema migration or write was performed during this Step 1 review.
