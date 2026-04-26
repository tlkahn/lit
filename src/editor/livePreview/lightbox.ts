export type LightboxContent =
  | { type: "image"; src: string }
  | { type: "svg"; svg: string };

const LIGHTBOX_CLASS = "cm-media-lightbox";

function removeExisting() {
  document.querySelector(`.${LIGHTBOX_CLASS}`)?.remove();
}

export function showMediaLightbox(content: LightboxContent): void {
  removeExisting();

  const backdrop = document.createElement("div");
  backdrop.className = LIGHTBOX_CLASS;
  backdrop.style.position = "fixed";
  backdrop.style.inset = "0";
  backdrop.style.zIndex = "9999";
  backdrop.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
  backdrop.style.display = "flex";
  backdrop.style.alignItems = "center";
  backdrop.style.justifyContent = "center";
  backdrop.style.cursor = "zoom-out";

  const inner = document.createElement("div");
  inner.style.maxWidth = "90vw";
  inner.style.maxHeight = "90vh";
  inner.style.cursor = "default";

  if (content.type === "image") {
    const img = document.createElement("img");
    img.src = content.src;
    img.style.maxWidth = "90vw";
    img.style.maxHeight = "90vh";
    img.style.objectFit = "contain";
    inner.appendChild(img);
  } else {
    inner.innerHTML = content.svg;
    const svg = inner.querySelector("svg");
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.width = "90vw";
      svg.style.maxHeight = "90vh";
    }
  }

  inner.addEventListener("click", (e) => e.stopPropagation());

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", onKey);

  backdrop.appendChild(inner);
  document.body.appendChild(backdrop);
}
