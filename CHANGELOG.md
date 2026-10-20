# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.20] - 2026-10-20

### Changed
- **Text translations protect placeholders.** `{name}`, `{{count}}` (also `{{n, number}}`), `%{name}`, `%s`/`%d` and `%1$s` in the text are now sent to the model the way file mode sends them, so they come back as written: `Clear the cache for {user}.` no longer becomes `… pour {utilisateur}.` An answer that loses, adds or translates one is retried, up to 3 attempts. If every attempt does, `tl` prints the last one with a `Placeholders: not all kept` warning on stderr (`metadata.placeholderMismatch` in JSON). Markup (`<b>`), `@:linked` keys and `$t(...)` stay ordinary text, since they also occur in prose. Streaming shows the placeholders, not the internal tokens.

### Fixed
- **A translation no longer shrinks to the glossary term.** When the model left a term tag open, `tl` replaced the tag and everything after it with the term: `tl "Cache size: 5 MB" --to fr` with `cache → antémémoire` often printed only `antémémoire`. This happened mostly when a term starts a `Label: value` text, and in file mode too (an Arabic benchmark sentence came back as the single word `نشر` in half the runs). The text is now kept, and the glossary retries place the term: `Antémémoire : taille : 5 Mo`.
- **The last glossary retry's answer starts uppercase when the first answer did.** That retry sends the term in place of the source word, so a text starting with the term came back lowercase (`antémémoire : taille : {size}`). Its first letter is now raised as in 0.5.19's drift fix, again leaving glossary spellings like `iOS` as written.

## [0.5.19] - 2026-10-20

### Fixed
- **A glossary term no longer swallows the words next to it.** When the model put a term tag around a neighbouring word, stripping the tag replaced that word too: French `Cache size: {size}` with `cache → antémémoire` could come out as only `Antémémoire : {size}`. `tl` now detects the drift and takes the answer from the code-switched check, which keeps those words (`Antémémoire : taille : {size}`). The JSON output reports it as `metadata.tagDrift`. That answer starts uppercase when the draft did, using the target language's casing rules, and glossary spellings like `iOS` or `.env` are left as written.

## [0.5.18] - 2026-10-19

### Added
- **`tl translate` reads piped stdin.** When no text, `--image` or `--file` is given, `tl` translates what is piped in: `echo "good morning" | tl --to ar`, `pbpaste | tl translate --to fr --json`. Trailing line breaks are dropped and inner ones kept. Text given as an argument wins over stdin. `tl` with no arguments still opens the TUI, so piping needs at least one argument.

### Changed
- **File mode reports an invalid `--max-size` first.** When a run has more than one problem, an invalid `--max-size` is now reported before a missing source file or an output path that can't be inferred. The "Cannot infer output path" message shows the absolute path.

### Fixed
- **File mode creates a missing output directory.** `tl translate --file locales/en/common.json --to ar` failed with `FILE_WRITE_FAILED` when `locales/ar/` didn't exist yet, and so did `--out` into a new directory. The directory is now created. A dry run still creates nothing.
- **Strict file mode uses `glossary.maxRetries`.** File mode always retried a missing glossary term twice, whatever the setting; it now makes the same attempts as a text translation.
- **`tl glossary remove` refuses an ambiguous id prefix.** A prefix matching more than one entry silently removed whichever sorted first. It now removes nothing, exits 1 with `INVALID_INPUT` and lists the matching ids. An exact id always wins over a longer id it prefixes. An unknown id, and an unsupported language in `tl glossary add` (`INVALID_LANGUAGE`), now print the usual `Error [TAG]` and hint.
- **Context sources are stored as absolute paths.** `tl context add ./docs` stored `./docs` as typed, so `tl context index` run from another directory read the wrong folder, and `./docs`, `docs` and the absolute path became three sources. New sources are stored absolute. Sources added before 0.5.18 keep the typed path: remove them (`tl context remove`, from the directory they were added in) and add them again. A missing path in `tl context remove` now reports `CONTEXT_DB_ERROR` with a hint.

## [0.5.17] - 2026-10-19

### Added
- **Offline replay of benchmark runs (for contributors).** `scripts/bench/replay.ts` re-runs every saved file-mode benchmark run from the model answers it recorded, in about a second and without a model, on the JSON benchmark catalog and two YAML copies (comments, block scalars, i18next plurals, a Rails `en:` root). It compares every line written, so `--out` on `main` and `--diff` on a branch list exactly the keys a change affects, formatting included.

### Changed
- **YAML targets keep their own values, like JSON targets.** When a YAML target already exists, `tl` now writes exactly the target's data: a number or boolean you changed in the target stays (`count: 7` was reset to the source's `count: 5`), and number, boolean or empty-map keys that only the source has are no longer added. Comments, quoting and key order still come from the source file. On the first sync after upgrading, an existing YAML target may lose such source-only keys (and the comment above them). New targets are unchanged.
- **Dry runs name the ICU syntax error.** `--dry-run` reported a malformed ICU message as `Invalid ICU MessageFormat at <key>`; it now adds the parser's error (`: MISSING_OTHER_CLAUSE`), the same as a real run.

### Fixed
- **An interrupted YAML run no longer writes English into a list.** When a sync was interrupted and the existing target had `null` entries in a list, a later item's source text could land in their place (`[Three, null, Tres]` instead of `[null, null, Tres]`).
- **A YAML number tag no longer corrupts a translated value.** A source value written with an explicit tag (`count: !!int 5`) turned the existing target's text into `count: !!int .nan`. The text is now written as is.

