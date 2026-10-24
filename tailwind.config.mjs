/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Noto Sans JP"',
          '"Hiragino Sans"',
          '"Yu Gothic"',
          "Meiryo",
          "sans-serif"
        ],
        serif: ['"Noto Serif JP"', '"Hiragino Mincho ProN"', '"Yu Mincho"', "serif"]
      },
      colors: {
        paper: "#F7F5F0",
        panel: "#FFFFFF",
        ink: "#1A1A1A",
        muted: "#6B6B6B",
        line: "#E3DFD5",
        accent: "#1F5C4A",
        "accent-dark": "#154236",
        "accent-soft": "#E6EFEA",
        vermilion: "#C8452D",
        "vermilion-text": "#AD3A25",
        "vermilion-soft": "#F8E9E5"
      }
    }
  },
  plugins: []
};
