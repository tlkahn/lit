import { describe, it, expect, vi } from "vitest";
import { commandProvider } from "./stubProviders";

describe("stubProviders", () => {
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

    it("search results have no function references in data (serializable)", async () => {
      const results = await commandProvider.search("insert");
      const data = results[0]!.data;
      if (data && typeof data === "object") {
        for (const value of Object.values(data as Record<string, unknown>)) {
          expect(typeof value).not.toBe("function");
        }
      }
    });

    it("onSelect dispatches the command's action using only the result id (lookup)", () => {
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      commandProvider.onSelect({
        id: "insert-annotation",
        title: "Insert Annotation",
        icon: "✏️",
        section: "Commands",
      });
      const event = dispatchSpy.mock.calls.find(
        (call) => (call[0] as CustomEvent).type === "lit:open-annotation-builder",
      );
      expect(event).toBeDefined();
      dispatchSpy.mockRestore();
    });
  });
});
