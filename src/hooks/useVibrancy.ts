import { useEffect, useRef } from "react";
import { usePreferencesStore } from "../stores/preferences";
import { setWindowVibrancy, getReduceTransparency } from "../lib/ipc";
import type { Theme } from "./useTheme";

const LIGHT_PRIMARY_ALPHA_AT_100 = 0.82;
const LIGHT_SECONDARY_ALPHA_AT_100 = 0.72;
const DARK_PRIMARY_ALPHA_AT_100 = 0.85;
const DARK_SECONDARY_ALPHA_AT_100 = 0.75;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function useVibrancy(theme: Theme) {
  const intensity = usePreferencesStore((s) => s.vibrancyIntensity);
  const reduceTransparency = useRef(false);
  const appliedIntensity = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    getReduceTransparency()
      .then((val) => {
        if (!cancelled) reduceTransparency.current = val;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const effective = reduceTransparency.current ? 0 : intensity;
    const root = document.documentElement;

    if (effective <= 0) {
      root.classList.remove("vibrancy-active");
      root.style.removeProperty("--vibrancy-intensity");
      root.style.removeProperty("--vibrancy-primary-alpha");
      root.style.removeProperty("--vibrancy-secondary-alpha");
      if (appliedIntensity.current > 0) {
        setWindowVibrancy(0).catch(() => {});
      }
      appliedIntensity.current = 0;
      return;
    }

    const t = effective / 100;
    const primaryAlpha = theme === "dark"
      ? lerp(1, DARK_PRIMARY_ALPHA_AT_100, t)
      : lerp(1, LIGHT_PRIMARY_ALPHA_AT_100, t);
    const secondaryAlpha = theme === "dark"
      ? lerp(1, DARK_SECONDARY_ALPHA_AT_100, t)
      : lerp(1, LIGHT_SECONDARY_ALPHA_AT_100, t);

    root.classList.add("vibrancy-active");
    root.style.setProperty("--vibrancy-intensity", t.toString());
    root.style.setProperty("--vibrancy-primary-alpha", primaryAlpha.toString());
    root.style.setProperty("--vibrancy-secondary-alpha", secondaryAlpha.toString());

    setWindowVibrancy(effective).catch(() => {});
    appliedIntensity.current = effective;
  }, [intensity, theme]);
}
