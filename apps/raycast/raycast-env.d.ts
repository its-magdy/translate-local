/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** tl Binary Path - Path to the tl CLI binary */
  "tlPath": string,
  /** Default Target Language - Default language to translate into */
  "defaultTargetLang": "ar" | "fr" | "es" | "de" | "zh" | "ja" | "ko",
  /** Glossary Mode - How strictly to enforce glossary terms */
  "glossaryMode": "prefer" | "strict"
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `translate` command */
  export type Translate = ExtensionPreferences & {}
  /** Preferences accessible in the `translate-selection` command */
  export type TranslateSelection = ExtensionPreferences & {}
  /** Preferences accessible in the `translate-clipboard` command */
  export type TranslateClipboard = ExtensionPreferences & {}
  /** Preferences accessible in the `glossary-list` command */
  export type GlossaryList = ExtensionPreferences & {}
  /** Preferences accessible in the `glossary-add` command */
  export type GlossaryAdd = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `translate` command */
  export type Translate = {}
  /** Arguments passed to the `translate-selection` command */
  export type TranslateSelection = {}
  /** Arguments passed to the `translate-clipboard` command */
  export type TranslateClipboard = {}
  /** Arguments passed to the `glossary-list` command */
  export type GlossaryList = {}
  /** Arguments passed to the `glossary-add` command */
  export type GlossaryAdd = {}
}

