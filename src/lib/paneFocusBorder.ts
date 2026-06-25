/**
 * Returns the CSS border class for single-pane focus indication.
 *
 * In multi-pane mode, the PaneContainer wrapper owns the focus border,
 * so child panes return an empty string. In single-pane mode, the child
 * pane itself renders the border.
 */
export function singlePaneFocusBorderClass(
  isMultiPane: boolean,
  isFocused: boolean,
): string {
  return isMultiPane
    ? ""
    : `border-t-2 ${isFocused ? "border-interactive-accent" : "border-transparent"}`;
}
