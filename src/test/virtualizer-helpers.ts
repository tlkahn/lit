export function mockScrollContainerDimensions(
  element: HTMLElement,
  height: number,
  width = 1000,
) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: width,
  });
}
