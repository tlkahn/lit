import { describe, it, expect } from "vitest";
import { parseCalloutType } from "./callout";

describe("parseCalloutType", () => {
  it('parses "> [!note]"', () => {
    const result = parseCalloutType("> [!note]");
    expect(result).toEqual({
      type: "note",
      resolvedType: "note",
      fold: null,
      title: undefined,
    });
  });

  it('parses "> [!warning]+" as expanded', () => {
    const result = parseCalloutType("> [!warning]+");
    expect(result).toEqual({
      type: "warning",
      resolvedType: "warning",
      fold: "expanded",
      title: undefined,
    });
  });

  it('parses "> [!tip]-" as collapsed', () => {
    const result = parseCalloutType("> [!tip]-");
    expect(result).toEqual({
      type: "tip",
      resolvedType: "tip",
      fold: "collapsed",
      title: undefined,
    });
  });

  it('parses "> [!info] Custom Title"', () => {
    const result = parseCalloutType("> [!info] Custom Title");
    expect(result).toEqual({
      type: "info",
      resolvedType: "info",
      fold: null,
      title: "Custom Title",
    });
  });

  it('returns null for "> Normal quote"', () => {
    expect(parseCalloutType("> Normal quote")).toBeNull();
  });

  it('is case insensitive: "> [!NOTE]" → type "note"', () => {
    const result = parseCalloutType("> [!NOTE]");
    expect(result!.type).toBe("note");
  });

  it('resolves alias: "> [!summary]" → resolvedType "abstract"', () => {
    const result = parseCalloutType("> [!summary]");
    expect(result!.resolvedType).toBe("abstract");
  });

  it('resolves alias: "> [!hint]" → resolvedType "tip"', () => {
    const result = parseCalloutType("> [!hint]");
    expect(result!.resolvedType).toBe("tip");
  });

  it('resolves alias: "> [!check]" → resolvedType "success"', () => {
    const result = parseCalloutType("> [!check]");
    expect(result!.resolvedType).toBe("success");
  });

  it('resolves alias: "> [!fail]" → resolvedType "failure"', () => {
    const result = parseCalloutType("> [!fail]");
    expect(result!.resolvedType).toBe("failure");
  });

  it('resolves alias: "> [!error]" → resolvedType "danger"', () => {
    const result = parseCalloutType("> [!error]");
    expect(result!.resolvedType).toBe("danger");
  });

  it('resolves alias: "> [!cite]" → resolvedType "quote"', () => {
    const result = parseCalloutType("> [!cite]");
    expect(result!.resolvedType).toBe("quote");
  });

  it('parses fold + title: "> [!tip]- Hidden Tip"', () => {
    const result = parseCalloutType("> [!tip]- Hidden Tip");
    expect(result).toEqual({
      type: "tip",
      resolvedType: "tip",
      fold: "collapsed",
      title: "Hidden Tip",
    });
  });
});
