import { describe, it, expect } from "vitest";
import { buildHeadingTree, sectionRange, applyRename, applyMove, findNode, findParent } from "./headingTree";
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
