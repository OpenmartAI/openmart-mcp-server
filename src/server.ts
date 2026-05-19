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
  getBatchResults,
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
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .default(50)
    .describe("Records per page, 1-1000 (default 50). One call fetches one page of this size."),
  cursor: z
    .array(z.unknown())
    .optional()
    .describe(
      "Pagination cursor. Omit for the first page; to fetch the next page pass the `next_cursor` from the previous response.",
    ),
});

const CompanySchema = z
  .object({
    domain: z.string().optional().describe("Company website domain, e.g. 'bluebottlecoffee.com'."),
    root_domain: z.string().optional().describe("Root domain — used when `domain` is absent."),
    website_url: z
      .string()
      .optional()
      .describe("Website URL — the domain is parsed from it when `domain`/`root_domain` are absent."),
    company_name: z.string().optional().describe("Company display name — improves match accuracy."),
    business_name: z.string().optional().describe("Alias for company_name (e.g. from a find_business row)."),
    store_name: z.string().optional().describe("Alias for company_name (e.g. from a find_business row)."),
    openmart_id: z.string().optional().describe("Openmart business id; echoed back as tracking_id on each contact."),
    tracking_id: z.string().optional().describe("Your own correlation id; echoed back on each contact."),
    city: z.string().optional().describe("City — helps disambiguate the company."),
    state: z.string().optional().describe("State — helps disambiguate the company."),
    country: z.string().optional().describe("Country — helps disambiguate the company."),
  })
  .passthrough();

const DecisionMakerSchema = z.object({
  companies: z
    .array(CompanySchema)
    .optional()
    .describe("Target companies. Each needs a domain (or a website_url to parse one from)."),
  businesses: z
    .array(CompanySchema)
    .optional()
    .describe("Alias for `companies` — accepts find_business result rows directly."),
  title: z
    .string()
    .default("Owner")
    .describe(
      "Job title to search for, e.g. 'Owner', 'CEO', 'Founder', 'CTO', 'Head of Marketing'. Defaults to 'Owner'.",
    ),
  max_k: z
    .number()
    .int()
    .min(1)
    .max(8)
    .default(3)
    .describe("Max contacts to return per company (1-8)."),
  info_access: z
    .array(z.enum(["EMAIL", "PHONE"]))
    .default(["EMAIL", "PHONE"])
    .describe(
      "Contact fields to retrieve: ['EMAIL'] for work email only, ['EMAIL','PHONE'] to also pull phone numbers (phone costs more).",
    ),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .max(600)
    .default(120)
    .describe("How long to wait for async enrichment before returning partial results (default 120s)."),
  poll_interval_ms: z
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(2_000)
    .describe("How often to poll batch status, in milliseconds."),
});

