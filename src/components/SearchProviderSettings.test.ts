import { describe, it, expect } from "vitest";
import { groupProviders } from "./SearchProviderSettings";
import type { ProviderInfo } from "../lib/ipc";

describe("groupProviders", () => {
  it("groups providers into known categories", () => {
    const providers: ProviderInfo[] = [
      { id: "openalex", label: "OpenAlex", description: "Open catalog", category: "general", needs_api_key: false },
      { id: "pubmed", label: "PubMed", description: "Biomedical", category: "biomedical", needs_api_key: false },
    ];

    const grouped = groupProviders(providers);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.category).toBe("general");
    expect(grouped[0]!.providers).toHaveLength(1);
    expect(grouped[1]!.category).toBe("biomedical");
    expect(grouped[1]!.providers).toHaveLength(1);
  });

  it("places providers with unknown categories into an 'Other' group", () => {
    const providers: ProviderInfo[] = [
      { id: "openalex", label: "OpenAlex", description: "Open catalog", category: "general", needs_api_key: false },
      { id: "custom-engine", label: "Custom Engine", description: "A custom search engine", category: "custom", needs_api_key: true },
    ];

    const grouped = groupProviders(providers);

    // Should have "general" + "other"
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.category).toBe("general");
    expect(grouped[0]!.providers).toHaveLength(1);

    const otherGroup = grouped.find((g) => g.category === "other");
    expect(otherGroup).toBeDefined();
    expect(otherGroup!.label).toBe("Other");
    expect(otherGroup!.providers).toHaveLength(1);
    expect(otherGroup!.providers[0]!.id).toBe("custom-engine");
  });

  it("does not create an 'Other' group when all categories are known", () => {
    const providers: ProviderInfo[] = [
      { id: "openalex", label: "OpenAlex", description: "Open catalog", category: "general", needs_api_key: false },
    ];

    const grouped = groupProviders(providers);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.category).toBe("general");
    expect(grouped.find((g) => g.category === "other")).toBeUndefined();
  });

  it("handles multiple providers with different unknown categories in one 'Other' group", () => {
    const providers: ProviderInfo[] = [
      { id: "a", label: "A", description: "d", category: "novelty", needs_api_key: false },
      { id: "b", label: "B", description: "d", category: "experimental", needs_api_key: false },
    ];

    const grouped = groupProviders(providers);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.category).toBe("other");
    expect(grouped[0]!.label).toBe("Other");
    expect(grouped[0]!.providers).toHaveLength(2);
  });

  it("returns empty array for empty providers list", () => {
    const grouped = groupProviders([]);
    expect(grouped).toHaveLength(0);
  });
});
