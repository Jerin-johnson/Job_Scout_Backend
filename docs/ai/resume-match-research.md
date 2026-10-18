# Job-specific resume matching research

Last verified against commit `857595d` plus working-tree changes and official product/ATS guidance on 2026-10-17.

## As built (verified in code)

The implementation uses deterministic matching and optional, grounded suggestions. External comparisons below inform UX only; they do not validate our score.

## Target design (not built yet)

Calibrated score interpretation and independently labeled relevance evaluation remain future work.

Research checked 17 October 2026. This feature is a deterministic **match estimate** and resume-readability checklist. It is not an employer ATS score, pass probability, or hiring prediction.

## Comparable products

| Product | Documented behavior | Plan gate observed | Product lesson |
| --- | --- | --- | --- |
| Teal Job Matcher | Compares a selected or pasted job description with a resume, surfaces present and missing keywords, permits ignoring terms, and offers AI bullet drafting. | Teal says free users see a limited number of keywords; Teal+ shows unlimited keywords. | Keep the full deterministic keyword list available to everyone; charge only for optional generated suggestions. |
| Jobscan Resume Matcher | Compares a resume to a job description and reports match rate, keyword gaps, formatting and section feedback. Jobscan explicitly says its match rate is a visualization and that an employer ATS does not score a resume in this way. | Its official site says initial match report is free; its premium explainer says free accounts receive five scans/month. | Never label our numeric score as what a hiring system will calculate. |
| Rezi | Provides resume checks across content/format/optimization and job-targeted keyword analysis. | Current pricing page distinguishes limited free analysis/keyword targeting from full Pro access; its checker requires an account. | Separate document-readiness checks from job fit, and disclose any AI limit plainly. |
| Resume Worded | Targeted Resume compares a resume to a pasted posting, weights required qualifications more than preferred ones, and lists matched and missing terms. | Its targeted resume landing page currently describes the scan as free. | Weight must-have requirements more; avoid promoting keyword stuffing. |

These products document heuristic comparisons and checks. Their published descriptions do not establish an ability to predict an employer's proprietary screening or hiring outcome. User reviews and anecdotal reports are not used as evidence in our scoring design; generated text can sound generic or introduce claims, so suggestions here must cite a user's stored fact and be reviewed before use.

## What employer ATS documentation supports

- Greenhouse accepts several common document types, but its support guidance lists parse failures caused by images, complex tables, headers/footers, text boxes, columned layouts, and unclear sections. This supports checking whether extracted text has clear sections and content; it does not support claiming a universal ATS pass score. [Supported formats](https://support.greenhouse.io/hc/en-us/articles/360052218132-Supported-formats-for-resumes-cover-letters-and-other-candidate-uploads), [parse failures](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse).
- Lever's help describes resume-derived text search and parsing of candidate location, but does not publish a universal candidate score that predicts application outcomes. [Candidate search](https://help.lever.co/s/article/Searching-the-Database-for-Candidates).
- Workable documents extracting candidate fields from uploaded resumes, including image-based CV support in its workflow. This is evidence that parser capabilities vary by vendor and workflow, not that a third-party checklist can predict a specific employer's result. [Resume parsing](https://help.workable.com/hc/en-us/articles/115012661408-Uploading-candidate-resumes-CVs-Individual-and-bulk-options).

The interface must say **“Match estimate, not what any employer's system will do.”** ATS readiness is a separate set of observable checks on our own extracted text and file metadata. It cannot observe a particular employer's parser, filters, recruiter settings, or hiring decisions.

## Cost and product choice

Deterministic keyword extraction, scoring, ATS checks, ignoring keywords and rescoring use local CPU and Mongo/Redis only; no embedding or provider call is required. Optional suggestions are generated only on a user click, use compact structured facts and the shared small-tier provider, and are cached by resume hash, job hash, prompt version and score version. The entitlement count is configured in one plan quota field. A provider cost cannot be responsibly stated until the configured model and rate catalog, token usage, and actual request measurements are available; report ledger observations rather than a fabricated fixed cost. Suggestions must be disabled if the shared AI layer is unavailable or the account has not consented to resume AI processing.

## References

- [Teal Job Matcher help](https://help.tealhq.com/en/articles/12060992-using-the-job-matcher) and [Teal ATS checker](https://www.tealhq.com/tool/resume-checker)
- [Jobscan Resume Matcher](https://www.jobscan.co/resume-matcher) and [Jobscan Premium overview](https://www.jobscan.co/video-jobscan-premium)
- [Rezi pricing](https://www.rezi.ai/pricing) and [Rezi resume checker](https://www.rezi.ai/tools/resume-checker)
- [Resume Worded Targeted Resume](https://www.resumeworded.com/targeted-resume)
