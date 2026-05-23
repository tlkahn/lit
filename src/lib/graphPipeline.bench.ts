import { bench, describe } from "vitest";
import { buildGraph } from "./graphLayout";
import { computeDiff, applyDiff, isDiffEmpty } from "./graphDiff";
import { generateSyntheticGraph } from "../test/fixtures/generateGraph";

const SIZES = [500, 1_000, 5_000, 10_000] as const;

const datasets = Object.fromEntries(
  SIZES.map((n) => [n, generateSyntheticGraph({ nodeCount: n })] as const),
) as Record<(typeof SIZES)[number], ReturnType<typeof generateSyntheticGraph>>;

describe("JSON serialize (simulates localStorage write)", () => {
  for (const size of SIZES) {
    const { subgraph, pagerank } = datasets[size];
    const payload = { subgraph, pagerank, timestamp: Date.now() };
    bench(`${size.toLocaleString()} nodes`, () => {
      JSON.stringify(payload);
    });
  }
});

describe("JSON parse (simulates localStorage read)", () => {
  for (const size of SIZES) {
    const { subgraph, pagerank } = datasets[size];
    const raw = JSON.stringify({ subgraph, pagerank, timestamp: Date.now() });
    bench(`${size.toLocaleString()} nodes (${(raw.length / 1024).toFixed(0)} kB)`, () => {
      JSON.parse(raw);
    });
  }
});

describe("buildGraph (Graphology construction)", () => {
  for (const size of SIZES) {
    const { subgraph } = datasets[size];
    bench(`${size.toLocaleString()} nodes`, () => {
      buildGraph({ subgraph, accentColor: "#0969da", stubColor: "#818b98" });
    });
  }
});

describe("computeDiff (no changes — best case)", () => {
  for (const size of SIZES) {
    const { subgraph } = datasets[size];
    const graph = buildGraph({ subgraph, accentColor: "#0969da", stubColor: "#818b98" });
    bench(`${size.toLocaleString()} nodes`, () => {
      const diff = computeDiff(graph, subgraph);
      isDiffEmpty(diff);
    });
  }
});

describe("computeDiff (5% nodes added)", () => {
  for (const size of SIZES) {
    const { subgraph } = datasets[size];
    const graph = buildGraph({ subgraph, accentColor: "#0969da", stubColor: "#818b98" });
    const added = Math.round(size * 0.05);
    const mutated = {
      nodes: [
        ...subgraph.nodes,
        ...Array.from({ length: added }, (_, i) => ({
          id: `new-${i}`,
          title: `New ${i}`,
          is_stub: false,
        })),
      ],
      edges: [
        ...subgraph.edges,
        ...Array.from({ length: added }, (_, i) => [`new-${i}`, subgraph.nodes[i % subgraph.nodes.length]!.id] as [string, string]),
      ],
    };
    bench(`${size.toLocaleString()} nodes + ${added} new`, () => {
      computeDiff(graph, mutated);
    });
  }
});

describe("applyDiff (5% nodes added)", () => {
  for (const size of SIZES) {
    const { subgraph, pagerank } = datasets[size];
    const added = Math.round(size * 0.05);
    const mutated = {
      nodes: [
        ...subgraph.nodes,
        ...Array.from({ length: added }, (_, i) => ({
          id: `new-${i}`,
          title: `New ${i}`,
          is_stub: false,
        })),
      ],
      edges: [
        ...subgraph.edges,
        ...Array.from({ length: added }, (_, i) => [`new-${i}`, subgraph.nodes[i % subgraph.nodes.length]!.id] as [string, string]),
      ],
    };
    const mutatedPagerank = { ...pagerank };
    for (let i = 0; i < added; i++) mutatedPagerank[`new-${i}`] = 0.001;

    bench(`${size.toLocaleString()} nodes + ${added} new`, () => {
      const graph = buildGraph({ subgraph, accentColor: "#0969da", stubColor: "#818b98" });
      const diff = computeDiff(graph, mutated);
      applyDiff(graph, diff, mutatedPagerank, "#0969da", "#818b98");
    });
  }
});

describe("position cache: serialize + deserialize positions", () => {
  for (const size of SIZES) {
    const { subgraph } = datasets[size];
    const graph = buildGraph({ subgraph, accentColor: "#0969da", stubColor: "#818b98" });
    const positions: Record<string, { x: number; y: number }> = {};
    graph.forEachNode((node, attrs) => {
      positions[node] = { x: attrs.x as number, y: attrs.y as number };
    });
    const cached = JSON.stringify({ positions, timestamp: Date.now() });

    bench(`${size.toLocaleString()} nodes roundtrip (${(cached.length / 1024).toFixed(0)} kB)`, () => {
      const raw = JSON.stringify({ positions, timestamp: Date.now() });
      JSON.parse(raw);
    });
  }
});
