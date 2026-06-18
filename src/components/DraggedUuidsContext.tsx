import { createContext, useContext } from "react";

const EMPTY_SET = new Set<string>();
export const DraggedUuidsContext = createContext<Set<string>>(EMPTY_SET);
export function useDraggedUuids() { return useContext(DraggedUuidsContext); }