const BatchResultsSchema = z.object({
  batch_ids: z
    .array(z.string())
    .min(1)
    .describe(
      "Batch ids to collect — use the `pending_batch_ids` from a find_decision_maker response whose status was 'processing'.",
    ),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .max(600)
    .default(120)
    .describe("How long to wait for the batches to finish before returning partial results (default 120s)."),
  poll_interval_ms: z
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(2_000)
    .describe("How often to poll batch status, in milliseconds."),
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
      description: [
        "Search Openmart's directory of local / SMB businesses — restaurants, salons, retail,",
        "fitness, services, healthcare, and similar physical-location merchants — to build prospect lists.",
        "",
        "Filter by geography, category, Google rating, review count, ownership type, price tier,",
        "location count (chains vs. single-location), website presence, and opening/refresh dates.",
        "",
        "Search target: pass `tags`, `store_name`, or `query`. When more than one is given, `tags`",
        "takes precedence over `store_name`, which takes precedence over `query`. `query` should be a",
        "single short category term (e.g. 'nail salon', 'auto repair') — not a sentence, and with no",
        "location in it (location goes in `location`). Pass at least one `location` for local results.",
        "",
        "Returns each business with name, address, phone, website, root domain, Google rating and",
        "review count, tags/categories, location count, ownership type, and price tier.",
        "",
        "Pagination: every response also carries `total_count` (how many businesses match the filters",
        "overall), `has_more`, and `next_cursor`. For a single page, call once. To collect more, repeat",
        "the call with `cursor` set to the previous response's `next_cursor`, and keep going while",
        "`has_more` is true — stop as soon as `has_more` is false (then `next_cursor` is null). Check",
        "`total_count` first: it tells you the full match size up front, so you can decide whether to",
        "page at all and how many pages it will take (total_count / limit).",
        "",
        "To get decision-maker contacts (email/phone) for the businesses found, follow up with",
        "`find_decision_maker` using their domains.",
      ].join("\n"),
      inputSchema: BusinessSearchSchema,
      annotations: {
        readOnlyHint: true, // a search — does not change anything
        openWorldHint: true, // queries the external Openmart directory
      },
    },
    async (input, extra) => toToolResult(await findBusinesses(input, resolveConfig(extra))),
  );

  server.registerTool(
    "find_decision_maker",
    {
      title: "Find Decision Maker",
      description: [
        "Find decision-maker contacts at one or more companies by job title. Give it a list of",
        "companies (domains, or rows returned by `find_business`); get back people with name, title,",
        "email (plus a verified flag), phone, and LinkedIn URL.",
        "",
        "Works for both local SMBs and B2B companies — tune it to your target audience with `title`",
        "(default 'Owner'; e.g. 'CTO', 'Head of Marketing', 'General Manager').",
        "",
        "Pass every target company in a SINGLE call. The tool batches them and transparently splits",
        "lists longer than 100 into multiple batches — do not loop one company per call.",
        "",
        "`info_access` controls which contact fields are retrieved: ['EMAIL'] for work email only,",
        "['EMAIL','PHONE'] to also pull phone numbers (phone is more expensive). `max_k` sets how many",
        "contacts to return per company (1-8).",
        "",
        "Companies without a resolvable domain are skipped and listed in `skipped_rows` — resolve them",
        "with `find_business` first. Enrichment runs asynchronously and is polled internally; if it is",
        "still running at the timeout, the response has status 'processing' plus `pending_batch_ids`.",
        "A 'processing' result is NOT final — the contacts in it are partial. Call `get_batch_results`",
        "with those `pending_batch_ids` to collect the rest before concluding.",
        "",
        "This discovers NEW contacts at a company by title; it is not for re-enriching a specific",
        "person you already know.",
      ].join("\n"),
      inputSchema: DecisionMakerSchema,
      annotations: {
        // Not read-only: it submits enrichment batches and consumes credits.
        // Not destructive either: it never deletes or overwrites data.
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input, extra) => toToolResult(await findDecisionMakers(input, resolveConfig(extra))),
  );

  server.registerTool(
    "get_batch_results",
    {
      title: "Get Batch Results",
      description: [
        "Collect the results of an asynchronous Openmart batch job — use this to finish gathering",
        "decision-maker contacts when `find_decision_maker` returned status 'processing'.",
        "",
        "`find_decision_maker` polls internally, but very large runs can still be in progress when it",
        "returns; in that case it hands back `pending_batch_ids`. Pass those ids here — this tool polls",
        "the batches and returns the contacts (name, title, email + verified flag, phone, LinkedIn URL)",
        "from every batch that has finished.",
        "",
        "If some batches are still running, the response is again status 'processing' with the",
        "remaining `pending_batch_ids` — wait a few seconds and call again with those. Keep going until",
        "status is 'completed'; do not treat a 'processing' result as the full answer.",
      ].join("\n"),
      inputSchema: BatchResultsSchema,
      annotations: {
        readOnlyHint: true, // only fetches results of an existing batch
        openWorldHint: true,
      },
    },
    async (input, extra) => toToolResult(await getBatchResults(input, resolveConfig(extra))),
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
