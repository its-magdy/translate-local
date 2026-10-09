## Summary

What changed and why. Link the issue if there is one (`Closes #123`).

## Checks

Details in [CONTRIBUTING.md](https://github.com/its-magdy/translate-local/blob/main/CONTRIBUTING.md#pre-commit-checklist).

- [ ] `bun run build` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes
- [ ] Relevant `tl` commands smoke-tested with an isolated `HOME` (a throwaway directory, not your real `~/.config/tl`)
- [ ] `TEST_ADAPTER=1 bun run test` passes (only if Ollama-facing adapter code changed)
- [ ] Docs updated if behavior changed
- [ ] No version bump or `CHANGELOG.md` edit (release PRs only)
