# Deterministic role and location coverage

Last verified against commit `8547300` plus the classification v6 worktree changes on 2026-10-16 (local development database only).

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

The backfill changes only `occupation`, `occupationConfidence`, `normalizedTitle`, and `occupationFeaturesVersion` (currently version 6). The existing `featuresVersion` field is already used by job text/skill feature extraction (version 1), so it is deliberately not repurposed. It uses a sorted Mongo cursor, bounded batches, and ObjectId resume cursor. Dry run is the default. On the local development catalog, v6 classified 841 jobs: 161 (19.14%) remain unclassified. Families: software 148, sales 192, operations 47, accounting/finance 40, marketing 42, customer support 71, healthcare 18, product 27, design 18, education 17, data 17, security 32, HR 6, administration 2, delivery/logistics 2, transport 1, unclassified 161. Source shares: Jobicy 142/734 (19.35%), RemoteOK 16/99 (16.16%), Remotive 1/4 (25%), mock board 2/4 (50%). The classification command prints counts by family/source and 30 random title samples before apply. Local apply updated 841 records additively; production was not touched.

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

A fresh random sample of 100 active local listings was manually labeled by primary occupation family after v6 was applied. This is a single, non-stratified sample; small-family estimates are noisy and should not be used as a production eligibility gate. The sample had 25/100 unclassified (25%). Among the 75 auto-classified records, 65 labels matched the manual label (86.7% aggregate precision). Precision by predicted family:

| Predicted family | Correct / labeled | Precision |
|---|---:|---:|
| accounting-finance | 3/3 | 100% |
| administration | 1/1 | 100% |
| data | 2/2 | 100% |
| design | 3/3 | 100% |
| healthcare | 1/2 | 50% |
| human-resources | 1/2 | 50% |
| marketing | 3/5 | 60% |
| operations | 6/6 | 100% |
| product | 3/3 | 100% |
| sales | 18/19 | 94.7% |
| security | 4/4 | 100% |
| software | 14/17 | 82.4% |
| customer-support | 6/8 | 75% |

The manual labels were based on job title and source category where available. Technical account, solutions, interpreter, fundraising, and sales-enablement titles are inherently ambiguous; the observed false positives and unclassified cases are why occupation remains a ranking/filter hint only, not an eligibility decision. A larger stratified audit is needed before treating these estimates as stable.

The sample's unclassified share by source was Jobicy 21/88 (23.9%), RemoteOK 3/10 (30%), and mock board 1/2 (50%). The full-catalog source shares above are the more useful coverage measure: Jobicy 142/734 (19.35%), RemoteOK 16/99 (16.16%), Remotive 1/4 (25%), mock board 2/4 (50%).

## Target design (not built yet)

Add more curated occupation aliases only after auditing false positives and measuring per-family precision on a hand-labeled sample. Do not call an LLM per job. A production migration requires an explicit deployment window and operator approval.

**Unverified:** a larger stratified precision audit and the completeness of upstream source categories. The manual sample above is a preliminary quality check, not a guarantee for low-support families or individual sources; do not use occupation as a high-confidence eligibility filter yet.

Production backfill was not run. The local apply command refuses production and non-loopback hosts.