## [0.5.16] - 2026-10-16

### Added
- **Glossary terms can accept other target forms.** A term like German `deploy → bereitstellen` is often correctly written as `Bereitstellung`, `bereitgestellt` or `stellen … bereit`. Before, `tl` reported such translations as missing the term, retried and could replace a correct sentence with a worse one. Add the forms with `tl glossary add … --forms "Bereitstellung|bereitgestellt|stellen … bereit"` or a 7th `forms` column in CSV imports; `glossary list` shows them. A split form (`a … b`) counts when its parts appear in order within one sentence. Prompts still name only the main term. Existing glossaries are upgraded automatically and behave exactly as before until you add forms. On our German benchmark, `Bitte stellen Sie den Zweig … bereit.` went from 0/3 to 3/3 correct, and a rollback message from 1/3 to 3/3 in 1 model call instead of 4.
- **File-mode benchmark.** `scripts/bench/file-mode.ts` translates a 131-key dashboard catalog with a real model and reports, per language, the model calls, grammar-repair calls, applied repairs and missed glossary terms. It measures what glossary and repair changes cost on a whole file, not just single sentences.

### Changed
- **A glossary term tagged around the wrong word is checked before it is replaced.** The model sometimes puts the glossary term in the right place but marks a different word as the term, so the translation came out with the term twice (`Bereitstellen nach jedem Commit bereitstellen.` for "Deploy automatically after each commit."). When the term already appears elsewhere in the sentence, `tl` now asks the model once more and keeps the marked word if that answer confirms it (`Automatisch nach jedem Commit bereitstellen.`). This happens on about 0.1% of translations; on our benchmark that sentence went from 0/3 to 2/3 correct with no change in the total number of model calls.
- **No added period on labels.** The model often ended a UI label with a period the source lacks (`Make the repository public` → `Rendre le dépôt public.`). `tl` now removes it when the source has no sentence-final punctuation; abbreviations (`etc.`, `Nr.`), ellipses and glossary terms ending in a period are kept. On our benchmark this removed 10 (French), 19 (German) and 26 (Arabic) added periods per 3 runs of 131 keys, and changed nothing else.
- **Grammar repairs that only add end punctuation are discarded.** The grammar repair often just added a period to a UI label (`Supprimer cet hôte` → `Supprimer cet hôte.`). A repair that is the original translation plus sentence-final punctuation the source lacks is now rejected and the original kept. A repair that fixes agreement and also adds a period, or restores one the source has, is still applied. On the file-mode benchmark (French, German, Arabic) this rejected 13 of 56 applied repairs and none of the 14 that fixed grammar; the number of model calls is unchanged.
- **Glossary guide:** documents the fixed-phrase workaround for collocations the model won't break up (`browser cache → كاش المتصفح`), how the Arabic `ل` + term form counts as covered, and every check a grammar repair must pass (no added `*`, no punctuation-only change).

### Fixed
- **Glossary terms keep the capital the model gave them.** When the model wrote a term at the start of a sentence or label (`Hôte : détails`), `tl` replaced it with the glossary's lowercase form (`hôte : détails`). Capitalized starts are now kept: lowercase sentence starts went from 21/240 to 1/240 in French and 12/99 to 0/99 in German on our benchmark.
- **All-caps glossary terms no longer come out half lowercase.** An all-caps word marked as a term (`HÔTES`) became `hôteS`. It is now `hôtes`, or `Hôtes` at the start of a sentence.

## [0.5.14] - 2026-10-13

### Fixed
- **Arabic glossary terms written with a shadda count as present.** When the model wrote the joined `ل` + term with diacritics (`للّغة`, `للتّوكن`), `tl` reported the term as missing and retried twice for nothing. It now recognizes them. On our benchmark case the translation went from 2.5 to 1 model call and from 1.2 s to 0.3 s. The diacritics stay in the output.

## [0.5.13] - 2026-10-13

### Changed
- **Arabic `ل` is joined to glossary terms that start with `ال`.** The model often wrote the preposition detached from the term (`مفيدة لـ الكاش`, `مخصصة للـ التوكن`, `للاللغة`). `tl` now writes it as Arabic does (`للكاش`, `للتوكن`, and `للغة` when the word itself starts with `ل`), without an extra model call. The joined form now counts as the glossary term, so a correct `للغة` is no longer reported as `0% covered` and no longer triggers retries that could replace it with a worse translation. On our Arabic benchmark, correct output went from 16 to 37 of 40 runs and the mean number of model calls from 2.83 to 2.25. Other languages are unaffected.

### Fixed
- **Arabic terms whose word starts with `ل` (`اللغة`).** 0.5.12's check accepted the misspelling `لللغة` and rejected the correct `للغة`. It now does the reverse.
- **Grammar repairs no longer add markdown.** The grammar repair sometimes bolded the term (`**الكاش**`). Such repairs are now discarded and the original translation kept.

## [0.5.12] - 2026-10-13

### Fixed
- **Arabic agreement repairs are no longer rejected when they merge `ل` with the term's `ال`.** The repair turns `يمكن لـ التوكن` into `يمكن للتوكن`, which is correct Arabic, but the exact coverage check no longer found the term and the repair was discarded. The repair's acceptance now splits that merge before checking coverage. Retries and the coverage of the first attempt are unchanged.

