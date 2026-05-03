import { describe, it, expect } from "vitest";
import {
  buildHeadingTree, sectionRange, applyRename, applyMove, findNode, findParent,
  findNextSibling, findPrevSibling, firstChild,
  applyInsertChild, applyInsertSibling, applyDeleteSection,
  insertChild, insertSibling, insertDangling,
} from "./headingTree";
import { extractHeadings } from "./headings";

describe("buildHeadingTree", () => {
  it("returns virtual root with no children for empty doc", () => {
    const root = buildHeadingTree([]);
    expect(root).toEqual({
      id: "root",
      level: 0,
      text: "",
      line: -1,
      from: -1,
      to: -1,
      children: [],
    });
  });

  it("nests H2 under H1 for flat headings", () => {
    const body = "# Intro\n## Part A\n## Part B";
    const root = buildHeadingTree(extractHeadings(body));
    expect(root.children).toHaveLength(1);
    expect(root.children[0]!.text).toBe("Intro");
    expect(root.children[0]!.children).toHaveLength(2);
    expect(root.children[0]!.children[0]!.text).toBe("Part A");
    expect(root.children[0]!.children[1]!.text).toBe("Part B");
  });

  it("handles deeply nested headings (H1 > H2 > H3 > H4)", () => {
    const body = "# A\n## B\n### C\n#### D";
    const root = buildHeadingTree(extractHeadings(body));
    expect(root.children).toHaveLength(1);
    const h1 = root.children[0]!;
    expect(h1.text).toBe("A");
    expect(h1.children).toHaveLength(1);
    const h2 = h1.children[0]!;
    expect(h2.text).toBe("B");
    expect(h2.children).toHaveLength(1);
    const h3 = h2.children[0]!;
    expect(h3.text).toBe("C");
    expect(h3.children).toHaveLength(1);
    expect(h3.children[0]!.text).toBe("D");
  });

  it("handles mixed levels: H1, H3, H2, H4", () => {
    const body = "# A\n### B\n## C\n#### D";
    const root = buildHeadingTree(extractHeadings(body));
    expect(root.children).toHaveLength(1);
    const h1 = root.children[0]!;
    expect(h1.text).toBe("A");
    expect(h1.children).toHaveLength(2);
    expect(h1.children[0]!.text).toBe("B");
    expect(h1.children[0]!.children).toHaveLength(0);
    expect(h1.children[1]!.text).toBe("C");
    expect(h1.children[1]!.children).toHaveLength(1);
    expect(h1.children[1]!.children[0]!.text).toBe("D");
  });

  it("attaches orphan headings (doc starts with H3) to root", () => {
    const body = "### Orphan\n## Also Orphan\n# Top";
    const root = buildHeadingTree(extractHeadings(body));
    expect(root.children).toHaveLength(3);
    expect(root.children[0]!.text).toBe("Orphan");
    expect(root.children[1]!.text).toBe("Also Orphan");
    expect(root.children[2]!.text).toBe("Top");
  });
});

describe("sectionRange", () => {
  it("H2 section extends from heading start to next same-level heading", () => {
    const body = "# Title\n## A\nA content\n## B\nB content";
    const headings = extractHeadings(body);
    const root = buildHeadingTree(headings);
    const nodeA = root.children[0]!.children[0]!;
    expect(nodeA.text).toBe("A");
    const range = sectionRange(headings, body.length, nodeA);
    expect(range.from).toBe(nodeA.from);
    expect(body.slice(range.from, range.to)).toBe("## A\nA content\n");
  });

  it("last heading's section extends to EOF", () => {
    const body = "# Title\n## Last\nfinal content";
    const headings = extractHeadings(body);
    const root = buildHeadingTree(headings);
    const last = root.children[0]!.children[0]!;
    expect(last.text).toBe("Last");
    const range = sectionRange(headings, body.length, last);
    expect(body.slice(range.from, range.to)).toBe("## Last\nfinal content");
  });

  it("H3 section ends at parent H2 boundary", () => {
    const body = "## A\n### Sub\nsub content\n## B";
    const headings = extractHeadings(body);
    const root = buildHeadingTree(headings);
    const sub = root.children[0]!.children[0]!;
    expect(sub.text).toBe("Sub");
    const range = sectionRange(headings, body.length, sub);
    expect(body.slice(range.from, range.to)).toBe("### Sub\nsub content\n");
  });
});

