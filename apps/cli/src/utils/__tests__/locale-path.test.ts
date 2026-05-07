import { describe, test, expect } from "bun:test";
import { inferOutputPath } from "../locale-path";

describe("inferOutputPath", () => {
  test("layout 1: <lang>.<ext>", () => {
    expect(inferOutputPath("/locales/en.json", "en", "ar")).toBe("/locales/ar.json");
    expect(inferOutputPath("./en.yaml", "en", "fr")).toBe("fr.yaml");
  });

  test("layout 2: <file>.<lang>.<ext>", () => {
    expect(inferOutputPath("/path/messages.en.yaml", "en", "ar")).toBe("/path/messages.ar.yaml");
    expect(inferOutputPath("./common.en.json", "en", "fr")).toBe("common.fr.json");
  });

  test("layout 3: <parent>/<lang>/<file>", () => {
    expect(inferOutputPath("/locales/en/common.json", "en", "ar")).toBe("/locales/ar/common.json");
    expect(inferOutputPath("/i18n/en/auth.json", "en", "fr")).toBe("/i18n/fr/auth.json");
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
