export interface SigmaLike {
  kill(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  setSetting(key: string, value: unknown): void;
  refresh(): void;
  getCamera(): { animatedReset(): void; animate(state: Record<string, number>): void };
  getNodeDisplayData(node: string): { x: number; y: number; hidden?: boolean } | undefined;
  framedGraphToViewport(coords: { x: number; y: number }): { x: number; y: number };
}

export interface GraphLike {
  nodes(): string[];
  forEachNode(callback: (node: string, attrs: Record<string, unknown>) => void): void;
  setNodeAttribute(node: string, attr: string, value: unknown): void;
  source(edge: string): string;
  target(edge: string): string;
}
