# ADR 09 — Source registry default-disabled

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

JobSource model defaults enabled=false and approved=false. Explicit source policy seeding registers the configured approved sources, and scheduler requires both enabled and approved.

## Target design (not built yet)

Require complete terms/attribution/retention/quota/verification and explicit approval before enabling a new registry record. Default for all newly proposed sources remains disabled.
