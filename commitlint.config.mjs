export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"]],
    "scope-enum": [2, "always", ["jobs", "resume", "applications", "interviews", "chat", "profile", "ai", "infra", "docs", "deps", "release"]],
    "subject-max-length": [2, "always", 72],
    "subject-full-stop": [2, "never", "."],
  },
};