describe("applyRename", () => {
  it("changes heading text, preserves # prefix and body", () => {
    const body = "# Intro\nSome text\n## Details\nMore text";
    const root = buildHeadingTree(extractHeadings(body));
    const node = root.children[0]!.children[0]!;
    expect(node.text).toBe("Details");
    const result = applyRename(body, node, "New Details");
    expect(result).toBe("# Intro\nSome text\n## New Details\nMore text");
  });

  it("handles heading with inline formatting", () => {
    const body = "## **Bold** heading";
    const root = buildHeadingTree(extractHeadings(body));
    const node = root.children[0]!;
    const result = applyRename(body, node, "Plain heading");
    expect(result).toBe("## Plain heading");
  });
});

describe("findNode", () => {
  it("finds an existing node by ID", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B\n### C"));
    const nodeC = root.children[0]!.children[0]!.children[0]!;
    expect(findNode(root, nodeC.id)).toBe(nodeC);
  });

  it("returns null for a missing ID", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B"));
    expect(findNode(root, "h-999")).toBeNull();
  });
});

describe("findParent", () => {
  it("finds the parent of a nested node", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B\n### C"));
    const nodeB = root.children[0]!.children[0]!;
    const nodeC = nodeB.children[0]!;
    expect(findParent(root, nodeC.id)).toBe(nodeB);
  });

  it("returns root for a top-level heading", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B"));
    const nodeA = root.children[0]!;
    expect(findParent(root, nodeA.id)).toBe(root);
  });

  it("returns null for the root node itself", () => {
    const root = buildHeadingTree(extractHeadings("# A"));
    expect(findParent(root, "root")).toBeNull();
  });
});

describe("applyMove", () => {
  it("reorder: swap two H2 siblings", () => {
    const body = "# Title\n## A\nA body\n## B\nB body";
    const root = buildHeadingTree(extractHeadings(body));
    const nodeB = root.children[0]!.children[1]!;
    expect(nodeB.text).toBe("B");
    const result = applyMove(body, root, nodeB.id, root.children[0]!.id, 0);
    expect(result).toBe("# Title\n## B\nB body\n## A\nA body");
  });

  it("reorder: move last of three siblings to first position", () => {
    const body = "# Title\n## A\nA body\n## B\nB body\n## C\nC body";
    const root = buildHeadingTree(extractHeadings(body));
    const nodeC = root.children[0]!.children[2]!;
    expect(nodeC.text).toBe("C");
    const result = applyMove(body, root, nodeC.id, root.children[0]!.id, 0);
    expect(result).toBe("# Title\n## C\nC body\n## A\nA body\n## B\nB body");
  });

  it("reorder preserves content between headings", () => {
    const body = "# Title\n## A\nLine 1\nLine 2\n## B\nLine 3";
    const root = buildHeadingTree(extractHeadings(body));
    const nodeA = root.children[0]!.children[0]!;
    expect(nodeA.text).toBe("A");
    const result = applyMove(body, root, nodeA.id, root.children[0]!.id, 1);
    expect(result).toBe("# Title\n## B\nLine 3\n## A\nLine 1\nLine 2");
  });

  it("reparent: H2 dropped onto another H2 becomes H3", () => {
    const body = "## A\nA body\n## B\nB body";
    const root = buildHeadingTree(extractHeadings(body));
    const nodeB = root.children[1]!;
    expect(nodeB.text).toBe("B");
    const result = applyMove(body, root, nodeB.id, root.children[0]!.id, 0);
    expect(result).toBe("## A\nA body\n### B\nB body");
  });

  it("reparent: H3 moved to root level becomes top-level heading", () => {
    const body = "## Parent\n### Child\nChild body";
    const root = buildHeadingTree(extractHeadings(body));
    const child = root.children[0]!.children[0]!;
    expect(child.text).toBe("Child");
    const result = applyMove(body, root, child.id, root.id, 1);
    expect(result).toBe("## Parent\n# Child\nChild body");
  });

  it("reparent: deep subtree with level shifts", () => {
    const body = "## A\n## B\n### C\n#### D";
    const root = buildHeadingTree(extractHeadings(body));
    const nodeB = root.children[1]!;
    expect(nodeB.text).toBe("B");
    const result = applyMove(body, root, nodeB.id, root.children[0]!.id, 0);
    expect(result).toBe("## A\n### B\n#### C\n##### D");
  });
});

