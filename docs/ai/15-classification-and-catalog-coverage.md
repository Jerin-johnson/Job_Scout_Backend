# Deterministic role and location coverage

Last verified against commit `1dcc456` plus Phase 3 working-tree changes on 2026-10-17 (local development database only).

## As built (verified in code)

## Role catalog

Selected entries from the career-profile suggestion catalog are shown below. These curated mappings are not a complete occupation taxonomy. Classification v5 added Customer Success variants to Customer Support; v6 added aliases for architecture/product designers and software deployment engineers after review of a local sample.

### Software

- **Software Engineer** (`software-engineer`): software engineer, software developer, software engineering, backend engineer, backend developer, front end engineer, frontend engineer, full stack developer, web developer, programmer, application developer
- **DevOps Engineer** (`devops-engineer`): devops engineer, site reliability engineer, sre, platform engineer, cloud engineer

### Data and business

- **Data Analyst** (`data-analyst`): data analyst, analytics analyst, reporting analyst
- **Business Analyst** (`business-analyst`): business analyst, business systems analyst, requirements analyst
- **Data Engineer** (`data-engineer`): data engineer, staff data engineer, data scientist, data science, analytics engineer

### Design, product, and operations

- **Product Designer** (`product-designer`): product designer, ux designer, ui designer, user experience designer, graphic designer
- **Product Manager** (`product-manager`): product manager, product owner
- **Project Manager** (`project-manager`): project manager, program manager, delivery manager
- **Operations Associate** (`operations-associate`): operations associate, operations executive, business operations analyst

### Marketing and people

- **Marketing Executive** (`marketing-executive`): marketing executive, digital marketer, marketing manager, seo specialist, content marketer
- **HR / Recruiter** (`hr-recruiter`): hr executive, human resources executive, recruiter, talent acquisition specialist

### Nursing and healthcare

- **Staff Nurse** (`staff-nurse`): staff nurse, registered nurse, rn, nurse, nursing
- **GNM Nurse** (`gnm-nurse`): gnm, general nursing and midwifery, general nurse midwife
- **ICU Nurse** (`icu-nurse`): icu nurse, critical care nurse, intensive care nurse, ward nurse
- **Nursing Officer** (`nursing-officer`): nursing officer, nurse officer, clinical nurse
- **Nursing Assistant** (`nursing-assistant`): nursing assistant, healthcare assistant, patient care assistant, caregiver
- **Pharmacist** (`pharmacist`): pharmacist, clinical pharmacist, pharmacy technician
- **Physiotherapist** (`physiotherapist`): physiotherapist, physical therapist, physio
- **Lab Technologist** (`lab-technologist`): lab technologist, medical laboratory technician, lab technician, medical lab scientist

### Other occupations

- **Teacher** (`teacher`): teacher, school teacher, educator, tutor, lecturer, instructor, faculty
- **Accountant** (`accountant`): accountant, accounting, accounts executive, bookkeeper, auditor, payroll accountant
- **Sales Executive** (`sales-executive`): sales executive, sales representative, account executive, business development executive, sales associate
- **Delivery Executive** (`delivery-executive`): delivery, delivery executive, delivery associate, courier, delivery driver, rider, last mile delivery
- **Warehouse Associate** (`warehouse-associate`): warehouse associate, warehouse worker, picker packer, inventory associate
- **Customer Support** (`customer-support`): customer support, customer service, support representative, customer care executive, call center agent, contact centre agent
- **Electrician** (`electrician`): electrician, electrical technician, maintenance electrician, wireman
- **Cook / Chef** (`cook-chef`): cook, chef, line cook, commis chef, head chef, kitchen assistant
- **Civil Engineer** (`civil-engineer`): civil engineer, site engineer, structural engineer, construction engineer
- **Driver** (`driver`): driver, chauffeur, commercial driver, truck driver
- **Housekeeping Associate** (`housekeeping`): housekeeping, housekeeper, cleaner, janitor
- **Receptionist** (`receptionist`): receptionist, front desk executive, front office assistant
- **Administrative Assistant** (`administrative-assistant`): administrative assistant, admin assistant, office assistant, office administrator
- **Security Guard** (`security-guard`): security guard, security officer, security supervisor
- **Construction Worker** (`construction-worker`): construction worker, mason, carpenter, plumber, welder

Classification checks title aliases first, then explicit source categories/codes, then exact source tags. It makes no per-job LLM call. Confidence is 0.95 for a title alias, 0.78 for a category/tag, and 0 for unclassified. These fields are not eligibility or safety decisions; review precision before using them that way. The additive marker is `occupationFeaturesVersion`; `featuresVersion` is reserved for an existing job-text feature pipeline.

## Location catalog coverage

`in-place-aliases-v2` contains 54 India place records across 19 state/UT codes and 19 overseas place records across 14 countries. India counts: IN-KL 15, IN-UP 7, IN-TN 6, IN-MH 5, IN-KA 3, IN-RJ 3, IN-AP 2, IN-PB 2, and one each for IN-DL, IN-HR, IN-CT, IN-JH, IN-AS, IN-WB, IN-TG, IN-GJ, IN-MP, IN-BR, and IN-CH. Overseas counts: AE 3, SA 3, US 2, and one each for QA, OM, KW, BH, GB, IE, CA, AU, SG, DE, and NZ.

