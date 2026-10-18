# Owner release checklist (local instructions only)

In **each repository**, install the approved hooks first using [hooks.md](../engineering/hooks.md), then run:

```powershell
npm run verify:release
npm run smoke:compose
npm audit --omit=dev --audit-level=high
```

Only after green checks and green GitHub Actions, push `development`, then `main`, then the approved release tag to the private remote. The current local tag is an RC only. The owner may create `v0.1.0-beta.1` only after the final audit and smoke gates pass.

Rollback instructions: stop release activity and restore the relevant branch from its recorded `backup/pre-merge-YYYY-MM-DD` tag through a reviewed recovery PR. Do not force push or reset shared remote history.

