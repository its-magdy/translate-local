import { describe, test, expect } from "bun:test";
import { join } from "path";
import { inferOutputPath, inferSourceLocale } from "../locale-path";

describe("inferOutputPath", () => {
  test("layout 1: <lang>.<ext>", () => {
    expect(inferOutputPath("/locales/en.json", "en", "ar")).toBe(join("/locales", "ar.json"));
    expect(inferOutputPath("./en.yaml", "en", "fr")).toBe("fr.yaml");
  });

  test("layout 2: <file>.<lang>.<ext>", () => {
    expect(inferOutputPath("/path/messages.en.yaml", "en", "ar")).toBe(join("/path", "messages.ar.yaml"));
    expect(inferOutputPath("./common.en.json", "en", "fr")).toBe("common.fr.json");
  });

  test("layout 3: <parent>/<lang>/<file>", () => {
    expect(inferOutputPath("/locales/en/common.json", "en", "ar")).toBe(join("/locales", "ar", "common.json"));
    expect(inferOutputPath("/i18n/en/auth.json", "en", "fr")).toBe(join("/i18n", "fr", "auth.json"));
  });

  test("returns null when no locale token detected", () => {
    expect(inferOutputPath("/path/strings.json", "en", "ar")).toBeNull();
    expect(inferOutputPath("/translation.yaml", "en", "ar")).toBeNull();
  });

  test("does not match when source lang is not the actual token", () => {
    // file.de.json with sourceLang=en should not be treated as having an en token
    expect(inferOutputPath("/path/messages.de.yaml", "en", "ar")).toBeNull();
  });
});

describe("inferSourceLocale", () => {
  test("returns the filename locale token for each layout", () => {
    expect(inferSourceLocale("/config/locales/en.yml", "auto")).toBe("en");
    expect(inferSourceLocale("/config/locales/pt-BR.yml", "auto")).toBe("pt-BR");
    expect(inferSourceLocale("/path/messages.de.yaml", "auto")).toBe("de");
    expect(inferSourceLocale("/locales/fr/common.json", "auto")).toBe("fr");
  });

  test("returns null when no locale token is present", () => {
    expect(inferSourceLocale("/path/strings.json", "auto")).toBeNull();
    expect(inferSourceLocale("/path/messages.de.yaml", "en")).toBeNull();
  });
});
