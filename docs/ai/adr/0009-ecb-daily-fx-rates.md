# ADR 0009: Daily ECB reference rates for display and comparable salary

Last verified against commit `Phase 3 working tree` on 2026-10-16.

## As built (verified in code)

The worker fetches daily ECB euro reference rates for USD, INR, GBP, CAD, AUD, AED and SAR once per day. Mongo retains the last successful dated rate. Requests never fetch FX. Salary display labels conversions as approximate and retains the source amount; scoring only compares known annual/monthly periods. `FX_REFERENCE_SOURCE` defaults to `ecb`; RBI/FBIL are recognized config values but have no active adapter. RBI ended publication of its own reference rate on 2018-07-09, FBIL took over on 2018-07-10, and FBIL's published fee FAQ indicates the reference-rate data is fee-liable. The code fails explicitly for those sources until feed rights are approved. ECB describes its reuse terms in its [statistics usage policy](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html).

## Decision

Use a documented no-cost reference source and avoid a request-time dependency. Cross-rate arithmetic uses EUR as the common base. An old rate is still shown with its date, not represented as current.

## Target design (not built yet)

Add a monitored refresh age metric and evaluate user-visible disclaimers with product/legal review.
