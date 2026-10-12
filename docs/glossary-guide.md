# Glossary Guide

The glossary is a database of term pairs that `tl` enforces during translation. When a source term is found in your text, the pipeline injects an XML tag that instructs the model to use the specified target translation.

## How It Works

When translating, the pipeline:

1. Looks up glossary entries matching the source language and target language (with [language fallback](#language-code-fallback))
2. Finds occurrences of source terms in your text ([Unicode-aware matching](#term-matching), case-insensitive)
3. Injects XML tags: `<term translation="target">source</term>`
4. Sends the tagged text to the adapter
5. Validates that target terms appear in the output (substring check, see [Coverage check](#coverage-check))
6. Strips the XML tags from the final result (see [Term tags in the output](#term-tags-in-the-output))

## Enforcement Modes

Set via `--glossary <mode>` flag or `glossary.mode` in config.

### `prefer` (default)

The model is guided toward using the specified translations. If a term is missing from the first translation, the pipeline retries with a reminder listing the missing terms (the same mechanism as `strict`). If a term is still missing, it makes one last, code-switched retry (see below). It then returns whichever attempt used the most terms (the earliest one on a tie). The result is returned even if some terms are still missing; prefer mode never fails because of the glossary. The retries are fixed at two: `glossary.maxRetries` only applies to `strict`. A translation that uses every term on the first try costs no extra model call.

```bash
tl "machine learning model" --from en --to ar --glossary prefer
```

### `strict`

If any glossary terms are missing from the translation, the pipeline retries (up to `glossary.maxRetries` times, default 2). Each retry adds a hint to the prompt listing the missing terms, except the last one, which is code-switched. If they are still missing after all retries, the command exits with error code 1.

### Code-switched last retry

In both modes, the last retry sends the source with each glossary term already replaced by its target term (`Restart the hôte.`, tagged as `<term translation="hôte">hôte</term>`) and no reminder. The model then writes the sentence around the term itself, which also tends to get the article and agreement right. Placeholders are sent unchanged.

When the term is written in a different script from the source word (`cache → الكاش`), the tag also carries the source word, `<term translation="الكاش" source="cache">الكاش</term>`. This keeps the word's meaning: `الكاش` also reads as "cash", and without the source word `Cleared the {name} الكاش.` came back as a payment sentence. Terms in the same script as the source word (`server → host` in Italian) don't get it, because the model would copy the source word instead of the term. Chinese, Japanese and Korean terms don't get it either: there it didn't help the term and the model dropped placeholders more often. So a same-script term that is also another word can still change the sentence's meaning on this retry; check translations of such terms.

### Term tags in the output

The model often copies the `<term>` tag into its output with a word of its own inside. `tl` replaces each such tag with the glossary term, unless the word inside is the model's own form of the term, which it keeps: one that contains the term (case-insensitive) and has no more words than it, after trimming and dropping surrounding quotes. So `<term translation="كوميت">الكوميت</term>` keeps the article (`الكوميت`), `<term translation="نشر">انشر</term>` keeps the imperative (`انشر`), and `<term translation="hôte">hôtes</term>` keeps the plural, while `<term translation="Zweig">Abteilung</term>` becomes `Zweig`. The part matching the term is written exactly as the glossary has it (`Hôtes` → `hôtes`), so the coverage check always finds it. A tag the model never closed is always replaced by the term.

### Articles and quotes around terms

After every attempt, `tl` fixes a few deterministic mistakes right around a glossary target term:

- quotes or em dashes wrapped directly around the term are dropped (`« hôte »` → `hôte`); in French and Italian a lone em dash right before it is dropped too (`il —host` → `l'host`);
- French and Italian articles and contractions are elided before a term that starts with a vowel or a mute h: `le hôte` → `l'hôte`, `au hôte` → `à l'hôte`, `ce hôte` → `cet hôte`, `il host` → `l'host`. French words with an aspirated h (`héros`, `hasard`, `haut`, …) keep their article;
- in Arabic, a detached article before a term that already starts with `ال` is dropped (`الـ الكاش` → `الكاش`);
- in Arabic, a detached article before any other term written in Arabic script is attached to it (`الـ كوميت` → `الكوميت`, `بالـ نشر` → `بالنشر`). A Latin-script term keeps the detached form (`الـ API`).

### Agreement repair

Gender and case agreement can't be fixed by rules: the right form depends on the term's gender and the word's role in the sentence. So when the final translation holds a term the model did not choose itself, `tl` makes one extra model call that asks it to proofread the text: fix only the articles, adjectives, pronouns and participles around the terms (`Erstellen Sie eine neue Zweig` → `Erstellen Sie einen neuen Zweig`) and change nothing else. A term counts as not chosen by the model when:

- the model echoed the term tag around its own word (`eine neue <term translation="Zweig">Abteilung</term>`) and `tl` swapped in the term (a tag around the model's own form of the term, such as `الكوميت`, is kept as written and doesn't count), or
- the result came from the code-switched last retry, where `tl` put the term into the source.

A translation where the model wrote the term itself, one without glossary terms, an image translation, and placeholders alone never trigger it. TranslateGemma usually echoes the tag, so expect this extra call on most translations that contain a glossary term; translations without one never pay for it. The repaired text is kept only if it still contains every glossary term the draft had and exactly the same placeholders, and its length is within 1.3× of the draft's; otherwise, or if the call fails, the unrepaired translation is returned. The repair only reaches what the model knows: it fixed `eine neue Zweig` and `Chaque validation doit être signé` in the agreement benchmark, but not `l'antémémoire est plein` (the 4B model doesn't know the rare word is feminine). With `--json`, a repaired result has `"repaired": true` in its `metadata`.

```bash
tl "machine learning model" --from en --to ar --glossary strict
```

Use `strict` for legal, medical, or technical content where term accuracy is non-negotiable.

## CSV Import Format

```
source,target,from,to,domain,note
machine learning,تعلم الآلة,en,ar,tech,
neural network,شبكة عصبية,en,ar,tech,
bonjour,hello,fr,en,,informal greeting
```

Columns:
- `source` — source term (required)
- `target` — target translation (required)
- `from` — BCP-47 source language code (required)
- `to` — BCP-47 target language code (required)
- `domain` — optional domain label
- `note` — optional free-text note

Import:

```bash
tl glossary import ./terms.csv
```

Duplicate entries (same source, target, source_lang, target_lang) are silently skipped. The whole file is imported in a single transaction — if the import fails partway, no rows are written.

## CRUD via CLI

### Add a term

```bash
tl glossary add \
  --source "API" \
  --target "واجهة برمجية" \
  --from en \
  --to ar \
  --domain tech
```

### List terms

```bash
tl glossary list                    # all entries
tl glossary list --from en --to ar  # filtered
tl glossary list --json             # JSON output
```

### Remove a term

```bash
# Get the ID from list output
tl glossary list --json | jq '.[0].id'

tl glossary remove <id>
```

### Export

```bash
tl glossary export --from en --to ar > my-glossary.csv
tl glossary export --json
```

## File Paths

| File | Default Location |
|------|-----------------|
| Glossary SQLite database | `~/.config/tl/glossary.db` |
| Config file | `~/.config/tl/config.jsonc` |

Override the database path in config:

```jsonc
{
  "glossary": {
    "dbPath": "~/my-project/glossary.db"
  }
}
```

## Glossary in file mode

`tl translate --file <path>` applies the glossary per leaf, exactly like single-string translation. The same `--glossary prefer|strict` flag governs both modes. A key missing a term is retried twice in prefer mode (keeping the best attempt) and up to `glossary.maxRetries` times in strict mode; if all strict retries fail on a key, the default behavior records the failure and falls back to the source value (pass `--strict` to abort the whole run instead). The [agreement repair](#agreement-repair) also runs per key, under the same conditions.

In a typical file translation of N keys, glossary matching runs N times. Each match is fast (indexed SQLite query in-process), but for very large catalogs you may notice the cumulative cost. This is acceptable for v1; revisit if it becomes a bottleneck.

## Term matching

Source terms are matched case-insensitively (simple case folding only: `ß` does not match `SS`, and Turkish `İ` does not match `i`). How a term's edges are anchored depends on the script of the character at that edge:

- **Space-delimited scripts** (Latin incl. accented letters, Cyrillic, Greek, Arabic, Hebrew, Hangul, Devanagari, …): whole-word match. The neighbouring character must not be a letter, digit, combining mark, `_`, or zero-width (non-)joiner (U+200C/U+200D) of a space-delimited script. So Persian `کتاب` does not match inside `کتاب‌ها`. `café` matches in `un café noir` but not in `cafés`; `caf` does not match inside `café`.
- **Scripts without word spaces** (Chinese, Japanese kanji/kana, Thai, Lao, Khmer, Myanmar): substring match. `机器学习` matches in `我喜欢机器学习技术`, and `東京タワー` matches in `東京タワーに行く`.
- **Punctuation at an edge** (e.g. `C++`, `(beta)`): that edge is not anchored. Regex metacharacters in terms are always matched literally.

A neighbour from a no-space script never blocks a match, so `API` matches in `このAPIキーを使う`.

Substring matching for CJK/Thai was chosen over `Intl.Segmenter` (which Bun supports): dictionary segmentation splits text by ICU's lexicon, which need not agree with your entries (e.g. it splits `机器学习` into `机器|学习`), and results can change between ICU versions. Substring matching is deterministic and what CAT tools commonly do for these scripts. The tradeoff is that a short CJK term can match inside a longer compound; longer entries win over shorter overlapping ones, so add the compound as its own entry if needed.

**Attached prefixes and particles are not stripped.** In Arabic, `كتاب` does not match inside `الكتاب`, `وكتاب`, or `بكتاب`; in Korean, `서울` does not match inside `서울에서`. Add the forms you need as separate entries. This keeps matches on whole words, so in space-delimited scripts the injected `<term>` tag does not split a word.

## Language code fallback

Language codes are matched case-insensitively (`en-us` == `en-US`) and fall back along the BCP-47 lookup chain ([RFC 4647 §3.4](https://www.rfc-editor.org/rfc/rfc4647#section-3.4)) on both the source and target side:

- `en-US` → `en`
- `zh-Hant-TW` → `zh-Hant` → `zh`

So `tl "..." --from en-US --to fr-CA` uses entries stored under `en`/`fr`, `en-US`/`fr`, `en`/`fr-CA`, and `en-US`/`fr-CA`. Fallback only goes toward the base: translating from `en` does **not** use entries stored under `en-US`.

When the same source term (compared case-insensitively, so `Email` and `email` compete) has entries at several levels, the most specific wins: the entry with the more specific **target** tag wins first, and the more specific source tag breaks the remaining tie. Target goes first because the output language decides which term is right: for `--from en-US --to fr-CA`, an `en`/`fr-CA` entry beats an `en-US`/`fr` entry. With `email → e-mail` under `en`/`fr` and `email → courriel` under `en`/`fr-CA`, `--to fr-CA` uses `courriel` and `--to fr-FR` uses `e-mail`.

### Auto-detected source (`--from auto`)

When the source language is `auto` (the default `defaults.sourceLang`), `tl` cannot pick a source code, so it uses entries of **every** source language for the target (target fallback and target specificity still apply). If the same source term exists under several source languages, the alphabetically first source code wins (`en` before `fr`), regardless of the order entries were added. Pass `--from` to use only one source language's entries.

In file mode with `--from auto`, a locale token in the source filename (`en.json`, `messages.fr.yaml`, `fr/common.json`) is used as the source language for the glossary lookup instead.

`tl glossary list --from/--to` still filters by the exact stored code (`--from auto` only lists entries stored under `auto`).

## Coverage check

After translation, a glossary term counts as covered if its target term appears anywhere in the output (ignoring combining diacritics). This is a substring check on purpose: models inflect target terms (Arabic `الكتاب` for `كتاب`, Russian `компьютера` for `компьютер`, Japanese terms followed by particles), and a whole-word check would report those as missing and trigger needless retries in `strict` mode. The flip side is that a target term contained in a longer word also counts as covered.
