#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { configFromEnv, OpenmartApiError } from "./openmart.js";
import { createOpenmartMcpServer } from "./server.js";

const server = createOpenmartMcpServer(() => configFromEnv());

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = formatError(error);
  console.error(message);
  process.exit(1);
});

function formatError(error: unknown): string {
  if (error instanceof OpenmartApiError) {
    const body = error.body === undefined ? "" : `\n${JSON.stringify(error.body, null, 2)}`;
    return `${error.message}${body}`;
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
