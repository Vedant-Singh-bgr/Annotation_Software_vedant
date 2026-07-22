import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0c10",
          900: "#0f1218",
          800: "#161a22",
          700: "#1f242e",
          600: "#2a303c",
          500: "#3a414f",
        },
        brand: {
          400: "#5b9dff",
          500: "#3b82f6",
          600: "#2563eb",
        },
      },
    },
  },
  plugins: [],
};

export default config;
