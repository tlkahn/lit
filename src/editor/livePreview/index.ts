import type { Extension } from "@codemirror/state";
import { livePreviewPlugin, blockReplacementField } from "./plugin";
import { createLinkClickHandler } from "./linkHandler";
import { createWikilinkClickHandler, type NavigateToPage } from "./wikilinkHandler";
import { livePreviewBaseTheme } from "./theme";
import { imageResolverFacet, type ImageResolver } from "./imageResolver";
import { navigateToPageFacet } from "./navigateToPageFacet";
import { calloutFoldField } from "./callout";
import { createCalloutClickHandler } from "./calloutClickHandler";
import { createMathClickHandler } from "./mathClickHandler";
import { createImageClickHandler } from "./imageClickHandler";
import { createLinkSelectHandler } from "./linkSelectHandler";
import { createWrappedLineClickFix } from "./clickFix";
import { crossrefExtension } from "./crossref";
import { citeprocExtension } from "./citeproc";
import { citationClickExtension } from "./citationClickHandler";
import { createAnnotationInputHandler } from "./annotationInputHandler";
import { autocompletion } from "@codemirror/autocomplete";
import { crossrefCompletionSource } from "./crossrefCompletion";
import { wikilinkCompletionSource } from "./wikilinkCompletion";
import { annotationCompletionSource } from "./annotationCompletion";
import { footnoteTooltipExtension } from "./footnoteTooltip";
import { openUrl as defaultOpenUrl } from "@tauri-apps/plugin-opener";

export { frontmatterFacet } from "./crossref";
export { noteDirFacet } from "./citeproc";
export { mediaThumbnailsFacet } from "./mediaThumbnails";
export { navigateToPageFacet } from "./navigateToPageFacet";

export interface LivePreviewConfig {
  openUrl?: (url: string) => void;
  openFilePath?: (path: string) => void;
  resolveImageSrc?: ImageResolver;
  navigateToPage?: NavigateToPage;
}

export function livePreviewExtension(config?: LivePreviewConfig): Extension {
  const openUrl = config?.openUrl ?? defaultOpenUrl;
  const exts: Extension[] = [
    livePreviewPlugin,
    blockReplacementField,
    createLinkClickHandler({ openUrl, openFilePath: config?.openFilePath }),
    ...(config?.navigateToPage ? [createWikilinkClickHandler(config.navigateToPage)] : []),
    createCalloutClickHandler(),
    createMathClickHandler(),
    createImageClickHandler(),
    createLinkSelectHandler(),
    createWrappedLineClickFix(),
    livePreviewBaseTheme,
    calloutFoldField,
    crossrefExtension(),
    citeprocExtension(),
    citationClickExtension(),
    createAnnotationInputHandler(),
    autocompletion({ override: [crossrefCompletionSource, wikilinkCompletionSource, annotationCompletionSource] }),
    footnoteTooltipExtension(),
  ];
  if (config?.resolveImageSrc) {
    exts.push(imageResolverFacet.of(config.resolveImageSrc));
  }
  if (config?.navigateToPage) {
    exts.push(navigateToPageFacet.of(config.navigateToPage));
  }
  return exts;
}
