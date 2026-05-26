import { bench, describe } from "vitest";
import { buildGraph } from "./graphLayout";
import { generateSyntheticGraph } from "../test/fixtures/generateGraph";

const SIZES = [1_000, 5_000, 10_000, 20_000] as const;

const datasets = Object.fromEntries(
  SIZES.map((n) => [n, generateSyntheticGraph({ nodeCount: n })] as const),
) as Record<(typeof SIZES)[number], ReturnType<typeof generateSyntheticGraph>>;

describe("buildGraph", () => {
  for (const size of SIZES) {
    const { subgraph } = datasets[size];
    bench(`${size.toLocaleString()} nodes`, () => {
      buildGraph({ subgraph, accentColor: "#0969da" });
    });
  }
});
