/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Hiragino Sans"', '"Yu Gothic"', "Meiryo", "sans-serif"]
      },
      colors: {
        ink: "#17221d",
        muted: "#5e6b64",
        paper: "#f4f5ef",
        panel: "#ffffff",
        line: "#d9ddd5",
        green: "#145a42",
        "green-dark": "#0d3f2e",
        gold: "#a56d00",
        "gold-soft": "#fff4cc",
        danger: "#b42318",
        "danger-soft": "#fff0ed"
      }
    }
  },
  plugins: []
};
