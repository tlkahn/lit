import { useWorkspaceStore } from "../stores/workspace";

export async function withGraphRebuilding<T>(fn: () => Promise<T>): Promise<T> {
  useWorkspaceStore.setState({ graphReady: false });
  try {
    return await fn();
  } finally {
    useWorkspaceStore.setState({ graphReady: true });
  }
}
