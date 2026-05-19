import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// End-to-end: spawn the real stdio MCP server (src/index.ts) as a child
// process, connect a real MCP client to it over stdio, and drive all three
// tools through the MCP protocol. A local HTTP server stands in for
// api.openmart.ai so the run is hermetic — no live API, no credits — while
// still exercising the whole path: stdio transport -> JSON-RPC -> tool
// dispatch -> zod validation -> HTTP client.

const SEARCH_RESPONSE = {
  data: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      content: {
        business_name: "E2E Coffee",
        root_domain: "e2ecoffee.com",
        city: "San Francisco",
        state: "California",
        google_rating: 4.8,
      },
      cursor: [4.8, "11111111-1111-1111-1111-111111111111"],
    },
  ],
  total_count: 750,
};

const CONTACT = {
  first_name: "Karl",
  last_name: "Strovink",
  title: "CEO",
  email: { email: "karl@e2ecoffee.com", verified: true },
  phones: [],
  linkedin_url: "https://linkedin.com/in/karl",
};

function startMockOpenmart(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const send = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "POST" && url === "/api/v1/search") {
      send(SEARCH_RESPONSE);
    } else if (req.method === "POST" && url === "/api/v1/task/batch/find_people") {
      send({ batch_id: "batch-e2e", submit_for: "find_people", status: { batch_ready: false } });
    } else if (url.includes("/status")) {
      send({ processing: 0, completed: 1, errored: 0, total: 1, batch_ready: true });
    } else if (url.includes("/task_ids")) {
      send(["task-e2e"]);
    } else if (url.includes("/task/task-e2e")) {
      send({ data: [CONTACT], status: "COMPLETED", task_id: "task-e2e", tracking_id: "e2e-biz" });
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

function parseToolResult(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((part) => part.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

test("e2e: a real MCP client lists and calls all three tools over stdio", { timeout: 30_000 }, async () => {
  const mock = await startMockOpenmart();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    env: childEnv({ OPENMART_API_KEY: "e2e-key", OPENMART_API_BASE_URL: mock.baseUrl }),
  });
  const client = new Client({ name: "e2e-test", version: "0.0.0" });

  try {
    await client.connect(transport);

    // tools/list — the server must advertise exactly the three tools.
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["find_business", "find_decision_maker", "get_batch_results"],
    );

    // find_business — search companies.
    const search = parseToolResult(
      await client.callTool({
        name: "find_business",
        arguments: { query: "coffee", location: [{ city: "San Francisco" }] },
      }),
    );
    assert.equal(search.total_count, 750);
    assert.equal((search.businesses as Array<Record<string, unknown>>)[0].business_name, "E2E Coffee");

    // find_decision_maker — find people, full submit/poll/fetch flow.
    const dm = parseToolResult(
      await client.callTool({
        name: "find_decision_maker",
        arguments: { businesses: [{ domain: "e2ecoffee.com" }], title: "CEO" },
      }),
    );
    assert.equal(dm.status, "completed");
    assert.equal((dm.contacts as Array<Record<string, unknown>>)[0].first_name, "Karl");

    // get_batch_results — resume an async batch by id.
    const batch = parseToolResult(
      await client.callTool({ name: "get_batch_results", arguments: { batch_ids: ["batch-e2e"] } }),
    );
    assert.equal(batch.status, "completed");
    assert.equal((batch.contacts as Array<Record<string, unknown>>)[0].first_name, "Karl");

    // Out-of-range input must be rejected by the schema, not reach the handler.
    let rejected = false;
    try {
      const bad = await client.callTool({
        name: "find_business",
        arguments: { query: "coffee", min_overall_rating: 99 },
      });
      rejected = (bad as { isError?: boolean }).isError === true;
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "out-of-range min_overall_rating should be rejected");
  } finally {
    await client.close();
    await mock.close();
  }
});
