# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately through GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/its-magdy/translate-local/security/advisories/new)**

Do not open a public issue or pull request for a suspected vulnerability. A public report puts every user at risk before a fix exists.

Include what you can:

- the affected `tl` version (`tl --version`) and how you installed it
- your OS and architecture
- steps to reproduce, or a proof of concept
- the impact you expect

Don't include real secrets or private catalog content in a report; a minimal sample file is enough.

`tl` is maintained by one person. Reports are handled on a best-effort basis, and no response or fix time is promised. The advisory thread is where the report, the fix and the disclosure get coordinated.

## Supported versions

Only the latest release receives security fixes. Releases are published from `vX.Y.Z` tags to [GitHub Releases](https://github.com/its-magdy/translate-local/releases), npm and the Homebrew tap, so upgrading to the newest version is the supported way to get a fix. Older versions are not patched.

## Scope

In scope are vulnerabilities in code in this repository, for example:

- the `tl` CLI and TUI
- reading and parsing local files: JSON/YAML catalogs (`--file`), glossary CSV, context sources, images and the config file
- writing files: atomic output writes, `.tl/locks`, and the glossary and context SQLite databases under `~/.config/tl/`
- how `tl` talks to the configured Ollama server and handles its responses
- `install.sh`, which downloads a release binary and verifies it against the release's `SHA256SUMS`
- the release workflow, the published `@translate-local/tl` npm packages and the Homebrew tap formula (`its-magdy/homebrew-tap`)

Out of scope:

- vulnerabilities in [Ollama](https://github.com/ollama/ollama) itself; report those to the Ollama project
- vulnerabilities in the models, including prompt injection that only changes what a model says (for example, text in a translated document that steers the model's output)
- vulnerabilities in third-party dependencies that don't affect `tl`; if one does, report it here
- issues that require an attacker who already controls the user's machine, account or `tl` configuration

## Verifying a release

- **Binary downloads:** every release includes a `SHA256SUMS` file. Compare your download against it, for example `sha256sum -c --ignore-missing SHA256SUMS` on Linux or `shasum -a 256 -c --ignore-missing SHA256SUMS` on macOS. `install.sh` does this check itself and aborts on a mismatch. Releases after 0.5.4 also carry signed build provenance for each binary: `gh attestation verify <file> --repo its-magdy/translate-local` confirms it was built by this repository's release workflow.
- **npm packages:** `@translate-local/tl` and its platform packages are published from GitHub Actions with [provenance](https://docs.npmjs.com/generating-provenance-statements). In a project that has them installed, run `npm audit signatures` to check the registry signatures and provenance attestations.
