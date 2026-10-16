# Career profile — Gate 1 backend proposal

Last verified against commit `3b3d1bb` on 2026-10-16.

**Status:** Gate 2 backend implementation in progress. The schema field and owner-authenticated career-profile read/update and suggestion APIs are additive. Migration remains a read-only dry run; no career-profile migration data has been written.

## As built (verified in code)

`Profile` stores resume role, skill, and education facts, legacy preferences, and an additive optional `careerProfile` subdocument. Owner-authenticated GET/PATCH endpoints and role/place suggestion endpoints are in place. The read-only migration report emits aggregate counts only; no migration values have been written.

## Implemented Gate 2 model and API

### Additive model

Keep the existing `roles`, `skills`, `education`, and `preferences` fields intact. Add optional `careerProfile` to the existing owner-scoped `Profile` document:

```json
{
  "schemaVersion": 1,
  "targetRoles": [
    { "roleCode": "software-engineer", "custom": false },
    { "customRoleLabel": "A user-defined role", "custom": true }
  ],
  "experience": {
    "confirmedYears": null,
    "derivedYears": null,
    "internshipYears": null,
    "needsConfirmation": true,
    "confirmedAt": null
  },
  "homeLocation": {
    "countryCode": null,
    "subdivisionCode": null,
    "cityCode": null,
    "aliasCatalogVersion": "in-place-aliases-v2",
    "confirmedAt": null
  },
  "targetLocations": [
    {
      "countryCode": "IN",
      "subdivisionCode": null,
      "cityCode": null,
      "aliasCatalogVersion": "in-place-aliases-v2",
      "confirmedAt": null
    }
  ],
  "workAuthorization": {
    "canWorkInHomeCountry": null,
    "sponsorshipOrRelocation": {
      "enabled": false,
      "countryCodes": []
    }
  },
  "workPreferences": {
    "workMode": "any",
    "employmentTypes": [],
    "shiftPreference": null
  },
  "compensation": {
    "minimumAmount": null,
    "currencyCode": null,
    "period": null
  },
  "moreDetails": {
    "educationLevelCode": null,
    "languages": [],
    "testScores": [{ "testCode": "IELTS", "score": "", "testDate": null }],
    "availabilityCode": null,
    "noticePeriodDays": null,
    "certifications": [
      { "name": "", "issuer": "", "countryCode": null, "expiresAt": null }
    ]
  },
  "updatedAt": null
}
```

