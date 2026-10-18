# Git standards research

Accessed 2026-10-18. This is a concise implementation reference; repository rules are in [standards.md](standards.md).

## Findings

- [Husky v9 setup](https://typicode.github.io/husky/get-started.html) installs Git hooks through its `prepare` script. Its [troubleshooting guide](https://typicode.github.io/husky/how-to.html) documents `HUSKY=0` as a bypass. Hooks are convenience checks, not an enforcement boundary.
- [lint-staged](https://github.com/lint-staged/lint-staged) runs configured tasks against staged files, which limits pre-commit work and avoids linting unrelated working-tree content.
- [commitlint CI setup](https://commitlint.js.org/guides/ci-setup) supports checking commit messages in pull-request ranges. New commits only are checked; existing history is not rewritten or retroactively linted.
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) support required pull requests, required status checks, and restrictions on force pushes. [GitHub recommends pinning Actions by full SHA](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions).
- [Git attributes](https://git-scm.com/docs/gitattributes) can preserve LF endings for scripts on Windows. This repository limits new attributes to hook and shell-script paths; no mass line-ending normalization is appropriate.

## Limits and practical policy

Local hooks can be bypassed with `--no-verify` or `HUSKY=0`, and may not run until the owner installs the approved development packages. Required CI checks and branch protection are the enforceable gates. Hook activation is therefore **unverified until installed by the owner**. On Windows, use Git for Windows/Git Bash for Husky shell hooks and keep hook files LF.

