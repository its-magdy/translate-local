import { showToast, showHUD, Toast, Clipboard, getPreferenceValues } from "@raycast/api";
import { translate, TlCommandError } from "./lib/tl";

interface Preferences {
  defaultTargetLang: string;
}

export default async function TranslateClipboardCommand() {
  const prefs = getPreferenceValues<Preferences>();

  const clipboardText = await Clipboard.readText();
  if (!clipboardText?.trim()) {
    await showToast({ style: Toast.Style.Failure, title: "Clipboard is empty" });
    return;
  }

  try {
    await showToast({ style: Toast.Style.Animated, title: "Translating..." });
    const result = await translate({ text: clipboardText, to: prefs.defaultTargetLang });
    await Clipboard.copy(result.translated);
    await showHUD("Translation copied");
  } catch (error) {
    if (error instanceof TlCommandError) {
      await showToast({ style: Toast.Style.Failure, title: error.tag, message: error.hint });
    } else {
      await showToast({ style: Toast.Style.Failure, title: "Translation failed", message: String(error) });
    }
  }
}
