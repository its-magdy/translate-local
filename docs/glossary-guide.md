# Glossary Guide

The glossary is a database of term pairs that `tl` enforces during translation. When a source term is found in your text, the pipeline injects an XML tag that instructs the model to use the specified target translation.

## How It Works

When translating, the pipeline:

1. Looks up glossary entries matching the source language and target language (with [language fallback](#language-code-fallback))
2. Finds occurrences of source terms in your text ([Unicode-aware matching](#term-matching), case-insensitive)
3. Injects XML tags: `<term translation="target">source</term>`
4. Sends the tagged text to the adapter
5. Validates that target terms appear in the output (substring check, see [Coverage check](#coverage-check))
6. Strips the XML tags from the final result (see [Term tags in the output](#term-tags-in-the-output)), checking with the model first when a tag sits on the wrong word (see [Tag check](#tag-check-a-term-tagged-around-the-wrong-word))
7. Fixes articles, elision and agreement around the term (see [Articles and quotes](#articles-and-quotes-around-terms) and [Agreement repair](#agreement-repair))

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

When the term is written in a different script from the source word (`cache → الكاش`), the tag also carries the source word, `<term translation="الكاش" source="cache">الكاش</term>`. This keeps the word's meaning: `الكاش` also reads as "cash", and without the source word `Cleared the {name} الكاش.` came back as a payment sentence. Terms in the same script as the source word (`server → host` in Italian) don't get it, because the model would copy the source word instead of the term. Chinese, Japanese and Korean terms don't get it either: there it didn't help the term and the model dropped placeholders more often. Nor do Latin-script terms translated from a non-Latin source (`サーバー → host` from Japanese): the model translated the source word itself and wrote "server" instead of the term. So a same-script term that is also another word can still change the sentence's meaning on this retry; check translations of such terms.

### Term tags in the output

The model often copies the `<term>` tag into its output with a word of its own inside. `tl` replaces each such tag with the glossary term, unless the word inside is the model's own form of the term, which it keeps: one that contains the term (case-insensitive) and has no more words than it, after trimming and dropping surrounding quotes. So `<term translation="كوميت">الكوميت</term>` keeps the article (`الكوميت`), `<term translation="نشر">انشر</term>` keeps the imperative (`انشر`), and `<term translation="hôte">hôtes</term>` keeps the plural, while `<term translation="Zweig">Abteilung</term>` becomes `Zweig`. The part matching the term is written exactly as the glossary has it (`HÔTE` → `hôte`), except that a capital first letter the model gave an all-lowercase term is kept (`Hôtes`, German `Bereitstellen`), so the coverage check always finds it. When a replaced word starts with a capital at the start of the text, a line or a sentence, the term is capitalized too (`<term translation="hôte">Serveur</term> : détails` → `Hôte : détails`). Terms with any capital letter of their own (`iOS`, `Zweig`) are always written as the glossary has them. A tag the model never closed is always replaced by the term.

### Tag check: a term tagged around the wrong word

Sometimes the model writes the glossary term in the right place *and* marks a
different word as the term. Replacing the marked word then puts the term in
twice: for "Deploy automatically after each commit." with
`deploy → bereitstellen`, the output
`<term translation="bereitstellen">Automatisch</term> nach jedem Commit bereitstellen.`
became `Bereitstellen nach jedem Commit bereitstellen.`

When a tagged word is not a form of the term **and** the term (or a form)
already stands outside every tag as a whole word, `tl` asks the model once
more before replacing: it re-sends the sentence code-switched (the term in
place of the source word), and keeps the marked word if that answer contains
both the term and that word. Otherwise the word is replaced as before. The
example above comes out as `Automatisch nach jedem Commit bereitstellen.`

- The second answer is only used to decide; it is never returned.
- In prefer mode, when the code-switched retry already ran, its output is
  reused and the check costs no extra call.
- The check is skipped for placeholders, for a word that is just the source
  word, for a word without letters, for terms matched more than once in the
  text or tagged more than once in the output, and for Chinese, Japanese,
  Korean, Thai, Lao, Khmer and Myanmar text, where word edges can't be
  determined.
- With `--json`, `metadata.tagChecked` marks the extra call and
  `metadata.keptWord` marks a kept word.

This fires on about 0.1% of keys (15 of 9,039 replayed file-mode leaves). On
the benchmark the sentence above went from 0/3 to 2/3 correct with no change
in the total number of model calls.

### Articles and quotes around terms

After every attempt, `tl` fixes a few deterministic mistakes right around a glossary target term:

- quotes or em dashes wrapped directly around the term are dropped (`« hôte »` → `hôte`); in French and Italian a lone em dash right before it is dropped too (`il —host` → `l'host`);
- French and Italian articles and contractions are elided before a term that starts with a vowel or a mute h: `le hôte` → `l'hôte`, `au hôte` → `à l'hôte`, `ce hôte` → `cet hôte`, `il host` → `l'host`. French words with an aspirated h (`héros`, `hasard`, `haut`, …) keep their article;
- in Arabic, a detached article before a term that already starts with `ال` is dropped (`الـ الكاش` → `الكاش`);
- in Arabic, a detached article before any other term written in Arabic script is attached to it (`الـ كوميت` → `الكوميت`, `بالـ نشر` → `بالنشر`). A Latin-script term keeps the detached form (`الـ API`).

Independently of the glossary, a full stop the model adds to a source that has
no sentence-final punctuation is dropped (`Save changes` → `Enregistrer les
modifications`), unless the last word is an abbreviation, a single letter, or a
glossary term ending in a period — see the
[CLI reference](cli-reference.md#tl-translate-text).

### Agreement repair

Gender and case agreement can't be fixed by rules: the right form depends on the term's gender and the word's role in the sentence. So when the final translation holds a term the model did not choose itself, `tl` makes one extra model call that asks it to proofread the text: fix only the articles, adjectives, pronouns and participles around the terms (`Erstellen Sie eine neue Zweig` → `Erstellen Sie einen neuen Zweig`) and change nothing else. A term counts as not chosen by the model when:

- the model echoed the term tag around its own word (`eine neue <term translation="Zweig">Abteilung</term>`) and `tl` swapped in the term (a tag around the model's own form of the term, such as `الكوميت`, is kept as written and doesn't count), or
- the result came from the code-switched last retry, where `tl` put the term into the source.

A translation where the model wrote the term itself, one without glossary terms, an image translation, and placeholders alone never trigger it. TranslateGemma usually echoes the tag, so expect this extra call on most translations that contain a glossary term; translations without one never pay for it. The repaired text is kept only if it still contains every glossary term the draft had and exactly the same placeholders, adds no `*` (the model sometimes bolds the term), is more than the draft plus a final period or other sentence-ending mark the source doesn't have (so `Delete the branch` stays `Löschen Sie den Zweig`, without a period), and its length is within 1.3× of the draft's; otherwise, or if the call fails, the unrepaired translation is returned. The repair only reaches what the model knows: it fixed `eine neue Zweig` and `Chaque validation doit être signé` in the agreement benchmark, but not `l'antémémoire est plein` (the 4B model doesn't know the rare word is feminine). With `--json`, a repaired result has `"repaired": true` in its `metadata`.

```bash
tl "machine learning model" --from en --to ar --glossary strict
```

Use `strict` for legal, medical, or technical content where term accuracy is non-negotiable.

## Other forms of a term

Some terms change shape with their role in the sentence, and a single target term then forces bad grammar. German `deploy → bereitstellen` is a verb, but "before you deploy again" needs the noun (`vor der erneuten Bereitstellung`) and "Deploy the branch" needs the split verb (`Stellen Sie den Zweig bereit`). With only `bereitstellen`, `tl` reported those correct translations as missing, retried them and ended up with `vor der erneuten bereitstellen`.

Give the entry its other forms, separated by `|`:

```bash
tl glossary add --source deploy --target bereitstellen --from en --to de \
  --forms "Bereitstellung|bereitgestellt|bereitzustellen|stellen … bereit|stellt … bereit"
```

Each form counts as the term:

- in the coverage check, so a translation that uses a form is not retried;
- inside a term tag the model echoes, which keeps the form instead of swapping in the term (`<term translation="bereitstellen">Bereitstellung</term>` stays `Bereitstellung`);
- when the agreement repair rewrites a sentence around a form.

A form with `…` (or `...`) is a split form: `stellen … bereit` counts when `stellen` and then `bereit` appear as whole words, in that order, in the same sentence (`Stellen Sie den Zweig jetzt bereit.`). A sentence ends at a line break or at `.`, `!` or `?` followed by a space and a word that doesn't start lowercase; a one-letter abbreviation (`z. B.`) or an ellipsis in the text doesn't end it. Parts in Chinese, Japanese or Thai script match as substrings, since those scripts have no spaces between words. Only forms are split this way: a target term that contains an ellipsis (`Speichern unter…`) is matched as written. The prompt still names only the target term.

To change an entry's forms, add it again with the new `--forms`; to remove them all, remove the entry and add it again.

Forms loosen the check for that entry: a form that is also a common word makes the term count wherever that word appears. Keep them to real forms of the term. In the file-mode bench, the German forms above changed only the `deploy` leaves, all for the better ("Deploy the branch to staging." went from 0 to 3 correct translations out of 3, "Roll back … before you deploy again." from 1 to 3, with a quarter of the model calls): `vor der erneuten Bereitstellung`, `Bitte stellen Sie den Zweig in der Testumgebung bereit.`, `bereitgestellt werden kann`, with fewer model calls.

## CSV Import Format

```
source,target,from,to,domain,note,forms
machine learning,تعلم الآلة,en,ar,tech,,
neural network,شبكة عصبية,en,ar,tech,,
bonjour,hello,fr,en,,informal greeting,
deploy,bereitstellen,en,de,,,Bereitstellung|bereitgestellt|stellen … bereit
```

Columns:
- `source` — source term (required)
- `target` — target translation (required)
- `from` — BCP-47 source language code (required)
- `to` — BCP-47 target language code (required)
- `domain` — optional domain label
- `note` — optional free-text note
- `forms` — optional other target forms separated by `|` (see [Other forms of a term](#other-forms-of-a-term)); files without this column still import

Import:

```bash
tl glossary import ./terms.csv
```

Duplicate entries (same source, target, source_lang, target_lang) are silently skipped, except that a duplicate row with forms replaces the stored entry's forms. The whole file is imported in a single transaction — if the import fails partway, no rows are written.

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

After translation, a glossary term counts as covered if its target term, or one of its [other forms](#other-forms-of-a-term), appears anywhere in the output (ignoring combining diacritics), also with a capital first letter when the term is all lowercase (`Bereitstellen` for `bereitstellen`). This is a substring check on purpose: models inflect target terms (Arabic `الكتاب` for `كتاب`, Russian `компьютера` for `компьютер`, Japanese terms followed by particles), and a whole-word check would report those as missing and trigger needless retries in `strict` mode. The flip side is that a target term contained in a longer word also counts as covered. For Arabic targets, the preposition `ل` joined to an `ال`-initial term also counts as the term (`للكاش` for `الكاش`, `للغة` for `اللغة`, with or without harakat).

## Terms inside fixed phrases

The model sometimes keeps its own set phrase for a whole expression and drops the term, even on the retries. Example with TranslateGemma 4B and `cache → الكاش`: "Cleared the browser cache." becomes `تم مسح ذاكرة التخزين المؤقت للمتصفح.` in nearly every run, and stronger prompt wording didn't change that. When a term keeps going missing inside one expression, add the whole expression as its own entry. Longer entries match first, so it takes precedence:

```bash
tl glossary add --source "browser cache" --target "كاش المتصفح" --from en --to ar
```

In our tests this raised the term from 1 to 9 out of 20 runs on two "browser cache" sentences. It helps but doesn't guarantee the term; `--glossary=strict` still fails the translation when the term is missing.
