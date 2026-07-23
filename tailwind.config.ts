import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Paper surfaces — CSS-variable backed so .dark flips them
        paper: {
          DEFAULT: "rgb(var(--paper) / <alpha-value>)",
          50: "rgb(var(--paper-50) / <alpha-value>)",
          100: "rgb(var(--paper-100) / <alpha-value>)",
          200: "rgb(var(--paper-200) / <alpha-value>)",
        },
        // Raised surface (cards, popovers, nav) — white in light mode
        surface: "rgb(var(--surface) / <alpha-value>)",
        // Warm foreground scale (thinkingmachines.ai fg ramp)
        ink: {
          900: "rgb(var(--ink-900) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
        },
        // Muted print-like accent inks
        accent: {
          red: "rgb(var(--accent-red) / <alpha-value>)",
          blue: "rgb(var(--accent-blue) / <alpha-value>)",
          green: "rgb(var(--accent-green) / <alpha-value>)",
          lime: "rgb(var(--accent-lime) / <alpha-value>)",
          yellow: "rgb(var(--accent-yellow) / <alpha-value>)",
          orange: "rgb(var(--accent-orange) / <alpha-value>)",
          purple: "rgb(var(--accent-purple) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
        display: ["var(--font-display)", ...defaultTheme.fontFamily.sans],
        serif: [
          "Iowan Old Style",
          "Iowan Old Style BT",
          "Palatino Linotype",
          "Georgia",
          "serif",
        ],
      },
      boxShadow: {
        ring: "var(--shadow-ring)",
        card: "var(--shadow-card)",
      },
      keyframes: {
        "btn-spring": {
          "0%": { transform: "scale(0.96)" },
          "40%": { transform: "scale(1.02)" },
          "70%": { transform: "scale(0.99)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        "btn-spring": "btn-spring 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
