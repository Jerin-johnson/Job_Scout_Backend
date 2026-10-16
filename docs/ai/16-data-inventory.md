# 16 — AI and matching data inventory

Last verified against commit pending final commit on 2026-10-16.

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

No stored resume was re-read for this task. The local profile diagnostic used aggregate fact counts only; no resume text or profile values were printed. One local profile has 43 skills, 0 role facts, and 1 education fact.

## Target design (not built yet)

Document a tested end-to-end data export/deletion lifecycle including object versions, encrypted resume text, extracted facts, caches, embeddings, backups and audit receipts. Retain only fields required by the approved source terms. No deletion or re-embedding migration was run as part of this work.

Job catalog adds deterministic `eligibility` with bounded evidence text and version, daily `FxRate` snapshots, and per-listing `reportCounts` keyed only by reason. Tracked company rows include normalized public careers URL, ATS platform/slug, request status and verification time; requests are pending review before ingestion. ATS source registry holds source quotas, cursors, health and policy. Adzuna activation metadata is a license reference and boolean policy attestations, not provider credentials. Existing job vectors are untouched; legacy vectors remain provider/model/dimension unknown.

**Unverified:** AWS S3 lifecycle/IAM policy, Mongo backup retention, provider retention for configured AI credentials, and whether every deployed export/deletion path covers `careerProfile` and `resumeAiConsent`. Local profile diagnostics are guarded to loopback DBs and emit country/location codes and public job metadata only; do not attach them to application logs.
