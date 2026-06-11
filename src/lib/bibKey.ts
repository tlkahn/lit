const BIB_PREFIX = "bib:";

export function bibKeyFromNodeId(nodeId: string): string | null {
  return nodeId.startsWith(BIB_PREFIX) ? nodeId.slice(BIB_PREFIX.length) : null;
}
