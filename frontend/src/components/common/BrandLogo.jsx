// src/components/common/BrandLogo.jsx
// Shows the company logo, or — if no logo is configured — a coloured
// badge with the company's first letter (plus the name when showName is set).
import React from "react";
import { useBrand } from "../../contexts/BrandContext";

const BrandLogo = ({
  className = "h-10 w-auto object-contain",
  showName = false,
  textClassName = "text-gray-800",
  badgeClassName = "h-10 w-10 text-lg",
}) => {
  const brand = useBrand();

  if (brand.logoUrl) {
    return <img src={brand.logoUrl} alt={brand.name} className={className} />;
  }

  const initial = (brand.shortName || brand.name || "H").trim().charAt(0).toUpperCase();
  return (
    <div className="flex items-center justify-center gap-2.5">
      <span
        className={`inline-flex items-center justify-center rounded-lg font-bold text-white shrink-0 ${badgeClassName}`}
        style={{ backgroundColor: brand.primaryColor }}
      >
        {initial}
      </span>
      {showName && (
        <span className={`font-semibold truncate ${textClassName}`}>
          {brand.shortName || brand.name}
        </span>
      )}
    </div>
  );
};

export default BrandLogo;
