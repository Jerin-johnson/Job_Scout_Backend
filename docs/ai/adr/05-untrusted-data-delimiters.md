# ADR 05 — Delimit untrusted data

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Chat labels candidate context/history as untrusted; interview inputs are wrapped in named delimiters with safety rules; resume facts are grounded to source.

## Target design (not built yet)

Use shared escaping/delimiter helpers and injection fixtures for every user/source text field. Validate model output independently of prompt compliance.
