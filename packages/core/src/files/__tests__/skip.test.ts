import { describe, test, expect } from "bun:test";
import { classifyValue } from "../skip";

describe("classifyValue", () => {
  test("empty string", () => {
    expect(classifyValue("")).toEqual({ skip: true, reason: "empty" });
  });

  test("whitespace-only", () => {
    expect(classifyValue("   ")).toEqual({ skip: true, reason: "whitespace-only" });
    expect(classifyValue("\n\t  ")).toEqual({ skip: true, reason: "whitespace-only" });
  });

  test("single char", () => {
    expect(classifyValue("x")).toEqual({ skip: true, reason: "single-char" });
    expect(classifyValue("·")).toEqual({ skip: true, reason: "single-char" });
  });

  test("URLs", () => {
    expect(classifyValue("https://example.com")).toEqual({ skip: true, reason: "url" });
    expect(classifyValue("http://localhost:3000/path?q=1")).toEqual({ skip: true, reason: "url" });
  });

  test("emails", () => {
    expect(classifyValue("user@example.com")).toEqual({ skip: true, reason: "email" });
    expect(classifyValue("first.last+tag@sub.example.co.uk")).toEqual({ skip: true, reason: "email" });
  });

  test("semver", () => {
    expect(classifyValue("1.2.3")).toEqual({ skip: true, reason: "semver" });
    expect(classifyValue("v0.4.0")).toEqual({ skip: true, reason: "semver" });
    expect(classifyValue("2.0.0-beta.1")).toEqual({ skip: true, reason: "semver" });
  });

  test("all-caps short tokens", () => {
    expect(classifyValue("OK")).toEqual({ skip: true, reason: "all-caps-short" });
    expect(classifyValue("API")).toEqual({ skip: true, reason: "all-caps-short" });
    expect(classifyValue("ID_X")).toEqual({ skip: true, reason: "all-caps-short" });
  });

  test("translatable normal sentences", () => {
    expect(classifyValue("Hello, world!")).toEqual({ skip: false });
    expect(classifyValue("Welcome back")).toEqual({ skip: false });
    expect(classifyValue("مرحبا")).toEqual({ skip: false });
  });

  test("4-char ALL-CAPS still treated as identifier (override with --translate-all)", () => {
    expect(classifyValue("OKAY")).toEqual({ skip: true, reason: "all-caps-short" });
  });

  test("5+ char ALL-CAPS treated as translatable text", () => {
    expect(classifyValue("HELLO!")).toEqual({ skip: false });
    expect(classifyValue("CONTACT")).toEqual({ skip: false });
  });

  test("two-char common abbreviations match", () => {
    expect(classifyValue("OK")).toEqual({ skip: true, reason: "all-caps-short" });
  });
});
