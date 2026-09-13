import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        jazz: {
          50: '#fff1f3', 100: '#ffe0e5', 200: '#ffc7d0', 300: '#ff9fb0',
          400: '#ff6885', 500: '#f83a60', 600: '#e4002b', 700: '#c00025',
          800: '#9e0724', 900: '#870a23', 950: '#4b000f',
        },
        ink: {
          50: '#f6f7f9', 100: '#eceef2', 200: '#d5d9e2', 300: '#b1b9c9',
          400: '#8793ab', 500: '#687691', 600: '#535f78', 700: '#444e62',
          800: '#3b4353', 900: '#353b47', 950: '#23272f',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.06), 0 1px 3px 0 rgb(16 24 40 / 0.10)',
        pop: '0 12px 32px -8px rgb(16 24 40 / 0.18)',
      },
    },
  },
  plugins: [],
} satisfies Config;
