/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ------------------------------------------------------------------
        // Government land-information portal palette (light mode, Phase 10).
        // Restrained, document-like. No neon, no dark full-page backgrounds.
        // `navy` is kept as a NAMED scale so existing class names keep working,
        // but every step now maps to a light neutral / muted government blue.
        // ------------------------------------------------------------------
        navy: {
          950: '#f5f7fa', // app background
          900: '#ffffff', // cards / panels
          850: '#ffffff',
          800: '#f1f4f8', // subtle inset
          700: '#e6ebf2', // hover / rails
          600: '#d5dde8', // borders on dark-ish spots
        },
        // Muted government blue
        primary: {
          DEFAULT: '#1e5fa8',
          hover: '#1a5495',
        },
        // Status / accent — muted, print-friendly
        gold: '#b7791f', // amber-700-ish, used for PROTOTYPE / DEMO / warning text
        cyan: {
          DEFAULT: '#0f766e', // muted teal
        },
        ok: '#15803d', // muted green
        warn: '#b45309', // muted amber
        danger: '#b91c1c', // muted red
        info: '#1e5fa8',
        ink: '#1f2937', // dark charcoal text
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        // Subtle, not decorative
        panel: '0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.08)',
        card: '0 1px 2px rgba(15, 23, 42, 0.05)',
      },
    },
  },
  plugins: [],
}
