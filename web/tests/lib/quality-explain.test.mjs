import { test } from "node:test";
import assert from "node:assert/strict";
import { explainQuality } from "../../src/lib/quality-explain.mjs";

test("every non-passing check gets an explanation; issues block, reviews do not", () => {
  assert.equal(explainQuality({ group: "File validation", status: "ok" }), null);
  const f = explainQuality({ group: "File validation", status: "issue" });
  assert.equal(f.blocks, true); assert.match(f.reliability, /Mechanical/);
  const r = explainQuality({ group: "Human readability", status: "review" });
  assert.equal(r.blocks, false); assert.match(r.reliability, /false positive/);
  assert.ok(explainQuality({ group: "Some future check", status: "warning" }).checks.length > 0);
  const own = explainQuality({ group: "Personal check", status: "issue", explain: { kind: "mechanical", checks: "c", fix: "f" } });
  assert.equal(own.checks, "c"); assert.match(own.reliability, /Mechanical/);
});