describe("findNextSibling", () => {
  it("returns the next sibling when one exists", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B\n## C"));
    const nodeB = root.children[0]!.children[0]!;
    const result = findNextSibling(root, nodeB.id);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("C");
  });

  it("returns null for the last sibling", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B\n## C"));
    const nodeC = root.children[0]!.children[1]!;
    expect(findNextSibling(root, nodeC.id)).toBeNull();
  });

  it("returns null for root", () => {
    const root = buildHeadingTree(extractHeadings("# A"));
    expect(findNextSibling(root, "root")).toBeNull();
  });

  it("works for top-level siblings under virtual root", () => {
    const root = buildHeadingTree(extractHeadings("# A\n# B\n# C"));
    const nodeA = root.children[0]!;
    const result = findNextSibling(root, nodeA.id);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("B");
  });
});

describe("findPrevSibling", () => {
  it("returns the previous sibling when one exists", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B\n## C"));
    const nodeC = root.children[0]!.children[1]!;
    const result = findPrevSibling(root, nodeC.id);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("B");
  });

  it("returns null for the first sibling", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B\n## C"));
    const nodeB = root.children[0]!.children[0]!;
    expect(findPrevSibling(root, nodeB.id)).toBeNull();
  });

  it("returns null for root", () => {
    const root = buildHeadingTree(extractHeadings("# A"));
    expect(findPrevSibling(root, "root")).toBeNull();
  });
});

describe("firstChild", () => {
  it("returns first child when children exist", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B\n## C"));
    const nodeA = root.children[0]!;
    const result = firstChild(nodeA);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("B");
  });

  it("returns null for a leaf node", () => {
    const root = buildHeadingTree(extractHeadings("# A\n## B"));
    const nodeB = root.children[0]!.children[0]!;
    expect(firstChild(nodeB)).toBeNull();
  });
});

describe("applyInsertChild", () => {
  it("inserts H2 under H1 with no existing children", () => {
    const body = "# Parent\nSome content";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyInsertChild(body, tree, tree.children[0]!.id, "Child");
    expect(result).toBe("# Parent\nSome content\n## Child");
  });

  it("inserts H2 after existing children", () => {
    const body = "# Parent\n## Existing\nContent";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyInsertChild(body, tree, tree.children[0]!.id, "New Child");
    expect(result).toBe("# Parent\n## Existing\nContent\n## New Child");
  });

  it("inserts H3 under H2", () => {
    const body = "# A\n## B\nB content";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    const result = applyInsertChild(body, tree, nodeB.id, "Sub");
    expect(result).toBe("# A\n## B\nB content\n### Sub");
  });

  it("inserts H1 under virtual root (appended to body)", () => {
    const body = "# Existing\nContent";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyInsertChild(body, tree, "root", "New Top");
    expect(result).toBe("# Existing\nContent\n# New Top");
  });

  it("clamps at H6 (no H7)", () => {
    const body = "###### Deep";
    const tree = buildHeadingTree(extractHeadings(body));
    const node = tree.children[0]!;
    const result = applyInsertChild(body, tree, node.id, "Deeper");
    expect(result).toBe("###### Deep\n###### Deeper");
  });

  it("returns body unchanged when parentId not found", () => {
    const body = "# A";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyInsertChild(body, tree, "h-999", "Ghost");
    expect(result).toBe(body);
  });

  it("preserves trailing newline", () => {
    const body = "# A\n";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyInsertChild(body, tree, tree.children[0]!.id, "B");
    expect(result).toContain("## B");
    expect(result.indexOf("# A")).toBe(0);
  });
});

