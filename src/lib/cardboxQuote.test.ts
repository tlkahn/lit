import { describe, it, expect, afterEach } from "vitest";
import { resolveQuoteTarget } from "./cardboxQuote";

// resolveQuoteTarget never depends on jsdom's Selection implementation: the
// tests hand it a Selection-shaped object over real DOM nodes.
function makeSelection(overrides: {
  anchorNode: Node | null;
  focusNode?: Node | null;
  text?: string;
  collapsed?: boolean;
}): Selection {
  return {
    isCollapsed: overrides.collapsed ?? false,
    anchorNode: overrides.anchorNode,
    focusNode: overrides.focusNode !== undefined ? overrides.focusNode : overrides.anchorNode,
    toString: () => overrides.text ?? "",
  } as unknown as Selection;
}

let root: HTMLElement | null = null;
afterEach(() => {
  root?.remove();
  root = null;
});

function makeGrid(): {
  grid: HTMLElement;
  cardText: Node;
  cardTextTail: Node;
  otherCardText: Node;
  bareText: Node;
} {
  root = document.createElement("div");
  document.body.appendChild(root);
  const card = document.createElement("div");
  // Deliberately keyed on data-uuid, not data-testid="cardbox-card", so the
  // resolver works against probe mocks too.
  card.setAttribute("data-uuid", "card-1");
  const cardText = document.createTextNode("quoted text lives here");
  card.appendChild(cardText);
  const cardTail = document.createElement("span");
  const cardTextTail = document.createTextNode("and continues here");
  cardTail.appendChild(cardTextTail);
  card.appendChild(cardTail);
  root.appendChild(card);
  const otherCard = document.createElement("div");
  otherCard.setAttribute("data-uuid", "card-2");
  const otherCardText = document.createTextNode("a different card's text");
  otherCard.appendChild(otherCardText);
  root.appendChild(otherCard);
  const bare = document.createElement("div");
  const bareText = document.createTextNode("outside any card");
  bare.appendChild(bareText);
  root.appendChild(bare);
  return { grid: root, cardText, cardTextTail, otherCardText, bareText };
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

  it("returns null when the selection spans two cards", () => {
    const { grid, cardText, otherCardText } = makeGrid();
    const sel = makeSelection({
      anchorNode: cardText,
      focusNode: otherCardText,
      text: "lives here\na different",
    });
    expect(resolveQuoteTarget(sel, grid)).toBeNull();
  });

  it("returns null when the selection extends past the card into bare grid", () => {
    const { grid, cardText, bareText } = makeGrid();
    const sel = makeSelection({
      anchorNode: cardText,
      focusNode: bareText,
      text: "lives here\noutside",
    });
    expect(resolveQuoteTarget(sel, grid)).toBeNull();
  });

  it("resolves when anchor and focus are different nodes of the same card", () => {
    const { grid, cardText, cardTextTail } = makeGrid();
    const sel = makeSelection({
      anchorNode: cardText,
      focusNode: cardTextTail,
      text: "lives here and continues",
    });
    expect(resolveQuoteTarget(sel, grid)?.uuid).toBe("card-1");
  });

  it("returns null for a null selection or root", () => {
    const { grid, cardText } = makeGrid();
    expect(resolveQuoteTarget(null, grid)).toBeNull();
    const sel = makeSelection({ anchorNode: cardText, text: "quoted" });
    expect(resolveQuoteTarget(sel, null)).toBeNull();
  });
});
