import { describe, it, expect } from "vitest";
import { fileProvider, tagProvider, contentProvider, commandProvider } from "./stubProviders";

describe("stub providers", () => {
  it("fileProvider: prefix $, label Files, priority 10, search returns []", async () => {
    expect(fileProvider.id).toBe("files");
    expect(fileProvider.prefix).toBe("$");
    expect(fileProvider.label).toBe("Files");
    expect(fileProvider.priority).toBe(10);
    expect(await fileProvider.search("test")).toEqual([]);
  });

  it("tagProvider: prefix #, label Tags, priority 30, search returns []", async () => {
    expect(tagProvider.id).toBe("tags");
    expect(tagProvider.prefix).toBe("#");
    expect(tagProvider.label).toBe("Tags");
    expect(tagProvider.priority).toBe(30);
    expect(await tagProvider.search("test")).toEqual([]);
  });

  it("contentProvider: prefix /, label Content, priority 40, search returns []", async () => {
    expect(contentProvider.id).toBe("content");
    expect(contentProvider.prefix).toBe("/");
    expect(contentProvider.label).toBe("Content");
    expect(contentProvider.priority).toBe(40);
    expect(await contentProvider.search("test")).toEqual([]);
  });

  it("commandProvider: prefix !, label Commands, priority 50, search returns []", async () => {
    expect(commandProvider.id).toBe("commands");
    expect(commandProvider.prefix).toBe("!");
    expect(commandProvider.label).toBe("Commands");
    expect(commandProvider.priority).toBe(50);
    expect(await commandProvider.search("test")).toEqual([]);
  });

  it("each onSelect is a no-op", () => {
    const result = { id: "test", title: "Test", section: "Test" };
    expect(() => fileProvider.onSelect(result)).not.toThrow();
    expect(() => tagProvider.onSelect(result)).not.toThrow();
    expect(() => contentProvider.onSelect(result)).not.toThrow();
    expect(() => commandProvider.onSelect(result)).not.toThrow();
  });
});
