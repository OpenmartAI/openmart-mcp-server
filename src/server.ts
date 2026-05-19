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
  city: z.string().optional().describe("City name, e.g. 'San Francisco'."),
  state: z.string().optional().describe("State or region, e.g. 'CA' or 'California'."),
  country: z.string().optional().describe("Country code or name, e.g. 'US'. Defaults to US."),
  zip_code: z.array(z.string()).optional().describe("ZIP / postal codes to match."),
  lat: z.number().optional().describe("Latitude (WGS84). Pair with long + geo_radius for a radius search."),
  long: z.number().optional().describe("Longitude (WGS84). Pair with lat + geo_radius for a radius search."),
  geo_radius: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Search radius in meters around lat/long. Defaults to 50000 (50km)."),
});

// All filters are flat, top-level keys — the Openmart /api/v1/search endpoint
// has no nested `filters` object, so anything wrapped in one is silently
// ignored by the server.
const BusinessSearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Business category or keyword, e.g. 'hair salon'. Ignored when tags is set."),
  tags: z
    .array(z.string())
    .max(100)
    .optional()
    .describe("Directory category tags. When non-empty, takes precedence over query and store_name."),
  store_name: z.string().optional().describe("Business or chain name, e.g. 'Starbucks'."),
  location: z
    .array(LocationSchema)
    .optional()
    .describe("One or more locations to search within. Pass at least one for local results."),
  min_locations: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Minimum number of locations (use >=2 for chains/franchises)."),
  max_locations: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Maximum number of locations (use 1 for single-location businesses)."),
  ownership_type: z
    .enum(["INDEPENDENT", "FAMILY", "FRANCHISE", "CHAIN"])
    .optional()
    .describe("Ownership type filter."),
  min_price_tier: z.number().int().min(1).max(4).optional().describe("Minimum price tier (1=$ to 4=$$$$)."),
  max_price_tier: z.number().int().min(1).max(4).optional().describe("Maximum price tier (1=$ to 4=$$$$)."),
  min_total_reviews: z.number().int().nonnegative().optional().describe("Minimum Google review count."),
  max_total_reviews: z.number().int().nonnegative().optional().describe("Maximum Google review count."),
  min_overall_rating: z.number().min(0).max(5).optional().describe("Minimum Google rating (0-5)."),
  max_overall_rating: z.number().min(0).max(5).optional().describe("Maximum Google rating (0-5)."),
  has_website: z.boolean().optional().describe("Only return businesses that have a website."),
  has_valid_website: z
    .boolean()
    .optional()
    .describe("Only return businesses with a validated, reachable website."),
  has_contact_info: z.boolean().optional().describe("Only return businesses that have contact info."),
  include_keywords: z
    .array(z.string())
    .max(64)
    .optional()
    .describe("Soft-rank: boost businesses whose description mentions these words."),
  exclude_keywords: z
    .array(z.string())
    .max(64)
    .optional()
    .describe("Hard filter: drop businesses whose description mentions these words."),
  exclude_root_domains: z
    .array(z.string())
    .max(10000)
    .optional()
    .describe("Exclude businesses on these root domains (e.g. to dedupe against existing leads)."),
  open_date_after: z.string().optional().describe("Only businesses opened on/after this date (YYYY-MM-DD)."),
  open_date_before: z.string().optional().describe("Only businesses opened on/before this date (YYYY-MM-DD)."),
  info_updated_after: z
    .string()
    .optional()
    .describe("Only records refreshed on/after this date (YYYY-MM-DD)."),
  info_updated_before: z
    .string()
    .optional()
    .describe("Only records refreshed on/before this date (YYYY-MM-DD)."),
  limit: z.number().int().positive().max(1000).default(50).describe("Max records per page (1-1000)."),
  cursor: z
    .array(z.unknown())
    .optional()
    .describe("Pagination cursor — pass the next_cursor returned by the previous call to get the next page."),
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
