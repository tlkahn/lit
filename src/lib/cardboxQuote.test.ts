import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveQuoteTarget, expandSelectionToCardText } from "./cardboxQuote";

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

describe("expandSelectionToCardText", () => {
  // A grid with one card exposing the three selectable text containers ⌘A
  // must expand into (mirroring the #root user-select opt-ins), plus bare
  // text outside any of them.
  function makeSelectableGrid() {
    root = document.createElement("div");
    document.body.appendChild(root);
    const card = document.createElement("div");
    card.setAttribute("data-uuid", "card-1");
    const prose = document.createElement("div");
    prose.className = "prose";
    const proseText = document.createTextNode("prose body text");
    prose.appendChild(proseText);
    card.appendChild(prose);
    const original = document.createElement("div");
    original.setAttribute("data-testid", "card-original");
    const originalText = document.createTextNode("source excerpt text");
    original.appendChild(originalText);
    card.appendChild(original);
    root.appendChild(card);
    const groupName = document.createElement("span");
    groupName.className = "group-name";
    const groupNameText = document.createTextNode("Group title");
    groupName.appendChild(groupNameText);
    root.appendChild(groupName);
    const bare = document.createElement("div");
    const bareText = document.createTextNode("bare grid text");
    bare.appendChild(bareText);
    root.appendChild(bare);
    return { grid: root, prose, proseText, original, originalText, groupName, groupNameText, bareText };
  }

  function makeExpandable(overrides: { anchorNode: Node | null; collapsed?: boolean }) {
    const removeAllRanges = vi.fn();
    const addRange = vi.fn();
    const sel = {
      isCollapsed: overrides.collapsed ?? false,
      anchorNode: overrides.anchorNode,
      removeAllRanges,
      addRange,
    } as unknown as Selection;
    return { sel, removeAllRanges, addRange };
  }

  function expectExpandedTo(addRange: ReturnType<typeof vi.fn>, container: Node, text: string) {
    expect(addRange).toHaveBeenCalledTimes(1);
    const range = addRange.mock.calls[0]![0] as Range;
    expect(range.startContainer).toBe(container);
    expect(range.endContainer).toBe(container);
    expect(range.toString()).toBe(text);
  }

  it("expands a selection anchored in the note prose to the whole .prose container", () => {
    const { grid, prose, proseText } = makeSelectableGrid();
    const { sel, removeAllRanges, addRange } = makeExpandable({ anchorNode: proseText });
    expect(expandSelectionToCardText(sel, grid)).toBe(true);
    expect(removeAllRanges).toHaveBeenCalledTimes(1);
    expectExpandedTo(addRange, prose, "prose body text");
    expect(removeAllRanges.mock.invocationCallOrder[0]!).toBeLessThan(
      addRange.mock.invocationCallOrder[0]!,
    );
  });

  it("expands a selection anchored in the source excerpt to the card-original container", () => {
    const { grid, original, originalText } = makeSelectableGrid();
    const { sel, addRange } = makeExpandable({ anchorNode: originalText });
    expect(expandSelectionToCardText(sel, grid)).toBe(true);
    expectExpandedTo(addRange, original, "source excerpt text");
  });

  it("expands a selection anchored in a group name to the .group-name container", () => {
    const { grid, groupName, groupNameText } = makeSelectableGrid();
    const { sel, addRange } = makeExpandable({ anchorNode: groupNameText });
    expect(expandSelectionToCardText(sel, grid)).toBe(true);
    expectExpandedTo(addRange, groupName, "Group title");
  });

  it("returns false for a null selection", () => {
    const { grid } = makeSelectableGrid();
    expect(expandSelectionToCardText(null, grid)).toBe(false);
  });

  it("returns false and leaves a collapsed selection untouched", () => {
    const { grid, proseText } = makeSelectableGrid();
    const { sel, removeAllRanges, addRange } = makeExpandable({ anchorNode: proseText, collapsed: true });
    expect(expandSelectionToCardText(sel, grid)).toBe(false);
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(addRange).not.toHaveBeenCalled();
  });

  it("returns false when the anchor is outside the root", () => {
    const { grid } = makeSelectableGrid();
    const outside = document.createElement("div");
    outside.className = "prose";
    const outsideText = document.createTextNode("elsewhere");
    outside.appendChild(outsideText);
    document.body.appendChild(outside);
    try {
      const { sel, removeAllRanges, addRange } = makeExpandable({ anchorNode: outsideText });
      expect(expandSelectionToCardText(sel, grid)).toBe(false);
      expect(removeAllRanges).not.toHaveBeenCalled();
      expect(addRange).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it("returns false when the anchor is in the root but outside any selectable container", () => {
    const { grid, bareText } = makeSelectableGrid();
    const { sel, removeAllRanges, addRange } = makeExpandable({ anchorNode: bareText });
    expect(expandSelectionToCardText(sel, grid)).toBe(false);
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(addRange).not.toHaveBeenCalled();
  });

  it("is idempotent: a selection already spanning the container expands again", () => {
    // After a first ⌘A the anchor sits on the container element itself; a
    // repeat press must still report true so it never falls through to
    // card multi-select.
    const { grid, prose } = makeSelectableGrid();
    const { sel, addRange } = makeExpandable({ anchorNode: prose });
    expect(expandSelectionToCardText(sel, grid)).toBe(true);
    expectExpandedTo(addRange, prose, "prose body text");
  });
});
