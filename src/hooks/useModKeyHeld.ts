import { useState, useEffect } from "react";

export function useModKeyHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") setHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") setHeld(false);
    };
    const onBlur = () => setHeld(false);

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return held;
}
