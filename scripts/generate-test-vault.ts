#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "quantum", "neural", "graph", "topology", "fractal", "entropy", "lambda",
  "syntax", "kernel", "lattice", "manifold", "tensor", "vector", "matrix",
  "algebra", "calculus", "geometry", "logic", "theory", "proof", "lemma",
  "axiom", "thesis", "model", "pattern", "signal", "field", "group", "ring",
  "space", "orbit", "flow", "wave", "node", "edge", "path", "tree", "cycle",
];

const SENTENCES = [
  "This note explores the relationship between concepts.",
  "Further research is needed to understand the implications.",
  "The underlying structure reveals interesting patterns.",
  "Several approaches have been proposed in the literature.",
  "We observe a connection to related topics.",
];

function generateTitle(rng: () => number): string {
  const w1 = WORDS[Math.floor(rng() * WORDS.length)]!;
  const w2 = WORDS[Math.floor(rng() * WORDS.length)]!;
  return `${w1[0]!.toUpperCase()}${w1.slice(1)} ${w2}`;
}

function main() {
  const nodeCount = parseInt(process.argv[2] ?? "1000", 10);
  const outputDir = process.argv[3] ?? `./test-vault-${nodeCount}`;
  const seed = 42;
  const edgeDensity = 3;

  const rng = mulberry32(seed);

  const titles: string[] = [];
  const filenames: string[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const title = `${generateTitle(rng)} ${i}`;
    titles.push(title);
    filenames.push(`${title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/ +/g, "-")}.md`);
  }

  mkdirSync(outputDir, { recursive: true });

  for (let i = 0; i < nodeCount; i++) {
    const linkCount = Math.round(edgeDensity + (rng() - 0.5) * 2);
    const links: string[] = [];
    for (let j = 0; j < linkCount; j++) {
      const target = Math.floor(rng() * nodeCount);
      if (target !== i) {
        links.push(`[[${titles[target]}]]`);
      }
    }

    const body = [
      `---`,
      `title: "${titles[i]}"`,
      `---`,
      ``,
      SENTENCES[Math.floor(rng() * SENTENCES.length)],
      ``,
      `## Links`,
      ``,
      ...links.map((l) => `- ${l}`),
      ``,
      SENTENCES[Math.floor(rng() * SENTENCES.length)],
      ``,
    ].join("\n");

    writeFileSync(join(outputDir, filenames[i]!), body);
  }

  console.log(`Generated ${nodeCount} notes in ${outputDir}`);
}

main();
