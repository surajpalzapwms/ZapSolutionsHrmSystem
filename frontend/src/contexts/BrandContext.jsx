// src/contexts/BrandContext.jsx
import { getBrand } from "../utils/brand";

// The brand is fixed (single company), so this just returns it.
export const useBrand = () => getBrand();