describe("applyInsertSibling", () => {
  it("inserts after middle sibling", () => {
    const body = "# A\n## B\nB body\n## C\nC body";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    const result = applyInsertSibling(body, tree, nodeB.id, "New");
    expect(result).toBe("# A\n## B\nB body\n## New\n## C\nC body");
  });

  it("inserts after last sibling", () => {
    const body = "# A\n## B\nB body";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    const result = applyInsertSibling(body, tree, nodeB.id, "New");
    expect(result).toBe("# A\n## B\nB body\n## New");
  });

  it("inserts H1 sibling under root", () => {
    const body = "# A\nContent";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeA = tree.children[0]!;
    const result = applyInsertSibling(body, tree, nodeA.id, "B");
    expect(result).toBe("# A\nContent\n# B");
  });

  it("preserves reference node's level", () => {
    const body = "# A\n### B\nB content";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    expect(nodeB.level).toBe(3);
    const result = applyInsertSibling(body, tree, nodeB.id, "C");
    expect(result).toContain("### C");
  });

  it("returns body unchanged when siblingId not found", () => {
    const body = "# A";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyInsertSibling(body, tree, "h-999", "Ghost");
    expect(result).toBe(body);
  });
});

describe("applyDeleteSection", () => {
  it("deletes leaf H2 with content", () => {
    const body = "# Title\n## A\nA content\n## B\nB content";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeA = tree.children[0]!.children[0]!;
    const result = applyDeleteSection(body, tree, nodeA.id);
    expect(result).toBe("# Title\n## B\nB content");
  });

  it("deletes parent + all children", () => {
    const body = "# Title\n## Parent\n### Child\nChild content\n## After";
    const tree = buildHeadingTree(extractHeadings(body));
    const parent = tree.children[0]!.children[0]!;
    expect(parent.text).toBe("Parent");
    const result = applyDeleteSection(body, tree, parent.id);
    expect(result).toBe("# Title\n## After");
  });

  it("deletes only heading when that's all there is", () => {
    const body = "# Only";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyDeleteSection(body, tree, tree.children[0]!.id);
    expect(result).toBe("");
  });

  it("deletes last heading, preserving content before it", () => {
    const body = "Some intro\n# Heading\nHeading content";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyDeleteSection(body, tree, tree.children[0]!.id);
    expect(result).toBe("Some intro\n");
  });

  it("returns unchanged when nodeId not found", () => {
    const body = "# A\n## B";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyDeleteSection(body, tree, "h-999");
    expect(result).toBe(body);
  });

  it("returns unchanged for root", () => {
    const body = "# A\n## B";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = applyDeleteSection(body, tree, "root");
    expect(result).toBe(body);
  });

  it("does not leave double blank lines after deletion", () => {
    const body = "# A\n\n## B\n\n## C";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    const result = applyDeleteSection(body, tree, nodeB.id);
    expect(result).not.toContain("\n\n\n");
  });
});

