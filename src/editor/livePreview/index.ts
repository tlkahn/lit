import type { Extension } from "@codemirror/state";
import { livePreviewPlugin, blockReplacementField } from "./plugin";
import { createLinkClickHandler } from "./linkHandler";
import { livePreviewBaseTheme } from "./theme";
import { imageResolverFacet, type ImageResolver } from "./imageResolver";
import { calloutFoldField } from "./callout";
import { openUrl as defaultOpenUrl } from "@tauri-apps/plugin-opener";

export interface LivePreviewConfig {
  openUrl?: (url: string) => void;
  resolveImageSrc?: ImageResolver;
}

export function livePreviewExtension(config?: LivePreviewConfig): Extension {
  const openUrl = config?.openUrl ?? defaultOpenUrl;
  const exts: Extension[] = [
    livePreviewPlugin,
    blockReplacementField,
    createLinkClickHandler(openUrl),
    livePreviewBaseTheme,
    calloutFoldField,
  ];
  if (config?.resolveImageSrc) {
    exts.push(imageResolverFacet.of(config.resolveImageSrc));
  }
  return exts;
}