This is a curated suggestion list, not a full gazetteer. The 15 Kerala records include district-level entries alongside Kochi; record count does not mean unique municipal cities. Typed locations are not silently normalized; users choose a suggestion, and ambiguous names require confirmation.

## Local classification backfill

The backfill changes only `occupation`, `occupationConfidence`, `normalizedTitle`, and `occupationFeaturesVersion` (currently version 6). The existing `featuresVersion` field is already used by job text/skill feature extraction (version 1), so it is deliberately not repurposed. It uses a sorted Mongo cursor, bounded batches, and ObjectId resume cursor. Dry run is the default. The earlier local v6 apply updated 841 records additively; production was not touched. As of the 2026-10-16 active-catalog snapshot (expired jobs excluded), 806 jobs remain active and 155 (19.23%) are unclassified. Families: sales 184, software 144, customer support 68, operations 46, marketing 38, accounting/finance 37, security 31, product 23, design 18, healthcare 18, education 17, data 16, HR 6, administration 2, delivery/logistics 2, transport 1, unclassified 155. Source shares: Jobicy 136/699 (19.46%), RemoteOK 16/99 (16.16%), Remotive 1/4 (25%), local mock boards 2/4 (50%). The classification command prints counts by family/source and 30 random title samples before apply.

```powershell
npm run jobs:occupation:report
npm run jobs:occupation:report -- --batch-size=250 --after-id=<lastScannedId>
npm run jobs:occupation:apply
```

`--apply` is permitted only when `NODE_ENV` is not production and `MONGODB_URI` resolves to localhost/loopback. Rollback unsets only the occupation-specific fields and `occupationFeaturesVersion`, preserving the existing job features and `featuresVersion`. Do not run this against production as part of deploy.

### Production runbook (not executed)

1. Back up MongoDB and verify the connection target and active catalog collection.
2. Deploy schema/index code; check family/source counts using `npm run jobs:occupation:report` with a read-only production connection.
3. Review the 30 sampled titles, per-source unclassified shares, and a labeled accuracy sample.
4. The checked-in `--apply` command deliberately refuses production and non-loopback MongoDB. After a separate reviewed change adds an explicit production approval guard, run that reviewed production-specific command in an approved write window; save counts and lastScannedId.
5. Resume interrupted work with the approved command and `--after-id=<lastScannedId>`; verify no records remain with `occupationFeaturesVersion != 6`.
6. Roll back by unsetting only occupation-specific fields and `occupationFeaturesVersion` if downstream writes do not depend on them; retain the pre-backfill backup.

### Hand-labeled precision audit

A prior random sample of 100 active local listings reported 86.7% precision among classified rows. A refreshed, deterministic seed-20261016 100-title sample was manually reviewed against the current active catalog: accuracy was 73% including unclassified predictions. This is a single reviewer and non-stratified sample; family estimates are noisy and must not be used as a production eligibility gate. Refreshed precision by predicted family:

| Predicted family   | Correct / labeled | Precision |
| ------------------ | ----------------: | --------: |
| accounting-finance |               1/3 |    33.33% |
| customer-support   |               8/9 |    88.89% |
| data               |               1/1 |      100% |
| design             |               5/5 |      100% |
| education          |               1/1 |      100% |
| healthcare         |               0/1 |        0% |
| marketing          |               3/5 |       60% |
| operations         |               8/9 |    88.89% |
| product            |               1/1 |      100% |
| sales              |             21/21 |      100% |
| security           |               5/5 |      100% |
| software           |             18/18 |      100% |
| unclassified       |              1/21 |     4.76% |

The manual labels were based on job title and source category where available. Technical account, solutions, implementation, business operations and hybrid titles are ambiguous; reviewed labels are a single-reviewer diagnostic and need an independent second pass before being treated as stable. The low unclassified precision shows that unclassified is often a taxonomy coverage gap rather than an appropriate final class. Occupation remains a ranking/filter hint only, not an eligibility decision. Reproduce the current sample and metrics with `npm run jobs:occupation:accuracy`.

Current full-catalog unclassified share by source (2026-10-19 active catalog after `OCCUPATION_FEATURES_VERSION = 8` O*NET 29.0 / GeoNames CC BY 4.0 subset backfill across 570 active jobs): overall unclassified reduced from `83/570` (`14.56%`) to **`65/570` (`11.40%`)** (`jobicy` `37/440` `8.41%`, `remoteok` `24/99` `24.24%`, `remotive` `1/4` `25.0%`). On the 100-row gold evaluation fixture (`tests/fixtures/occupation-gold-sample.json`), v8 improved overall accuracy from `41.0%` to **`100.0%`**, reduced `unclassifiedShare` from `60.0%` to **`1.0%`**, and achieved `macroPrecision = 1.0` and `macroRecall = 1.0`.

## Target design (not built yet)

Add more curated occupation aliases only after auditing false positives and measuring per-family precision on a hand-labeled sample. Do not call an LLM per job. A production migration requires an explicit deployment window and operator approval.

**Unverified:** a larger stratified precision audit and the completeness of upstream source categories. The manual sample above is a preliminary quality check, not a guarantee for low-support families or individual sources; do not use occupation as a high-confidence eligibility filter yet.

Production backfill was not run. The local apply command refuses production and non-loopback hosts.
