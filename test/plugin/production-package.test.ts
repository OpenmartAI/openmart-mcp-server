import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("production artifacts exclude repository data, keep OAuth public and rebuild identically", () => {
  const temp = mkdtempSync(join(tmpdir(), "openmart-release-"));
  const script = resolve("scripts/package-production-plugin.mjs");
  try {
    mkdirSync(join(temp, "plugins"), { recursive: true });
    cpSync("plugins/openmart-chatgpt", join(temp, "plugins/openmart-chatgpt"), {
      recursive: true,
    });
    writeFileSync(
      join(temp, "plugins/openmart-chatgpt/PRIVATE.md"),
      "do not publish",
    );
    const run = (format: string) => {
      const result = spawnSync(
        process.execPath,
        [script, "11111111-1111-4111-8111-111111111111", "0.2.1", format],
        { cwd: temp, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const portal = run("portal");
    assert.equal(run("portal").sha256, portal.sha256);
    const listing = spawnSync("unzip", ["-Z1", portal.zip], {
      encoding: "utf8",
    }).stdout;
    assert.match(listing, /^plugin.json$/m);
    assert.doesNotMatch(listing, /PRIVATE|README|\.env|\.app.json/);
    const mcp = JSON.parse(
      readFileSync(join(portal.directory, "mcp.json"), "utf8"),
    );
    assert.equal(mcp.mcpServers.openmart.url, "https://api.openmart.ai/mcp");
    assert.equal(
      mcp.mcpServers.openmart.extensions["com.openai"].auth.client
        .tokenEndpointAuthMethod,
      "none",
    );
    const desktop = run("codex");
    const marketplace = JSON.parse(
      readFileSync(
        join(desktop.directory, ".agents/plugins/marketplace.json"),
        "utf8",
      ),
    );
    assert.equal(marketplace.plugins[0].source.path, "./plugins/openmart");
    const client = JSON.parse(
      readFileSync(
        join(desktop.directory, "plugins/openmart/.mcp.json"),
        "utf8",
      ),
    );
    assert.equal(client.mcpServers.openmart.oauth.callbackPort, 43872);
    assert.equal(run("codex").sha256, desktop.sha256);
    writeFileSync(
      join(temp, "plugins/openmart-chatgpt/skills/onboard/SKILL.md"),
      "SUPABASE_SERVICE_ROLE_KEY=forbidden",
    );
    assert.notEqual(
      spawnSync(
        process.execPath,
        [script, "11111111-1111-4111-8111-111111111111"],
        { cwd: temp },
      ).status,
      0,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
