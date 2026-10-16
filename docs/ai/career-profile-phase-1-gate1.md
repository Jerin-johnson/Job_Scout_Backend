# Career profile — Gate 1 backend proposal

Last verified against commit `0275ec3` on 2026-10-16.

**Status:** proposed for review; no career-profile schema, API, or data migration has been implemented. The only database operation performed for this review was a read-only preview.

## As built (verified in code)

`Profile` currently stores resume role, skill, and education facts and legacy preferences (`targetRoles`, `minimumSalaryUsd`, `preferredLocations`, `preferredCountryCodes`, occupation codes, and remote preference). There is no `careerProfile` subdocument or career-profile API yet. The existing profile remains owner-scoped. The read-only local preview and its limitations are recorded below.

## Target design (not built yet)

### Proposed additive model

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
    "aliasCatalogVersion": "in-place-aliases-v1",
    "confirmedAt": null
  },
  "workAuthorization": {
    "homeCountryOnly": true,
    "sponsorshipOrRelocationCountryCodes": []
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
    "testScores": [],
    "availabilityCode": null,
    "noticePeriodDays": null,
    "certifications": []
  },
  "updatedAt": null
}
```

`roleCode` is a stable internal canonical ID; custom roles retain their user-provided label, are explicitly marked custom, and remain eligible for token/synonym matching. Country uses ISO 3166-1 alpha-2, currency uses ISO 4217, and state/province uses ISO 3166-2. City codes are stable internal slugs from the small versioned alias map, not a new external dataset. The ISO 3166-2:2020 standard remains current after its 2025 review ([ISO standard record](https://www.iso.org/standard/72483.html)).

Sensitive fields (home city, work authorization, licenses/certifications, notice period, and test scores) are stored only in the profile service. They are excluded from AI prompts and logs. The later possibility of allow-listing safe fields such as role, seniority, years, and country for chat remains an open decision pending provider terms review.

## API proposal

Add authenticated, owner-scoped endpoints without changing the existing preferences contract:

- `GET /api/v1/profile/career-profile` returns `careerProfile`, a non-mutating set of legacy-field migration suggestions, and the current profile version. It never persists suggestions.
- `PATCH /api/v1/profile/career-profile` validates a partial update, requires the current `profileVersion`, and saves only explicitly confirmed selections. Return the updated profile and incremented version.
- A user confirmation of an alias or USD-to-INR conversion is an explicit field-level action in the patch. A mismatch in currencies skips salary-fit scoring; no automatic currency conversion or exchange-rate service is proposed.

The old endpoints and legacy preferences remain readable for compatibility. New fields do not silently overwrite `minimumSalaryUsd`, `targetRoles`, or `preferredLocations`.

## Read-only migration dry run

The local development MongoDB has one profile. The preview resolved that only profile because no configured admin identity was available to bind the query to a named account; treat it as the sole local profile-shaped sample, not as proof of production-account identity. No field values or IDs were emitted, and nothing was written.

| Existing data | Preview | Proposed handling |
| --- | ---: | --- |
| Target-role preferences | 1 | Offer as one role suggestion; use a canonical code only when the user confirms a curated match, otherwise retain as custom. |
| Role-history facts | 0 | Do not infer years or fresher status. Show experience as needing confirmation; a user-confirmed fresher can set 0 years and internships separately. |
| Skills | 43 | Preserve existing source facts; do not duplicate them into the new profile fields. |
| Education facts | 1 | Preserve existing source fact; ask for education level only under More details. |
| Legacy preferred-location strings | 1 | Retain unchanged and show a one-tap suggestion only on exact alias match. |
| Preferred country codes | 0 | No home or target country is inferred. |
| Positive legacy USD minimum | No | No currency-conversion prompt is needed for this sample. |
| Role dates requiring confirmation | 0 | No role-history dates were present to derive in this sample. |

The preview does not migrate `skills` or `education`, and it does not make a user's home country equal to a preferred location. The sample has no role facts, so experience cannot be derived; the UI must ask instead of guessing. Production counts and mappings remain unverified until a production read-only dry run is explicitly scheduled.

## Location suggestions — `in-place-aliases-v1`

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

This is a proposal, not a committed dataset. Please review whether the state/city coverage and ambiguous names are acceptable before Gate 2. No fuzzy or partial matching is planned in this version.

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

- Keep `lexical-v2` as the default and put `lexical-v3` behind a version flag. Compare both against all existing fixtures and the new profile-shaped fixtures; ship v3 only if no existing fixture regresses and the new fixtures improve. Report the fixture-level table; do not retune weights.
- Update AI inventory, matching engine, evaluation, failure modes, data inventory, and ADRs with implementation details. Run `npm run docs:check` and full tests.
- Do not implement eligibility, a gazetteer, INR display before confirmation, provider personalization, or new dependencies/data/infrastructure in this phase.
