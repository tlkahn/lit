function generateCannedGraph(): {
  nodes: { id: string; title: string; is_stub: boolean }[];
  edges: [string, string][];
  positions: Record<string, { x: number; y: number }>;
} {
  const NODE_COUNT = 50;
  const EDGE_COUNT = 40;
  const nodes: { id: string; title: string; is_stub: boolean }[] = [];
  const positions: Record<string, { x: number; y: number }> = {};

  for (let i = 0; i < NODE_COUNT; i++) {
    const id = `node-${i}.md`;
    nodes.push({ id, title: `Node ${i}`, is_stub: i >= 40 });
    const angle = (2 * Math.PI * i) / NODE_COUNT;
    positions[id] = { x: Math.cos(angle) * 500, y: Math.sin(angle) * 500 };
  }

  const edges: [string, string][] = [];
  for (let i = 0; i < EDGE_COUNT; i++) {
    edges.push([`node-${i}.md`, `node-${(i + 1) % NODE_COUNT}.md`]);
  }

  return { nodes, edges, positions };
}

const canned = generateCannedGraph();

export const ipcStubScript = `(function() {
  const cannedNodes = ${JSON.stringify(canned.nodes)};
  const cannedEdges = ${JSON.stringify(canned.edges)};
  const cannedPositions = ${JSON.stringify(canned.positions)};

  const callbacks = new Map();
  let callbackId = 0;
  const listeners = new Map();

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      if (cmd === 'plugin:event|listen') {
        const id = callbackId++;
        const event = args?.event || 'unknown';
        listeners.set(event, id);
        return Promise.resolve(id);
      }
      if (cmd === 'plugin:event|unlisten') {
        return Promise.resolve();
      }
      if (cmd === 'get_graph_subgraph') {
        return Promise.resolve({
          nodes: cannedNodes,
          edges: cannedEdges,
          pagerank: {},
          positions: cannedPositions,
        });
      }
      if (cmd === 'get_graph_positions') {
        return Promise.resolve(cannedPositions);
      }
      console.warn('[e2e ipc-stub] unhandled command:', cmd, args);
      return Promise.resolve(null);
    },
    transformCallback: function(cb, once) {
      const id = callbackId++;
      callbacks.set(id, { cb: cb, once: !!once });
      return id;
    },
    convertFileSrc: function(path) {
      return 'asset://localhost/' + encodeURIComponent(path);
    },
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function() {},
  };

  window.__E2E_EMIT__ = function(event, payload) {
    const listenerId = listeners.get(event);
    if (listenerId !== undefined) {
      const entry = callbacks.get(listenerId);
      if (entry) {
        entry.cb({ event: event, payload: payload, id: 0, windowLabel: 'main' });
      }
    }
  };
})();`;