## [0.5.11] - 2026-10-13

### Fixed
- **Glossary terms into English from Arabic or Japanese are kept again.** 0.5.10 started telling the model, on the last glossary retry, which source word a term stands for. For a term in the Latin alphabet (English, French, …) translated from a non-Latin source, the model then translated that word itself and wrote its own word instead of the term: with `サーバー → host`, it wrote "server" in 6 of 16 last retries, against 0 of 18 in 0.5.9. Latin-alphabet terms are now sent as in 0.5.9 (term kept in 40/40 runs). Arabic terms keep the hint, so the 0.5.10 fix for `الكاش` being read as "cash" still applies.

## [0.5.10] - 2026-10-13

### Fixed
- **Glossary terms keep their meaning on the last retry.** The last glossary retry hands the model the target term in place of the source word. When that term is also another word (Arabic `الكاش` for "cache" also reads as "cash"), the model could translate the wrong meaning: on our benchmark, `Cleared the {name} cache.` became a payment sentence in 19–20 of 20 forced attempts. When the source word and the term use different writing systems, the retry now also tells the model which word the term stands for, and the drift went to 0/20. Same-script pairs (French, German, Italian, …) and Chinese, Japanese and Korean terms are sent as before, because the extra hint made the model copy the English word or drop placeholders there.
- **Detached Arabic article before a glossary term.** `الـ كوميت` and `بالـ نشر` are now written `الكوميت` and `بالنشر`. Latin-script terms keep `الـ API`.

## [0.5.9] - 2026-10-12

### Added
- **Grammar repair around forced glossary terms.** When a glossary term replaces the model's own word, the words around it often keep agreeing with the model's word (German `eine neue Zweig` instead of `einen neuen Zweig`). After translating, `tl` now makes one extra model call that fixes only the grammar around the term, and keeps the result only if every term and placeholder survives. It runs only when a term was forced into the output, so text without glossary terms is unaffected; when it runs, the translation takes one extra model call. On our benchmark with TranslateGemma 4b, grammatical agreement went from 84 to 91 of 110 cases in prefer mode and from 89 to 98 in strict mode; the German case went from 0/10 to 9–10/10.

### Fixed
- **The model's own form of a glossary term is kept.** When the model wrote an inflected form of a term inside its glossary tag (Arabic `الكوميت` for `كوميت`, imperative `انشر` for `نشر`, French plural `hôtes` for `hôte`), `tl` replaced it with the bare glossary entry, which could break the sentence. It now keeps the model's form when it contains the term and has no more words than it. In our Arabic benchmark case, broken output (`ثم قم بنشر.`) went from 6/10 to 1/10 runs.

## [0.5.8] - 2026-10-12

### Changed
- **The last glossary retry hands the model the target term.** When a term is still missing after the reminder retry, the final attempt puts the required translation directly in the text to translate instead of the source word, so the model only has to keep it. Prefer mode (the default) now retries up to twice (reminder, then this attempt) and keeps the translation that covers the most terms; it still never fails over a missed term. Strict mode uses it for its last allowed retry. On our benchmark with TranslateGemma 4b, glossary runs went from 92% to 100% passing in both strict and prefer mode, including a three-term Arabic case that never passed before.

### Fixed
- **Grammar around glossary terms.** After translation, French and Italian articles are elided or contracted before a term that starts with a vowel or mute h (`le hôte` → `l'hôte`, `au hôte` → `à l'hôte`, `il host` → `l'host`; aspirated-h and y-initial words keep their article), quotes the model wraps around a term are removed (`« hôte »` → `hôte`), and a doubled Arabic article is dropped (`الـ الكاش` → `الكاش`). Grammatical-agreement cases on our benchmark went from 27% to about 77% passing. Gender and case agreement (German `eine neue Zweig`) is not fixed yet.

## [0.5.7] - 2026-10-12

### Changed
- **Prefer mode (the default) retries once when a glossary term is missing.** It used to give the model a single attempt. It now makes one more attempt that reminds the model of the missing terms, and keeps whichever translation covers more of them; it still never fails over a missed term. On our benchmark with TranslateGemma 4b, prefer-mode glossary runs went from 65% to 92% passing. A translation that uses every term on the first try makes no extra call. `glossary.maxRetries` still applies only to strict mode.

### Fixed
- **File mode keeps placeholders more reliably.** The prompt's placeholder examples showed two tokens even when the text had one, and said each token appears "exactly once" even when one repeats. The examples now use the text's own placeholders and the rule asks for each as many times as in the source. On our benchmark every placeholder case passed (60/60), with fewer retries.
- **Non-TranslateGemma prompts now tell the model to keep placeholders.** The generic prompt had no placeholder rule.

## [0.5.6] - 2026-10-12

### Added
- **Ctrl+C cancels a running translation and unloads the model.** The first Ctrl+C (or SIGTERM) aborts the request, unloads the model from VRAM and exits with code 130 (143 for SIGTERM). Before, the process died at once and the model stayed loaded until Ollama's keep-alive ran out. If unloading hangs, `tl` exits after 3 s anyway, and a second Ctrl+C exits immediately.
- **An interrupted file translation keeps the work it finished.** `tl translate --file` writes the keys it already translated, plus the lock, and leaves the keys it never reached out of the target, so the next run translates exactly those. The summary has `aborted: true` and an `Interrupted: N of M key(s) not translated` warning. `--strict` stays all-or-nothing.
- **`failed` entries in the file summary carry `pointer` and `tag`.** `pointer` is the key's JSON Pointer (unambiguous for keys that contain dots) and `tag` is the error `--strict` would have raised. `path` is unchanged.

