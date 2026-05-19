import { setTimeout as delay } from "node:timers/promises";

export type JsonRecord = Record<string, unknown>;

export type OpenmartConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  pollIntervalMs: number;
};

export type LocationInput = {
  city?: string;
  state?: string;
  country?: string;
  zip_code?: string[];
  lat?: number;
  long?: number;
  geo_radius?: number;
};

// Mirrors Openmart's flat /api/v1/search request body. Every filter is a
// top-level key — there is no nested `filters` object, so wrapping filters
// in one makes the server silently ignore them.
export type BusinessSearchInput = {
  query?: string;
  tags?: string[];
  store_name?: string;
  location?: LocationInput[];
  min_locations?: number;
  max_locations?: number;
  ownership_type?: "INDEPENDENT" | "FAMILY" | "FRANCHISE" | "CHAIN";
  min_price_tier?: number;
  max_price_tier?: number;
  min_total_reviews?: number;
  max_total_reviews?: number;
  min_overall_rating?: number;
  max_overall_rating?: number;
  has_website?: boolean;
  has_valid_website?: boolean;
  has_contact_info?: boolean;
  include_keywords?: string[];
  exclude_keywords?: string[];
  exclude_root_domains?: string[];
  open_date_after?: string;
  open_date_before?: string;
  info_updated_after?: string;
  info_updated_before?: string;
  limit?: number;
  cursor?: unknown[];
};

export type CompanyInput = {
  domain?: string;
  root_domain?: string;
  website_url?: string;
  company_name?: string;
  business_name?: string;
  store_name?: string;
  openmart_id?: string;
  tracking_id?: string;
  city?: string;
  state?: string;
  country?: string;
};

export type DecisionMakerInput = {
  companies?: CompanyInput[];
  businesses?: CompanyInput[];
  title?: string;
  max_k?: number;
  info_access?: Array<"EMAIL" | "PHONE">;
  timeout_seconds?: number;
  poll_interval_ms?: number;
};

export class OpenmartApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "OpenmartApiError";
  }
}

export function configFromEnv(env = process.env): OpenmartConfig {
  const apiKey = env.OPENMART_API_KEY;
  if (!apiKey) {
    throw new OpenmartApiError(
      "Missing OPENMART_API_KEY. Set it before starting the MCP server.",
    );
  }

  return {
    apiKey,
    baseUrl: env.OPENMART_API_BASE_URL ?? "https://api.openmart.ai",
    timeoutMs: Number(env.OPENMART_TIMEOUT_MS ?? 120_000),
    pollIntervalMs: Number(env.OPENMART_POLL_INTERVAL_MS ?? 2_000),
  };
}

export function configFromApiKey(apiKey: string, env = process.env): OpenmartConfig {
  if (!apiKey) {
    throw new OpenmartApiError(
      "Missing Openmart API key. Provide X-API-Key or Authorization: Bearer <key>.",
    );
  }

  return {
    apiKey,
    baseUrl: env.OPENMART_API_BASE_URL ?? "https://api.openmart.ai",
    timeoutMs: Number(env.OPENMART_TIMEOUT_MS ?? 120_000),
    pollIntervalMs: Number(env.OPENMART_POLL_INTERVAL_MS ?? 2_000),
  };
}

export async function findBusinesses(
  input: BusinessSearchInput,
  config: OpenmartConfig,
): Promise<JsonRecord> {
  // estimate_total flips the response to {data, total_count} so callers can
  // gauge how broad the query is before paging further.
  const body = { ...input, estimate_total: true };
  const response = await openmartRequest<JsonRecord>(config, "POST", "/api/v1/search", body);
  const businesses = extractArray(response, [
    "data",
    "businesses",
    "results",
    "items",
    "records",
    "data.businesses",
    "data.results",
    "data.items",
  ]);
  const total_count = extractTotalCount(response);
  const next_cursor = lastCursor(businesses);

  if (businesses.length === 0) {
    return {
      businesses: [],
      total_count,
      next_cursor,
      message: "No businesses found. Broaden the category/location or drop some filters.",
    };
  }

  return {
    businesses: businesses.map(normalizeBusiness),
    total_count,
    next_cursor,
  };
}

// Openmart rejects a batch with more than 100 tasks, so large company
// lists are split across several batches.
const BATCH_TASK_LIMIT = 100;

