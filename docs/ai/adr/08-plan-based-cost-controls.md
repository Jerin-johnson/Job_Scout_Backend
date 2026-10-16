# ADR 08 — Plan-aware cost controls

Last verified against commit a519e3673d2e02c2ab556d71296db57167544713 on 2026-10-16.

## As built (verified in code)

Per-feature plan quotas, daily user/global spend caps, kill switch and monthly shadow logging are implemented. Paid models remain disabled in the user-facing chat picker; production provider/model data policy is checked. Monthly atomic reservations/enforcement are not implemented.

## Target design (not built yet)

Use atomic reserve/settle with idempotency and billing reconciliation; roll out in shadow mode before blocking. Keep limits feature- and plan-aware.
