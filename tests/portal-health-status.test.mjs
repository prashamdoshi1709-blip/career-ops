// Portal health states and 429 handling (2026-11-22). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { portalHealth, deferredByRateLimit, rateLimitBackoffMs } from "../portal-health-status.mjs";
import { classifyFetchError } from "../verify-portals.mjs";
import { computeConsecutiveFailures, withProviderSlot } from "../scan.mjs";

const T = (h) => new Date(Date.UTC(2026, 10, 22, h)).toISOString();

test("429 is rate_limited, not unknown, server or broken", () => {
  assert.equal(classifyFetchError({ status: 429 }), "rate_limited");
  assert.equal(classifyFetchError(new Error("HTTP 429 Too Many Requests")), "rate_limited");
  assert.equal(classifyFetchError({ status: 404 }), "slug_gone");
  assert.equal(classifyFetchError({ status: 503 }), "server");
});

test("states: healthy, rate-limited with backoff, auth, unavailable, broken, unknown", () => {
  const rows = [
    { timestamp: T(0), company: "A", status: "reachable" },
    { timestamp: T(0), company: "B", status: "reachable" }, { timestamp: T(1), company: "B", status: "rate_limited" }, { timestamp: T(2), company: "B", status: "rate_limited" },
    { timestamp: T(1), company: "C", status: "auth" },
    { timestamp: T(1), company: "D", status: "network" },
    { timestamp: T(1), company: "E", status: "slug_gone" }, { timestamp: T(2), company: "E", status: "slug_gone" },
    { timestamp: T(1), company: "F", status: "slug_gone" },
    { timestamp: T(1), company: "G", status: "unknown" },
  ];
  const h = portalHealth(rows, Date.parse(T(3)));
  assert.equal(h.get("A").state, "Healthy");
  assert.equal(h.get("B").state, "Temporarily rate-limited");
  assert.equal(h.get("B").lastSuccessAt, T(0));
  assert.equal(h.get("B").retryAfter, new Date(Date.parse(T(2)) + rateLimitBackoffMs(2)).toISOString());
  assert.equal(h.get("C").state, "Authentication required");
  assert.equal(h.get("D").state, "Temporarily unavailable");
  assert.equal(h.get("E").state, "Confirmed broken");
  assert.equal(h.get("F").state, "Temporarily unavailable", "one 404 is not yet broken");
  assert.equal(h.get("G").state, "Unknown");
  assert.deepEqual([...deferredByRateLimit(rows, Date.parse(T(3))).keys()], ["B"]);
  assert.deepEqual([...deferredByRateLimit(rows, Date.parse(T(30))).keys()], [], "backoff expires");
  assert.equal(rateLimitBackoffMs(20), 24 * 3600_000, "capped at 24h");
});

test("a 429 never counts toward the dead-portal streak", () => {
  const s = computeConsecutiveFailures([{ company: "X", status: "network" }, { company: "X", status: "rate_limited" }, { company: "X", status: "rate_limited" }]);
  assert.equal(s.get("X"), 1);
});

test("provider slots cap concurrency", async () => {
  let active = 0, peak = 0;
  const job = () => withProviderSlot("t", 2, async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; });
  await Promise.all(Array.from({ length: 6 }, job));
  assert.equal(peak, 2);
});
