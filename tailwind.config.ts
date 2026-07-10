import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/renderer/index.html',
    './src/renderer/cover.html',
    './src/renderer/overlay.html',
    './src/renderer/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        line: 'var(--line)',
        accent: 'var(--accent)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
      },
      fontSize: {
        xs: ['11px', '15px'],
        sm: ['13px', '18px'],
        base: ['15px', '21px'],
        lg: ['18px', '24px'],
        xl: ['20px', '26px'],
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '5px',
        md: '6px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.04)',
        pop: '0 4px 16px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
