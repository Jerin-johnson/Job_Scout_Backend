# 16 — AI and matching data inventory

## Job-specific resume match additions

`jobMatchReports` stores an owner ID, resume ID and content hash, a job identity/content hash, deterministic score/checklist/evidence snippets, ignored keywords, and optional grounded suggestions. A unique owner/resume/job/version index makes creation idempotent. It does not store decrypted resume text or the full catalog job description; pasted/application descriptions are bounded and are stored only for the report's supported display needs. Reports are deleted with the selected resume and during user privacy erasure. Resume term-index cache is keyed by owner and file hash and removed with resume deletion. Export includes reports and resume metadata but omits encrypted raw resume text.

Last verified against commit `1dcc456` plus Phase 3 working-tree changes on 2026-10-17.

## As built (verified in code)

| Data | Storage / scope | AI or matching use | Retention / deletion |
|---|---|---|---|
| Resume original | AWS S3 object under the authenticated user's `resumes/{userId}/` prefix | Text extraction only after versioned user consent | User-scoped resume deletion path; actual bucket lifecycle and backup deletion window are **Unverified**. |
| Extracted resume text | Encrypted fields on the owner-scoped `Resume` Mongo record; never logged | Grounding source and approved career workflows | Retained with the resume record. Verify deployment backups and account deletion execution. |
| Structured resume facts | Owner-scoped Mongo `Profile` roles, skills and education | Deterministic matching, profile grounding and explicitly requested career AI features | Current user deletion/export integration needs deployment-level verification. |
| Resume AI consent | `User.resumeAiConsent.acceptedAt` and consent version | Gate for upload URL issuance and resume processing | User record lifecycle; current consent version is `resume-ai-processing-v1`. |
| Career profile | Optional `Profile.careerProfile` with role, experience, location, work, compensation and other fields | Recommendations use selected structured matching fields; suggestions do not call an LLM | Stored in existing Profile collection. No new collection/service. User controls save; export/deletion integration **Unverified**. |
| Job listing | Mongo `Job`, shared catalog; source attribution, normalized fields, title/description/tags and classification metadata | Deterministic candidate retrieval and scoring; no per-job LLM call | Source-specific policy and expiry apply. Current indexed sources are limited and not the whole internet. |
| Occupation classification | Additive `occupation`, `occupationConfidence`, `normalizedTitle`, `occupationFeaturesVersion` fields on `Job` | Deterministic filters and analysis; no personal profile data | Reversible by unsetting occupation-only fields and version marker; existing job `featuresVersion` is preserved. |
| Model usage metadata | `UsageEvent` without prompt or resume text | Quota, cost, error and retry monitoring | 90-day application retention setting; verify provider and database backups. |
| Job interaction events | `InteractionEvent`: event type, bounded source/occupation/country/score band, count, timestamp, and stable pseudonymous actor key; never free text | Aggregate zero-result, click/apply and score-band reports | Opt-in only via `PUT /api/v1/profile/job-analytics-consent`; version `job-analytics-v1`; 180-day TTL; revoking consent deletes the user's prior event rows. Included in export without actor key and removed on account deletion. |
| Product feedback | `UserFeedback`: owner ID, category, bounded plain-text message, timestamp | Product feedback only; not included in admin coverage metrics | Authenticated; five submissions/user/hour; 180-day TTL; owner export and account-deletion cascade. Never log body text. |
| External reference data | None imported. GeoNames/O*NET license/attribution research is documented; no raw or derived local dataset is present | No runtime calls or matching effect | Import is pending source files and additive/rollback implementation; no external download occurred in this task. |

No stored resume was re-read for this task. The local profile diagnostic used aggregate fact counts only; no resume text or profile values were printed. One local profile has 43 skills, 0 role facts, and 1 education fact.

## Target design (not built yet)

Document a tested end-to-end data export/deletion lifecycle including object versions, encrypted resume text, extracted facts, caches, embeddings, backups and audit receipts. Retain only fields required by the approved source terms. No deletion or re-embedding migration was run as part of this work.

Job catalog adds deterministic `eligibility` with bounded evidence text and version, daily `FxRate` snapshots, and per-listing `reportCounts` keyed only by reason. Tracked company rows include normalized public careers URL, ATS platform/slug, request status and verification time; requests are pending review before ingestion. ATS source registry holds source quotas, cursors, health and policy. Adzuna activation metadata is a license reference and boolean policy attestations, not provider credentials. Existing job vectors are untouched; legacy vectors remain provider/model/dimension unknown.

**Unverified:** AWS S3 lifecycle/IAM policy, Mongo backup retention, provider retention for configured AI credentials, and whether every deployed export/deletion path covers `careerProfile` and `resumeAiConsent`. Local profile diagnostics are guarded to loopback DBs and emit country/location codes and public job metadata only; do not attach them to application logs.
