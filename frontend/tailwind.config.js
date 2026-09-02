/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Government GIS palette (spec section 37)
        navy: {
          950: '#070c16',
          900: '#0b1220',
          850: '#0f1829',
          800: '#141f33',
          700: '#1c2b45',
          600: '#26395c',
        },
        primary: {
          DEFAULT: '#2f6feb',
          hover: '#4784f5',
        },
        gold: '#f2b807',
        cyan: {
          DEFAULT: '#38c9d6',
        },
        ok: '#3fbf7f',
        warn: '#f0a726',
        danger: '#e4566e',
        info: '#4784f5',
        ink: '#e2e7ef',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 14px 40px rgba(0, 0, 0, 0.45)',
      },
    },
  },
  plugins: [],
}
