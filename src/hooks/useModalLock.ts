import { useEffect } from "react";
import { useModalLockStore } from "../stores/modalLock";

export function useModalLock(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return;
    useModalLockStore.getState().increment();
    return () => useModalLockStore.getState().decrement();
  }, [isOpen]);
}
