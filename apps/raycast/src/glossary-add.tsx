import { Form, ActionPanel, Action, showToast, Toast, useNavigation } from "@raycast/api";
import { useState } from "react";
import { addGlossaryEntry, TlCommandError } from "./lib/tl";
import { languages } from "./lib/languages";

interface GlossaryAddProps {
  onAdded?: () => void;
}

export default function GlossaryAdd({ onAdded }: GlossaryAddProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: {
    source: string;
    target: string;
    from: string;
    to: string;
    domain: string;
    note: string;
  }) {
    if (!values.source.trim() || !values.target.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Source and target terms are required" });
      return;
    }

    setIsSubmitting(true);
    try {
      await addGlossaryEntry({
        source: values.source.trim(),
        target: values.target.trim(),
        from: values.from,
        to: values.to,
        domain: values.domain.trim() || undefined,
        note: values.note.trim() || undefined,
      });
      await showToast({ style: Toast.Style.Success, title: "Entry added", message: `${values.source} → ${values.target}` });
      onAdded?.();
      pop();
    } catch (error) {
      const err = error instanceof TlCommandError ? error : new TlCommandError("UNKNOWN", String(error));
      await showToast({ style: Toast.Style.Failure, title: "Failed to add entry", message: err.hint ?? err.message });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Entry" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="source" title="Source Term" placeholder="Hello" />
      <Form.TextField id="target" title="Target Term" placeholder="مرحبا" />
      <Form.Dropdown id="from" title="From Language" defaultValue="en">
        {languages.map((lang) => (
          <Form.Dropdown.Item key={lang.code} value={lang.code} title={lang.name} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="to" title="To Language" defaultValue="ar">
        {languages.map((lang) => (
          <Form.Dropdown.Item key={lang.code} value={lang.code} title={lang.name} />
        ))}
      </Form.Dropdown>
      <Form.TextField id="domain" title="Domain" placeholder="Optional (e.g., medical, legal)" />
      <Form.TextField id="note" title="Note" placeholder="Optional note about this entry" />
    </Form>
  );
}
