import { setTimeout as delay } from "node:timers/promises";

export type JsonRecord = Record<string, unknown>;

export type OpenmartConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  pollIntervalMs: number;
};

export type BusinessSearchInput = {
  query: string;
  location?: JsonRecord[];
  limit?: number;
  filters?: JsonRecord;
  cursor?: unknown;
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
  const response = await openmartRequest<JsonRecord>(config, "POST", "/api/v1/search", input);
  const businesses = extractArray(response, [
    "businesses",
    "results",
    "items",
    "records",
    "data.businesses",
    "data.results",
    "data.items",
  ]);

  if (businesses.length === 0) {
    return {
      businesses: [],
      next_cursor: extractNextCursor(response),
      message: "No businesses found. Try a broader category or location.",
      raw: response,
    };
  }

  return {
    businesses: businesses.map(normalizeBusiness),
    next_cursor: extractNextCursor(response),
  };
}

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

  const submitPayload = companies.map((company) => ({
    ...company,
    title,
    max_k,
    info_access,
  }));
  const submit = await openmartRequest<JsonRecord>(
    config,
    "POST",
    "/api/v1/task/batch/find_people",
    submitPayload,
  );
  const batchId = findString(submit, ["batch_id", "id", "data.batch_id", "data.id"]);
  if (!batchId) {
    throw new OpenmartApiError("Openmart did not return a batch_id for find_people.", undefined, submit);
  }

  const deadline = Date.now() + timeoutMs;
  let latestStatus: JsonRecord = {};

  while (Date.now() < deadline) {
    latestStatus = await openmartRequest<JsonRecord>(
      config,
      "GET",
      `/api/v1/task/batch/${encodeURIComponent(batchId)}/status`,
    );

    if (isBatchReady(latestStatus)) {
      const taskIds = await fetchCompletedTaskIds(config, batchId);
      const contacts = await fetchTaskContacts(config, taskIds);
      return {
        status: "completed",
        batch_id: batchId,
        contacts,
        skipped_rows,
      };
    }

    await delay(pollIntervalMs);
  }

  return {
    status: "processing",
    batch_id: batchId,
    batch_status: latestStatus,
    skipped_rows,
    message: "Decision-maker enrichment is still running.",
  };
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

async function openmartRequest<T>(
  config: OpenmartConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = new URL(path, ensureTrailingSlash(config.baseUrl));
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await parseBody(response);

  if (!response.ok) {
    throw mapApiError(response.status, responseBody);
  }

  return responseBody as T;
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
    num_stores: content.num_stores ?? content.num_locations,
    match_score: value.match_score,
    match_highlights: value.match_highlights,
  });
}

function extractNextCursor(response: unknown): unknown {
  const explicit = getNested(response, "next_cursor") ?? getNested(response, "data.next_cursor");
  if (explicit !== undefined) {
    return explicit;
  }

  if (Array.isArray(response) && response.length > 0) {
    const last = response[response.length - 1];
    return isRecord(last) ? last.cursor ?? null : null;
  }

  return null;
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
