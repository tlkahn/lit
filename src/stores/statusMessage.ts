import { create } from "zustand";

export type StatusVariant = "success" | "error";

export interface StatusMessageState {
  message: string | null;
  variant: StatusVariant;
  show: (message: string, variant?: StatusVariant, durationMs?: number) => void;
}

let timerId: ReturnType<typeof setTimeout> | null = null;

export const useStatusMessageStore = create<StatusMessageState>((set) => ({
  message: null,
  variant: "success",
  show: (message, variant = "success", durationMs = 4000) => {
    if (timerId != null) clearTimeout(timerId);
    set({ message, variant });
    timerId = setTimeout(() => {
      set({ message: null });
      timerId = null;
    }, durationMs);
  },
}));
