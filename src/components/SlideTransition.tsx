import {
  type ReactNode,
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";

export interface SlideTransitionProps {
  viewKey: string;
  direction: "push" | "pop" | "none";
  onTransitionEnd?: () => void;
  children: ReactNode;
}

interface TransitionState {
  previousView: ReactNode;
  previousKey: string;
  activeDirection: "push" | "pop";
}

const DURATION_MS = 200;
const SAFETY_MARGIN_MS = 50;

function panelStyles(
  role: "entering" | "exiting",
  direction: "push" | "pop",
  phase: "start" | "end",
): React.CSSProperties {
  const isPush = direction === "push";
  const isEntering = role === "entering";

  let translateX: string;
  if (phase === "start") {
    if (isEntering) {
      translateX = isPush ? "30%" : "-30%";
    } else {
      translateX = "0%";
    }
  } else {
    if (isEntering) {
      translateX = "0%";
    } else {
      translateX = isPush ? "-30%" : "30%";
    }
  }

  const opacity = phase === "start" && isEntering ? 0 : phase === "end" && !isEntering ? 0 : 1;

  return {
    transform: `translateX(${translateX})`,
    opacity,
  };
}

export function SlideTransition({
  viewKey,
  direction,
  onTransitionEnd,
  children,
}: SlideTransitionProps) {
  const reducedMotion = useReducedMotion();
  const [transition, setTransition] = useState<TransitionState | null>(null);
  const [phase, setPhase] = useState<"start" | "end">("start");
  const prevChildrenRef = useRef<ReactNode>(children);
  const prevKeyRef = useRef(viewKey);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enteringRef = useRef<HTMLDivElement>(null);
  const onTransitionEndRef = useRef(onTransitionEnd);
  onTransitionEndRef.current = onTransitionEnd;

  const completeTransition = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    setTransition(null);
    setPhase("start");
    onTransitionEndRef.current?.();
  }, []);

  useEffect(() => {
    if (viewKey === prevKeyRef.current) {
      prevChildrenRef.current = children;
      return;
    }

    if (direction === "none" || reducedMotion) {
      if (transition) completeTransition();
      prevChildrenRef.current = children;
      prevKeyRef.current = viewKey;
      onTransitionEndRef.current?.();
      return;
    }

    if (transition) {
      completeTransition();
    }

    setTransition({
      previousView: prevChildrenRef.current,
      previousKey: prevKeyRef.current,
      activeDirection: direction,
    });
    setPhase("start");

    prevChildrenRef.current = children;
    prevKeyRef.current = viewKey;
  }, [viewKey, direction, children, reducedMotion, transition, completeTransition]);

  useEffect(() => {
    if (!transition || phase !== "start") return;
    const raf = requestAnimationFrame(() => {
      setPhase("end");
    });
    return () => cancelAnimationFrame(raf);
  }, [transition, phase]);

  useEffect(() => {
    if (!transition || phase !== "end") return;
    safetyTimerRef.current = setTimeout(completeTransition, DURATION_MS + SAFETY_MARGIN_MS);
    return () => {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    };
  }, [transition, phase, completeTransition]);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (
        e.propertyName === "transform" &&
        e.target === enteringRef.current
      ) {
        completeTransition();
      }
    },
    [completeTransition],
  );

  useEffect(() => {
    return () => {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
      }
    };
  }, []);

  if (!transition) {
    return (
      <div className="relative flex flex-1 overflow-hidden">
        <div className="slide-panel">{children}</div>
      </div>
    );
  }

  const dir = transition.activeDirection;
  const transitioning = phase === "end";

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <div
        data-testid="slide-panel-exiting"
        className={`slide-panel${transitioning ? " slide-panel--transitioning" : ""}`}
        style={panelStyles("exiting", dir, phase)}
      >
        {transition.previousView}
      </div>
      <div
        ref={enteringRef}
        data-testid="slide-panel-entering"
        className={`slide-panel${transitioning ? " slide-panel--transitioning" : ""}`}
        style={panelStyles("entering", dir, phase)}
        onTransitionEnd={handleTransitionEnd}
      >
        {children}
      </div>
    </div>
  );
}
