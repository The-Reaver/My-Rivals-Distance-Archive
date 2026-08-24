import type { Config } from "tailwindcss";

// Visual Direction Document v1.0 -- these values are quoted directly from
// that spec (sections 2, 3, 8). Do not hand-roll hex values in components;
// reference these tokens so the whole app stays in sync with one source.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#0A0A0F",
          elevated: "#12121A",
          hover: "#1A1A28",
        },
        text: {
          primary: "#E8E6E3",
        },
        accent: {
          gold: "#C9A84C",
          ember: "#8B3A3A",
          steel: "#4A6670",
          parchment: "#D4C5A0",
        },
        border: {
          subtle: "#1E1E2E",
        },
      },
      fontFamily: {
        display: ["var(--font-playfair)", "Georgia", "serif"],
        body: ["var(--font-inter)", "-apple-system", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Visual Direction 3. Type Scale
        "page-title": ["2rem", { lineHeight: "1.2", fontWeight: "700" }], // 32px/700, Playfair
        "section-heading": ["1.5rem", { lineHeight: "1.25", fontWeight: "600" }], // 24px/600, Playfair
        "card-title": ["1.125rem", { lineHeight: "1.3", fontWeight: "600" }], // 18px/600, Playfair
        body: ["1rem", { lineHeight: "1.5", fontWeight: "400" }], // 16px/400, Inter
        "body-small": ["0.875rem", { lineHeight: "1.5", fontWeight: "400" }], // 14px/400, Inter
        caption: ["0.75rem", { lineHeight: "1.4", fontWeight: "500" }], // 12px/500, Inter
        metric: ["0.875rem", { lineHeight: "1.4", fontWeight: "500" }], // 14px/500, JetBrains Mono
      },
      spacing: {
        // Visual Direction 8. Spacing and Grid -- 4px base unit
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "48px",
      },
      maxWidth: {
        grid: "1200px", // 12-column grid, desktop max-width
        reader: "680px", // Chronicle Reader column width
      },
      borderRadius: {
        card: "8px",
      },
      transitionDuration: {
        hover: "150ms",
        page: "200ms",
      },
    },
  },
  plugins: [],
};

export default config;
