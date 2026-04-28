import { Facet } from "@codemirror/state";
import type { NavigateToPage } from "./wikilinkHandler";

export const navigateToPageFacet = Facet.define<NavigateToPage | null, NavigateToPage | null>({
  combine: (values) => values.find((v) => v != null) ?? null,
});