describe("insertChild", () => {
  it("returns { body, nodeId } for H1→H2", () => {
    const body = "# Parent\nSome content";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = insertChild(body, tree, tree.children[0]!.id, "Child");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("# Parent\nSome content\n## Child");
    expect(result!.nodeId).toBe("h-2");
  });

  it("returns correct nodeId for H2→H3", () => {
    const body = "# A\n## B\nB content";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    const result = insertChild(body, tree, nodeB.id, "Sub");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("# A\n## B\nB content\n### Sub");
    expect(result!.nodeId).toBe("h-3");
  });

  it("returns correct nodeId for root→H1", () => {
    const body = "# Existing\nContent";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = insertChild(body, tree, "root", "New Top");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("# Existing\nContent\n# New Top");
    expect(result!.nodeId).toBe("h-2");
  });

  it("nodeId line matches actual heading line in output body", () => {
    const body = "# Parent\n## Existing\nContent";
    const tree = buildHeadingTree(extractHeadings(body));
    const result = insertChild(body, tree, tree.children[0]!.id, "New Child");
    expect(result).not.toBeNull();
    const newTree = buildHeadingTree(extractHeadings(result!.body));
    const inserted = findNode(newTree, result!.nodeId);
    expect(inserted).not.toBeNull();
    expect(inserted!.text).toBe("New Child");
  });

  it("returns null for unknown parentId", () => {
    const body = "# A";
    const tree = buildHeadingTree(extractHeadings(body));
    expect(insertChild(body, tree, "h-999", "Ghost")).toBeNull();
  });

  it("clamps at H6", () => {
    const body = "###### Deep";
    const tree = buildHeadingTree(extractHeadings(body));
    const node = tree.children[0]!;
    const result = insertChild(body, tree, node.id, "Deeper");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("###### Deep\n###### Deeper");
  });
});

describe("insertSibling", () => {
  it("returns correct { body, nodeId } for middle sibling", () => {
    const body = "# A\n## B\nB body\n## C\nC body";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    const result = insertSibling(body, tree, nodeB.id, "New");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("# A\n## B\nB body\n## New\n## C\nC body");
    expect(result!.nodeId).toBe("h-3");
  });

  it("returns correct { body, nodeId } for last sibling", () => {
    const body = "# A\n## B\nB body";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    const result = insertSibling(body, tree, nodeB.id, "New");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("# A\n## B\nB body\n## New");
    expect(result!.nodeId).toBe("h-3");
  });

  it("nodeId matches actual heading in rebuilt tree", () => {
    const body = "# A\n## B\nB body\n## C\nC body";
    const tree = buildHeadingTree(extractHeadings(body));
    const nodeB = tree.children[0]!.children[0]!;
    const result = insertSibling(body, tree, nodeB.id, "New");
    expect(result).not.toBeNull();
    const newTree = buildHeadingTree(extractHeadings(result!.body));
    const inserted = findNode(newTree, result!.nodeId);
    expect(inserted).not.toBeNull();
    expect(inserted!.text).toBe("New");
  });

  it("returns null for unknown siblingId", () => {
    const body = "# A";
    const tree = buildHeadingTree(extractHeadings(body));
    expect(insertSibling(body, tree, "h-999", "Ghost")).toBeNull();
  });
});

describe("insertDangling", () => {
  it("appends H2 at end and returns correct nodeId", () => {
    const body = "# Title\nSome content";
    const result = insertDangling(body, 2, "Untitled");
    expect(result.body).toBe("# Title\nSome content\n## Untitled");
    expect(result.nodeId).toBe("h-2");
  });

  it("works on empty body", () => {
    const result = insertDangling("", 2, "Untitled");
    expect(result.body).toBe("## Untitled");
    expect(result.nodeId).toBe("h-0");
  });

  it("nodeId matches actual heading in rebuilt tree", () => {
    const body = "# A\n## B";
    const result = insertDangling(body, 2, "New");
    const newTree = buildHeadingTree(extractHeadings(result.body));
    const inserted = findNode(newTree, result.nodeId);
    expect(inserted).not.toBeNull();
    expect(inserted!.text).toBe("New");
  });
});
