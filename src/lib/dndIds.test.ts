import { describe, it, expect } from "vitest";
import {
  parseActiveId,
  parseOverId,
  makeGroupCardId,
  makeDroppableGroupId,
} from "./dndIds";

describe("dndIds", () => {
  describe("parseActiveId", () => {
    it("parses bare UUID as topCard", () => {
      expect(parseActiveId("abc-123")).toEqual({ type: "topCard", uuid: "abc-123" });
    });

    it("parses group:xxx as group", () => {
      expect(parseActiveId("group:g1")).toEqual({ type: "group", groupId: "g1" });
    });

    it("parses ingroup:gid:uuid as groupCard", () => {
      expect(parseActiveId("ingroup:g1:abc-123")).toEqual({
        type: "groupCard",
        groupId: "g1",
        uuid: "abc-123",
      });
    });

    it("handles group ID containing colons in ingroup prefix", () => {
      // groupId is "g1", uuid is "uuid:with:colons"
      expect(parseActiveId("ingroup:g1:uuid:with:colons")).toEqual({
        type: "groupCard",
        groupId: "g1",
        uuid: "uuid:with:colons",
      });
    });
  });

  describe("parseOverId", () => {
    it("parses bare UUID as topCard", () => {
      expect(parseOverId("abc-123")).toEqual({ type: "topCard", uuid: "abc-123" });
    });

    it("parses group:xxx as group", () => {
      expect(parseOverId("group:g1")).toEqual({ type: "group", groupId: "g1" });
    });

    it("parses droppable:group:xxx as groupDropZone", () => {
      expect(parseOverId("droppable:group:g1")).toEqual({
        type: "groupDropZone",
        groupId: "g1",
      });
    });

    it("parses ingroup:gid:uuid as groupCard", () => {
      expect(parseOverId("ingroup:g1:abc-123")).toEqual({
        type: "groupCard",
        groupId: "g1",
        uuid: "abc-123",
      });
    });
  });

  describe("makeGroupCardId", () => {
    it("creates ingroup prefixed ID", () => {
      expect(makeGroupCardId("g1", "abc-123")).toBe("ingroup:g1:abc-123");
    });
  });

  describe("makeDroppableGroupId", () => {
    it("creates droppable prefixed ID", () => {
      expect(makeDroppableGroupId("g1")).toBe("droppable:group:g1");
    });
  });
});
