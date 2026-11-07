// Handoff contracts: validator rules, instruction section, in-place swap, and the profiles that use them.
// usage: node tests/handoffs.mjs   (no app needed)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { checkHandoffs, handoffRule, withHandoffs } from "../handoffs.mjs";

const names = ["A", "B", "C"];
const step = (from, to) => ({ from, to, hands: "งาน", requires: ["หลักฐาน"] });
let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log("✓", label); };
const rejects = (label, flows, pattern) => ok(label, () => assert.throws(() => checkHandoffs(flows, names), pattern));

ok("no handoffs is allowed", () => checkHandoffs(undefined, names));
ok("straight chain without maxReturns passes", () => checkHandoffs([{ flow: "f", steps: [step("A", "B"), step("B", "C")] }], names));
ok("loop with maxReturns passes", () => checkHandoffs([{ flow: "f", maxReturns: 2, steps: [step("A", "B"), step("B", "A")] }], names));
rejects("unknown bot", [{ flow: "f", steps: [step("A", "Z")] }], /ไม่มีบอท Z/);
rejects("bot hands to itself", [{ flow: "f", steps: [step("A", "A")] }], /ตัวเอง/);
rejects("missing evidence", [{ flow: "f", steps: [{ from: "A", to: "B", hands: "งาน", requires: [] }] }], /requires/);
rejects("missing hands", [{ flow: "f", steps: [{ from: "A", to: "B", requires: ["x"] }] }], /hands/);
rejects("loop without cap", [{ flow: "f", steps: [step("A", "B"), step("B", "C"), step("C", "A")] }], /maxReturns 1-3/);
rejects("cap above 3", [{ flow: "f", maxReturns: 5, steps: [step("A", "B"), step("B", "A")] }], /maxReturns 1-3/);
rejects("cap on a chain that never loops", [{ flow: "f", maxReturns: 1, steps: [step("A", "B")] }], /ไม่ต้องตั้ง/);
rejects("duplicate flow name", [{ flow: "f", steps: [step("A", "B")] }, { flow: "f", steps: [step("B", "C")] }], /ซ้ำ/);

const p = { handoffs: [{ flow: "f", maxReturns: 1, steps: [step("A", "B"), step("B", "A")] }] };
ok("bot outside every flow gets no section", () => assert.equal(handoffRule(p, "C"), ""));
ok("sender and receiver both see their side", () => {
  assert.match(handoffRule(p, "A"), /ส่งให้ B/);
  assert.match(handoffRule(p, "A"), /รับจาก B/);
  assert.match(handoffRule(p, "A"), /ไม่เกิน 1 รอบ/);
});
ok("in-place swap keeps hand edits and replaces the old section", () => {
  const edited = "คำสั่งเดิมที่คนแก้เอง" + handoffRule(p, "A");
  const p2 = { handoffs: [{ flow: "g", steps: [step("A", "C")] }] };
  const next = withHandoffs(p2, edited, "A");
  assert.ok(next.startsWith("คำสั่งเดิมที่คนแก้เอง"));
  assert.match(next, /Flow "g"/);
  assert.doesNotMatch(next, /Flow "f"/);
  assert.equal(withHandoffs(p2, next, "A"), next, "running twice changes nothing");
});
ok("removing all flows strips the section", () => assert.equal(withHandoffs({}, "เดิม" + handoffRule(p, "A"), "A"), "เดิม"));

// every profile still passes its own dry-run; mining carries its 3 flows
const dry = name => JSON.parse(execFileSync("node", ["seed-bots.mjs", "--profile", name, "--dry-run"], { cwd: new URL("..", import.meta.url) }));
for (const name of ["company", ...fs.readdirSync(new URL("../profiles", import.meta.url)).map(f => f.replace(/\.json$/, ""))])
  ok(`dry-run ${name}`, () => assert.ok(dry(name).longestInstructions < 20000));
ok("mining has 3 handoff flows", () => assert.equal(dry("mining").handoffs.length, 3));

console.log(`\n${passed} passed`);
