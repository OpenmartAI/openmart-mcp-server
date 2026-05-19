// Builds the .mcpb desktop-extension bundle.
//
// 1. esbuild bundles the compiled stdio server (dist/index.js) and all of its
//    dependencies into a single ESM file — so the bundle is self-contained and
//    needs no node_modules on the user's machine.
// 2. The bundle is staged next to manifest.json and packed with the mcpb CLI.
//
// Run via `npm run pack:mcpb` (which builds dist/ first).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

const STAGE = "mcpb-build";
const OUTPUT = "openmart-mcp-server.mcpb";

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(`${STAGE}/server`, { recursive: true });

await build({
  entryPoints: ["dist/index.js"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: `${STAGE}/server/index.mjs`,
});

copyFileSync("manifest.json", `${STAGE}/manifest.json`);
copyFileSync("icon.png", `${STAGE}/icon.png`);

execFileSync("npx", ["mcpb", "pack", STAGE, OUTPUT], { stdio: "inherit" });

console.log(`\nBundled ${OUTPUT}`);
