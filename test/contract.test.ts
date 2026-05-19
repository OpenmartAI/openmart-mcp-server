import assert from "node:assert/strict";
import test from "node:test";

import {
  chunk,
  configFromApiKey,
  findBusinesses,
  findDecisionMakers,
  getBatchResults,
} from "../src/openmart.js";

// Contract tests: stub global fetch with canned responses shaped like the
// real Openmart API (captured from api.openmart.ai) and assert the request
// bodies and the parsed results.

const cfg = configFromApiKey("test-key");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Route = (url: string, init: RequestInit) => Response;

function stubFetch(route: Route) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fake = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method ?? "GET", body });
    return route(url, init);
  }) as unknown as typeof fetch;
  return { fake, calls };
}

async function withFetch<T>(fake: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("chunk splits a list into fixed-size groups", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
});

test("find_business sends a flat request body with estimate_total", async () => {
  const { fake, calls } = stubFetch(() => json({ data: [], total_count: 0 }));
  await withFetch(fake, () =>
    findBusinesses(
      {
        query: "coffee",
        location: [{ city: "San Francisco", state: "CA" }],
        min_overall_rating: 4.5,
        has_valid_website: true,
        limit: 10,
      },
      cfg,
    ),
  );

  assert.equal(calls.length, 1);
  const body = calls[0].body as Record<string, unknown>;
  // Filters must be flat top-level keys — a nested `filters` object is
  // silently ignored by /api/v1/search.
  assert.equal(body.filters, undefined);
  assert.equal(body.min_overall_rating, 4.5);
  assert.equal(body.has_valid_website, true);
  assert.equal(body.estimate_total, true);
  assert.equal(body.query, "coffee");
});

const TWO_BUSINESSES = {
  data: [
    { id: "u1", content: { business_name: "Cafe A", root_domain: "a.com", city: "SF" }, cursor: [1, "u1"] },
    { id: "u2", content: { business_name: "Cafe B", root_domain: "b.com", city: "SF" }, cursor: [2.5, "u2"] },
  ],
  total_count: 750,
};

test("find_business parses {data,total_count}; a full page has more pages", async () => {
  const { fake } = stubFetch(() => json(TWO_BUSINESSES));
  // limit 2 + 2 rows back = a full page, so there is probably more.
  const result = await withFetch(fake, () => findBusinesses({ query: "coffee", limit: 2 }, cfg));

  assert.equal(result.total_count, 750);
  assert.equal(result.has_more, true);
  assert.deepEqual(result.next_cursor, [2.5, "u2"]);
  const businesses = result.businesses as Array<Record<string, unknown>>;
  assert.equal(businesses.length, 2);
  assert.equal(businesses[0].business_name, "Cafe A");
  assert.equal(businesses[0].root_domain, "a.com");
});

test("find_business marks a short page as the last one", async () => {
  const { fake } = stubFetch(() => json(TWO_BUSINESSES));
  // 2 rows back against the default limit of 50 = a short page = the end.
  const result = await withFetch(fake, () => findBusinesses({ query: "coffee" }, cfg));

  assert.equal(result.has_more, false);
  assert.equal(result.next_cursor, null);
});

test("find_business reports an empty result without throwing", async () => {
  const { fake } = stubFetch(() => json({ data: [], total_count: 0 }));
  const result = await withFetch(fake, () => findBusinesses({ query: "nothing" }, cfg));

  assert.deepEqual(result.businesses, []);
  assert.equal(result.total_count, 0);
  assert.equal(result.has_more, false);
  assert.equal(result.next_cursor, null);
  assert.match(String(result.message), /No businesses/);
});

test("find_decision_maker runs submit/poll/fetch and returns contacts", async () => {
  const { fake } = stubFetch((url) => {
    if (url.includes("/task/batch/find_people")) {
      return json({ batch_id: "b1", submit_for: "find_people", status: { batch_ready: false } });
    }
    if (url.includes("/status")) {
      return json({ processing: 0, completed: 1, errored: 0, total: 1, batch_ready: true });
    }
    if (url.includes("/task_ids")) {
      return json(["t1"]);
    }
    if (url.includes("/task/t1")) {
      return json({
        data: [
          {
            first_name: "Karl",
            last_name: "Strovink",
            title: "CEO",
            email: { email: "karl@bluebottle.com", verified: true },
            phones: [],
            linkedin_url: "https://linkedin.com/in/karl",
          },
        ],
        status: "COMPLETED",
        task_id: "t1",
        tracking_id: "biz_1",
      });
    }
    return json({}, 404);
  });

  const result = await withFetch(fake, () =>
    findDecisionMakers(
      {
        businesses: [{ root_domain: "bluebottle.com", openmart_id: "biz_1" }],
        title: "CEO",
        poll_interval_ms: 1,
        timeout_seconds: 5,
      },
      cfg,
    ),
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(result.batch_ids, ["b1"]);
  const contacts = result.contacts as Array<Record<string, unknown>>;
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].first_name, "Karl");
  assert.deepEqual(contacts[0].email, { email: "karl@bluebottle.com", verified: true });
  assert.equal(contacts[0].tracking_id, "biz_1");
  assert.equal(contacts[0].task_id, "t1");
});

