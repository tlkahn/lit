import { Facet } from "@codemirror/state";

export type ImageResolver = (src: string) => string[];

export const imageResolverFacet = Facet.define<ImageResolver, ImageResolver>({
  combine: (values) => values[0] ?? ((src: string) => [src]),
});
