import React from 'react';

export interface SovraBrandLogoProps {
  size?: number;
  showIcon?: boolean;
  showWordmark?: boolean;
  showPill?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * SovraBrandLogo
 * YouTube-Grade Typography Wordmark with S-Monogram for App Icon Exclusive Deployment.
 */
export const SovraBrandLogo: React.FC<SovraBrandLogoProps> = ({
  size = 34,
  showIcon = false,
  showWordmark = true,
  showPill = true,
  onClick,
  style,
}) => {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.22),
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        ...style,
      }}
    >
      {/* 3D Glassmorphic Obsidian Emblem (App Icon Exclusive) */}
      {showIcon && (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.26),
            background: 'linear-gradient(135deg, #080e1e 0%, #050811 50%, #020409 100%)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            boxShadow: '0 2px 10px rgba(56, 189, 248, 0.2), 0 0 15px rgba(99, 102, 241, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <svg
            viewBox="0 0 512 512"
            width={Math.round(size * 0.82)}
            height={Math.round(size * 0.82)}
            style={{ display: 'block' }}
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="logoCenterGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.45" />
                <stop offset="45%" stopColor="#00f0ff" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="logoSUpper" x1="10%" y1="0%" x2="90%" y2="100%">
                <stop offset="0%" stopColor="#00f5ff" />
                <stop offset="45%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
              <linearGradient id="logoSLower" x1="10%" y1="0%" x2="90%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="45%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#f43f5e" />
              </linearGradient>
              <linearGradient id="logoSpecCore" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="40%" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#c084fc" stopOpacity="0.8" />
              </linearGradient>
            </defs>

            {/* Ambient Center Aura */}
            <circle cx="256" cy="256" r="195" fill="url(#logoCenterGlow)" />

            {/* S Ribbon Curves */}
            <path
              d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275"
              fill="none"
              stroke="url(#logoSUpper)"
              strokeWidth="74"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
              fill="none"
              stroke="url(#logoSLower)"
              strokeWidth="74"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 335 195 C 335 135 300 110 256 110 C 195 110 165 145 165 195 C 165 240 215 260 256 275 C 298 290 347 310 347 355 C 347 405 315 440 256 440 C 200 440 165 415 165 360"
              fill="none"
              stroke="url(#logoSpecCore)"
              strokeWidth="13"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.95"
            />

            {/* Terminal Mesh Nodes */}
            <circle cx="335" cy="195" r="10" fill="#00f5ff" />
            <circle cx="335" cy="195" r="5" fill="#ffffff" />
            <circle cx="165" cy="360" r="10" fill="#f43f5e" />
            <circle cx="165" cy="360" r="5" fill="#ffffff" />
          </svg>
        </div>
      )}

      {/* Typography: YouTube-Style SOVRA Wordmark & Subscript Pill */}
      {showWordmark && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              fontFamily:
                "'YouTube Sans', 'Oswald', 'Roboto Condensed', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              fontSize: Math.round(size * 0.68),
              fontWeight: 700,
              letterSpacing: -0.8,
              color: '#ffffff',
              lineHeight: 1,
              textTransform: 'uppercase',
            }}
          >
            SOVRA
          </span>

          {showPill && (
            <span
              style={{
                fontFamily:
                  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                fontSize: Math.max(9, Math.round(size * 0.24)),
                fontWeight: 700,
                letterSpacing: 0.5,
                padding: '1px 5px',
                borderRadius: 3,
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                color: '#aaaaaa',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                lineHeight: 1.1,
                verticalAlign: 'super',
                marginTop: -4,
                textTransform: 'uppercase',
              }}
            >
              MESH
            </span>
          )}
        </div>
      )}
    </div>
  );
};
