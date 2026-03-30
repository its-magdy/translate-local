import { List, ActionPanel, Action, Icon, showToast, Toast, Clipboard } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { listGlossary, removeGlossaryEntry, exportGlossary, TlCommandError } from "./lib/tl";
import { getLanguageName } from "./lib/languages";
import type { TlGlossaryEntry } from "./lib/types";
import GlossaryAdd from "./glossary-add";

export default function GlossaryList() {
  const { data, isLoading, revalidate } = usePromise(listGlossary);

  const grouped = groupByDomain(data ?? []);

  async function handleDelete(entry: TlGlossaryEntry) {
    try {
      await removeGlossaryEntry(entry.id);
      await showToast({ style: Toast.Style.Success, title: "Entry removed", message: `${entry.source} → ${entry.target}` });
      revalidate();
    } catch (error) {
      const err = error instanceof TlCommandError ? error : new TlCommandError("UNKNOWN", String(error));
      await showToast({ style: Toast.Style.Failure, title: "Failed to remove entry", message: err.hint ?? err.message });
    }
  }

  async function handleExport() {
    try {
      const json = await exportGlossary();
      await Clipboard.copy(json);
      await showToast({ style: Toast.Style.Success, title: "Glossary exported", message: "Copied to clipboard" });
    } catch (error) {
      const err = error instanceof TlCommandError ? error : new TlCommandError("UNKNOWN", String(error));
      await showToast({ style: Toast.Style.Failure, title: "Failed to export glossary", message: err.hint ?? err.message });
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter glossary entries...">
      {Object.entries(grouped).map(([domain, entries]) => (
        <List.Section key={domain} title={domain} subtitle={`${entries.length} entries`}>
          {entries.map((entry) => (
            <List.Item
              key={entry.id}
              title={`${entry.source} → ${entry.target}`}
              subtitle={entry.note}
              accessories={[
                { tag: `${getLanguageName(entry.fromLang)} → ${getLanguageName(entry.toLang)}` },
              ]}
              actions={
                <ActionPanel>
                  <Action.Push title="Add Entry" icon={Icon.Plus} target={<GlossaryAdd onAdded={revalidate} />} shortcut={{ modifiers: ["cmd"], key: "n" }} />
                  <Action
                    title="Delete Entry"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                    onAction={() => handleDelete(entry)}
                  />
                  <Action.CopyToClipboard title="Copy Entry" content={`${entry.source} → ${entry.target}`} shortcut={{ modifiers: ["cmd"], key: "c" }} />
                  <Action title="Export Glossary" icon={Icon.Download} shortcut={{ modifiers: ["cmd"], key: "e" }} onAction={handleExport} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
      {!isLoading && (data ?? []).length === 0 && (
        <List.EmptyView
          title="No Glossary Entries"
          description="Add your first entry with ⌘N"
          actions={
            <ActionPanel>
              <Action.Push title="Add Entry" icon={Icon.Plus} target={<GlossaryAdd onAdded={revalidate} />} shortcut={{ modifiers: ["cmd"], key: "n" }} />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

function groupByDomain(entries: TlGlossaryEntry[]): Record<string, TlGlossaryEntry[]> {
  const groups: Record<string, TlGlossaryEntry[]> = {};
  for (const entry of entries) {
    const domain = entry.domain || "General";
    if (!groups[domain]) groups[domain] = [];
    groups[domain].push(entry);
  }
  return groups;
}
