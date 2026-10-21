# Jobright.ai: public product analysis

**Research date:** 2026-10-20. **Scope:** public pages and one unauthenticated homepage browser capture. This is product research, not a claim about Jobright's private implementation.

Last verified against commit `19a9e22951fe449e40690b88248c5db499eda809` for the repository references in this research set.

## As built (verified in code)

This page records public product behavior and labels it as first-party claims. It does not describe Jobright internals as verified code. IrowzScout's existing app architecture and implemented matching/resume behavior are summarized in the [AI inventory](01-ai-inventory.md), [matching engine](06-job-matching-engine.md), and [resume pipeline](08-resume-ai-pipeline.md).

## Target design (not built yet)

Any IrowzScout product recommendations in this research set are proposals for independent implementation; they are not code changes or claims about Jobright.

## Executive summary

Jobright publicly presents an end-to-end job-search workspace: personalized job matching, resume tools, a career copilot, application autofill, interview preparation, saved jobs/tracking, and connection/referral discovery. Its public pages substantiate what it advertises, not whether every workflow is available to every account or how the backend is built. Product pages provide no reliable disclosure of the complete listing-source portfolio, matching weights, prompt design, model per feature, or private API contracts.

## Public workflows and evidence

| Journey            | Publicly described behavior                                                                                                                                                                                                                   | Evidence / confidence                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover jobs      | AI Job Match describes using a resume/profile and preferences to present a Match Score and explanations involving experience, seniority, skills, and gaps.                                                                                    | [AI Job Match](https://jobright.ai/ai-job-match), first-party product claim, high confidence that this is advertised.                        |
| Resume             | Resume-job matcher describes upload/target role comparison with match score, skill/experience overlap, and keyword gaps. Resume builder advertises analysis, refinement, and download.                                                        | [Resume matcher](https://jobright.ai/tools/resume-job-matcher), [Resume builder](https://jobright.ai/ai-resume-builder), first-party claims. |
| Apply              | Job Autofill page describes a browser extension that fills application fields after the user opens an employer application; the illustrated flow ends with the candidate reviewing/submitting. This does not establish autonomous submission. | [Job Autofill](https://jobright.ai/job-autofill), first-party page.                                                                          |
| Save and track     | Job tracker describes saving/favoriting listings and tracking application status.                                                                                                                                                             | [Job tracker](https://jobright.ai/tools/job-tracker), first-party claim.                                                                     |
| Copilot/interviews | Homepage promotes Orion Copilot and interview questions; the interview page advertises company-specific question preparation.                                                                                                                 | [Homepage](https://jobright.ai/), [interview questions](https://jobright.ai/interview-landing).                                              |
| Connections        | Homepage promotes Insider Connections/TNT. Public material describes networking/referral discovery, but account-level availability and underlying data provenance were not independently verified.                                            | [Homepage](https://jobright.ai/).                                                                                                            |

The homepage advertises large catalog and daily-job counts. Treat those as marketing statements: this investigation did not independently enumerate the catalog, deduplicate the claimed count, or validate geographic coverage.

## Browser observation

REA captured the public homepage in an isolated headless Chrome session on 2026-10-20 without credentials, cookies, browser storage, or request/response bodies. It confirmed a publicly accessible homepage and sampled successful page/static-asset requests. The capture retained only metadata; the request window overflowed and dropped 414 network events. Consequently it is **not** a complete request inventory and cannot prove that the site has no public APIs, identify all third parties, or support conclusions about authenticated flows. No private endpoints were accessed.

## Privacy and terms constraints

Jobright's privacy policy describes collecting resumes/professional information, using AI providers including OpenAI, Anthropic, Google Cloud AI and AWS AI, and sending inputs/outputs/personal information to those providers. It also discloses US-based servers/transfers and a six-month retention period after account termination, subject to the policy's details. It does not map a provider/model to an individual feature or reveal prompts. See [Privacy Policy](https://jobright.ai/legal/privacy), accessed 2026-10-20.

The [Terms of Service](https://jobright.ai/legal/service) restrict copying, aggregating, republishing, and automated querying/reverse engineering. This report records public claims and high-level observations only; it does not copy listings, reproduce private contracts, or provide a legal opinion. Recheck terms before any future research or product use.

## Implications for IrowzScout

Build the same user problem space independently, not Jobright's hidden internals: an honest indexed catalog; profile-grounded recommendations with explainable factors; user-controlled resume analysis; explicit user review before external application submission; and opt-in saved-job/application tracking. Keep source provenance, consent, deletion, and source terms visible. Use independent copy, schemas, scoring, and endpoints. Unknowns are listed in [the evidence register](research-evidence-register.md).

## Verification

Reviewed first-party public product, privacy, and terms pages on 2026-10-20; recorded the REA capture limitations in the evidence register. Repository code was not changed. `npm run docs:check` validates this document's local documentation structure.
