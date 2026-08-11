// src/components/common/Card.jsx
import React from "react";

const Card = ({
  children,
  title,
  className = "",
  headerClassName = "",
  bodyClassName = "",
  footer,
  footerClassName = "",
  noPadding = false,
  style,
  onClick,
}) => {
  return (
    <div
      className={`bg-white rounded-xl shadow-md border border-gray-200 ${className}`}
      style={style}
      onClick={onClick}
    >
      {title && (
        <div
          className={`px-6 py-4 border-b border-gray-200 ${headerClassName}`}
        >
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        </div>
      )}
      <div className={noPadding ? "" : `p-6 ${bodyClassName}`}>{children}</div>
      {footer && (
        <div
          className={`px-6 py-4 border-t border-gray-200 ${footerClassName}`}
        >
          {footer}
        </div>
      )}
    </div>
  );
};

export default Card;