test("find_decision_maker splits >100 companies into multiple batches", async () => {
  const submittedSizes: number[] = [];
  let batchN = 0;
  const { fake } = stubFetch((url, init) => {
    if (url.includes("/task/batch/find_people")) {
      const payload = typeof init.body === "string" ? JSON.parse(init.body) : [];
      submittedSizes.push(payload.length);
      batchN += 1;
      return json({ batch_id: `b${batchN}`, status: { batch_ready: false } });
    }
    if (url.includes("/status")) {
      return json({ batch_ready: true });
    }
    if (url.includes("/task_ids")) {
      return json([]);
    }
    return json({});
  });

  const businesses = Array.from({ length: 230 }, (_, i) => ({ domain: `d${i}.com` }));
  const result = await withFetch(fake, () =>
    findDecisionMakers({ businesses, poll_interval_ms: 1 }, cfg),
  );

  assert.deepEqual(submittedSizes, [100, 100, 30]);
  assert.deepEqual(result.batch_ids, ["b1", "b2", "b3"]);
  assert.equal(result.status, "completed");
});

test("find_decision_maker skips companies with no resolvable domain", async () => {
  const result = await findDecisionMakers(
    { businesses: [{ business_name: "No Website LLC", openmart_id: "biz_9" }], poll_interval_ms: 1 },
    cfg,
  );

  // Nothing had a domain, so no batch is submitted at all.
  assert.equal(result.status, "completed");
  const skipped = result.skipped_rows as Array<Record<string, unknown>>;
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, "missing_domain");
});

test("a transient 503 is retried", async () => {
  let n = 0;
  const { fake } = stubFetch(() => {
    n += 1;
    return n < 2 ? json({}, 503) : json({ data: [], total_count: 5 });
  });
  const result = await withFetch(fake, () => findBusinesses({ query: "coffee" }, cfg));

  assert.equal(n, 2);
  assert.equal(result.total_count, 5);
});

test("a 401 maps to an invalid-key error", async () => {
  const { fake } = stubFetch(() => json({ detail: "Invalid API Key" }, 401));
  await assert.rejects(
    withFetch(fake, () => findBusinesses({ query: "coffee" }, cfg)),
    /Invalid Openmart API key/,
  );
});

test("get_batch_results collects contacts from ready batches", async () => {
  const { fake } = stubFetch((url) => {
    if (url.includes("/status")) {
      return json({ processing: 0, completed: 1, errored: 0, total: 1, batch_ready: true });
    }
    if (url.includes("/task_ids")) {
      return json(["t9"]);
    }
    if (url.includes("/task/t9")) {
      return json({
        data: [
          {
            first_name: "Dana",
            last_name: "Lee",
            title: "Owner",
            email: { email: "dana@shop.com", verified: false },
            phones: [{ phone_number: "+15551234567", line_type: "MOBILE", valid: true }],
          },
        ],
        status: "COMPLETED",
        task_id: "t9",
        tracking_id: "biz_x",
      });
    }
    return json({}, 404);
  });

  const result = await withFetch(fake, () =>
    getBatchResults({ batch_ids: ["b9"], poll_interval_ms: 1, timeout_seconds: 5 }, cfg),
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(result.batch_ids, ["b9"]);
  const contacts = result.contacts as Array<Record<string, unknown>>;
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].first_name, "Dana");
  assert.equal(contacts[0].tracking_id, "biz_x");
});

test("get_batch_results returns 'processing' while a batch is unfinished", async () => {
  const { fake } = stubFetch(() =>
    json({ processing: 1, completed: 0, errored: 0, total: 1, batch_ready: false }),
  );
  const result = await withFetch(fake, () =>
    getBatchResults({ batch_ids: ["b1", "b2"], poll_interval_ms: 1, timeout_seconds: 0 }, cfg),
  );

  assert.equal(result.status, "processing");
  assert.deepEqual(result.pending_batch_ids, ["b1", "b2"]);
  assert.deepEqual(result.contacts, []);
});

test("get_batch_results handles an empty batch_ids list", async () => {
  const result = await getBatchResults({ batch_ids: [] }, cfg);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.contacts, []);
});
