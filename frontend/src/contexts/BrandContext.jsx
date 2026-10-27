// src/contexts/BrandContext.jsx
import { useSyncExternalStore } from "react";
import { getBrand, subscribeBrand } from "../utils/brand";

// Re-renders the component whenever the Settings are saved / loaded.
export const useBrand = () => useSyncExternalStore(subscribeBrand, getBrand, getBrand);
