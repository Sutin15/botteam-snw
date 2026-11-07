// Handoff contracts for bot-team profiles (kept apart from seed-bots.mjs so tests can import it without starting the app).
const HANDOFF_HEAD = "\n\n# การส่งงานต่อ\n";
// Pattern borrowed from prompts.chat Bot Teams (CC0): each flow lists who hands what to whom and which evidence must travel
// with it. A flow whose arrows form a loop (verifier sends work back) must cap the returns, or bots can bounce work forever.
const hasCycle = steps => {
  const next = new Map();
  for (const s of steps) next.set(s.from, [...(next.get(s.from) || []), s.to]);
  const state = new Map(); // 1 = on the current path, 2 = done
  const visit = n => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    const found = (next.get(n) || []).some(visit);
    state.set(n, 2);
    return found;
  };
  return [...next.keys()].some(visit);
};
export function checkHandoffs(flows, names) {
  if (flows === undefined) return;
  if (!Array.isArray(flows)) throw new Error("handoffs ต้องเป็น array");
  const seen = new Set();
  for (const f of flows) {
    if (!f.flow || seen.has(f.flow)) throw new Error(`handoffs: ชื่อ flow ว่างหรือซ้ำ (${f.flow})`);
    seen.add(f.flow);
    if (!Array.isArray(f.steps) || !f.steps.length) throw new Error(`${f.flow}: ต้องมี steps อย่างน้อย 1 ขั้น`);
    for (const s of f.steps) {
      for (const x of [s.from, s.to]) if (!names.includes(x)) throw new Error(`${f.flow}: ไม่มีบอท ${x}`);
      if (s.from === s.to) throw new Error(`${f.flow}: ${s.from} ส่งงานให้ตัวเองไม่ได้`);
      if (!s.hands) throw new Error(`${f.flow}: ${s.from} → ${s.to} ต้องบอกว่าส่งอะไร (hands)`);
      if (!Array.isArray(s.requires) || !s.requires.length) throw new Error(`${f.flow}: ${s.from} → ${s.to} ต้องระบุหลักฐานที่แนบ (requires)`);
    }
    const loops = hasCycle(f.steps);
    if (loops && !(Number.isInteger(f.maxReturns) && f.maxReturns >= 1 && f.maxReturns <= 3))
      throw new Error(`${f.flow}: มีการส่งงานวนกลับ ต้องตั้ง maxReturns 1-3`);
    if (!loops && f.maxReturns !== undefined) throw new Error(`${f.flow}: ไม่มีการส่งวนกลับ ไม่ต้องตั้ง maxReturns`);
  }
}
// The part of each flow that concerns one bot, written into that bot's instructions.
export const handoffRule = (p, name) => {
  const lines = [];
  for (const f of p.handoffs || []) {
    const mine = f.steps.filter(s => s.from === name || s.to === name);
    if (!mine.length) continue;
    lines.push(`- Flow "${f.flow}"${f.maxReturns ? ` (ตีกลับได้ไม่เกิน ${f.maxReturns} รอบ เกินนั้นหยุดแล้วส่งเรื่องให้คนตัดสิน)` : ""}:`);
    for (const s of mine) lines.push(s.from === name
      ? `  - ส่งให้ ${s.to}: ${s.hands} · ต้องแนบ ${s.requires.join(", ")}`
      : `  - รับจาก ${s.from}: ${s.hands} · ถ้าขาด ${s.requires.join(", ")} ให้ตีกลับ ห้ามเดาเติม`);
  }
  return lines.length ? HANDOFF_HEAD + lines.join("\n") : "";
};
// Swap only the trailing handoff section of instructions a bot already has, so hand edits above it survive.
export const withHandoffs = (p, current, name) => (current.includes(HANDOFF_HEAD) ? current.slice(0, current.indexOf(HANDOFF_HEAD)) : current) + handoffRule(p, name);
