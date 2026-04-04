/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        syne: ["Syne", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        lora: ["Lora", "serif"],
      },
      colors: {
        surface: {
          0: "#0a0a0a",
          1: "#111111",
          2: "#1a1a1a",
          3: "#242424",
          4: "#2e2e2e",
        },
        border: "#2e2e2e",
        muted: "#666666",
        dim: "#444444",
        text: {
          primary: "#e8e8e8",
          secondary: "#999999",
          dim: "#666666",
        },
        accent: {
          blue: "#4a9eff",
          green: "#4ade80",
          amber: "#fbbf24",
          red: "#f87171",
          purple: "#a78bfa",
        },
        impact: {
          high: "#f87171",
          medium: "#fbbf24",
          low: "#4ade80",
        },
        domain: {
          product: "#4a9eff",
          engineering: "#a78bfa",
          marketing: "#fb923c",
          business: "#4ade80",
          design: "#f472b6",
        },
      },
    },
  },
  plugins: [],
};
