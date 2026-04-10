# Changelog

## [0.2.0] - 2026-04-07

### Added
- Standalone binary distribution via `bun build --compile`. Run `bun run build:bin` in `apps/cli` to produce a self-contained `dist/tl` executable. No Bun, Node, or other runtime needed at install time.
- `.github/workflows/release.yml`: cross-compiles `tl` for darwin-arm64, darwin-x64, linux-x64, linux-arm64, and windows-x64 from a single `ubuntu-latest` runner on `v*` tag push, and publishes the binaries plus `SHA256SUMS` to a GitHub Release.
- README install section restructured into "Direct binary download" (recommended for end users) and "Develop / contribute" (for contributors using `bun link`).

### Changed
- TUI is now embedded in-process. The CLI no longer spawns `bun run apps/tui/src/index.ts` as a subprocess when invoked with no arguments — it dynamically imports `@tl/tui` and calls `runTui()` directly. This is required for the compiled binary to launch the TUI without a `bun` runtime on the user's machine. Cold-path performance for non-TUI invocations (e.g. `tl "hello" --to ar`) is preserved by using a dynamic `import()`.
- `apps/cli` now depends on `@tl/tui` as a workspace dependency.
- `--version` bumped to `0.2.0`.

### Notes
- macOS binaries downloaded from GitHub Releases will trigger Gatekeeper's "unidentified developer" warning until we ship signed builds. Run `xattr -d com.apple.quarantine ./tl` to bypass it. Apple Developer ID signing + notarization is tracked as a follow-up.
- Binary size is ~63 MB on darwin-arm64; the embedded Bun runtime accounts for ~60 MB of that. There is no way to strip it today (see [oven-sh/bun#4453](https://github.com/oven-sh/bun/issues/4453)).
- `--bytecode` is intentionally omitted from `build:bin` due to known interactions with top-level await ([oven-sh/bun#9774](https://github.com/oven-sh/bun/issues/9774)).