### Fixed
- **Glossary terms are applied with the default `--from auto`.** Entries were ignored unless the source language was given explicitly, and the coverage line still said 100%. Entries of every source language now apply; file mode uses the language from the source file's name.
- **Strict glossary mode succeeds much more often.** When the model echoed a glossary tag with its own word inside, the required term was thrown away; it is now kept. The retry reminder was sent as part of the text to translate (and named the source term, not the target); it is now an instruction. On our benchmark with TranslateGemma 4b, strict mode went from 85% to 94% of glossary runs passing.
- **File mode keeps placeholders more reliably.** The prompt stated twice the real number of placeholders, and in `--glossary strict` a dropped placeholder failed the key at once instead of being retried. Placeholder runs on the benchmark went from 75% to 100%.
- **Keys that fell back to source text are retried.** A key that failed (for example a lost placeholder) kept the copied source text, and later missing-only runs skipped it for good. The lock now records failed keys, and missing-only runs retry them while the target still holds the copied value. Keys stuck from earlier versions need one `--force` run.
- **The prompt no longer names "auto" as a language.** With `--from auto` the model was asked to translate from "auto"; the prompt now leaves the source language out.
- **Ollama errors are reported instead of returning partial text.** An error sent in the middle of a streamed response, or a stream that ended early, used to come back as a successful (truncated) translation.
- **Long translations no longer time out while text is still arriving.** The 60 s limit was a total deadline; it is now an idle timeout that restarts on every chunk.
- **`glossary.mode` in the config is respected.** The `--glossary` flag's built-in default always overrode it.
- **The `Glossary: N% covered` line is shown only when a term matched.** Text with no glossary terms printed `100% covered`.
- **`--json` errors are JSON for every command.** `glossary list`, `glossary export` and `context list` printed plain-text errors; all commands now print `{ error, message, hint }`.
- **Glossary writes wait for a lock instead of failing.** Running the CLI and the TUI at once could fail with "database is locked".
- **TUI:** starting a new translation cancels the previous one in Ollama (it kept generating), translations use context folders and the config's glossary settings, `TL_ADAPTER` is respected, image errors show their hint, and quitting restores the terminal immediately instead of waiting for the model to unload.

### Removed
- **The unused `adapter.local.command` and `adapter.local.keepAlive` config fields.** Nothing read them. Configs that still contain them load fine and drop them on the next save.

## [0.5.5] - 2026-10-09

### Fixed
- **Removing glossary tags from model output no longer slows down on unclosed tags.** The cleanup took time proportional to the square of the output length when the model left `<term>` tags unclosed (100,000 of them took about 25 s). It now takes linear time, with the same result.
- **Release assets no longer include source map files.** v0.5.4 uploaded a `.map` file next to each binary (and listed it in `SHA256SUMS`). The map is already embedded in the binary, so stack traces still point at the TypeScript sources.
- **zsh completions** escape backslashes in option descriptions. No current description contains one, so the generated script is unchanged.

### Changed
- **Release binaries carry signed build provenance.** Check a download with `gh attestation verify <file> --repo its-magdy/translate-local`. Releases are also immutable from this version on, so a published binary can't be replaced.

## [0.5.4] - 2026-10-09

### Fixed
- **The TUI no longer leaks memory while streaming, and no longer crashes in long sessions.** Each streamed chunk replaced the output text with a new element and only detached the old one, so its native memory was never freed. After about 16,000 updates (roughly 150 long translations) the TUI could no longer create elements and crashed. The output is now updated in place, and removed elements are destroyed.

### Changed
- **Faster startup:** release binaries are compiled with Bun bytecode. `tl --version` starts in about 31 ms instead of 55 ms, and the TUI draws its first frame about a third sooner. Binaries are about 6 MB larger.
- **Readable crash traces:** release binaries embed a source map, so an unexpected error's stack trace points at the original TypeScript file and line.
- **Project docs:** added a security policy (report vulnerabilities privately through GitHub) and a code of conduct (Contributor Covenant 2.1). Bug reports and feature requests now use issue forms, and the contributing guide and PR template are up to date.
- **CI:** the CLI tests have a 30 s timeout, because cold-starting Bun on Windows runners can take more than the 5 s default. CI now also checks that the compiled binary draws the TUI on Linux, macOS and Windows.

## [0.5.3] - 2026-10-09

### Fixed
- **`install.sh` verifies the binary before installing it.** The download is checked against the release's `SHA256SUMS`; on a mismatch, a missing or malformed entry, or when no SHA-256 tool (`sha256sum`, `shasum` or `openssl`) is available, the script aborts without installing anything. The README already said downloads are verified, but the script never checked. The temporary download directory is now also removed when the script exits.
- **Installing the repo no longer downloads the 0.3.4 binaries.** The `@translate-local/tl` wrapper's platform `optionalDependencies` were pinned to `0.3.4`, so every `bun install` fetched those binaries from npm. They now resolve from the workspace; the release still publishes them with the release version, and the publish script refuses a package that still contains `workspace:`.

