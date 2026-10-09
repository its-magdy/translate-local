# File translation guide

Deep reference for `tl translate --file <path>`. Companion to the [CLI reference](cli-reference.md#file-mode) entry; this page covers detection rules, sync semantics, placeholder algorithm, edge cases, and the rationale for refused formats.

---

## Quick start

```bash
# Translate en.json → ar.json (only fills in missing/empty keys)
tl translate --file en.json --to ar

# See what would change without writing
tl translate --file en.json --to ar --dry-run

# Re-translate everything
tl translate --file en.json --to ar --force

# Also remove keys from ar.json that no longer exist in en.json
tl translate --file en.json --to ar --prune

# Override output path
tl translate --file path/to/en.json --to ar --out path/to/ar.json
```

---

## Output path inference

When `--out` is omitted, `tl` infers the output path by replacing a locale token in the source filename. Three layouts are recognized, in priority order:

| Layout | Source | Output (target=ar) |
|---|---|---|
| `<lang>.<ext>` | `en.json` | `ar.json` |
| `<file>.<lang>.<ext>` | `messages.en.yaml` | `messages.ar.yaml` |
| `<parent>/<lang>/<file>` | `locales/en/common.json` | `locales/ar/common.json` |

When `--from` is `auto` (default), any BCP-47-shaped token in the filename (e.g. `en`, `de`, `zh-CN`) is treated as the source locale. When `--from` is explicit, only that exact code is matched.

If no token can be detected, `tl` errors with `INVALID_INPUT` and asks you to pass `--out`.

---

## Sync semantics

The default mode is `missing-only`. A target value is translated when:

| Target value | Translated? |
|---|---|
| Key absent from target file | yes |
| `""` (empty string) | yes |
| `null` | yes |
| Whitespace-only (`"   "`, `"\n\t"`) | yes |
| Any other non-empty string | **no** (preserved) — unless the source value changed since the last run |
| Number, boolean, array, object | preserved verbatim |

In addition, a key is re-translated when its **source value changed** since the last run (see [Lock files](#lock-files-changed-source-detection) below), even though the target already has a value.

Pass `--force` to re-translate every leaf regardless of existing target value.

**Locale-rooted catalogs (Rails).** Rails reads the locale from the file's root key (`en:` in `config/locales/en.yml`), not from the filename. When the source root is a mapping with exactly one key that equals the source locale (case-insensitive, `-` and `_` treated alike, so `pt-BR` matches `pt_BR`), `tl` renames that key to the `--to` value as typed, keeping comments and styles, and prints `Root locale key: en -> fr`. With `--from auto`, the locale token from the filename is used. Sync runs against the target's own root (`fr:`). If the existing target is still rooted at the source locale (an `en:` key in `fr.yml`), `tl` refuses: rename its root key to the target locale, or delete the file. A catalog with a different single root key (`app:`) is left alone. Matching is exact apart from case and `-`/`_`: a region-qualified root (`en-US:`) with `--from en` is not renamed, and `--to fr` does not match an existing `fr-FR:` root. If the existing target has no root matching `--to` (rooted under another locale such as `ar:`, or flat), its keys are kept and a new root is added next to them; `tl` prints a warning because the output then has two roots or a mixed structure.

### Lock files (changed-source detection)

Every successful (non-dry-run) write also writes a small lock file for that target. It records a hash of every source string the target was last synced from: the first 16 hex characters (64 bits) of its SHA-256.

```json
{
  "version": 1,
  "checksums": {
    "/cart": "5bd2e4695d2d94a4",
    "/nav/home": "3a78695388b38b5c"
  }
}
```

**Where it lives:** `<root>/.tl/locks/<target path relative to root>.lock`. The root is the nearest ancestor of the target that contains `.git` (your project root); outside a git checkout, it is the target's own directory. For example, `tl translate --file src/en.json --out public/locales/ar/common.json` in a repo writes `<repo>/.tl/locks/public/locales/ar/common.json.lock`. Nothing is ever written inside `public/locales/`. A symlinked target resolves to its real path first, so it shares the lock of the file it points at.

On the next run, a key whose current source hash differs from the recorded one is re-translated and reported as `Source changed: N`. **Commit `.tl/`** so teammates and CI share the same baseline.

| Situation | Behavior |
|---|---|
| No lock for this target yet (first run, or a target that predates this feature) | Existing target values are trusted and kept; hashes for every source key are recorded. Change detection starts from the next run. |
| Source value changed since the last run, target value is a string | Re-translated, even though the target has a value. |
| Source value changed, but the target value is a different shape (e.g. a plural map under a source string) | Kept, as in normal sync — never replaced by a string. |
| Source value changed and now matches a [skip heuristic](#skip-heuristics) (URL, email, …) | The new source value is copied over the existing target value, the same as for any skipped key. A *localized* URL in the target is replaced. Use `--dry-run` first if the target localizes such values. |
| Key has no entry in the lock (e.g. a target value you added by hand) | Normal missing-only rule; the hash is recorded. |
| Key removed from the source | Its lock entry is dropped. The target key itself is only removed with `--prune`. |
| `--force` | Everything is re-translated; the lock is rewritten from the current source. |
| `--dry-run` | Changed keys are listed under `Source changed`; neither the target nor the lock is written. |
| A key fails (placeholder mismatch, ICU) | Source is written as the fallback (as before) and the key keeps its *previous* lock entry, so a changed key that failed is retried on the next run. |
| Lock is not valid JSON / wrong version (e.g. merge-conflict markers) | That target aborts with `FILE_PARSE_FAILED` before anything is written; other targets are unaffected. Delete that one `.lock` file to rebuild it. The target's existing translations are kept, but source changes made since its last run won't be detected. |
| Target deleted or renamed | Its old lock is not cleaned up automatically. Stale locks are harmless, and you can delete them by hand. |
| Running outside a repo, with `HOME` as the nearest `.git` (a "dotfiles repo" home directory) | The root is `~`, so locks land under `~/.tl/locks/…`. Run inside a project checkout, or delete `~/.tl/` if you don't want it. |

Design notes:

- **Not next to the target.** Many i18n setups load or ship whatever sits in the locale directory:
  - Hugo loads every file under `i18n/`, recursively, with no extension filter. Its walker drops entries whose name starts with `.` or `#`, or ends in `~`, *before* descending into them, so a `.tl/` directory is never entered.
  - Vite, Next, and other static setups copy `public/` verbatim, dotfiles included, so a lock beside an i18next-http-backend catalog would be deployed.

  The project root is outside all of those. In the no-git fallback, the dot-directory and the `.lock` extension keep the locks out of Hugo, `*.json` / `*.yml` globs (Rails `config/locales/*.{rb,yml}`, Vite `import.meta.glob`, Symfony's `domain.locale.format` naming), and webpack `require.context(…, /\.json$/)`.
- **One lock file per target**, not one shared lock and not one per source:
  - A merge conflict or corrupt lock is confined to one target, and the recovery (delete that file) resets only that target's baseline.
  - Files stay small, about one short line per key.
  - Per target rather than per source because each run syncs one target, and different targets of the same source are synced at different times. A source-level hash would mark a change as "seen" after the first target was updated.
- **Keys are JSON Pointers** (RFC 6901: `/nav/home`, `/items/0`, `/a~1b` for key `a/b`), so a key containing dots (`"nav.home"`) can't collide with a nested path. Array index `0` and an object key `"0"` share the pointer `/0`. This only matters if a value switches between array and object while keeping the same text, which is harmless (the key is just not re-queued).
- **Hash:** SHA-256 via `node:crypto` rather than `Bun.hash`, truncated to 64 bits. The lock is a committed artifact, so the digest has to be identical across runtimes and versions. 64 bits is ample for detecting that one string changed, and a quarter of the size of the full digest.
- **Deterministic output:** keys sorted, 2-space indent, trailing newline, so it diffs cleanly in git.
- **Atomic write:** the same temp-file + validate + rename as the target, done *after* the target. A crash in between costs at most one redundant re-translation, never a missed one.

### Pruning (`--prune`)

By default, keys present in the target but absent from the source are left alone. Pass `--prune` to remove them:

- Object keys that no longer exist in the source are deleted, at any depth.
- Arrays longer than their source counterpart are truncated to the source length.
- A shape mismatch (source string vs. target plural map) is kept, as in normal sync.
- **Plural forms are kept.** A target legitimately has more plural forms than its source; Arabic has `zero`, `two`, `few`, and `many` where English has only `one` / `other`. All six CLDR categories count. These are never pruned, whether or not the file was detected as i18next-plurals:
  - **i18next v4:** a target-only `stem_<category>` or `stem_ordinal_<category>` key, while the source still has `stem` or any plural form of it (`cart_few` next to a source `cart_one`).
  - **Nested plural maps** (Rails / Ruby i18n, some JSON libraries): inside a map whose source keys are *all* categories (`inbox: { one, other }`), any target key that is a category (`inbox.few`).
  - **i18next v3** (`compatibilityJSON: "v3"`): `stem_<n>` and `stem_plural`, while the source has `stem` or `stem_plural` (`item_0` … `item_5` next to a source `item` / `item_plural`).
- With `--dry-run`, the paths that would be pruned are listed under `Would prune`; nothing is written.
- For YAML, the output is still written using the source document as the template, so surviving keys keep the *source's* comments, scalar styles, and key order. Comments that existed only in the target file are not carried over (see the [re-translation note](#round-trip-fidelity)).

**Safety guard.** Before anything is translated or written, `--prune` refuses with `PRUNE_REFUSED` if:

- source and target share no top-level keys, so every target value would go. This is typical of a Rails-style catalog keyed by its locale whose root `tl` could not match (`en:` in the source, `ar:` in the target, with `--from auto` and no locale in the filename; otherwise the root is renamed first, see [Locale-rooted catalogs](#sync-semantics)), or
- it would remove more than **50%** of the target's values.

Either usually means the source and target don't line up, not that half the catalog was deleted. If the removal is intended, pass `--allow-large-prune`. Preview the list with `--dry-run --prune --allow-large-prune`. The guard also applies to `--dry-run`.

The summary prints `Pruned: N`, and `--json` output includes a `pruned` array of paths. Paths in `pruned` and `changed` are JSON Pointers (`/nav/home`; a dotted key prints as `/nav.home`).

---

## Format detection

`tl` first parses by extension (`.json` / `.yaml` / `.yml`), then inspects the parsed content shape. Detection priority:

1. **xcstrings** — `{ sourceLanguage, version, strings: { ... } }` → refused (Apple's per-locale state machine needs format-aware handling).
2. **ARB** — any top-level key matching `@<name>` or `@@locale` / `@@last_modified` → refused (`@key` metadata blocks must not be translated, `@@locale` must be rewritten, and Flutter's `gen-l10n` ignores ICU apostrophe quoting unless `use-escaping` is on — see the refused-formats table below).
3. **FormatJS catalog** — value shape `{ defaultMessage: string, ... }` → supported. Every `defaultMessage` is translated as ICU MessageFormat (see [ICU MessageFormat](#icu-messageformat)); `description` and any other field are copied verbatim and counted as `metadata` skips. A *compiled* FormatJS catalog (`formatjs compile --ast`, values are AST arrays like `[{ "type": 0, "value": "Hi " }]`) is refused: translate the extracted catalog and compile it again.
4. **Lingui full mode** — value shape `{ translation, message, description, origin }` → refused.
5. **i18next plurals** — leaf key matching `_{zero|one|two|few|many|other}$` with sibling stem → supported; plural groups are regenerated for the target locale (see [i18next plurals](#i18next-plurals)).
6. **Vanilla** — anything else.

Override detection with `--format <fmt>`:

- `--format json` / `yaml` — force the parser, but still apply content-shape detection.
- `--format raw-json` / `raw-yaml` — bypass content-shape detection entirely. Translates every string leaf regardless of metadata. Useful for one-off translation of refused formats, but **may corrupt** ARB `@key` metadata or xcstrings state fields. Leaves containing ICU plural/select are still translated structure-aware.

---

## i18next plurals

i18next v4 picks a plural key at runtime with `Intl.PluralRules(lng).select(count)` and looks up `key_<category>` (`key_ordinal_<category>` with `ordinal: true`). A source catalog holds the **source** locale's categories, so `tl` rewrites every plural group to the **target** locale's categories before translating:

| Source (`en`) | Target | Keys written |
|---|---|---|
| `item_one`, `item_other` | `ar` | `item_zero`, `item_one`, `item_two`, `item_few`, `item_many`, `item_other` |
| `item_one`, `item_other` | `ru` | `item_one`, `item_few`, `item_many`, `item_other` |
| `item_one`, `item_other` | `fr` | `item_one`, `item_many`, `item_other` |
| `item_one`, `item_other` | `ja` | `item_other` |
| `place_ordinal_one/two/few/other` | `ar` | `place_ordinal_other` |

The target's categories come from `Intl.PluralRules(<target>).resolvedOptions().pluralCategories` (`{ type: "ordinal" }` for `_ordinal_` keys) — the same rules i18next uses, so the generated keys are exactly the ones it will look up.

**Which keys form a group.** Keys in the same object that share a stem and end in `_zero|_one|_two|_few|_many|_other` (cardinal) or `_ordinal_<category>` (ordinal). A group must contain `_other` and at least one other category, and every member must be a string. A lone `_other` counts only when `--from` names a language whose only category is `other` (e.g. `ja`, `zh`). With `--from auto` (the default) lone `_other` keys are translated 1:1 and listed in a warning asking for `--from`. `step_one` / `step_two` / `step_three` has no `_other` and is left alone. When the source language is known, a group containing a category that language never uses is left alone too: in English, `player_one` / `player_two` / `player_other` are three keys, not plural forms, because English has no cardinal `two` (`_zero` is always allowed). Context keys (`friend_male_one`) group by their full stem.

**What is generated:**

- Each target category is translated from the source form of the **same category** when the source has it, otherwise from `_other`.
- Source-only categories are not written (en→ja has no `_one`). An existing target file is never pruned — a stale key there is left alone, like any other target-only key.
- A source `_zero` is always kept: i18next uses `key_zero` for `count === 0` in every language, not only those with a CLDR `zero` category.
- Every target category is generated, including French/Spanish/Italian/Portuguese/Catalan `_many`, which only covers exact millions. i18next has no fallback from a missing `key_many` to `key_other`: it tries `key_many`, then the bare `key`, then the fallback language, so a missing `_many` would show the English string for 1,000,000.
- Generated keys take the position of the source group, in CLDR order (`zero, one, two, few, many, other`). In YAML, the comment above the group moves to its first key; comments on other keys inside the group are dropped. Scalar style (quoting) is cloned from the source form.

**Sample counts.** A model shown `__TLPH_0__ files` cannot tell which grammatical number to use, so it writes the same form for every category. For each plural form, `tl` substitutes a **sample count** for `{{count}}` (or a formatted `{{count, number}}`) — the smallest integer in the target category that the source text also fits — and swaps it back afterwards. en→ar sends `0 files`, `1 file`, `2 files`, `3 files`, `11 files`, `100 files`, and gets back the dual (`ملفان`), the plural (`3 ملفات`), the accusative singular (`11 ملفًا`), and the genitive singular (`100 ملف`).

- Some forms get no sample and are translated from their plain text: categories that hold only fractions (Russian/Polish `other`), categories whose smallest number is a million (French `many` — the model rewrites `1000000` as "un million" or loops on zeros), and forms where every candidate number already appears in the text (`{{count}} files in 5 folders` never uses 5, because a dropped count would let the literal 5 become `{{count}}`).
- The number is matched back in any Unicode digit system (`3`, `٣`, `۳`, `३`), with digit grouping (`1 000 000`), and directly next to markup (`<b>{{count}}</b>`).
- When the category holds a single number (Arabic `zero`/`one`/`two`, English `one`), the model may drop the number or spell it out (`ملف واحد`, `ملفان`) — that is accepted, because the form is only ever shown for that number. Elsewhere a missing number is rejected.
- After 3 attempts without the number surviving, the form is translated from the plain text with the placeholder masked, as for any other key. These forms, together with forms that have no `{{count}}` to carry a sample (e.g. `"n_one": "One item"` for Russian `one`, which also covers 21) or no collision-free sample, are listed in a warning so you can check their grammatical number, and counted in `pluralFallbacks` in the `--json` summary.

**`--from` matters for samples.** With `--from auto`, `tl` cannot look up the source language's rules, so it picks samples that fit the target alone (it still avoids `1` for `_other` text). Pass `--from` so a sample like the Arabic ordinal `4` is chosen to match `4th`, not `1st`.

**Sync.** Regeneration happens before the missing-only diff, so sync works per target category: existing non-empty values are kept and only the missing categories are translated. `--force` re-translates every category.

**Unknown target rules.** If the runtime has no plural rules for the target language, plural groups are translated 1:1 from source and a warning asks you to review them.

---

## Placeholder protection

`tl` extracts placeholders from each source value, replaces them with ASCII sentinel tokens (`__TLPH_0__`, `__TLPH_1__`, …) before sending to the model, and restores them after. Each sentinel is also injected as a synthetic glossary hit, which wraps it in the `<term translation="X">` mechanism the underlying model is well-trained to preserve. The translated output is then re-scanned for placeholders and validated against the source via multiset equality.

If validation fails (the model dropped or altered a placeholder), the orchestrator retries up to **10 times** with the same input. Translation models are non-deterministic and a different sample very often succeeds; with a per-attempt success rate of ~50% on the hardest cases, 10 retries gives an effective success rate of ~99.9%. If all retries fail, the source value is written to the target as a fallback and the key is recorded in the failed list. The whole run then exits with code `2` so CI catches it. Pass `--strict` to switch to abort-on-first-failure.

The prompt also includes few-shot examples showing the model how source-with-sentinels should round-trip to target-with-sentinels-preserved across multiple languages. This is the primary lever for placeholder fidelity; the retries only catch residual sampling noise.

**Reliability notes (measured against translategemma):** single- and multi-placeholder strings across all supported families (`{{name}}`, `{name}`, `%{name}`, `%s`, `%1$s`, `$t()`, `@:linked`, HTML tags) preserve reliably end-to-end. The previously-flaky combinations (Rails `%{user}` + `%{count}` together, bare printf `%s` + `%d` together) succeeded 10/10 in stability testing after the few-shot + retry-bump tuning. Long-tail edge cases still hit the source-fallback path occasionally; that path is non-fatal and clearly reported.

**Recognized placeholder families:**

| Pattern | Used by | Example |
|---|---|---|
| `{{name}}` / `{{name, format}}` | i18next, Mustache | `Hello {{name}}`, `{{count, number}} items`, `{{val, currency(USD)}}` |
| `{name}` / `{0}` | Vue I18n, ICU simple | `Click {action}` |
| `%{name}` | Rails I18n | `Bonjour %{user}` |
| `%s` / `%d` / `%f` | printf | `%s items left` |
| `%1$s` / `%2$d` | positional printf (Android, gettext) | `%1$s and %2$d` |
| `$t(key)` | i18next nesting | `Press $t(button.ok)` |
| `@:key` / `@.upper:key` | Vue I18n linked | `@:nav.home` |
| `<tag>...</tag>` | inline HTML | `Use <b>bold</b>` |

**Validation:** multiset equality. The set of placeholders extracted from the model output must exactly match the source — same identities, same counts. Reordering is allowed (RTL languages legitimately move placeholders around).

**Failure mode (default):** a placeholder mismatch is recorded in the run summary and the source value is written to the target as a fallback (so the output file remains complete and you can grep for un-translated source text). The exit code is non-zero (`2`) if any keys failed, so CI catches it. Pass `--strict` to switch to abort-on-first-failure (the original target file is then left untouched).

---

## ICU MessageFormat

Values containing `{n, plural, ...}`, `{x, select, ...}`, `{x, selectordinal, ...}` or `{x, number|date|time[, style]}` — and every FormatJS `defaultMessage` — are parsed with [`@formatjs/icu-messageformat-parser`](https://formatjs.github.io/docs/icu-messageformat-parser) and translated **structure-preserving**: only literal text changes. Argument names, select keys, `#`, `offset:N`, `=N` branches, nesting, and number/date/time styles and skeletons are re-emitted from the source.

**How a message is split.** The top-level message and every plural/select branch are each translated as one whole message, with their nested syntax (arguments, `#`, a nested plural/select) masked as `__TLPH_N__` sentinels. Branches are never fragmented word-by-word. Adjacent placeholders (`<b>#</b>`) share one sentinel. A unit with no letters (`{a}: {b}`) is not sent to the model.

```
"{name} has {gender, select, female {{n, plural, one {# cat} other {# cats}}} other {...}}"
  unit: "__TLPH_0__ has __TLPH_1__"     (outer sentence; the whole select is one token)
  unit: "1 cat"                         (plural branch, count replaced by a sample number)
  unit: "2 cats"
```

**Plural branches use a sample number.** Inside a plural branch the count (`#`, or the plural's own argument when there is no offset) is replaced by a representative number for that branch's category in the *target* locale — `one` → 1, Arabic `few` → 3, Arabic `many` → 11, Arabic `other` → 100, `=N` → N — so the model inflects the noun for that number ("100 رسالة جديدة", not "100 رسائل"). The number is then mapped back to `#`. If it doesn't come back exactly, or the model invents another number, the branch is re-translated with a `__TLPH_N__` sentinel instead. A category that holds a single value (`one` = 1 in English, Arabic `two` = 2, `=N`) may drop the number: "رسالتان جديدتان" (two new messages) is accepted. Tags that fully enclose the number (`<b>#</b>`) may go with it. Half a tag pair (`<b># file</b>`), a void tag (`#<br/>`) or another argument never does; those branches take the sentinel route instead.

Sample details:
- A category that holds only fractions (Russian / Polish `other`) gets no sample and is translated with a sentinel. "1.5 files" produced nonsense.
- The sample skips numbers already written in the branch. In "# files in 5 folders" Russian `many` uses 6, not 5, so a dropped sample can't turn the literal 5 into `#`. If no such number exists, the branch takes the sentinel route.
- The number is recognized in any decimal digit system ("3", "٣", "۳", "३"), with digit grouping ("1 000 000"), and glued to a sentinel (`__TLPH_0__3`).
- A target code that `Intl.PluralRules` doesn't know (it silently falls back to the host locale) is detected, and the branches are left as in the source. `tl` is resolved as `fil`.

**Plural categories follow the target locale** (`Intl.PluralRules(target).resolvedOptions().pluralCategories`; `type: "ordinal"` for `selectordinal`):

- Missing categories are added, derived from `other` with the sample number (en → ar adds `zero`, `two`, `few`, `many`; en → ru / pl adds `few`, `many`). If that fails, the category gets a copy of the translated `other`.
- A category whose smallest value is a million or more is **not added**: French / Spanish / Italian / Portuguese / Catalan `many` (1 000 000, 2 000 000, …). Runtimes fall back to `other`, and adding it would bloat every plural. If the source already has it, it is kept.
- Categories the target doesn't use are dropped (en → ja keeps only `other`). That includes a source `zero` for a target without one (French, Japanese, …). This is correct: in those locales `zero` is never selected, not even for 0. To give the literal value 0 its own wording, use an exact branch, `=0 {No files}`, which every locale honors and which is always kept.
- `other` and every `=N` branch are always kept. A category whose values are all covered by `=N` branches is not added (`=0` makes Arabic `zero` redundant).
- An unknown target locale leaves the branches unchanged.

**Output format.** The printer emits canonical spacing — `{n, plural, one {...} other {...}}` — with `=N` branches first, then categories in CLDR order (`zero one two few many other`). Arguments, number/date/time elements, and `offset:` are copied verbatim. Apostrophe escaping follows ICU: `{`, `}` (and `#` directly inside a plural branch) in translated text are quoted (`'{'`), and an apostrophe is doubled only where it would otherwise start a quote — "l'{item}" becomes `l''{item}`, while "n'a" stays `n'a`.

**Validation.** The translated message must re-parse and keep the same arguments (names and types), select keys, and plural type / offset / `=N` keys as the source. Tags are parsed as literal text during translation. If the source also parses as rich text with tags enabled (react-intl / next-intl `<b>…</b>`), the output must too, with the same tag names in the same nesting. This catches half-dropped or reordered tags, and a quoted `'<b>'` coming back unquoted. Each unit must keep exactly its sentinels and must not gain placeholder-shaped text the source didn't have (a model-invented `<i>` or `{name}`). Units are retried up to 10 times like any other leaf. A model/pipeline error is never absorbed by a fallback route. A failure falls back to the source value and is reported (exit code `2`); `--strict` aborts instead. A value that does not parse as ICU (e.g. a plural without `other`, or ICU4J-only types like `spellout` / `choice`) is reported as `Invalid ICU MessageFormat` and falls back the same way.

**i18next catalogs.** A file detected as i18next (`_one` / `_other` keys) never takes the ICU path: i18next does not evaluate ICU, so `{price, number}` there is literal text. A value with an ICU plural, select or selectordinal can't be translated as plain text, so it is kept as source and reported as failed with a warning (exit code `2`); `--strict` aborts instead. As with any failed key, the target now holds the source string, so later missing-only runs skip it; re-run with `--force` to retry. Use i18next plural keys (`key_one`, `key_other`) for these. Any `_one` / `_other` (or other CLDR suffix) sibling keys make the whole file count as i18next, so a next-intl / ICU catalog that happens to have such keys is misdetected; pass `--format raw-json` (or `raw-yaml`) to translate its ICU values structure-preserving. That also turns off i18next plural regeneration.

**Model limitation.** translategemma sometimes drops the sentinel standing for a sentence's subject (`{name} added {count, plural, ...} to the order` → Arabic). Non-ICU strings hit the same limitation (`{name} added {item} to the order` fails the same way); the key falls back to source and is reported.

---

## Skip heuristics

Values matching any of the following are passed through verbatim, not translated:

- URLs: `^https?://...$`
- Emails: standard RFC5322-lite pattern
- Semver: `^v?\d+\.\d+\.\d+(...)?$`
- Single character: `len(value) == 1`
- ALL-CAPS short tokens: `^[A-Z][A-Z0-9_]{0,3}$` (e.g. `OK`, `API`, `ID_X`)
- Empty string, whitespace-only

Override all of these with `--translate-all`.

---

## Atomic write

`tl` always writes the output via temp-file-plus-rename:

1. Serialize the in-memory target tree to a string.
2. Write to `<dir>/.<basename>.tmp-<pid>` in the same directory.
3. `rename()` to the final path.

This is atomic on POSIX filesystems. If `tl` is killed mid-run, the original target file is untouched. The [lock file](#lock-files-changed-source-detection) is written the same way, right after the target. After the run, the tmp file is gone (or, on rename failure, cleaned up best-effort).

`tl` then re-parses the output to confirm it round-trips cleanly. A re-parse failure aborts before the rename — you get an error, not a corrupted file.

---

## Round-trip fidelity

For JSON, the following are preserved on write:

- **Indentation:** detected from the source (2-space, 4-space, or tab); fallback is 2-space.
- **Line endings:** detected from the source (LF or CRLF).
- **Trailing newline:** present-or-absent matches the source.
- **Key order:** new keys appended at the position of their source counterpart; existing keys retain their order.
- **UTF-8 BOM:** stripped on read; never written back. (BOM in JSON breaks `JSON.parse` in many tools; we don't propagate the problem.)

For YAML (via the `yaml` package's Document API), additionally preserved:

- **Comments** above and inline with keys.
- **Block scalar style** — literal `|` and folded `>` are kept; if the source value used `|`, the translated value will too (forced single-line strings get block-quoted automatically when long). The chomping indicator is kept with it: `|`, `|-`, and `|+` each survive the round-trip, so the trailing blank lines a `|+` block preserves are not dropped.
- **Quoting style** per scalar (plain, single-quoted, double-quoted).
- **Key insertion order** within maps.

Long translated strings are not reflowed — the writer is configured with `lineWidth: 0` so the content you put in is the content that comes out. Anchors and aliases are not supported (refused at read time).

**Re-translation note (YAML).** On a re-run, only the existing target's data values are read; the *write template* (comments, scalar styles, key order) is taken from the source file. If you've hand-edited comments or scalar styles in the target file, they will be replaced by the source's on the next run. This is intentional — keep authoritative formatting in the source.

---

## Edge case behavior

| Case | Behavior |
|---|---|
| BOM in source | Stripped on read, not emitted. |
| CRLF source | Preserved on write. |
| File > 20 MB | Refused with `FILE_TOO_LARGE`. Override with `--max-size`. |
| Source file is a symlink, FIFO, socket, or device node | Refused with `FILE_INVALID_FORMAT`. Pass a regular file. |
| Same source and target locale (`--from en --to en`) | Refused with `SAME_LOCALE`. |
| Output path resolves to the source file (e.g. `--file en.json --to en` with the source language left at `auto`, or `--out` aimed at the input) | Refused with `SAME_LOCALE` — the source is never written over. |
| Source file does not exist | Refused with `FILE_NOT_FOUND`. |
| Existing target is invalid JSON | Refused with `FILE_PARSE_FAILED`. Fix or delete the target before re-running. |
| Source YAML is empty or comments-only | The existing target's keys are preserved in the output (nothing to translate). |
| Key shape differs between source and target (e.g. source string vs target plural map) | The target's value wins and its structure is kept in the output. |
| Duplicate keys in JSON source | Last value wins (same as `JSON.parse`); a warning names each repeated key path and line. |
| Duplicate keys in YAML source | Rejected as a parse error: the `yaml` package's `uniqueKeys` option defaults to `true`. |
| Keys with dots (`"section.title"`) | Treated as opaque string keys, not split paths. |
| Numeric values (number, boolean, null) | Preserved verbatim. |
| Arrays of strings | Each element translated; index preserved. |
| Deeply nested (>64 levels) | Refused — likely malformed input. |
| Strings >context-window | Translated as-is; the model may truncate. No splitting in v1. |

---

## Glossary and context in file mode

Glossary terms are applied per leaf, exactly as they would be for a single-string translation. The same `--glossary prefer|strict` flag governs both modes.

Context retrieval also runs per leaf, with the source value as the query. If you've added a context source via `tl context add`, snippets are retrieved per key, using the same `context.maxSnippets` and `context.minRelevance` settings as single-string mode (see [Relevance score](context-guide.md#relevance-score)). The tokenizer is Unicode-aware — Arabic, Cyrillic, CJK, and Thai values retrieve context as well as Latin ones (see [Tokenization](context-guide.md#tokenization)).

---

## Refused formats — rationale and workarounds

| Format | Why refused | Workaround |
|---|---|---|
| **Flutter ARB** | `@key` blocks contain `description` and `placeholders` metadata that must not be translated, and `@@locale` must be rewritten for the target. Flutter's `gen-l10n` also treats apostrophes literally unless `use-escaping: true`, so ICU quoting (`'{'`, `''`) would show up in the UI. | `--format raw-json` translates every leaf (corrupts metadata; ICU values are still translated structure-aware). Wait for Phase C for proper ARB support. |
| **Apple `.xcstrings`** | Per-locale `stringUnit.state` machine (`translated`, `needs_review`, `new`, `stale`) drives Xcode's UI; the format also has plural variations. | `--format raw-json` translates every leaf (state fields will be left as English string values). Wait for Phase C. |
| **Lingui full mode** | The multi-field shape (`translation`, `message`, `description`, `origin`) needs a strategy for which fields to translate, which to leave. | Use Lingui minimal mode (`{ id: "translation" }`). |
| **Multi-document YAML** (`---` separator) | Phase B refusal — uncommon in i18n catalogs; supporting it cleanly needs work we haven't done. | Split the file. |
| **YAML 1.1 directive** (`%YAML 1.1`) | The Norway problem (`no` → `false`) and other implicit-typing bugs make round-trip unreliable. | Re-save as YAML 1.2 (modern editors default to this). |
| **YAML anchors / aliases** | Modifying an anchored value mutates all aliases. Translating once propagates everywhere — sometimes desirable, sometimes not. Detecting "shared between translatable and non-translatable contexts" is hard to do safely. | Inline the alias. |

---

## Errors

All errors carry a `tag` and a `hint`. With `--json`, errors serialize as `{ "error": <tag>, "message": "...", "hint": "..." }`.

| Tag | Meaning |
|---|---|
| `FILE_NOT_FOUND` | Source file does not exist. |
| `FILE_TOO_LARGE` | Source exceeds `--max-size`. |
| `FILE_PARSE_FAILED` | JSON / YAML parse error. |
| `FILE_INVALID_FORMAT` | Refused content shape (ARB, xcstrings, etc.), unsupported extension, non-regular file (symlink, FIFO, device), or (under `--strict`) a value that is not valid ICU MessageFormat. |
| `FILE_WRITE_FAILED` | Output write or pre-rename re-parse failed. |
| `PLACEHOLDER_MISMATCH` | The model's output dropped or altered placeholders. |
| `SAME_LOCALE` | `--from` and `--to` are the same, or the output path resolves to the source file. |
| `PRUNE_REFUSED` | `--prune` would remove more than half of the target, or source and target share no top-level keys. Pass `--allow-large-prune` if intended. |

---

## What's coming next

- **Phase B (YAML)** — Rails / Hugo / Symfony non-ICU catalogs with full comment, anchor, and block-scalar preservation.
- **Phase C (later)** — proper ARB and xcstrings handling.