export async function findDecisionMakers(
  input: DecisionMakerInput,
  config: OpenmartConfig,
): Promise<JsonRecord> {
  const { companies, skipped_rows } = buildFindPeopleCompanies(input);
  if (companies.length === 0) {
    return {
      status: "completed",
      contacts: [],
      skipped_rows,
      message: "No companies had a domain, so no decision-maker enrichment was submitted.",
    };
  }

  const title = input.title ?? "Owner";
  const max_k = input.max_k ?? 3;
  const info_access = input.info_access ?? ["EMAIL", "PHONE"];
  const timeoutMs = (input.timeout_seconds ?? config.timeoutMs / 1000) * 1000;
  const pollIntervalMs = input.poll_interval_ms ?? config.pollIntervalMs;

  // Submit one batch per <=100-task chunk.
  const batchIds: string[] = [];
  for (const group of chunk(companies, BATCH_TASK_LIMIT)) {
    const payload = group.map((company) => ({ ...company, title, max_k, info_access }));
    const submit = await openmartRequest<JsonRecord>(
      config,
      "POST",
      "/api/v1/task/batch/find_people",
      payload,
    );
    const batchId = findString(submit, ["batch_id", "id", "data.batch_id", "data.id"]);
    if (!batchId) {
      throw new OpenmartApiError("Openmart did not return a batch_id for find_people.", undefined, submit);
    }
    batchIds.push(batchId);
  }

  // Poll every batch until ready or the deadline passes. A failed status
  // check is treated as "not ready yet" so a single transient blip cannot
  // kill the whole job.
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(batchIds);
  while (pending.size > 0 && Date.now() < deadline) {
    for (const batchId of [...pending]) {
      const status = await safeBatchStatus(config, batchId);
      if (status && isBatchReady(status)) {
        pending.delete(batchId);
      }
    }
    if (pending.size > 0) {
      await delay(pollIntervalMs);
    }
  }

  // Collect contacts from every batch that finished.
  const readyBatchIds = batchIds.filter((id) => !pending.has(id));
  const contactGroups = await Promise.all(
    readyBatchIds.map(async (batchId) => {
      const taskIds = await fetchCompletedTaskIds(config, batchId);
      return fetchTaskContacts(config, taskIds);
    }),
  );
  const contacts = contactGroups.flat();

  if (pending.size > 0) {
    return {
      status: "processing",
      batch_ids: batchIds,
      pending_batch_ids: [...pending],
      contacts,
      skipped_rows,
      message:
        `Decision-maker enrichment finished ${readyBatchIds.length} of ${batchIds.length} ` +
        `batch(es); ${pending.size} still running. Retry later to collect the rest.`,
    };
  }

  return {
    status: "completed",
    batch_ids: batchIds,
    contacts,
    skipped_rows,
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

export function buildFindPeopleCompanies(input: DecisionMakerInput): {
  companies: JsonRecord[];
  skipped_rows: JsonRecord[];
} {
  const source = input.companies ?? input.businesses ?? [];
  const companies: JsonRecord[] = [];
  const skipped_rows: JsonRecord[] = [];

  for (const row of source) {
    const domain = normalizeDomain(row.domain ?? row.root_domain ?? extractDomain(row.website_url));
    const companyName = row.company_name ?? row.business_name ?? row.store_name;
    const trackingId = row.tracking_id ?? row.openmart_id;

    if (!domain) {
      skipped_rows.push({
        reason: "missing_domain",
        business_name: companyName,
        openmart_id: row.openmart_id,
      });
      continue;
    }

    companies.push(removeUndefined({
      domain,
      company_name: companyName,
      city: row.city,
      state: row.state,
      country: row.country,
      tracking_id: trackingId,
    }));
  }

  return { companies, skipped_rows };
}

export function extractDomain(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const withProtocol = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    const hostname = new URL(withProtocol).hostname;
    return normalizeDomain(hostname);
  } catch {
    return normalizeDomain(url);
  }
}

export function normalizeDomain(domain?: string): string | undefined {
  if (!domain) {
    return undefined;
  }

  const cleaned = domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split("?")[0]
    .toLowerCase();

  return cleaned || undefined;
}

async function safeBatchStatus(
  config: OpenmartConfig,
  batchId: string,
): Promise<JsonRecord | null> {
  try {
    return await openmartRequest<JsonRecord>(
      config,
      "GET",
      `/api/v1/task/batch/${encodeURIComponent(batchId)}/status`,
    );
  } catch {
    return null; // transient failure — keep polling
  }
}

async function fetchCompletedTaskIds(config: OpenmartConfig, batchId: string): Promise<string[]> {
  const response = await openmartRequest<JsonRecord>(
    config,
    "GET",
    `/api/v1/task/batch/${encodeURIComponent(batchId)}/task_ids?status=COMPLETED`,
  );
  const taskIds = extractArray(response, ["task_ids", "ids", "data.task_ids", "data.ids"]);
  if (taskIds.length > 0) {
    return taskIds.map(String);
  }

  const tasks = extractArray(response, ["tasks", "data.tasks"]);
  return tasks
    .map((task) => isRecord(task) ? findString(task, ["task_id", "id"]) : undefined)
    .filter((id): id is string => Boolean(id));
}

async function fetchTaskContacts(config: OpenmartConfig, taskIds: string[]): Promise<JsonRecord[]> {
  const results = await Promise.all(
    taskIds.map((taskId) =>
      openmartRequest<JsonRecord>(config, "GET", `/api/v1/task/${encodeURIComponent(taskId)}`),
    ),
  );

  return results.flatMap((result) => {
    const contacts = extractArray(result, [
      "contacts",
      "people",
      "results",
      "data",
      "data.contacts",
      "data.people",
      "data.results",
    ]);
    const trackingId = stringOrUndefined(result.tracking_id);
    const taskId = stringOrUndefined(result.task_id);
    return contacts.map((contact) => {
      if (!isRecord(contact)) {
        return removeUndefined({ value: contact, tracking_id: trackingId, task_id: taskId });
      }
      return removeUndefined({ ...contact, tracking_id: contact.tracking_id ?? trackingId, task_id: taskId });
    });
  });
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_RETRIES = 3;

function backoffMs(attempt: number): number {
  return 1_000 * 2 ** attempt; // 1s, 2s, 4s
}

async function openmartRequest<T>(
  config: OpenmartConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = new URL(path, ensureTrailingSlash(config.baseUrl));
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init);

      // Retry transient server / rate-limit statuses with exponential back-off.
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_REQUEST_RETRIES) {
        await response.body?.cancel();
        await delay(backoffMs(attempt));
        continue;
      }

      const responseBody = await parseBody(response);
      if (!response.ok) {
        throw mapApiError(response.status, responseBody);
      }
      return responseBody as T;
    } catch (error) {
      // API errors are final; network failures (fetch threw) get retried.
      if (error instanceof OpenmartApiError) {
        throw error;
      }
      if (attempt < MAX_REQUEST_RETRIES) {
        await delay(backoffMs(attempt));
        continue;
      }
      throw new OpenmartApiError(
        `Openmart request to ${path} failed after ${MAX_REQUEST_RETRIES + 1} attempts: ${String(error)}`,
      );
    }
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function mapApiError(status: number, body: unknown): OpenmartApiError {
  if (status === 401 || status === 403) {
    return new OpenmartApiError("Invalid Openmart API key.", status, body);
  }
  if (status === 402 || status === 429) {
    return new OpenmartApiError("Credit limit reached. Please add credits or upgrade.", status, body);
  }
  return new OpenmartApiError(`Openmart API request failed with HTTP ${status}.`, status, body);
}

