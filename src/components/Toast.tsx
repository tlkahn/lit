import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
}

export function Toast({ message, visible, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [visible, message, onDismiss]);

  if (!visible) return null;

  return createPortal(
    <div
      data-testid="toast"
      className="fixed top-3 right-3 z-50 rounded border border-border bg-bg-secondary px-4 py-2 text-sm text-text-normal shadow-lg"
    >
      {message}
    </div>,
    document.body,
  );
}
