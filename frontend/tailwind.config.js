/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ------------------------------------------------------------------
        // "Cadastral Instrument" design system. Every token below is backed
        // by a CSS custom property (defined in src/index.css) that carries a
        // different value under :root and .dark — so a single edit in
        // index.css re-themes the whole app, and no component needs a
        // dark: variant of its own to participate in theming.
        // ------------------------------------------------------------------
        paper: 'rgb(var(--color-paper) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          2: 'rgb(var(--color-surface-2) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
        },
        // Neutral scale used throughout the app (text-slate-900, border-slate-200,
        // bg-slate-50, ...). Re-mapped to CSS vars so every existing usage keeps
        // working unchanged and flips automatically between themes.
        slate: {
          50: 'rgb(var(--slate-50) / <alpha-value>)',
          100: 'rgb(var(--slate-100) / <alpha-value>)',
          200: 'rgb(var(--slate-200) / <alpha-value>)',
          300: 'rgb(var(--slate-300) / <alpha-value>)',
          400: 'rgb(var(--slate-400) / <alpha-value>)',
          500: 'rgb(var(--slate-500) / <alpha-value>)',
          600: 'rgb(var(--slate-600) / <alpha-value>)',
          700: 'rgb(var(--slate-700) / <alpha-value>)',
          800: 'rgb(var(--slate-800) / <alpha-value>)',
          900: 'rgb(var(--slate-900) / <alpha-value>)',
          950: 'rgb(var(--slate-950) / <alpha-value>)',
        },
        // `navy` kept as a named scale (legacy class compat) — light neutral
        // surfaces in light mode, deep instrument-navy surfaces in dark mode.
        navy: {
          950: 'rgb(var(--color-paper) / <alpha-value>)',
          900: 'rgb(var(--color-surface) / <alpha-value>)',
          850: 'rgb(var(--color-surface) / <alpha-value>)',
          800: 'rgb(var(--color-surface-2) / <alpha-value>)',
          700: 'rgb(var(--color-border) / <alpha-value>)',
          600: 'rgb(var(--color-border-strong) / <alpha-value>)',
        },
        // Deep institutional indigo-navy — the primary brand color.
        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          hover: 'rgb(var(--color-primary-hover) / <alpha-value>)',
        },
        // Muted brass/amber — reserved for "official / seal" marks.
        gold: 'rgb(var(--color-brass) / <alpha-value>)',
        brass: 'rgb(var(--color-brass) / <alpha-value>)',
        // Teal-green — "verified" accent.
        cyan: {
          DEFAULT: 'rgb(var(--color-teal) / <alpha-value>)',
        },
        teal: {
          DEFAULT: 'rgb(var(--color-teal) / <alpha-value>)',
        },
        ok: 'rgb(var(--color-ok) / <alpha-value>)',
        warn: 'rgb(var(--color-warn) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        info: 'rgb(var(--color-primary) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        // Crisp, small-blur elevation — an instrument panel, not a soft SaaS card.
        panel: '0 1px 0 rgba(15, 23, 42, 0.04), 0 4px 12px -2px rgba(15, 23, 42, 0.12)',
        card: '0 1px 2px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
}
