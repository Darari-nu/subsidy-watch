import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const site = process.env.SITE_URL ?? "https://example.github.io";
const base = process.env.BASE_PATH ?? (repository ? `/${repository}` : "/");

export default defineConfig({
  site,
  base,
  output: "static",
  trailingSlash: "always",
  integrations: [tailwind()]
});
