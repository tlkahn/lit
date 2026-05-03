import { describe, it, expect, vi } from "vitest";
import { fileProvider, tagProvider, contentProvider, commandProvider } from "./stubProviders";

describe("stubProviders", () => {
  describe("fileProvider", () => {
    it('has id "files", prefix "$", label "Files", priority 10', () => {
      expect(fileProvider.id).toBe("files");
      expect(fileProvider.prefix).toBe("$");
      expect(fileProvider.label).toBe("Files");
      expect(fileProvider.priority).toBe(10);
    });

    it("search() returns []", async () => {
      expect(await fileProvider.search("test")).toEqual([]);
    });
  });

  describe("tagProvider", () => {
    it('has id "tags", prefix "#", label "Tags", priority 30', () => {
      expect(tagProvider.id).toBe("tags");
      expect(tagProvider.prefix).toBe("#");
      expect(tagProvider.label).toBe("Tags");
      expect(tagProvider.priority).toBe(30);
    });

    it("search() returns []", async () => {
      expect(await tagProvider.search("test")).toEqual([]);
    });
  });

  describe("contentProvider", () => {
    it('has id "content", prefix "/", label "Content", priority 40', () => {
      expect(contentProvider.id).toBe("content");
      expect(contentProvider.prefix).toBe("/");
      expect(contentProvider.label).toBe("Content");
      expect(contentProvider.priority).toBe(40);
    });

    it("search() returns []", async () => {
      expect(await contentProvider.search("test")).toEqual([]);
    });
  });

  describe("commandProvider", () => {
    it('has id "commands", prefix "!", label "Commands", priority 50', () => {
      expect(commandProvider.id).toBe("commands");
      expect(commandProvider.prefix).toBe("!");
      expect(commandProvider.label).toBe("Commands");
      expect(commandProvider.priority).toBe(50);
    });

    it('search("insert") returns PaletteResult for "Insert Annotation"', async () => {
      const results = await commandProvider.search("insert");
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe("Insert Annotation");
      expect(results[0]!.id).toBe("insert-annotation");
      expect(results[0]!.section).toBe("Commands");
    });

    it('search("xyz") returns [] (no match)', async () => {
      const results = await commandProvider.search("xyz");
      expect(results).toEqual([]);
    });

    it('search("") returns all commands (browse mode)', async () => {
      const results = await commandProvider.search("");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.title).toBe("Insert Annotation");
    });

    it("onSelect dispatches the command's action", () => {
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      commandProvider.onSelect({
        id: "insert-annotation",
        title: "Insert Annotation",
        icon: "✏️",
        section: "Commands",
        data: { action: () => window.dispatchEvent(new CustomEvent("lit:open-annotation-builder")) },
      });
      const event = dispatchSpy.mock.calls.find(
        (call) => (call[0] as CustomEvent).type === "lit:open-annotation-builder",
      );
      expect(event).toBeDefined();
      dispatchSpy.mockRestore();
    });
  });
});