### Changed
- **Bun 1.4.2** (was 1.3.13).
- **TUI:** `@opentui/core` 0.5.17 (was 0.2).
- **Releases:** the Homebrew tap is updated with a short-lived GitHub App token, scoped to the tap repository, instead of a personal access token.

## [0.5.2] - 2026-10-09

### Fixed
- **The context database file is released when it is closed.** Indexing left `context.db` open after `close()`, so on Windows the file stayed locked (it could not be deleted or replaced) until the process exited.

### Changed
- `tl --version` is read from the package version, so it can no longer drift from the release.
- **Releases:** npm packages are published with npm trusted publishing (OIDC) instead of a stored token, with provenance. The GitHub Release and Homebrew update now run only after npm publishing succeeds, a tag that doesn't match the package versions is rejected before anything is built, and the platform packages publish in parallel.
- **CI** runs the tests on Linux, macOS and Windows and smoke-tests the compiled binary on every pull request. Dependabot proposes monthly dependency and GitHub Actions updates.
- `@translate-local/shared`, `core` and `adapters` are marked private. They were never published; the CLI bundles them.
- `adapters`, `cli` and `tui` no longer compile their tests into `dist/`.
- Updated dependencies: `yaml` 2.9, `zod` 4.6 and `turbo` 2.11.

## [0.5.1] - 2026-10-08

### Fixed
- **ICU plural/select in i18next catalogs is no longer garbled.** In a file detected as i18next (`_one` / `_other` keys), a value with ICU `plural`, `select` or `selectordinal` syntax was sent to the model as plain text and came back broken (0.5.0 regression). It now keeps the source value and is reported as failed with a warning (exit code `2`); `--strict` aborts. Rewrite such values as i18next plural keys, or use `--format raw-json` if the file is really an ICU catalog that was misdetected.
- **File-mode progress no longer runs together in logs.** `Translated n/m` progress is only shown when stderr is a terminal; CI and piped logs now get just the final summary.

### Changed
- **Release workflow:** `actions/checkout` and `actions/setup-node` v7, `softprops/action-gh-release` v3, and Node 24 for npm publishing.
- `@translate-local/core` no longer compiles its nested test folders into `dist/`.

## [0.5.0] - 2026-10-08

### Upgrade notes
- **The context database upgrade is one-way.** The first time 0.5.0 opens your `context.db` it re-indexes it in a new format, and 0.4.2 and earlier can't open the result. To downgrade, delete `context.db` and run `tl context add` again for each source.
- **`context.minRelevance` is on a new 0–1 scale, and the default is now `0.09`** (was `0.3`). If you set `minRelevance` explicitly (for example to `0.3`), you will now get almost no context: remove the setting or use a value around `0.05`–`0.15`.
- **File mode writes lock files under `.tl/locks/`** at your project root (the nearest `.git`). Commit `.tl/` so teammates and CI share the same changed-source baseline.
- **New dependency:** `@translate-local/core` now depends on `@formatjs/icu-messageformat-parser` (ICU MessageFormat support).

### Added
- **ICU MessageFormat in file mode.** Values with `{n, plural, ...}`, `{x, select, ...}`, `{x, selectordinal, ...}` or `{x, number|date|time}` are now translated structure-preserving instead of being refused: only literal text changes; argument names, selectors, `#`, offsets, `=N` branches and number/date skeletons are kept verbatim. Each top-level message and plural/select branch is translated as one whole message. Plural branches follow the target locale's CLDR categories (en→ar adds `zero`/`two`/`few`/`many`, en→ja keeps only `other`) and are translated with a representative number so the noun inflects correctly. Messages that fail to re-parse with the same arguments fall back to source (or abort under `--strict`).
- **FormatJS / react-intl catalogs are supported.** `defaultMessage` values are translated as ICU; `description` and other fields are copied verbatim. Compiled FormatJS AST catalogs are refused.
- **i18next plural keys are regenerated for the target locale's CLDR plural categories** (`Intl.PluralRules`). en→ar now writes `_zero`/`_one`/`_two`/`_few`/`_many`/`_other`, and en→ja writes only `_other`. Cardinal and `_ordinal_` groups, a kept source `_zero`, JSON and YAML (in place, comments kept) are all supported. Each form is translated with a sample count in place of `{{count}}` (e.g. `3 files`) so the model picks the right grammatical number. Forms that couldn't get one are listed in a warning and counted in the `--json` summary as `pluralFallbacks`.
- **Changed-source detection.** `tl translate --file` writes a small per-target lock at `.tl/locks/<target path>.lock` under the project root (nearest `.git`; never inside the locale directory) with a hash per source key. Keys whose source changed since the last run are re-translated even if the target already has a value (`Source changed: N`). With no lock (first run), existing translations are kept and only hashes are recorded.
- **`--prune`** for file mode: removes keys and array elements present in the target but absent from the source (JSON and YAML). Target-only plural forms are kept (i18next `cart_few`, Rails nested `inbox.few`, i18next v3 `item_0`…`item_5`). Refuses with the new `PRUNE_REFUSED` error when it would remove more than half of the target or when source and target share no top-level keys; `--allow-large-prune` confirms. Combine with `--dry-run` to preview; the summary prints `Pruned: N`.
- File-mode `--json` summary includes `changed` and `pruned` arrays of JSON Pointer paths.
- File mode warns when a JSON source contains duplicate keys (key path and line); the last value still wins. Duplicate YAML keys are rejected by the parser, as documented.

