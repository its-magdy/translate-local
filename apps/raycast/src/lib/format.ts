import type { TlTranslateResult } from "./types";
import { getLanguageName } from "./languages";

export function formatResultMarkdown(result: TlTranslateResult): string {
  const sourceName = getLanguageName(result.sourceLang);
  const targetName = getLanguageName(result.targetLang);
  const coverage = Math.round(result.glossaryCoverage * 100);

  let md = `# ${result.translated}\n\n---\n\n`;
  md += `| | |\n|---|---|\n`;
  md += `| **Source** | ${sourceName} (${result.sourceLang}) |\n`;
  md += `| **Target** | ${targetName} (${result.targetLang}) |\n`;
  md += `| **Glossary** | ${coverage}% |\n`;
  md += `| **Time** | ${result.metadata.durationMs}ms |\n`;
  md += `| **Adapter** | ${result.metadata.adapter} |\n`;

  if (result.missingTerms.length > 0) {
    md += `\n### Missing Glossary Terms\n\n`;
    result.missingTerms.forEach((term) => {
      md += `- ${term}\n`;
    });
  }

  return md;
}
