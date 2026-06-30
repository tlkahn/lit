import { useState, useCallback, useEffect, useRef } from "react";
import type { FlatRow } from "./useFlatTree";

interface UseTreeKeyboardOptions {
  rows: FlatRow[];
  toggleCollapse: (folderPath: string) => void;
  selectPage: (path: string) => void;
  scrollToIndex: (index: number) => void;
}

export function findParentIndex(rows: FlatRow[], currentIndex: number): number {
  const current = rows[currentIndex];
  if (!current || current.depth === 0) return -1;
  const targetDepth = current.depth - 1;
  for (let i = currentIndex - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.type === "folder" && row.depth === targetDepth) return i;
  }
  return -1;
}

export function useTreeKeyboard({
  rows,
  toggleCollapse,
  selectPage,
  scrollToIndex,
}: UseTreeKeyboardOptions) {
  const [focusedIndex, setFocusedIndexState] = useState(-1);

  // Mirror inputs and the current focus into refs so the returned handlers
  // can keep a stable identity (empty dep arrays). Without this, callers that
  // pass inline closures (e.g. `scrollToIndex: (i) => virtualizer.scrollToIndex(i)`)
  // would get a new handler on every render, and any effect that lists one as
  // a dependency would re-run every commit — an easy path to a render loop.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const toggleCollapseRef = useRef(toggleCollapse);
  toggleCollapseRef.current = toggleCollapse;
  const selectPageRef = useRef(selectPage);
  selectPageRef.current = selectPage;
  const scrollToIndexRef = useRef(scrollToIndex);
  scrollToIndexRef.current = scrollToIndex;
  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;

  useEffect(() => {
    setFocusedIndexState((prev) => {
      if (rows.length === 0) return -1;
      if (prev >= rows.length) return rows.length - 1;
      return prev;
    });
  }, [rows]);

  const setFocusedIndex = useCallback((index: number) => {
    focusedIndexRef.current = index;
    setFocusedIndexState(index);
    if (index >= 0) scrollToIndexRef.current(index);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const r = rowsRef.current;
    if (r.length === 0) return;

    const idx = focusedIndexRef.current < 0 ? 0 : focusedIndexRef.current;
    const row = r[idx];
    if (!row) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex(Math.min(idx + 1, r.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex(Math.max(idx - 1, 0));
        break;
      case "ArrowRight":
        e.preventDefault();
        if (row.type === "folder") {
          if (row.isCollapsed) {
            toggleCollapseRef.current(row.folderPath);
          } else if (idx + 1 < r.length) {
            setFocusedIndex(idx + 1);
          }
        }
        break;
      case "ArrowLeft": {
        e.preventDefault();
        if (row.type === "folder" && !row.isCollapsed) {
          toggleCollapseRef.current(row.folderPath);
        } else {
          const parentIdx = findParentIndex(r, idx);
          if (parentIdx >= 0) setFocusedIndex(parentIdx);
        }
        break;
      }
      case "Enter":
        e.preventDefault();
        if (row.type === "page") {
          selectPageRef.current(row.page.relative_path);
        } else {
          toggleCollapseRef.current(row.folderPath);
        }
        break;
      case "Home":
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case "End":
        e.preventDefault();
        setFocusedIndex(r.length - 1);
        break;
    }
  }, [setFocusedIndex]);

  const handleContainerFocus = useCallback(() => {
    if (focusedIndexRef.current < 0 && rowsRef.current.length > 0) {
      setFocusedIndex(0);
    }
  }, [setFocusedIndex]);

  return { focusedIndex, setFocusedIndex, handleKeyDown, handleContainerFocus };
}