function normalizeBusiness(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    return { value };
  }

  const content = isRecord(value.content) ? value.content : value;

  return removeUndefined({
    openmart_id: content.openmart_id ?? value.id ?? content.store_id,
    business_name: content.business_name ?? content.name,
    store_name: content.store_name,
    root_domain: normalizeDomain(stringOrUndefined(content.root_domain ?? content.domain)),
    website_url: content.website_url ?? content.website,
    city: content.city,
    state: content.state,
    country: content.country,
    street_address: content.street_address ?? content.address,
    store_phones: content.store_phones ?? content.phones ?? content.phone,
    business_emails: content.business_emails,
    business_phones: content.business_phones,
    google_rating: content.google_rating ?? content.rating,
    google_reviews_count: content.google_reviews_count ?? content.reviews_count,
    tags: content.tags,
    business_categories: content.business_categories,
    num_stores: content.num_stores ?? content.num_locations,
    ownership_type: content.ownership_type,
    price_tier: content.price_tier,
    open_date: content.open_date,
    latitude: content.latitude,
    longitude: content.longitude,
    match_score: value.match_score,
    match_highlights: value.match_highlights,
  });
}

function extractTotalCount(response: unknown): number | null {
  const value = getNested(response, "total_count") ?? getNested(response, "data.total_count");
  return typeof value === "number" ? value : null;
}

// Openmart paginates by cursor: each record carries a [score, store_id]
// cursor, and the next page is requested with the last record's cursor.
function lastCursor(businesses: unknown[]): unknown {
  if (businesses.length === 0) {
    return null;
  }
  const last = businesses[businesses.length - 1];
  return isRecord(last) ? last.cursor ?? null : null;
}

function isBatchReady(status: JsonRecord): boolean {
  const ready = getNested(status, "batch_ready") ?? getNested(status, "data.batch_ready");
  if (ready === true) {
    return true;
  }

  const nestedReady = getNested(status, "status.batch_ready") ?? getNested(status, "data.status.batch_ready");
  if (nestedReady === true) {
    return true;
  }

  const statusValue = String(
    getNested(status, "status") ?? getNested(status, "data.status") ?? getNested(status, "status.status") ?? "",
  ).toLowerCase();
  return ["completed", "complete", "ready", "done"].includes(statusValue);
}

function extractArray(source: unknown, paths: string[]): unknown[] {
  if (Array.isArray(source)) {
    return source;
  }

  for (const path of paths) {
    const value = getNested(source, path);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function findString(source: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getNested(source, path);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function getNested(source: unknown, path: string): unknown {
  if (!isRecord(source)) {
    return undefined;
  }

  return path.split(".").reduce<unknown>((current, part) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[part];
  }, source);
}

function removeUndefined<T extends JsonRecord>(value: T): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
