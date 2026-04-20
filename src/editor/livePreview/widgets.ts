import { WidgetType } from "@codemirror/view";

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "300px";
    img.style.display = "block";
    return img;
  }

  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
