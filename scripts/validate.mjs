import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const ROOT = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const subsidySchema = await readJson(
  new URL("schema/subsidy.schema.json", ROOT)
);
const sourcesSchema = await readJson(new URL("schema/sources.schema.json", ROOT));
const subsidies = await readJson(new URL("data/subsidies.json", ROOT));
const sources = parse(
  await readFile(new URL("config/sources.yaml", ROOT), "utf8")
);

const validations = [
  ["data/subsidies.json", subsidySchema, subsidies],
  ["config/sources.yaml", sourcesSchema, sources]
];

let failed = false;
for (const [name, schema, data] of validations) {
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    failed = true;
    console.error(`${name}: 検証エラー`);
    for (const error of validate.errors ?? []) {
      console.error(`  ${error.instancePath || "/"} ${error.message}`);
    }
  } else {
    console.log(`${name}: OK`);
  }
}

if (new Set(subsidies.map((item) => item.id)).size !== subsidies.length) {
  failed = true;
  console.error("data/subsidies.json: idが重複しています");
}

for (let index = 1; index < subsidies.length; index += 1) {
  if (subsidies[index - 1].end > subsidies[index].end) {
    failed = true;
    console.error("data/subsidies.json: 締切日の昇順になっていません");
    break;
  }
}

if (failed) process.exitCode = 1;
else console.log(`validate: ${subsidies.length}件、全検証に合格`);
