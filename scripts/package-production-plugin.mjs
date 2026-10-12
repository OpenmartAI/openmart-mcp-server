// Build allowlisted artifacts only; never copy repository docs or credentials.
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  utimes,
} from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const [clientId, version = "0.2.1", format = "portal"] = process.argv.slice(2);
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    clientId ?? "",
  ) ||
  !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version) ||
  !["portal", "codex"].includes(format)
) {
  throw Error(
    "Usage: node scripts/package-production-plugin.mjs PUBLIC_OAUTH_CLIENT_UUID [VERSION] [portal|codex]",
  );
}
const source = resolve("plugins/openmart-chatgpt");
const base = resolve(`dist/release/openmart-${format}-${version}`);
await rm(base, { recursive: true, force: true });
const root = format === "codex" ? join(base, "plugins/openmart") : base;
await mkdir(root, { recursive: true });
for (const dir of ["skills", "assets"])
  await cp(join(source, dir), join(root, dir), {
    recursive: true,
    dereference: false,
  });
const plugin = JSON.parse(await readFile(join(source, "plugin.json"), "utf8"));
plugin.version = version;
plugin.extensions["com.openai"].review = JSON.parse(
  await readFile(join(source, "review.json"), "utf8"),
);
plugin.extensions["com.openai"].publication = {
  release_notes:
    "Initial production OAuth plugin candidate: business discovery, company research, asynchronous contact enrichment, saved results and contact exclusions. Downloads are available only when supported by the host.",
};
plugin.description =
  "Find businesses, research companies and discover decision-maker contacts with Openmart.";
const ui = plugin.extensions["com.openai"].interface;
ui.shortDescription = "Find businesses and contacts";
ui.supportURL = "https://github.com/OpenmartAI/openmart-mcp-server/issues";
ui.termsOfServiceURL = "https://www.openmart.com/terms-of-use";
ui.longDescription =
  "Search business locations and companies, select prospects, and find decision-maker contacts. Track enrichment jobs and review saved results. Requires an Openmart account. Searches and enrichment may use your team’s Openmart credits. File downloads depend on client support.";
ui.defaultPrompt = [
  "Find 10 independent coffee shops in Austin.",
  "Find one owner email for the businesses I selected.",
  "Show the status and results of my last Openmart task.",
];
const writeJSON = (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");
if (format === "portal") {
  await writeJSON(join(root, "plugin.json"), plugin);
  await writeJSON(join(root, "mcp.json"), {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {
      openmart: {
        type: "streamable-http",
        url: "https://api.openmart.ai/mcp",
        extensions: {
          "com.openai": {
            auth: {
              type: "oauth",
              client: {
                mode: "provided",
                clientId,
                tokenEndpointAuthMethod: "none",
              },
              baseScopes: ["openid"],
            },
          },
        },
      },
    },
  });
} else {
  await mkdir(join(root, ".codex-plugin"));
  await writeJSON(join(root, ".codex-plugin/plugin.json"), {
    name: "openmart",
    version,
    description: plugin.description,
    author: { name: "Openmart", url: "https://www.openmart.com" },
    skills: "./skills",
    mcpServers: "./.mcp.json",
    interface: ui,
  });
  await writeJSON(join(root, ".mcp.json"), {
    mcpServers: {
      openmart: {
        type: "http",
        url: "https://api.openmart.ai/mcp",
        oauth: {
          clientId,
          callbackPort: 43872,
          callbackUrl: "http://127.0.0.1:43872/callback/_oAHIM6iHKSV",
        },
      },
    },
  });
  await mkdir(join(base, ".agents/plugins"), { recursive: true });
  await writeJSON(join(base, ".agents/plugins/marketplace.json"), {
    name: "openmart-beta",
    interface: { displayName: "Openmart Beta" },
    plugins: [
      {
        name: "openmart",
        source: { source: "local", path: "./plugins/openmart" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      },
    ],
  });
}
// Inspect every packaged text file before creating an archive.
async function list(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink())
      throw Error(`Symlinks are not allowed: ${path}`);
    if (entry.isDirectory()) result.push(...(await list(path)));
    else result.push(path);
  }
  return result.sort();
}
const paths = await list(base);
for (const path of paths.filter((p) => /\.(json|md)$/.test(p))) {
  const text = await readFile(path, "utf8");
  if (
    /api-stg\.|clientSecret|service_role|SUPABASE_SERVICE|Bearer eyJ|\/Users\//.test(
      text,
    )
  )
    throw Error(
      `Unexpected private or staging data in ${relative(base, path)}`,
    );
}
// Normalize timestamps for identical archives from identical inputs.
for (const path of paths)
  await utimes(
    path,
    new Date("2000-01-01T00:00:00Z"),
    new Date("2000-01-01T00:00:00Z"),
  );
const zip = `${base}.zip`;
await rm(zip, { force: true });
execFileSync("zip", ["-X", "-q", zip, ...paths.map((p) => relative(base, p))], {
  cwd: base,
});
const sha256 = createHash("sha256")
  .update(await readFile(zip))
  .digest("hex");
await writeFile(`${zip}.sha256`, `${sha256}  ${zip.split("/").pop()}\n`);
console.log(
  JSON.stringify(
    { directory: base, zip, sha256, files: paths.length, version, format },
    null,
    2,
  ),
);
