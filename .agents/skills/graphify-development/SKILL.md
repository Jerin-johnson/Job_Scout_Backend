---
name: graphify-development
description: Explore and change the JobScout backend or frontend with Graphify-guided discovery, focused source verification, tests, and safe Git review. Use for unfamiliar features and changes spanning modules; keep isolated fixes proportionate.
---

# Graphify-assisted JobScout development

Use this workflow in either the JobScout backend or frontend repository. Graphify narrows codebase exploration; source code, configuration, and tests remain authoritative.

## 1. Establish context

- Identify the repository root and current branch; inspect `git status` before edits.
- Read applicable `AGENTS.md` instructions and determine whether the task is isolated or spans modules.
- Avoid unrelated files and preserve all existing user changes.

## 2. Discover with Graphify

- Locate the repository's Graphify report and structured graph artifacts. Check that they are readable and relevant before relying on them; the presence of an output directory alone is not proof of a usable graph.
- Verify syntax against the installed integration or `graphify --help`. In this environment, the Graphify skill supports `$graphify .` for its full workflow and `$graphify . --update` for incremental updates. The CLI documents `graphify query "<question>" --graph graphify-out/graph.json`, `graphify update .`, and `graphify extract .`; confirm current-version syntax before use.
- Query for relevant files, modules, functions, classes, callers, dependencies, routes, and data flows. Reuse a valid graph. Update or rebuild only if it is missing, unreadable, or materially stale, following repository conventions.
- For small isolated changes, use judgment and skip graph work when it adds no value.
- Never claim a graph query or operation that was not actually performed. If Graphify is unavailable, say so and continue with focused source exploration.

## 3. Verify source behavior

- Inspect the relevant source files, configuration, and tests identified by graph queries or focused searches.
- Verify signatures, control flow, validation, authorization, error handling, and data access as applicable.
- Treat graph edges and summaries as navigation hints, not proof of runtime behavior. Note missing or outdated graph information.

## 4. Plan non-trivial changes

Summarize the current implementation, minimal files to change, dependencies and regression risks, and validation strategy. Ask for clarification only when an essential requirement cannot be inferred. Do not broaden scope with unrelated refactors.

## 5. Implement and validate

- Follow the repository architecture and conventions; reuse suitable abstractions, avoid unnecessary dependencies, and preserve security boundaries.
- Run relevant unit/integration tests, type checks, lint, builds, and project-specific checks using commands documented by the repository.
- Report actual outcomes. If a check cannot run, explain why; never imply it passed.

## 6. Maintain the graph when warranted

Decide whether the change alters relationships represented in Graphify. Update the graph only when useful; do not rebuild for every trivial edit or stage generated graph artifacts automatically. Follow the repository's generated-file policy.

## 7. Review Git changes

Before recommending or making a commit, inspect status and the complete diff; check scope, secrets/sensitive configuration, authorization and error handling, tests, dependencies, generated files, and unresolved risks. Never commit automatically unless explicitly requested. Never amend, reset, or rewrite history without explicit authorization.

## 8. Report clearly

Give a concise report of Graphify queries/operations actually performed, relevant source inspected, files changed, checks and their real results, remaining risks or skipped checks, whether the graph needs updating, and readiness for review/commit.

## Token efficiency and safety

- Prefer targeted graph queries and file reads over broad scans; avoid redundant reads and repeated large excerpts.
- Do not sacrifice source verification or required testing to save tokens.
- Never discard user changes, expose secrets, or modify production infrastructure without authorization.
- Never fabricate graph results, test results, or command output.
