import { Facet } from "@codemirror/state";

export const mediaThumbnailsFacet = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1]! : true),
});
