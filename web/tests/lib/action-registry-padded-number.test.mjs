import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/web-ts-alias-loader.mjs";

const { dispatch } = await import("../../src/app/actions/registry.ts");

function context() {
  const started = [];
  const writes = [];
  const pushed = [];
  return {
    started,
    writes,
    pushed,
    ctx: {
      push(p) { pushed.push(p); },
      replace() {},
      startJob(opts) {
        started.push(opts);
        return `job-${started.length}`;
      },
      inbox: [],
      applications: [{ n: "7", company: "Acme", role: "Engineer" }],
      jobForUrl() {},
      estimateCost() {
        return { tokens: 0, usd: 0 };
      },
      rememberFact() {},
      writeStatus(n, status) {
        writes.push([n, status]);
      },
      setApplyField() {},
      startApply() {},
    },
  };
}

// Local customisation (2026-11-10): generatePdf no longer starts the retired
// generic-template CV worker; it opens the job page, where the shared
// original-format generator runs. It must never start a worker.
test("generatePdf opens the job page and starts no worker", () => {
  const { ctx, started, pushed } = context();
  dispatch("generatePdf", { n: "007" }, ctx);
  assert.deepEqual(started, []);
  assert.deepEqual(pushed, ["/opportunities/007"]);
});

test("setStatus names the company and role for a zero-padded application number", async () => {
  const { ctx, writes } = context();
  const result = dispatch("setStatus", { n: "007", status: "Applied" }, ctx);
  assert.equal(result.summary, "Mark Acme · Engineer → Applied?");
  await result.run();
  assert.deepEqual(writes, [["007", "Applied"]]);
});

test("generatePdf ignores a non-numeric number and starts nothing", () => {
  const { ctx, started, pushed } = context();
  dispatch("generatePdf", { n: "abc" }, ctx);
  dispatch("generatePdf", { n: "7abc" }, ctx);
  assert.deepEqual(started, []);
  assert.deepEqual(pushed, []);
});


test("setStatus keeps its approved target and waits for the write result", async () => {
  const { ctx } = context();
  let release;
  ctx.writeStatus = () => new Promise((resolve) => { release = resolve; });
  const result = dispatch("setStatus", { n: "007", status: "Rejected" }, ctx);
  assert.deepEqual(result.statusChange, { n: "007", status: "Rejected" });
  let completed = false;
  const pending = result.run().then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  release(); await pending;
  assert.equal(completed, true);
  ctx.writeStatus = async () => { throw new Error("write failed"); };
  await assert.rejects(dispatch("setStatus", { n: "007", status: "Rejected" }, ctx).run(), /write failed/);
});
