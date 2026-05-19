import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFindPeopleCompanies,
  extractDomain,
  normalizeDomain,
} from "../src/openmart.js";

test("normalizes domains from URLs and hostnames", () => {
  assert.equal(extractDomain("https://www.example.com/path?q=1"), "example.com");
  assert.equal(extractDomain("www.example.com/store"), "example.com");
  assert.equal(normalizeDomain("HTTPS://WWW.Example.COM/path"), "example.com");
});

test("builds find_people companies and skips rows without domains", () => {
  const result = buildFindPeopleCompanies({
    businesses: [
      {
        openmart_id: "biz_1",
        business_name: "Blue Bottle Coffee",
        root_domain: "bluebottlecoffee.com",
        city: "San Francisco",
        state: "CA",
        country: "US",
      },
      {
        openmart_id: "biz_2",
        business_name: "No Website LLC",
      },
    ],
  });

  assert.deepEqual(result.companies, [
    {
      domain: "bluebottlecoffee.com",
      company_name: "Blue Bottle Coffee",
      city: "San Francisco",
      state: "CA",
      country: "US",
      tracking_id: "biz_1",
    },
  ]);
  assert.deepEqual(result.skipped_rows, [
    {
      reason: "missing_domain",
      business_name: "No Website LLC",
      openmart_id: "biz_2",
    },
  ]);
});
