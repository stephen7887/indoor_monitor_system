import type { Config } from "tailwindcss";

// 모든 색은 globals.css의 CSS 변수(테마별)에서 온다 — 컴포넌트에 raw hex 금지
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        edge: "var(--border)",
        fg: "var(--text)",
        muted: "var(--text-muted)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        info: "var(--info)",
        "ok-bg": "var(--ok-bg)",
        "warn-bg": "var(--warn-bg)",
        "danger-bg": "var(--danger-bg)",
        "info-bg": "var(--info-bg)",
        "danger-solid": "var(--danger-solid)",
        "on-danger": "var(--on-danger)",
      },
    },
  },
  plugins: [],
};

export default config;
