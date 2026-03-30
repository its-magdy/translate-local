import { Form, Detail, ActionPanel, Action, showToast, Toast, getPreferenceValues, useNavigation } from "@raycast/api";
import { useState } from "react";
import { translate, TlCommandError } from "./lib/tl";
import { languages } from "./lib/languages";
import { formatResultMarkdown } from "./lib/format";
import type { TlTranslateResult } from "./lib/types";

interface Preferences {
  defaultTargetLang: string;
  glossaryMode: "prefer" | "strict";
}

function ResultDetail({ result, sourceText }: { result: TlTranslateResult; sourceText: string }) {
  return (
    <Detail
      markdown={formatResultMarkdown(result)}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Translation" content={result.translated} shortcut={{ modifiers: ["cmd"], key: "c" }} />
          <Action.CopyToClipboard
            title="Copy Source + Target"
            content={`${sourceText}\n${result.translated}`}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel>
      }
    />
  );
}

export default function TranslateCommand() {
  const { push } = useNavigation();
  const prefs = getPreferenceValues<Preferences>();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: { text: string; from: string; to: string; glossaryMode: string }) {
    if (!values.text.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Text is required" });
      return;
    }

    setIsLoading(true);
    try {
      await showToast({ style: Toast.Style.Animated, title: "Translating..." });
      const result = await translate({
        text: values.text,
        from: values.from || undefined,
        to: values.to,
        glossaryMode: (values.glossaryMode as "prefer" | "strict") || undefined,
      });
      await showToast({ style: Toast.Style.Success, title: "Translated" });
      push(<ResultDetail result={result} sourceText={values.text} />);
    } catch (error) {
      if (error instanceof TlCommandError) {
        await showToast({ style: Toast.Style.Failure, title: error.tag, message: error.hint });
      } else {
        await showToast({ style: Toast.Style.Failure, title: "Translation failed", message: String(error) });
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Translate" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="text" title="Text" placeholder="Enter text to translate..." />
      <Form.Dropdown id="from" title="From" defaultValue="">
        <Form.Dropdown.Item value="" title="Auto-detect" />
        {languages.map((lang) => (
          <Form.Dropdown.Item key={lang.code} value={lang.code} title={lang.name} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="to" title="To" defaultValue={prefs.defaultTargetLang}>
        {languages.map((lang) => (
          <Form.Dropdown.Item key={lang.code} value={lang.code} title={lang.name} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="glossaryMode" title="Glossary Mode" defaultValue={prefs.glossaryMode ?? "prefer"}>
        <Form.Dropdown.Item value="prefer" title="Prefer" />
        <Form.Dropdown.Item value="strict" title="Strict" />
      </Form.Dropdown>
    </Form>
  );
}
