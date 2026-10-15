import React from 'react';

interface SvhLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
}

export const SvhLogo: React.FC<SvhLogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
}) => {
  // Dimensions map
  const sizeConfig = {
    sm: { height: 32, width: showSubtitle ? 38 : 34 },
    md: { height: 42, width: showSubtitle ? 50 : 44 },
    lg: { height: 56, width: showSubtitle ? 66 : 58 },
    xl: { height: 76, width: showSubtitle ? 90 : 80 },
  };

  const currentSize = sizeConfig[size];

  return (
    <div className={`inline-flex items-center select-none ${className}`}>
      <svg
        viewBox={showSubtitle ? '0 0 500 420' : '0 0 500 350'}
        className="h-auto w-auto transition-transform"
        style={{ height: `${currentSize.height}px` }}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="SVH Arquitectos Logo"
      >
        {/* S Block - Vibrant Green */}
        <rect
          x="15"
          y="15"
          width="145"
          height="315"
          rx="6"
          fill="#1ca330"
        />
        <text
          x="87"
          y="230"
          textAnchor="middle"
          fill="#ffffff"
          fontFamily="'Playfair Display', 'Georgia', 'Times New Roman', serif"
          fontSize="155"
          fontWeight="bold"
        >
          S
        </text>

        {/* V Block - Fresh Lime Yellow-Green */}
        <rect
          x="177"
          y="15"
          width="145"
          height="315"
          rx="6"
          fill="#98d52c"
        />
        <text
          x="250"
          y="230"
          textAnchor="middle"
          fill="#ffffff"
          fontFamily="'Playfair Display', 'Georgia', 'Times New Roman', serif"
          fontSize="155"
          fontWeight="bold"
        >
          V
        </text>

        {/* H Block - Vibrant Green */}
        <rect
          x="340"
          y="15"
          width="145"
          height="315"
          rx="6"
          fill="#1ca330"
        />
        <text
          x="412"
          y="230"
          textAnchor="middle"
          fill="#ffffff"
          fontFamily="'Playfair Display', 'Georgia', 'Times New Roman', serif"
          fontSize="155"
          fontWeight="bold"
        >
          H
        </text>

        {/* ARQUITECTOS Subtitle */}
        {showSubtitle && (
          <text
            x="250"
            y="395"
            textAnchor="middle"
            fill="#0f172a"
            fontFamily="'Playfair Display', 'Georgia', 'Times New Roman', serif"
            fontSize="41"
            fontWeight="bold"
            letterSpacing="0.44em"
          >
            ARQUITECTOS
          </text>
        )}
      </svg>
    </div>
  );
};

export default SvhLogo;
