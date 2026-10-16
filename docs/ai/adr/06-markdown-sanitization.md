# ADR 06 — Safe assistant markdown

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Frontend assistant output uses react-markdown/GFM without raw HTML, explicit URL transformation, no remote image loading, restricted internal links, and isolated external links. Tests cover dangerous schemes and active HTML payloads.

## Target design (not built yet)

Keep raw HTML disabled and review every renderer/plugin change for script, URL, image beacon, long-text and layout risks.