### Changed
- Existing context databases are re-indexed automatically the first time they are opened after upgrading (one-way, see Upgrade notes). This scales with corpus size and runs once. Sources whose folder is unavailable keep their old index until it returns, and read-only databases keep working on their old index.
- `context.minRelevance` default is `0.09` on the new 0–1 relevance scale (see Upgrade notes).
- `tl context add` and `tl context index` skip unreadable subfolders with a warning instead of failing, and a failed `tl context add` no longer leaves a broken source behind.
- File mode: the "i18next plural keys are translated 1:1 … review output manually" warning is now emitted only when the target language's plural rules are unknown to the runtime, or, under `--from auto`, for lone `_other` keys.
- `{x, number}` / `{x, date}` / `{x, time}` without a style are now recognized as ICU.
- Release workflow: publish tokens are checked before anything is built, and npm publishing fails on real errors (expired token, missing 2FA bypass) instead of logging them as "already published"; re-running a release skips versions that are already published or still being staged by the registry.

### Fixed
- **Context snippets are no longer translated into the output.** They are now passed to TranslateGemma as reference material before the translate instruction, instead of being appended to the text to translate (which leaked them into file-mode catalogs).
- **Context retrieval works for non-Latin text.** The tokenizer is Unicode-aware: NFKC normalization, Arabic diacritics/Hebrew niqqud stripping, Arabic alef and digit folding, `Intl.Segmenter` word boundaries (including Thai), and character bigrams for Chinese, Japanese, and Korean. Accented Latin words are no longer split. The whole of a long Chinese/Japanese/Korean document is now searchable, not just its first ~100 characters.
- Context retrieval no longer scans the whole term table: the context database is about 10x smaller and queries about 100x faster on a 1,000-file corpus.
- **Context relevance is a cosine similarity between 0 and 1**, so `context.minRelevance` means what it says. One-file context sources no longer score 0, and stopwords in English, French, German, Spanish, Italian, Portuguese, Russian and Arabic (Snowball lists) no longer count as matches.
- File mode now applies `context.minRelevance` and `context.maxSnippets`, like single-string mode. It previously injected every match, up to a hardcoded 3 snippets.
- **Glossary term matching is Unicode-aware:** accented Latin, Cyrillic, Arabic and other space-delimited scripts use whole-word boundaries (no more `caf` matching inside `café`), and CJK, Japanese kana, Thai, Lao, Khmer and Myanmar terms match inside running text without needing surrounding spaces or punctuation.
- Glossary lookup falls back along the BCP-47 chain on both source and target (`en-US` → `en`, `zh-Hant-TW` → `zh-Hant` → `zh`), case-insensitively; the most specific entry for a source term wins.
- **Rails-style locale-rooted catalogs** (`en:` root in `config/locales/en.yml`) now get their root key renamed to the target locale (`fr:`), keeping comments and styles. Previously the output kept `en:`, so Rails loaded the translations as the source locale. Also applies to JSON catalogs with a single locale root. With `--from auto` the locale is taken from the filename. An existing target still rooted at the source locale is refused with a hint instead of being merged. Plural regeneration, changed-source detection and `--prune` all work on the renamed root.
- i18next formatted interpolations (`{{count, number}}`, `{{val, currency(USD)}}`, chained `{{value, number, uppercase}}`) are now protected as placeholders instead of being sent to the model, which translated them.

## [0.4.2] - 2026-10-08

0.4.0 was never published as a binary release; this is the first release containing the 0.4.0 features below.

### Added
- `tl completion <shell>` command: generates a static shell completion script for `bash`, `zsh`, or `fish`. Completes top-level commands, subcommands, all long flags, every supported language code for `--from`/`--to`, and choice values for `--glossary` and `--format`. Path-arg flags (`--image`, `--file`, `--out`, `glossary import`, `context add|remove`) defer to the shell's default file completion. Installation instructions per shell live in [`docs/cli-reference.md`](docs/cli-reference.md).

