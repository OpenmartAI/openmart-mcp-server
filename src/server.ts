import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";

import {
  findBusinesses,
  findDecisionMakers,
  type OpenmartConfig,
} from "./openmart.js";

type HandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type OpenmartConfigResolver = (extra: HandlerExtra) => OpenmartConfig;

const LocationSchema = z.object({
  country: z.string().describe("Country name or code, for example USA or US."),
  state: z.string().optional().describe("State or region, for example CA."),
  city: z.string().optional().describe("City, for example San Francisco."),
}).passthrough();

const BusinessSearchSchema = z.object({
  query: z.string().min(1).describe("Business category or keyword, for example hair salons."),
  location: z.array(LocationSchema).optional(),
  limit: z.number().int().positive().max(1000).default(50),
  filters: z.object({
    has_website: z.boolean().optional(),
    has_valid_website: z.boolean().optional(),
    has_contact_info: z.boolean().optional(),
    max_locations: z.number().int().positive().optional(),
    min_total_reviews: z.number().int().nonnegative().optional(),
    min_overall_rating: z.number().min(0).max(5).optional(),
    open_date_after: z.string().optional(),
  }).passthrough().optional(),
  cursor: z.unknown().optional(),
});

const CompanySchema = z.object({
  domain: z.string().optional(),
  root_domain: z.string().optional(),
  website_url: z.string().optional(),
  company_name: z.string().optional(),
  business_name: z.string().optional(),
  store_name: z.string().optional(),
  openmart_id: z.string().optional(),
  tracking_id: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
}).passthrough();

const DecisionMakerSchema = z.object({
  companies: z.array(CompanySchema).optional(),
  businesses: z.array(CompanySchema).optional(),
  title: z.string().default("Owner").describe("Target role, for example Owner, Founder, Manager."),
  max_k: z.number().int().positive().max(10).default(3),
  info_access: z.array(z.enum(["EMAIL", "PHONE"])).default(["EMAIL", "PHONE"]),
  timeout_seconds: z.number().int().positive().max(600).default(120),
  poll_interval_ms: z.number().int().positive().max(30_000).default(2_000),
});

export function createOpenmartMcpServer(resolveConfig: OpenmartConfigResolver): McpServer {
  const server = new McpServer({
    name: "openmart-mcp-server",
    version: "0.1.0",
  });

  server.registerTool(
    "find_business",
    {
      title: "Find Business",
      description:
        "Search Openmart local business records by query, location, and filters. Returns structured business rows.",
      inputSchema: BusinessSearchSchema,
    },
    async (input, extra) => toToolResult(await findBusinesses(input, resolveConfig(extra))),
  );

  server.registerTool(
    "find_decision_maker",
    {
      title: "Find Decision Maker",
      description:
        "Find owner, founder, manager, or other decision-maker contact info for companies or businesses. Handles Openmart async batch polling internally when possible.",
      inputSchema: DecisionMakerSchema,
    },
    async (input, extra) => toToolResult(await findDecisionMakers(input, resolveConfig(extra))),
  );

  return server;
}

function toToolResult(structuredContent: Record<string, unknown>) {
  return {
    structuredContent,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
  };
}
