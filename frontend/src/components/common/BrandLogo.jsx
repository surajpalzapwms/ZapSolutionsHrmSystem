// src/components/common/BrandLogo.jsx
// Same idea as the mobile app's CornerLogo: the GENERAL logo is shown
// everywhere, and when a company's admin uploads its own logo (Company
// Profile) that company's logo replaces it — for that company only.
// brand.logoUrl already holds the right one (see utils/brand.js), so every
// screen that uses <BrandLogo /> follows automatically.
// With showName the company name is written next to the logo.
import React from "react";
import { useBrand } from "../../contexts/BrandContext";

const BrandLogo = ({
  className = "h-10 w-auto object-contain",
  showName = false,
  textClassName = "text-gray-800",
}) => {
  const brand = useBrand();
  const name = brand.shortName || brand.name;

  const img = <img src={brand.logoUrl} alt={brand.name} className={className} />;
  if (!showName || !name) return img;

  return (
    <div className="flex items-center justify-center gap-2.5 min-w-0">
      {img}
      {/* A company's own logo usually already carries its name. */}
      {!brand.hasCustomLogo && (
        <span className={`font-semibold truncate ${textClassName}`}>{name}</span>
      )}
    </div>
  );
};

export default BrandLogo;
