# Term helpers stay in shared, behind TermSet

Only core's `TermSet` uses the glossary term helpers in `packages/shared/src/utils/text.ts` (tag check, coverage, forms), but they stay in `shared`. The tag strip (`stripGlossaryTags`) has to live there, because the mock adapter calls it and the adapters package can't import core (core already depends on adapters through `TranslationSession`). The tag check reuses the strip's private internals (`removeTermTags`, `unescapeAttr`, the tag regexes), and the coverage helpers are used by the tag check. So moving any of them into core would either export those internals from `shared` or make `shared` import core. The deepening happened at the interface instead: `runPipeline` calls only `TermSet`, and these helpers are its implementation, even though they sit in another package.

## Consequences

`text.test.ts` keeps testing these helpers directly. New term behaviour should be tested through `TermSet` (`terms.test.ts`), which needs no store or adapter.
