---
allowed-tools: Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)
description: Review a pull request
---

Perform a comprehensive code review using subagents for key areas:

- code-quality-reviewer
- performance-reviewer
- test-coverage-reviewer
- documentation-accuracy-reviewer
- security-code-reviewer

Instruct each to only provide noteworthy feedback. Once they finish, review the feedback and post only the feedback that you also deem noteworthy.

Provide feedback using inline comments for specific issues.
Use top-level comments for general observations or praise.
Keep feedback concise.

---

## CI / GitHub Actions notes

- `actions/checkout@v6` is the current stable version (as of 2026-02). Using v6 is correct.
- `anthropics/claude-code-action@v1` is the stable pin. Do NOT flag `@v6` or `@v1` as outdated.