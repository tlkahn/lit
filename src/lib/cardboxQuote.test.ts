import { describe, it, expect, afterEach } from "vitest";
import { resolveQuoteTarget } from "./cardboxQuote";

// resolveQuoteTarget never depends on jsdom's Selection implementation: the
// tests hand it a Selection-shaped object over real DOM nodes.
function makeSelection(overrides: {
  anchorNode: Node | null;
  text?: string;
  collapsed?: boolean;
}): Selection {
  return {
    isCollapsed: overrides.collapsed ?? false,
    anchorNode: overrides.anchorNode,
    toString: () => overrides.text ?? "",
  } as unknown as Selection;
}

let root: HTMLElement | null = null;
afterEach(() => {
  root?.remove();
  root = null;
});

function makeGrid(): { grid: HTMLElement; cardText: Node; bareText: Node } {
  root = document.createElement("div");
  document.body.appendChild(root);
  const card = document.createElement("div");
  // Deliberately keyed on data-uuid, not data-testid="cardbox-card", so the
  // resolver works against probe mocks too.
  card.setAttribute("data-uuid", "card-1");
  const cardText = document.createTextNode("quoted text lives here");
  card.appendChild(cardText);
  root.appendChild(card);
  const bare = document.createElement("div");
  const bareText = document.createTextNode("outside any card");
  bare.appendChild(bareText);
  root.appendChild(bare);
  return { grid: root, cardText, bareText };
}

describe("resolveQuoteTarget", () => {
  it("returns the card uuid and a blockquote for a selection inside a card", () => {
    const { grid, cardText } = makeGrid();
    const sel = makeSelection({ anchorNode: cardText, text: "quoted text" });
    expect(resolveQuoteTarget(sel, grid)).toEqual({
      uuid: "card-1",
      text: "> quoted text",
    });
  });

  it("blockquotes a multi-line selection", () => {
    const { grid, cardText } = makeGrid();
    const sel = makeSelection({ anchorNode: cardText, text: "one\ntwo" });
    expect(resolveQuoteTarget(sel, grid)?.text).toBe("> one\n> two");
  });

  it("returns null for a collapsed selection", () => {
    const { grid, cardText } = makeGrid();
    const sel = makeSelection({ anchorNode: cardText, text: "", collapsed: true });
    expect(resolveQuoteTarget(sel, grid)).toBeNull();
  });

  it("returns null for a whitespace-only selection", () => {
    const { grid, cardText } = makeGrid();
    const sel = makeSelection({ anchorNode: cardText, text: "  \n " });
    expect(resolveQuoteTarget(sel, grid)).toBeNull();
  });

  it("returns null when the anchor is outside the root", () => {
    const { grid } = makeGrid();
    const outside = document.createElement("div");
    outside.setAttribute("data-uuid", "elsewhere");
    const outsideText = document.createTextNode("selected elsewhere");
    outside.appendChild(outsideText);
    document.body.appendChild(outside);
    try {
      const sel = makeSelection({ anchorNode: outsideText, text: "selected elsewhere" });
      expect(resolveQuoteTarget(sel, grid)).toBeNull();
    } finally {
      outside.remove();
    }
  });

  it("returns null when the anchor is in the grid but not inside a card", () => {
    const { grid, bareText } = makeGrid();
    const sel = makeSelection({ anchorNode: bareText, text: "outside any card" });
    expect(resolveQuoteTarget(sel, grid)).toBeNull();
  });

  it("returns null for a null selection or root", () => {
    const { grid, cardText } = makeGrid();
    expect(resolveQuoteTarget(null, grid)).toBeNull();
    const sel = makeSelection({ anchorNode: cardText, text: "quoted" });
    expect(resolveQuoteTarget(sel, null)).toBeNull();
  });
});
