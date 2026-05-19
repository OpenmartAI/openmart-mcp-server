#!/usr/bin/env node
import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { configFromApiKey, OpenmartApiError } from "./openmart.js";
import { createOpenmartMcpServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, name: "openmart-mcp-server" });
    return;
  }

  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
    return;
  }

  let mcpServer: ReturnType<typeof createOpenmartMcpServer> | undefined;
  let transport: StreamableHTTPServerTransport | undefined;

  try {
    const parsedBody = await readJsonBody(req);
    mcpServer = createOpenmartMcpServer((extra) => {
      const apiKey = extractApiKey(extra.requestInfo?.headers);
      return configFromApiKey(apiKey);
    });
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    if (!res.headersSent) {
      const message = formatError(error);
      sendJson(res, error instanceof OpenmartApiError && error.status ? error.status : 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message },
        id: null,
      });
    }
  } finally {
    res.on("close", () => {
      void transport?.close();
      void mcpServer?.close();
    });
  }
});

server.listen(port, host, () => {
  console.error(`Openmart MCP HTTP server listening on http://${host}:${port}/mcp`);
});

function extractApiKey(headers?: Record<string, string | string[] | undefined>): string {
  const apiKey = getHeader(headers, "x-api-key");
  if (apiKey) {
    return apiKey;
  }

  const authorization = getHeader(headers, "authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function getHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key, Mcp-Session-Id, MCP-Protocol-Version",
  );
}

function formatError(error: unknown): string {
  if (error instanceof OpenmartApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
