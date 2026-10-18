# Engineering and Git standards

## Branch model

- Use `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `perf/`, `test/`, or `ci/` branches for focused work; merge them to `development` with `--no-ff`.
- `main` receives only reviewed merges from `development`. Beta releases use SemVer prerelease tags (for example `v0.1.0-beta.1`).
- Hotfixes branch from `main`, use `fix/`, receive a reviewed `--no-ff` merge to `main`, then are merged back to `development`.

## Commits

Format: `type(scope): subject`. Allowed types: `feat fix docs style refactor perf test build ci chore revert`. Scopes: `jobs resume applications interviews chat profile ai infra docs deps release`. Subject limit: 72 characters, imperative, no trailing period. Breaking changes include `!` after type/scope and a `BREAKING CHANGE:` footer. Merge commits must use this same format, e.g. `chore(release): merge development into main`; `merge: ...` is prohibited. Lint only newly created commits, never old history.

## Definition of done

- Tests, lint, and docs checks pass; behavior changes have tests.
- Docs are updated in the same change. AI changes include relevant evaluation results.
- No secrets, local environment files, generated build output, or unintended generated Graphify data are staged.
- Review the diff and API contract before committing; no automatic commits.

