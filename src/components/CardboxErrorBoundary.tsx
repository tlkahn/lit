import { Component } from "react";
import type { ReactNode } from "react";
import { useCardboxStore } from "../stores/cardbox";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class CardboxErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  handleReload = () => {
    // Reset store state and re-fetch
    useCardboxStore.setState({
      annotations: [],
      expandedUuid: null,
      loading: false,
      searchQuery: "",
      activeTypes: null,
      activeColors: null,
      order: [],
      links: [],
      pinned: [],
      colors: {},
      connectionsForUuid: null,
      connectionsSavedFilters: null,
    });
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-text-faint">
          <p>Something went wrong in the Cardbox view.</p>
          <button
            onClick={this.handleReload}
            className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-text-on-accent hover:opacity-90"
            data-testid="cardbox-reload"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