### Fixed
- **Empty or comments-only source YAML no longer wipes the target file.** A source document with no content nodes made the write path a silent no-op and replaced the existing target with an empty document, deleting every key. The target data is now materialized into the output.
- **YAML shape mismatches no longer drop target data.** A key present in both files but with different shapes (e.g. source scalar vs target plural map, or an empty `key:`) was silently dropped on sync; the node is now replaced wholesale so the target's structure survives.
- **Piped stdout is now truly pipe-safe.** Tokens stream to stdout only when it is an interactive terminal; piped output receives exactly the final postprocessed translation once. Previously a pipe could capture raw glossary `<term>` tags, unnormalized whitespace, or — with strict-mode retries — two concatenated translations. When streaming, the final text is reprinted whenever it differs from what was streamed.
- **Typed env substitution for config values.** A quoted `"${VAR}"` on a number or boolean field now converts to that type — `"maxRetries": "${TL_RETRIES}"` with `TL_RETRIES=3` loads as the number `3` — and the parse error for an unquoted `${VAR}` explains that the reference must be inside a quoted string. Conversion is driven by the field's declared type, not by the env value's shape, so a numeric-looking value on a string field (`"model": "${TL_MODEL}"` with `TL_MODEL=2`) stays a string instead of failing with `CONFIG_INVALID`.
- **File mode no longer overwrites the source file.** The same-locale guard only fired when `--from` was given explicitly, so `tl translate --file en.json --to en` (source language left at `auto`) resolved the output path back onto the input and rewrote it — with `--force` it would have replaced the source with its own translation. The source and output paths are now compared directly and the run is refused with `SAME_LOCALE`. An `--out` that resolves to the source path is refused the same way.
- **YAML block scalar chomping indicators survive translation.** A translated value comes back without a trailing newline, which silently rewrote `|` as `|-`, `>` as `>-`, and `|+` as `|-` — the last dropping the trailing blank lines the `+` indicator exists to keep. The original trailing-newline run is now carried onto the translated value.
- **`tl help` prints usage** instead of translating the literal word "help". Root-level flags are now derived from the program's registered options instead of a hardcoded list.
- **Metadata color now follows stderr.** ANSI codes for the metadata block gate on stderr's TTY-ness, so `2> err.log` no longer captures raw escape bytes and metadata stays colored when stdout is piped. Metadata indentation is also consistent between color and NO_COLOR runs.
- **YAML file mode no longer deletes target-only keys.** `writeYaml` re-serializes the source document; keys present only in the existing target file (e.g. entries kept after the source dropped them) were silently removed on every sync. They are now appended to the output. Extra array elements in the target survive the same way. The JSON path was unaffected.
- **Empty glossary terms can no longer hang translations.** An empty `sourceTerm` produced a zero-width regex that spun `matchTerms` forever on any text containing punctuation or digits. `matchTerms` now skips empty terms and iterates with `matchAll`, and `GlossaryStore.add` rejects empty/whitespace terms with `INVALID_INPUT`.
- **Non-streaming adapters now print the translation.** Non-JSON CLI output relied entirely on streaming; adapters that don't stream produced metadata with no translation text. The final translation is now printed when nothing was streamed, and after strict-mode retries the corrected final text is printed as well.
- **Translation metadata moved from stdout to stderr.** `tl "text" --to fr > out.txt` no longer captures adapter/timing/glossary-coverage lines; stdout carries only the translation.
- **Flag-first invocation works:** `tl --to fr "hello"` now routes to `translate` instead of failing with `unknown option`.
- **Config env vars with backslashes or quotes no longer break parsing.** `${VAR}` substitution now happens on parsed string values instead of the raw JSON text, so Windows paths and quoted values round-trip intact.
- **Glossary and context databases are stored in `~/.config/tl/` when no config file exists.** Without a `config.jsonc`, the default `~/...` database paths were not expanded, so `tl` created a literal `~` directory (`./~/.config/tl/glossary.db`, `./~/.config/tl/context.db`) inside whatever directory it was run from, and glossary entries seemed to vanish after changing directories. Entries saved this way are not migrated automatically: move a stray `./~/.config/tl/*.db` into `$HOME/.config/tl/` to keep them.

