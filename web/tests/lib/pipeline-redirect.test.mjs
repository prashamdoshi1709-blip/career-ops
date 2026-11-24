import { test } from "node:test";
import assert from "node:assert/strict";
import { pipelineRedirectTarget } from "../../src/lib/pipeline-redirect.mjs";

test("old /pipeline links keep their query; compare ids become n (2026-11-22)", () => {
  assert.equal(pipelineRedirectTarget(["compare"], { ids: "3,7" }), "/opportunities/compare?n=3%2C7");
  assert.equal(pipelineRedirectTarget(["compare"], { n: "3,7" }), "/opportunities/compare?n=3%2C7");
  assert.equal(pipelineRedirectTarget(["17", "apply"], {}), "/opportunities/17/apply");
  assert.equal(pipelineRedirectTarget([], { tab: "all" }), "/opportunities?tab=all");
  assert.equal(pipelineRedirectTarget([], {}), "/opportunities");
});
