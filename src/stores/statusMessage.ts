import { create } from "zustand";

export type StatusVariant = "success" | "error" | "progress" | "info";

export interface StatusAction {
  label: string;
  onClick: () => void;
}

export interface StatusMessageState {
  message: string | null;
  variant: StatusVariant;
  action: StatusAction | null;
  show: (message: string, variant?: StatusVariant, durationMs?: number, action?: StatusAction) => void;
}

let timerId: ReturnType<typeof setTimeout> | null = null;

export const useStatusMessageStore = create<StatusMessageState>((set) => ({
  message: null,
  variant: "success",
  action: null,
  show: (message, variant = "success", durationMs = 4000, action) => {
    if (timerId != null) clearTimeout(timerId);
    set({ message, variant, action: action ?? null });
    timerId = setTimeout(() => {
      set({ message: null, action: null });
      timerId = null;
    }, durationMs);
  },
}));
