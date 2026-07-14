import { describe, it, expect } from "vitest";
import { routeFileLink } from "./linkRouting";

describe("routeFileLink", () => {
  it("routes ../-traversing .md links to the path-resolved page (finding 1)", () => {
    // From notes/deep/note.md, ../../other.md resolves to the workspace root.
    const route = routeFileLink("../../other.md", null, "/ws/notes/deep", "/ws");
    expect(route).toEqual({ kind: "page", target: "other" });
  });

  it("routes .md links that escape the workspace to the OS opener", () => {
    const route = routeFileLink("../../outside/x.md", null, "/ws/notes", "/ws");
    expect(route).toEqual({ kind: "os", absPath: "/outside/x.md" });
  });

  it("routes vault-internal absolute .md links in-app, preserving the fragment (finding 3)", () => {
    const route = routeFileLink("/ws/vault/note.md", "^id", "/ws/vault/notes", "/ws/vault");
    expect(route).toEqual({ kind: "page", target: "note", section: "^id" });
  });

  it("routes vault-internal absolute .md links even without a note directory", () => {
    const route = routeFileLink("/ws/note.md", null, "", "/ws");
    expect(route).toEqual({ kind: "page", target: "note" });
  });

  it("routes absolute non-.md links to the OS opener", () => {
    const route = routeFileLink("/abs/file.pdf", "^id", "/ws/notes", "/ws");
    expect(route).toEqual({ kind: "os", absPath: "/abs/file.pdf" });
  });

  it("routes absolute .md links outside the workspace to the OS opener", () => {
    const route = routeFileLink("/elsewhere/note.md", null, "/ws/notes", "/ws");
    expect(route).toEqual({ kind: "os", absPath: "/elsewhere/note.md" });
  });

  it("resolves subdir-qualified .md links against the note directory", () => {
    const route = routeFileLink("subdir/note.md", null, "/ws/notes", "/ws");
    expect(route).toEqual({ kind: "page", target: "notes/subdir/note" });
  });

  it("resolves ./-prefixed and bare .md links against the note directory", () => {
    expect(routeFileLink("./note.md", null, "/ws/notes", "/ws")).toEqual({
      kind: "page",
      target: "notes/note",
    });
    expect(routeFileLink("note.md", "Heading", "/ws/notes", "/ws")).toEqual({
      kind: "page",
      target: "notes/note",
      section: "Heading",
    });
  });

  it("matches the .md extension case-insensitively", () => {
    expect(routeFileLink("note.MD", null, "/ws", "/ws")).toEqual({
      kind: "page",
      target: "note",
    });
  });

  it("routes relative non-.md links to the OS opener via the note directory", () => {
    const route = routeFileLink("file.pdf", null, "/ws/sub", "/ws");
    expect(route).toEqual({ kind: "os", absPath: "/ws/sub/file.pdf" });
  });

  it("is unroutable for relative links without a note directory", () => {
    expect(routeFileLink("note.md", null, "", "/ws")).toEqual({ kind: "none" });
  });
});
