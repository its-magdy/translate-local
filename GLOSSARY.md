# tl

A local translation tool whose central promise is that a user's glossary terms appear in the translation, even when the model would rather write its own word.

## Glossary

**Glossary entry**:
A user's rule that a source-language term must be translated as a given target-language term.
_Avoid_: rule, mapping

**Term**:
The target-language side of a glossary entry: the word the translation must contain.
_Avoid_: translation (ambiguous with the whole output), keyword

**Form**:
Another way of writing a term that also counts as the term, such as an inflection. A **one-piece form** is a single span of text; a **split form** comes in parts that may have other words between them (German `stellen … bereit`).
_Avoid_: variant, alias

**Hit**:
One occurrence of a glossary entry's source term in the text being translated.
_Avoid_: match (also used for target-side checks)

**Term Set**:
All the hits of one source text, taken together with the target language: what the model is told about terms, and how its output is judged against them.

**Coverage**:
The share of a text's terms that its translation contains, counting forms.
_Avoid_: glossary score, hit rate

## Translating

**Attempt**:
One request to the model for a translation of the whole text; a translation may take several when terms are missing.
_Avoid_: try, call (a call also covers checks and repairs)

**Code-switched retry**:
The last attempt, where the source is sent with each term already written in place of its source word, so the model only has to write the sentence around it.

**Forced term**:
A term the translation contains because the tool put it there (a code-switched retry, or a term swapped in for the model's own word) rather than because the model chose it.

**Tag check**:
An extra question to the model, asked when the model wrapped a term's marker around some other word while writing the term elsewhere: whether that other word translates a different part of the source and should stay.

**Agreement repair**:
An extra request that asks the model to fix the grammar around forced terms (gender, case, articles) without changing the terms.
_Avoid_: proofreading pass, fix-up (fix-ups are the tool's own rule-based corrections)

## File mode

**Catalog**:
A JSON or YAML file of translatable strings that an app loads at runtime.
_Avoid_: locale file, resource file

**Leaf**:
One string value in a catalog, addressed by its path of keys.
_Avoid_: key (the key is only the last segment of the path), entry

**Placeholder**:
A part of a leaf that must reach the translation unchanged, such as `{name}`; it is hidden from the model behind a **sentinel** token.
