# GitHub branch protection settings

Configure rulesets for `main` and `development` separately:

1. Require a pull request before merging; require at least one approval (owner may self-approve only if repository policy permits).
2. Require all applicable checks: `verify` (lint, tests, docs, secret scan, audit report, commit lint) and `production-build`.
3. Require branches to be up to date before merging.
4. Block force pushes and branch deletion.
5. Permit merge commits because this workflow explicitly uses `--no-ff`; do not require linear history.
6. Restrict `main` changes to PRs sourced from `development` (and approved hotfix branches). Do not allow direct pushes.

These settings are owner actions and are not applied by this repository change.

