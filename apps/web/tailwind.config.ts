import type { Config } from "tailwindcss";

export default {
  content: ["./apps/web/index.html", "./apps/web/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        panel: "0 24px 60px rgba(15, 23, 42, 0.14)",
        card: "0 16px 36px rgba(15, 23, 42, 0.12)"
      },
      fontFamily: {
        sans: ["SUIT Variable", "Pretendard Variable", "Noto Sans KR", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;
