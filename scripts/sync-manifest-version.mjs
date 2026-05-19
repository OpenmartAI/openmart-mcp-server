// Keeps manifest.json's version in sync with package.json.
//
// Wired as the npm `version` lifecycle script, so `npm version <bump>` updates
// both files and stages manifest.json into the same release commit. Without
// this, a release would ship a .mcpb whose manifest version lags package.json.
import { readFileSync, writeFileSync } from "node:fs";

const VERSION_FIELD = /("version":\s*")[^"]*(")/;

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = readFileSync("manifest.json", "utf8");

if (!VERSION_FIELD.test(manifest)) {
  throw new Error("sync-manifest-version: no version field found in manifest.json");
}

writeFileSync("manifest.json", manifest.replace(VERSION_FIELD, `$1${version}$2`));
console.log(`manifest.json version -> ${version}`);
