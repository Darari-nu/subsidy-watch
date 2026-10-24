import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const site = process.env.SITE_URL ?? "https://darari-nu.github.io";
// darari-nu.com/subsidy-watch/ の中継があるため、base は /subsidy-watch から変えない。
// ローカルビルドでも本番と同じパスになるよう、環境変数が無い場合も /subsidy-watch にする。
const base = process.env.BASE_PATH ?? (repository ? `/${repository}` : "/subsidy-watch");

export default defineConfig({
  site,
  base,
  output: "static",
  trailingSlash: "always",
  integrations: [tailwind()]
});
