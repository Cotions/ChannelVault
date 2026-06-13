import { createContext, useContext } from "react";

export const PlayerCtx = createContext(null);
export const usePlayer = () => useContext(PlayerCtx);