### Removed
- `resolveConfigPath()`, `resolveGlossaryDbPath()`, and `resolveContextDbPath()` from `@translate-local/shared/constants`, and the unused `TlConfig` interface from `@translate-local/shared/types`. `loadConfig` now expands `~` in the `DEFAULT_*_PATH` constants itself, so the resolvers had no remaining callers; external code should read the resolved paths off the loaded config instead. Permitted under a patch bump only because the scope is pre-1.0 and unpublished — see [semver clause 4](https://semver.org/#spec-item-4).

### Changed
- Removed stale `TEST_INTEGRATION` references from docs, `turbo.json`, and CI — the pipeline and context test suites now run in the default `bun run test` (they use MockAdapter and temp SQLite only); no code has read the variable since. `TEST_ADAPTER=1` (real Ollama) remains.

## [0.4.0] - 2026-05-06

### Added
- **File mode** for `tl translate`: `--file <path>` translates JSON or YAML i18n catalogs.
  - Default sync semantics: only translates missing, empty, `null`, or whitespace-only target values; existing translations are preserved. Pass `--force` to re-translate everything.
  - Output path auto-inferred via locale-token replacement (`en.json` → `ar.json`, `messages.en.yaml` → `messages.ar.yaml`, `locales/en/common.json` → `locales/ar/common.json`). Override with `--out <path>`.
  - Atomic write — temp file + rename — guarantees the original target is intact on crash or kill.
  - Re-parse-before-commit: the written file is re-read to confirm it parses cleanly; on failure the rename is skipped.
  - Round-trip preserves: indentation, line endings (LF/CRLF), trailing newline, key order, UTF-8 BOM stripping. YAML additionally preserves comments, block scalar style (`|`/`>`), and quoting style.
  - Placeholder protection (hybrid mask + multiset validation) for: `{{name}}` (i18next), `{name}` (Vue/ICU simple), `%{name}` (Rails), `%s`/`%d`/`%1$s` (printf), `$t(...)` (i18next nesting), `@:linked` (Vue), HTML tags.
  - Non-translatable skip heuristics for URLs, emails, semver, single chars, and ALL-CAPS short tokens. Override with `--translate-all`.
  - `--dry-run` reports what would be translated without writing.
  - On validation failure (e.g. placeholder mismatch) the default behavior is to record the key in the failed list, fall back to the source value, and continue the run. Pass `--strict` to abort on the first failure instead.
  - `--format auto|json|yaml|raw-json|raw-yaml`: format override; `raw-*` bypasses content-shape refusal.
  - `--max-size <mb>` controls source file size cap (default 20 MB).
  - Refused-by-default formats: Flutter ARB (`@key` metadata + ICU), Apple `.xcstrings`, FormatJS-with-ICU, Lingui full mode, YAML with anchors/aliases, YAML 1.1 directive, multi-document YAML.
  - 7 new typed errors: `FILE_NOT_FOUND`, `FILE_TOO_LARGE`, `FILE_PARSE_FAILED`, `FILE_WRITE_FAILED`, `FILE_INVALID_FORMAT`, `PLACEHOLDER_MISMATCH`, `SAME_LOCALE`.
  - New core subpath export: `@translate-local/core/files`.
- New docs: [`docs/file-translate-guide.md`](docs/file-translate-guide.md).
- `tl languages` command: lists supported language codes and names.

### Changed
- `yaml@^2` added as a dependency of `@translate-local/core`.
- `DEFAULT_MODEL` constant updated from `translate-gemma-12b` to `translategemma:latest` to match the model name in current Ollama registry. This unblocks `TEST_ADAPTER=1` gated tests (was failing for all users since the old tag was retired).
- Prompt builder now appends explicit placeholder-preservation instructions and few-shot examples when the source contains `__TLPH_N__` sentinels (file mode). Combined with synthetic glossary hits and 10-attempt retries, this brings multi-placeholder preservation from ~30-60% to >99% across every tested family.

### Fixed
- Glossary `add` lang pickers now read defaults from config instead of hardcoding `en`/`fr`.
- Ollama HTTP fetch calls now use `AbortSignal` timeouts so requests don't hang forever when the daemon is unreachable.

## [0.3.5] - 2026-05-02

### Changed
- Bump Bun from 1.3.5 to 1.3.13 (release CI pinned to 1.3.13)
- Bump `@opentui/core` from 0.1.82 to 0.2.1
- Upgrade TypeScript from 5.7 to 6.0; replace `bun-types` with `@types/bun`

## [0.3.4] - 2026-04-11

### Fixed
- Pin Bun to 1.3.5 in release CI — Bun 1.3.12 regresses macOS codesigning,
  producing binaries that `codesign -s -` rejects with "invalid or unsupported format"

## [0.3.3] - 2026-04-11

### Fixed
- Remove `--sourcemap` from release binary builds — sourcemaps embedded in the Mach-O binary prevent `codesign` from signing on macOS 15 (Sequoia) runners

## [0.3.2] - 2026-04-11

### Added
- `install.sh`: curl-pipe installer for macOS and Linux — auto-detects platform, downloads binary from GitHub Releases, installs to `~/.local/bin`, patches shell rc files for PATH

### Fixed
- macOS Gatekeeper killing compiled binaries (exit 137) on Apple Silicon / macOS 15+: darwin binaries are now ad-hoc codesigned in CI using Bun's required JIT entitlements before upload

## [0.3.1] - 2026-04-11

### Fixed
- Lowercase GitHub repository URLs across all package.json files (`Translate-Local` → `translate-local`)
- Replace `npm install` / `npx` with `bun install` / `bunx` in READMEs
- Add keywords to `@translate-local/tl` npm package

## [0.3.0] - 2026-04-10

### Changed
- Unified versioning: all packages now share a single version number, bumped together on each release

### Added
- Standalone binary distribution via `bun build --compile` (CLI)
- `.github/workflows/release.yml`: cross-compiles `tl` for darwin-arm64, darwin-x64, linux-x64, linux-arm64, and windows-x64 on `v*` tag push
- npm distribution via `@translate-local/tl` with platform-specific optional dependencies
- TUI embedded in-process via dynamic `import()` (no subprocess spawn)
- `ContextStore`: SQLite-backed TF-IDF context retrieval with add, remove, list, reindex, retrieve (core)
- Config loader with JSONC comment stripping, `~` expansion, `${ENV}` resolution (core)
- `GlossaryStore`: SQLite CRUD with word-boundary, longest-first greedy matching (core)
- `runPipeline` orchestrator: preprocess, translate, postprocess, validate with strict retry loop (core)
- `TranslateGemmaLocalAdapter`: Ollama HTTP API adapter with `dispose()` for VRAM unloading (adapters)
- `MockAdapter`: deterministic adapter for tests with glossary substitution (adapters)
- `buildStructuredPrompt()` and `buildNaturalPrompt()` prompt builders (adapters)
- `createAdapter(config)` factory (adapters)
- Shared types, `TlError` with tag+hint, `SUPPORTED_LANGUAGES`, language/text utils (shared)
- Image translation support via `--image` flag
- Streaming output support via `onChunk` callback
- JSON output mode via `--json` flag
- Interactive terminal UI (TUI) with Translate and Glossary tabs
- Glossary management CLI: add, list, remove, import, export
- Context source management CLI: add, list, remove, index

### Removed
- `TranslateGemmaHFAdapter`: HuggingFace backend removed (not available on HF serverless API)

### Fixed
- `normalizeLang`: trims whitespace before lowercasing (shared)
- `stripGlossaryTags`: regex uses `s` (dotAll) flag for multiline content (shared)

## [0.1.0] - 2026-03-30

### Added
- Initial release: CLI-first translation tool with TranslateGemma via Ollama
