/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Route line" palette — grounded in the product's actual job
        // (routing a visitor from A to B), not a generic SaaS blue/purple.
        // Deliberately NOT the cream+terracotta or near-black+neon
        // defaults; a cool paper background keeps long tables of links
        // legible, ink is a true near-black-navy (not tinted #111), and
        // signal blue is used sparingly as the one accent.
        paper: {
          DEFAULT: '#F5F6F8',
          raised: '#FFFFFF',
        },
        ink: {
          DEFAULT: '#12172B',
          muted: '#5B6178',
          faint: '#9498A8',
        },
        line: {
          DEFAULT: '#E4E6EC',
        },
        signal: {
          DEFAULT: '#2456F5',
          hover: '#1D46D6',
          faint: '#EAEFFE',
        },
        coral: {
          DEFAULT: '#EF5A45',
          faint: '#FDECE9',
        },
        moss: {
          DEFAULT: '#1E9E6B',
          faint: '#E7F6EF',
        },
        amber: {
          DEFAULT: '#C7841D',
          faint: '#FBF1E1',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      maxWidth: {
        prose: '38rem', // ~ <80ch for body copy
      },
      keyframes: {
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateY(-6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'slide-in': 'slide-in 240ms ease-out',
      },
    },
  },
  plugins: [],
};
