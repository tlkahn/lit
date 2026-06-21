import { useState, useEffect, useLayoutEffect, useRef } from "react";

export interface OverflowMenuConfig {
  /** Anchor direction for the menu relative to the trigger button.
   *  "below-right" (default): menu appears below, right-aligned with trigger.
   *  "above-left": menu appears above, left-aligned with trigger.
   */
  anchor?: "below-right" | "above-left";
  /** Whether to close the menu on scroll events. Defaults to true. */
  dismissOnScroll?: boolean;
  /** Whether to reposition on window resize. Defaults to false. */
  onResize?: boolean;
  /** Extra dependencies for the positioning useLayoutEffect. */
  extraDeps?: unknown[];
}

export function useOverflowMenu(config?: OverflowMenuConfig) {
  const anchor = config?.anchor ?? "below-right";
  const dismissOnScroll = config?.dismissOnScroll ?? true;
  const onResize = config?.onResize ?? false;
  const extraDeps = config?.extraDeps ?? [];

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    if (dismissOnScroll) {
      const handleScroll = () => setOpen(false);
      window.addEventListener("scroll", handleScroll, true);
      return () => {
        document.removeEventListener("mousedown", handleClick);
        document.removeEventListener("keydown", handleKey);
        window.removeEventListener("scroll", handleScroll, true);
      };
    }
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, dismissOnScroll]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return;
    const position = () => {
      if (!menuRef.current || !triggerRef.current) return;
      const btnRect = triggerRef.current.getBoundingClientRect();
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left: number;
      let top: number;
      if (anchor === "above-left") {
        left = btnRect.left;
        top = btnRect.top - rect.height - 4;
      } else {
        left = btnRect.right - rect.width;
        top = btnRect.bottom + 4;
      }
      if (left + rect.width > vw) left = vw - rect.width;
      if (top + rect.height > vh) top = vh - rect.height;
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    position();
    if (onResize) {
      window.addEventListener("resize", position);
      return () => window.removeEventListener("resize", position);
    }
  }, [open, anchor, onResize, ...extraDeps]);

  return { open, setOpen, triggerRef, menuRef };
}
