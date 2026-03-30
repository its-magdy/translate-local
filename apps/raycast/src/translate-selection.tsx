import { showToast, showHUD, Toast, Clipboard, getSelectedText, getPreferenceValues } from "@raycast/api";
import { translate, TlCommandError } from "./lib/tl";
import { getLanguageName } from "./lib/languages";

interface Preferences {
  defaultTargetLang: string;
}

export default async function TranslateSelectionCommand() {
  const prefs = getPreferenceValues<Preferences>();

  let text: string;
  try {
    text = await getSelectedText();
  } catch {
    await showToast({ style: Toast.Style.Failure, title: "No text selected" });
    return;
  }

  if (!text.trim()) {
    await showToast({ style: Toast.Style.Failure, title: "Selected text is empty" });
    return;
  }

  try {
    await showToast({ style: Toast.Style.Animated, title: "Translating..." });
    const result = await translate({ text, to: prefs.defaultTargetLang });
    await Clipboard.paste(result.translated);
    await showHUD(`Translated to ${getLanguageName(result.targetLang)}`);
  } catch (error) {
    if (error instanceof TlCommandError) {
      await showToast({ style: Toast.Style.Failure, title: error.tag, message: error.hint });
    } else {
      await showToast({ style: Toast.Style.Failure, title: "Translation failed", message: String(error) });
    }
  }
}