`roleCode` is a stable internal canonical ID; custom roles retain their user-provided label, are explicitly marked custom, and remain eligible for token/synonym matching. Country uses ISO 3166-1 alpha-2, currency uses ISO 4217, and state/province uses ISO 3166-2. City codes are stable internal slugs from the small versioned alias map, not a new external dataset. `homeLocation` is separate from `targetLocations`; matching a legacy preferred-location string must never infer where the user lives. Validate the exact subdivision identifiers against the maintained ISO collection before Gate 2; do not invent codes from labels. ISO 3166-2:2020 remains the current standard after its 2025 review ([ISO standard record](https://www.iso.org/standard/72483.html)).

Validation: at most 20 target roles, 20 target locations, 20 destination countries, 20 languages, 20 test scores, and 100 certifications; bounded strings (role labels 120 chars, issuer/name 120 chars); experience 0–60 years and notice 0–365 days. workMode is any|remote|hybrid|onsite, employment types are full_time|contract|part_time, shift is day|night|rotating|flexible|null, compensation period is hourly|monthly|annual|null. Language arrays default to empty; no language or proficiency is pre-filled. Salary scoring annualizes known monthly amounts by x12 and compares only within one currency; hourly/unknown periods and currency mismatches are neutral. Use ISO 639-1 language codes and explicit proficiency codes. Test score remains user-entered text plus date; do not infer or normalize exam bands.

Sensitive fields (home city, work authorization, licenses/certifications, notice period, and test scores) are stored only in the profile service. They are excluded from AI prompts and logs. The later possibility of allow-listing safe fields such as role, seniority, years, and country for chat remains an open decision pending provider terms review.

## API proposal

Authenticated, owner-scoped endpoints, without changing the existing preferences contract:

- `GET /api/v1/profile/career-profile` returns `{ data: { careerProfile, legacySuggestions, profileVersion } }`. Suggestions are computed only for exact alias matches and never persisted.
- `PATCH /api/v1/profile/career-profile` accepts `{ profileVersion, careerProfile }`, validates the profile payload, and saves only explicitly submitted values. Return `{ data: { careerProfile, profileVersion } }`; stale profile versions return `409` so edits are not overwritten.
- `GET /api/v1/profile/role-suggestions?q=` and `/place-suggestions?q=` are authenticated, user-rate-limited, cached with ETags, and read-only. Free-text role labels remain supported. Place lookup uses exact aliases and consistent city/region pairs; ambiguous names require confirmation.
- Career-profile reads include derived experience and education-level suggestions from stored resume facts. Those are suggestions only and are never saved automatically.
- A user confirmation of an alias or USD-to-INR conversion is an explicit field-level action in the patch. A mismatch in currencies skips salary-fit scoring; no automatic currency conversion or exchange-rate service is proposed.

The old endpoints and legacy preferences remain readable for compatibility. New fields do not silently overwrite `minimumSalaryUsd`, `targetRoles`, or `preferredLocations`.

## Read-only migration dry run

Run `npm run career-profile:migration:report` before any backfill. It emits aggregate counts only, no field values or IDs, and writes nothing. The local development MongoDB currently has one profile, which the account owner has confirmed is theirs. No career-profile data migration is approved yet.

| Existing data | Preview | Proposed handling |
| --- | ---: | --- |
| Target-role preferences | 1 | Offer as one role suggestion; use a canonical code only when the user confirms a curated match, otherwise retain as custom. |
| Role-history facts | 0 | Do not infer years or fresher status. Show experience as needing confirmation; a user-confirmed fresher can set 0 years and internships separately. |
| Skills | 43 | Preserve existing source facts; do not duplicate them into the new profile fields. |
| Education facts | 1 | Preserve existing source fact; ask for education level only under More details. |
| Legacy preferred-location strings | 1 | Retain unchanged and offer a one-tap `targetLocations` suggestion only on exact alias match; never set `homeLocation` from this field. |
| Preferred country codes | 0 | No home or target country is inferred. |
| Positive legacy USD minimum | No | No currency-conversion prompt is needed for this sample. |
| Role dates requiring confirmation | 0 | No role-history dates were present to derive in this sample. |

The preview does not migrate `skills` or `education`, and it does not make a user's home country equal to a preferred location. The sample has no role facts, so experience cannot be derived; the UI must ask instead of guessing. Production counts and mappings remain unverified until a production read-only dry run is explicitly scheduled.

## Location suggestions — `in-place-aliases-v2`

Suggestions are exact normalized string matches only. They never change saved data until the user confirms. Unknown text stays as an unclassified legacy value. State suggestions store the ISO 3166-2 subdivision code. City suggestions store the internal code and parent subdivision when it is unambiguous.

| Canonical suggestion | Accepted exact aliases |
| --- | --- |
| Kerala | Kerala |
| Karnataka | Karnataka |
| Tamil Nadu | Tamil Nadu |
| Maharashtra | Maharashtra |
| West Bengal | West Bengal |
| Odisha | Odisha; Orissa |
| Uttarakhand | Uttarakhand; Uttaranchal |
| Andhra Pradesh | Andhra Pradesh |
| Telangana | Telangana |
| Delhi (NCT) | Delhi; NCT Delhi |
| Arunachal Pradesh | Arunachal Pradesh |
| Assam | Assam |
| Bihar | Bihar |
| Chhattisgarh | Chhattisgarh |
| Goa | Goa |
| Gujarat | Gujarat |
| Haryana | Haryana |
| Himachal Pradesh | Himachal Pradesh |
| Jharkhand | Jharkhand |
| Madhya Pradesh | Madhya Pradesh |
| Manipur | Manipur |
| Meghalaya | Meghalaya |
| Mizoram | Mizoram |
| Nagaland | Nagaland |
| Punjab | Punjab |
| Rajasthan | Rajasthan |
| Sikkim | Sikkim |
| Tripura | Tripura |
| Uttar Pradesh | Uttar Pradesh |
| Jammu and Kashmir | Jammu and Kashmir; J&K |
| Ladakh | Ladakh |
| Puducherry | Puducherry; Pondicherry |
| Andaman and Nicobar Islands | Andaman and Nicobar Islands |
| Lakshadweep | Lakshadweep |
| Kochi | Kochi; Cochin |
| Thiruvananthapuram | Thiruvananthapuram; Trivandrum |
| Bengaluru | Bengaluru; Bangalore |
| Mysuru | Mysuru; Mysore |
| Mumbai | Mumbai; Bombay |
| Chennai | Chennai; Madras |
| Kolkata | Kolkata; Calcutta |
| Visakhapatnam | Visakhapatnam; Vizag |
| Gurugram | Gurugram; Gurgaon |
| Vadodara | Vadodara; Baroda |
| Mangaluru | Mangaluru; Mangalore |
| Hyderabad | Hyderabad |
| Pune | Pune |
| Ahmedabad | Ahmedabad |
| Jaipur | Jaipur |
| Lucknow | Lucknow |
| Indore | Indore |
| Bhopal | Bhopal |
| Coimbatore | Coimbatore |
| Nagpur | Nagpur |
| Surat | Surat |
| Patna | Patna |
| Bhubaneswar | Bhubaneswar |
| Dehradun | Dehradun |
| Chandigarh | Chandigarh |

The implemented curated catalog includes the 14 Kerala districts and aliases requested, Kochi under Ernakulam, the requested India-first city list, and the Gulf/overseas city and country aliases. Lookups normalize case, diacritics, punctuation, and whitespace but use exact alias/prefix search, never typo similarity or auto-conversion. The API checks city/region consistency and asks for confirmation for ambiguous Delhi, Punjab, and Hyderabad. Remote and Anywhere in India are explicit choice records.

Subdivision codes used by the catalog were checked on 2026-10-16 against ISO's current ISO 3166-2:2020 record and official Online Browsing Platform / country-code collection: https://www.iso.org/standard/72483.html and https://www.iso.org/iso-3166-country-codes.html. The checked codes in this subset are IN-KL, IN-DL, IN-UP, IN-HR, IN-MH, IN-TN, IN-AP, IN-KA, IN-CT, IN-JH, IN-AS, IN-RJ, IN-PB, IN-WB, IN-TG, IN-GJ, IN-MP, IN-BR, and IN-CH. City aliases are internal labels, not ISO codes. To add entries, update the versioned catalog, verify country/subdivision codes against ISO's current collection, add consistency and alias tests, then bump PLACE_CATALOG_VERSION.

## Experience derivation

- Normalize supported month/year formats without guessing; `present` resolves to the derivation date (today).
- Merge overlapping employment periods before calculating total years.
- Missing or unparseable start/end dates set `needsConfirmation`; do not fill missing dates with estimates.
- Internships remain separately represented. A fresher is 0 years only after explicit user confirmation; an empty role list alone is not proof of fresher status.
- Evaluation fixtures must cover present/current roles, overlapping periods, missing dates, invalid dates, no roles, and confirmed fresher plus internship history.

## Salary, completeness, and UX contract

- Default to INR only when the user confirms an Indian home country. Keep a currency selector and ISO 4217 code.
- A positive legacy USD minimum prompts: “Convert your saved USD minimum to INR?” No silent conversion and no FX call. The current local sample has no positive legacy USD minimum.
- Skip salary-fit comparison when currencies or pay periods differ or are unknown.
- The dismissible completeness meter counts only match-impacting fields: target role, confirmed experience, skills, target country/location, work mode, work authorization, employment type, and comparable salary when supplied. Each missing item explains its one-line matching benefit; it never blocks saving.
- Keep the existing Resume route. Proposed nav label: **Resume & profile**. Group optional education level, languages/test scores, availability, employment type, shift, and certification name/issuer/country/expiry under “More details.” Never collect certificate/license numbers.
- Use collapsible groups, explicit Save feedback, unsaved-change warning, accessible labels/errors, 44px touch targets, and dark/light theme tokens. No route migration is needed.

## Privacy inventory, export, and deletion

Add `careerProfile` to the profile data inventory and existing profile export. Existing account deletion must remove the embedded profile fields as part of deleting the owner profile. Do not add profile values to application logs, request traces, error messages, LLM context, or analytics. Keep the data in MongoDB and use existing export/deletion mechanisms; no new storage service is proposed.

## Rollback

The proposed schema is additive. Rollback disables the career-profile API/UI feature flag and restores the prior Resume preferences UI; legacy fields remain untouched. If the later approved migration writes copied values, each write must carry a migration version/source marker. A rollback may remove only untouched migration-created values with that marker; it must preserve any field edited or confirmed by the user after migration. No rollback will delete existing facts or vectors.

## Gate 2 quality gates

- **Current-code finding:** `src/services/jobs/matching.js` sets `MATCH_SCORE_VERSION` to `lexical-v3` unconditionally. The `lexical-v2` implementation is recoverable at commit `88bec63`; the v3 change set adds role normalization, adjusts unknown experience handling, and raises the Fair threshold. Therefore Gate 2 must restore a side-by-side v2/v3 evaluator and a default-v2 version flag before it can satisfy the approved ship criterion. Do not treat the current default as already approved.
- Compare both versions against all existing fixtures and the new profile-shaped fixtures; ship v3 only if no existing fixture regresses and the new fixtures improve. Report the fixture-level table; do not retune weights.
- Update AI inventory, matching engine, evaluation, failure modes, data inventory, and ADRs with implementation details. Run `npm run docs:check` and full tests.
- Do not implement eligibility, a gazetteer, INR display before confirmation, provider personalization, or new dependencies/data/infrastructure in this phase.

## Target design (not built yet)

Gate 3 adds the frontend profile form and completeness meter. The career-profile migration remains report-only until the owner approves the dry-run counts.

## Verification

Run `npm run career-profile:migration:report` for the non-writing aggregate report, `npm run test` for schema/API/parser coverage, and `npm run docs:check` for documentation checks.
