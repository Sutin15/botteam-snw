// Mining data MCP for the Sn-W project bot team (โครงการเหมือง Sn-W รัฐฉาน).
// Same transport as demo-acct/server.mjs: MCP over Streamable HTTP, stateless JSON, zero dependencies, bearer token,
// runs as a sidecar in rakazo-worker's network namespace (bots can only reach http://localhost or public https).
// The store starts EMPTY — no made-up numbers. Only people/bots record real data through the tools below.
// Guardrails (physical limits): Sn 0–78.7 %, WO3 0–76.5 %, recovery 0–100 %, tonnage/length >= 0. Values outside are
// rejected as data_error and never enter a summary. Every mutating call takes an idempotency key; records are append-only
// (corrections = a new record that supersedes, so the audit trail survives).
// usage: node server.mjs            (serves 127.0.0.1:7789/mcp, bearer token from ./token, data in ./data.json)
//        node server.mjs --selftest (checks on a fresh in-memory store, no network)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(DIR, "data.json"), PORT = Number(process.env.MINING_MCP_PORT || 7789);
export const LIMITS = { sn: [0, 78.7], wo3: [0, 76.5], recovery: [0, 100] };
const ZONES = ["Zone 1", "Zone 2", "Zone 3", "Pit A", "Pit B", "Pit C", "Pit D", "อื่นๆ"];
const INCIDENT_TYPES = ["near_miss", "injury", "equipment", "slope", "environment", "community", "security", "other"];
const TYPE_TH = { near_miss: "เกือบเกิดเหตุ", injury: "บาดเจ็บ", equipment: "เครื่องจักร", slope: "ลาด/ผนังบ่อ", environment: "สิ่งแวดล้อม", community: "ชุมชน", security: "ความปลอดภัยพื้นที่", other: "อื่นๆ" };

// ---------- helpers ----------
const now = () => new Date(Date.now() + 7 * 3600e3).toISOString().replace("Z", "+07:00"); // Asia/Bangkok stamp
const today = () => now().slice(0, 10);
const r = (n, d = 2) => n == null ? null : Math.round(n * 10 ** d) / 10 ** d;
export class DataError extends Error { constructor(m) { super("data_error: " + m); } }
const num = (v, name, { min = 0, max = Infinity, optional = false } = {}) => {
  if (v == null || v === "") { if (optional) return null; throw new DataError(`ต้องระบุ ${name}`); }
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new DataError(`${name} ไม่ใช่ตัวเลข: ${v}`);
  if (n < min || n > max) throw new DataError(`${name} = ${n} อยู่นอกช่วงทางกายภาพ ${min}–${max === Infinity ? "∞" : max}`);
  return n;
};
const date = (v, name = "date") => {
  const d = v || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new DataError(`${name} ต้องเป็น YYYY-MM-DD: ${v}`);
  return d;
};
const txt = (v, name, max = 500, optional = true) => {
  const s = String(v ?? "").trim();
  if (!s && !optional) throw new DataError(`ต้องระบุ ${name}`);
  return s.slice(0, max);
};
const holeId = v => { const s = txt(v, "hole_id", 40, false).toUpperCase(); if (!/^[A-Z0-9._-]+$/.test(s)) throw new DataError(`hole_id ใช้ได้แค่ A-Z 0-9 . _ - : ${v}`); return s; };

export function freshStore() {
  return { version: 1, created: now(), intervals: [], shifts: [], incidents: [], keys: {}, seq: { incident: 0 } };
}
// idempotency: same key -> return the first result, write nothing
function once(s, kind, key, make) {
  const k = key ? `${kind}:${key}` : null;
  if (k && s.keys[k]) return { ...s.keys[k], duplicate: true };
  const out = make();
  if (k) s.keys[k] = out;
  return out;
}
const live = arr => arr.filter(x => !x.supersededBy);

// ---------- drill holes ----------
export function addInterval(s, a) {
  const hole = holeId(a.hole_id), from = num(a.from_m, "from_m"), to = num(a.to_m, "to_m");
  if (to <= from) throw new DataError(`to_m (${to}) ต้องมากกว่า from_m (${from})`);
  const sn = num(a.sn_pct, "sn_pct", { min: LIMITS.sn[0], max: LIMITS.sn[1], optional: true });
  const wo3 = num(a.wo3_pct, "wo3_pct", { min: LIMITS.wo3[0], max: LIMITS.wo3[1], optional: true });
  return once(s, "interval", a.idempotency_key, () => {
    const overlap = live(s.intervals).filter(i => i.hole === hole && i.from < to && i.to > from);
    if (overlap.length && !a.supersede) throw new DataError(`ช่วง ${from}–${to} m ทับกับข้อมูลเดิม (${overlap.map(i => `${i.from}–${i.to}`).join(", ")}) — ถ้าเป็นการแก้ไข ให้ส่ง supersede=true`);
    const rec = { id: `${hole}@${from}-${to}#${s.intervals.length + 1}`, hole, from, to, lithology: txt(a.lithology, "lithology", 60), sn, wo3,
      sample: txt(a.sample_id, "sample_id", 40), source: txt(a.source, "source", 120) || "ไม่ระบุแหล่ง", at: now() };
    for (const o of overlap) o.supersededBy = rec.id;
    s.intervals.push(rec);
    return { id: rec.id, superseded: overlap.map(o => o.id) };
  });
}
export function holeSummary(s, hole) {
  const iv = live(s.intervals).filter(i => i.hole === hole).sort((a, b) => a.from - b.from);
  const w = el => { const a = iv.filter(i => i[el] != null), L = a.reduce((x, i) => x + i.to - i.from, 0);
    return { assayed_m: r(L), grade: L ? r(a.reduce((x, i) => x + (i.to - i.from) * i[el], 0) / L, 3) : null }; };
  return { hole, intervals: iv.length, logged_m: r(iv.reduce((x, i) => x + i.to - i.from, 0)), depth_m: iv.length ? iv.at(-1).to : 0, sn: w("sn"), wo3: w("wo3"), rows: iv };
}
// best contiguous run at/above cutoff (adjacent = next.from == prev.to), ranked by metal accumulation (grade × length)
export function bestIntercept(s, { hole, element = "sn", cutoff = 0, min_length = 0 }) {
  const el = element === "wo3" ? "wo3" : "sn", holes = hole ? [hole] : [...new Set(live(s.intervals).map(i => i.hole))];
  let best = null;
  for (const h of holes) {
    const iv = live(s.intervals).filter(i => i.hole === h && i[el] != null).sort((a, b) => a.from - b.from);
    let run = [];
    const close = () => {
      if (!run.length) return;
      const L = run.at(-1).to - run[0].from, g = run.reduce((x, i) => x + (i.to - i.from) * i[el], 0) / L;
      if (L >= min_length && (!best || g * L > best.gxl)) best = { hole: h, from: run[0].from, to: run.at(-1).to, length_m: r(L), grade: r(g, 3), gxl: g * L };
      run = [];
    };
    for (const i of iv) {
      if (i[el] >= cutoff && (!run.length || Math.abs(run.at(-1).to - i.from) < 0.005)) run.push(i);
      else { close(); if (i[el] >= cutoff) run.push(i); }
    }
    close();
  }
  if (best) best.gxl = r(best.gxl, 3);
  return best;
}

// ---------- production ----------
export function logShift(s, a) {
  const rec = {
    date: date(a.date), shift: a.shift === "night" ? "night" : "day", zone: ZONES.includes(a.zone) ? a.zone : (() => { throw new DataError(`zone ต้องเป็น ${ZONES.join(" / ")}`); })(),
    ore_t: num(a.ore_t, "ore_t"), waste_t: num(a.waste_t, "waste_t", { optional: true }) ?? 0,
    feed_t: num(a.feed_t, "feed_t", { optional: true }), feed_sn_pct: num(a.feed_sn_pct, "feed_sn_pct", { max: LIMITS.sn[1], optional: true }),
    conc_t: num(a.conc_t, "conc_t", { optional: true }), conc_sn_pct: num(a.conc_sn_pct, "conc_sn_pct", { max: LIMITS.sn[1], optional: true }),
    fuel_l: num(a.fuel_l, "fuel_l", { optional: true }), note: txt(a.note, "note"), source: txt(a.source, "source", 120) || "ไม่ระบุแหล่ง",
  };
  if (rec.conc_t != null && rec.feed_t != null && rec.conc_t > rec.feed_t) throw new DataError(`conc_t (${rec.conc_t}) มากกว่า feed_t (${rec.feed_t}) ไม่ได้`);
  const rec_pct = recovery(rec);
  if (rec_pct != null && (rec_pct < LIMITS.recovery[0] || rec_pct > LIMITS.recovery[1])) throw new DataError(`recovery คำนวณได้ ${r(rec_pct, 1)}% อยู่นอกช่วง 0–100% — ตรวจเกรดหรือตันอีกครั้ง`);
  return once(s, "shift", a.idempotency_key, () => {
    const prev = live(s.shifts).find(x => x.date === rec.date && x.shift === rec.shift && x.zone === rec.zone);
    if (prev && !a.supersede) throw new DataError(`มีบันทึก ${rec.zone} ${rec.date} กะ${rec.shift === "day" ? "เช้า" : "ดึก"} แล้ว — ถ้าแก้ไขให้ส่ง supersede=true`);
    const id = `S${s.shifts.length + 1}`;
    if (prev) prev.supersededBy = id;
    s.shifts.push({ id, ...rec, at: now() });
    return { id, recovery_pct: rec_pct == null ? null : r(rec_pct, 1), superseded: prev ? [prev.id] : [] };
  });
}
const recovery = x => (x.feed_t && x.feed_sn_pct && x.conc_t != null && x.conc_sn_pct != null) ? (x.conc_t * x.conc_sn_pct) / (x.feed_t * x.feed_sn_pct) * 100 : null;
export function productionSummary(s, { from, to, zone } = {}) {
  const rows = live(s.shifts).filter(x => (!from || x.date >= from) && (!to || x.date <= to) && (!zone || x.zone === zone));
  const sum = k => rows.reduce((a, x) => a + (x[k] ?? 0), 0);
  const withRec = rows.filter(x => recovery(x) != null);
  const snIn = withRec.reduce((a, x) => a + x.feed_t * x.feed_sn_pct, 0), snOut = withRec.reduce((a, x) => a + x.conc_t * x.conc_sn_pct, 0);
  const ore = sum("ore_t"), waste = sum("waste_t");
  return { shifts: rows.length, ore_t: r(ore), waste_t: r(waste), strip_ratio: ore ? r(waste / ore) : null, feed_t: r(sum("feed_t")), conc_t: r(sum("conc_t"), 3),
    sn_in_conc_t: r(snOut / 100, 3), recovery_pct: snIn ? r(snOut / snIn * 100, 1) : null, recovery_basis_shifts: withRec.length,
    fuel_l: r(sum("fuel_l")), fuel_l_per_t_moved: ore + waste ? r(sum("fuel_l") / (ore + waste), 3) : null };
}

// ---------- HSE / incidents ----------
export function logIncident(s, a) {
  const type = INCIDENT_TYPES.includes(a.type) ? a.type : (() => { throw new DataError(`type ต้องเป็น ${INCIDENT_TYPES.join(" / ")}`); })();
  const sev = num(a.severity, "severity", { min: 1, max: 5 });
  if (!Number.isInteger(sev)) throw new DataError("severity ต้องเป็นจำนวนเต็ม 1–5");
  const rec = { date: date(a.date), zone: txt(a.zone, "zone", 40) || "ไม่ระบุ", type, severity: sev, description: txt(a.description, "description", 1000, false),
    immediate_action: txt(a.immediate_action, "immediate_action", 500), reported_by: txt(a.reported_by, "reported_by", 80) };
  return once(s, "incident", a.idempotency_key, () => {
    const id = `INC-${String(++s.seq.incident).padStart(4, "0")}`;
    s.incidents.push({ id, ...rec, status: "open", at: now() });
    return { id, escalate: sev >= 4 };
  });
}
export function closeIncident(s, a) {
  const i = s.incidents.find(x => x.id === a.id);
  if (!i) throw new DataError(`ไม่พบ ${a.id}`);
  if (i.status === "closed") return { id: i.id, duplicate: true };
  Object.assign(i, { status: "closed", closure: txt(a.closure, "closure", 1000, false), closed_by: txt(a.closed_by, "closed_by", 80), closed_at: now() });
  return { id: i.id };
}

// ---------- MCP tools ----------
const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const KEY = { type: "string", description: "คีย์กันบันทึกซ้ำ (เช่น เลขใบรายงาน/เลขตัวอย่าง) — เรียกซ้ำด้วยคีย์เดิมจะไม่บันทึกซ้ำ" };
const SRC = { type: "string", description: "แหล่งข้อมูล เช่น 'ใบ assay lab X เลขที่ 123' หรือ 'รายงานกะ 2026-10-07 คุณ...'" };
const NUMS = { type: ["number", "string"] };
const g = (x, u = "%") => x == null ? "N/A" : x + u;

const TOOLS = {
  data_status: {
    description: "ดูว่าฐานข้อมูลเหมืองมีข้อมูลอะไรแล้วบ้าง (จำนวนหลุม ช่วงเจาะ กะผลิต เหตุการณ์) — เรียกก่อนตอบคำถามตัวเลขทุกครั้ง ถ้าว่างให้ตอบว่าไม่มีข้อมูล ห้ามเดา",
    inputSchema: S({}),
    run: st => {
      const holes = new Set(live(st.intervals).map(i => i.hole)), open = st.incidents.filter(i => i.status === "open").length;
      const last = [...st.intervals, ...st.shifts, ...st.incidents].map(x => x.at).sort().at(-1) || "ยังไม่มี";
      return { text: `หลุมเจาะ ${holes.size} หลุม · ช่วงเจาะ ${live(st.intervals).length} ช่วง · บันทึกกะ ${live(st.shifts).length} กะ · เหตุการณ์ ${st.incidents.length} (เปิดอยู่ ${open}) · อัปเดตล่าสุด ${last}`,
        data: { holes: [...holes], intervals: live(st.intervals).length, shifts: live(st.shifts).length, incidents: st.incidents.length, open_incidents: open, last_update: last } };
    },
  },
  add_drill_interval: {
    description: "บันทึกช่วงหลุมเจาะ (ความลึกเป็นเมตร) พร้อมหินและผล assay Sn%/WO3% (ถ้ามี) — ค่านอกช่วงทางกายภาพจะถูกปฏิเสธ; แก้ข้อมูลเดิมให้ส่ง supersede=true",
    inputSchema: S({ hole_id: { type: "string" }, from_m: NUMS, to_m: NUMS, lithology: { type: "string", description: "เช่น Gr1, Gr2, Pz1, Sn-W vein, Fe-W vein, Qc, saprolite" },
      sn_pct: NUMS, wo3_pct: NUMS, sample_id: { type: "string" }, source: SRC, supersede: { type: "boolean" }, idempotency_key: KEY }, ["hole_id", "from_m", "to_m"]),
    run: (st, a) => { const x = addInterval(st, a); return { text: `${x.duplicate ? "(บันทึกไปแล้ว ไม่บันทึกซ้ำ) " : ""}บันทึก ${x.id}${x.superseded?.length ? ` แทนที่ ${x.superseded.join(", ")}` : ""}`, data: x, wrote: !x.duplicate }; },
  },
  get_hole_summary: {
    description: "สรุปหลุมเจาะ: ความยาวที่ log, เกรดเฉลี่ยถ่วงน้ำหนักความยาว Sn% และ WO3% (คิดเฉพาะช่วงที่มี assay) และรายการช่วงทั้งหมด",
    inputSchema: S({ hole_id: { type: "string" } }, ["hole_id"]),
    run: (st, a) => { const h = holeSummary(st, holeId(a.hole_id));
      if (!h.intervals) return { text: `ไม่มีข้อมูลหลุม ${h.hole}`, data: h };
      return { text: `${h.hole}: ${h.intervals} ช่วง ลึกถึง ${h.depth_m} m (log ${h.logged_m} m)\nSn เฉลี่ย ${g(h.sn.grade)} (assay ${h.sn.assayed_m} m) · WO3 เฉลี่ย ${g(h.wo3.grade)} (assay ${h.wo3.assayed_m} m)\n` +
        h.rows.map(i => `${i.from}–${i.to} m ${i.lithology || "-"} Sn ${g(i.sn)} WO3 ${g(i.wo3)}${i.sample ? " [" + i.sample + "]" : ""}`).join("\n"), data: h }; },
  },
  find_best_intercept: {
    description: "หา intercept ที่ดีที่สุด (ช่วงต่อเนื่องที่เกรด >= cutoff, จัดอันดับด้วย grade×length) ในหลุมเดียวหรือทุกหลุม — เป็นการคำนวณเบื้องต้น ไม่ใช่การจำแนกทรัพยากรตาม JORC",
    inputSchema: S({ hole_id: { type: "string" }, element: { type: "string", enum: ["sn", "wo3"] }, cutoff: NUMS, min_length_m: NUMS }, ["element", "cutoff"]),
    run: (st, a) => { const b = bestIntercept(st, { hole: a.hole_id ? holeId(a.hole_id) : null, element: a.element, cutoff: num(a.cutoff, "cutoff", { max: 100 }), min_length: num(a.min_length_m, "min_length_m", { optional: true }) ?? 0 });
      return { text: b ? `${b.hole}: ${b.length_m} m @ ${b.grade}% ${a.element === "wo3" ? "WO3" : "Sn"} จาก ${b.from}–${b.to} m (grade×length ${b.gxl})` : "ไม่พบช่วงที่ผ่านเงื่อนไข (หรือยังไม่มีข้อมูล assay)", data: b }; },
  },
  log_shift_production: {
    description: "บันทึกผลผลิตรายกะต่อโซน: ore_t, waste_t, feed_t+feed_sn_pct, conc_t+conc_sn_pct (ระบบคำนวณ recovery ให้ และปฏิเสธถ้าเกิน 100%), fuel_l",
    inputSchema: S({ date: { type: "string" }, shift: { type: "string", enum: ["day", "night"] }, zone: { type: "string", enum: ZONES }, ore_t: NUMS, waste_t: NUMS, feed_t: NUMS, feed_sn_pct: NUMS,
      conc_t: NUMS, conc_sn_pct: NUMS, fuel_l: NUMS, note: { type: "string" }, source: SRC, supersede: { type: "boolean" }, idempotency_key: KEY }, ["zone", "ore_t"]),
    run: (st, a) => { const x = logShift(st, a); return { text: `${x.duplicate ? "(บันทึกไปแล้ว) " : ""}บันทึกกะ ${x.id}${x.recovery_pct != null ? ` · recovery ${x.recovery_pct}%` : ""}`, data: x, wrote: !x.duplicate }; },
  },
  get_production_summary: {
    description: "สรุปผลผลิตช่วงวันที่ (YYYY-MM-DD) และโซน: ore/waste, strip ratio, feed, หัวแร่, Sn ในหัวแร่, recovery รวม (ถ่วงน้ำหนักโลหะ), น้ำมันต่อตัน",
    inputSchema: S({ from: { type: "string" }, to: { type: "string" }, zone: { type: "string", enum: ZONES } }),
    run: (st, a) => { const p = productionSummary(st, a);
      if (!p.shifts) return { text: "ไม่มีข้อมูลผลผลิตในช่วงนี้", data: p };
      return { text: `${p.shifts} กะ · ore ${p.ore_t} t · waste ${p.waste_t} t · strip ratio ${p.strip_ratio ?? "N/A"}\nfeed ${p.feed_t} t · หัวแร่ ${p.conc_t} t · Sn ในหัวแร่ ${p.sn_in_conc_t} t · recovery ${g(p.recovery_pct)} (จาก ${p.recovery_basis_shifts} กะที่มีเกรดครบ)\nน้ำมัน ${p.fuel_l} L (${p.fuel_l_per_t_moved ?? "N/A"} L/t ที่ขนย้าย)`, data: p }; },
  },
  log_incident: {
    description: "บันทึกเหตุการณ์ HSE/ชุมชน (severity 1=เล็กน้อย … 5=ร้ายแรง; >=4 ต้องแจ้งหัวหน้าโครงการทันที)",
    inputSchema: S({ date: { type: "string" }, zone: { type: "string" }, type: { type: "string", enum: INCIDENT_TYPES }, severity: { type: "integer", minimum: 1, maximum: 5 },
      description: { type: "string" }, immediate_action: { type: "string" }, reported_by: { type: "string" }, idempotency_key: KEY }, ["type", "severity", "description"]),
    run: (st, a) => { const x = logIncident(st, a); return { text: `${x.duplicate ? "(บันทึกไปแล้ว) " : ""}บันทึก ${x.id}${x.escalate ? " ⚠️ ระดับ 4–5: แจ้งหัวหน้าโครงการทันที" : ""}`, data: x, wrote: !x.duplicate }; },
  },
  list_incidents: {
    description: "ดูรายการเหตุการณ์ (open_only=true เฉพาะที่ยังไม่ปิด) ช่วงวันที่",
    inputSchema: S({ open_only: { type: "boolean" }, from: { type: "string" }, to: { type: "string" } }),
    run: (st, a) => { const rows = st.incidents.filter(i => (!a.open_only || i.status === "open") && (!a.from || i.date >= a.from) && (!a.to || i.date <= a.to));
      return { text: rows.map(i => `${i.id} ${i.date} ${i.zone} [${TYPE_TH[i.type]} ระดับ ${i.severity}] ${i.status === "open" ? "🔴 เปิด" : "✅ ปิด"} — ${i.description}`).join("\n") || "ไม่มีเหตุการณ์ตามเงื่อนไข", data: rows }; },
  },
  close_incident: {
    description: "ปิดเหตุการณ์พร้อมสรุปการแก้ไข (closure)",
    inputSchema: S({ id: { type: "string" }, closure: { type: "string" }, closed_by: { type: "string" } }, ["id", "closure"]),
    run: (st, a) => { const x = closeIncident(st, a); return { text: `${x.duplicate ? "ปิดไปแล้ว: " : "ปิด "}${x.id}`, data: x, wrote: !x.duplicate }; },
  },
};

// ---------- server ----------
function load() { try { return JSON.parse(fs.readFileSync(DATA, "utf8")); } catch { const st = freshStore(); save(st); return st; } }
function save(st) { fs.writeFileSync(DATA + ".tmp", JSON.stringify(st)); fs.renameSync(DATA + ".tmp", DATA); }

export function rpc(st, msg, persist = save) {
  const ok = result => ({ jsonrpc: "2.0", id: msg.id, result }), fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize": return ok({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mining-data", version: "1.0.0" },
      instructions: "ข้อมูลโครงการเหมือง Sn-W รัฐฉาน (ข้อมูลจริงที่ทีมบันทึก) — เรียก data_status ก่อนตอบตัวเลข ถ้าไม่มีข้อมูลให้ตอบ N/A ห้ามเดา; อ้างอิง source ของแต่ละบันทึก" });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": {
      const t = TOOLS[msg.params?.name];
      if (!t) return fail(-32602, "unknown tool " + msg.params?.name);
      try {
        const out = t.run(st, msg.params.arguments || {});
        if (out.wrote) persist(st);
        return ok({ content: [{ type: "text", text: out.text }], structuredContent: { result: out.data } });
      } catch (e) { return ok({ content: [{ type: "text", text: "ผิดพลาด: " + e.message }], isError: true }); }
    }
    default: return msg.id == null ? null : fail(-32601, "method not found");
  }
}

function serve() {
  const token = fs.readFileSync(path.join(DIR, "token"), "utf8").trim();
  const st = load();
  http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, body ? { "content-type": "application/json" } : {}); res.end(body ? JSON.stringify(body) : undefined); };
    if (req.url !== "/mcp") return send(404);
    const auth = Buffer.from(req.headers.authorization || ""), want = Buffer.from("Bearer " + token);
    if (auth.length !== want.length || !crypto.timingSafeEqual(auth, want)) return send(401, { error: "unauthorized" });
    if (req.method !== "POST") return send(405);
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let msg;
      try { msg = JSON.parse(body); } catch { return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
      const out = Array.isArray(msg) ? msg.map(m => rpc(st, m)).filter(Boolean) : rpc(st, msg);
      return out && (!Array.isArray(out) || out.length) ? send(200, out) : send(202);
    });
  }).listen(PORT, "127.0.0.1", () => console.log(`mining-data on 127.0.0.1:${PORT}/mcp`));
}

function selftest() {
  const assert = (c, m) => { if (!c) throw new Error("FAIL " + m); console.log("PASS " + m); };
  const throws = (f, m) => { let t = false; try { f(); } catch (e) { t = e instanceof DataError; } assert(t, m); };
  const st = freshStore();
  assert(!st.intervals.length && !st.shifts.length && !st.incidents.length, "store starts empty (no made-up data)");
  throws(() => addInterval(st, { hole_id: "DH-01", from_m: 0, to_m: 1, sn_pct: 80 }), "Sn 80% rejected (> 78.7)");
  throws(() => addInterval(st, { hole_id: "DH-01", from_m: 0, to_m: 1, wo3_pct: 77 }), "WO3 77% rejected (> 76.5)");
  throws(() => addInterval(st, { hole_id: "DH-01", from_m: 5, to_m: 4 }), "to_m <= from_m rejected");
  throws(() => addInterval(st, { hole_id: "DH-01", from_m: -1, to_m: 1 }), "negative depth rejected");
  assert(st.intervals.length === 0, "rejected values never stored");
  // test fixture only (numbers chosen for easy arithmetic, not project data)
  addInterval(st, { hole_id: "dh-t1", from_m: 0, to_m: 2, lithology: "saprolite", sn_pct: 0.05, idempotency_key: "a" });
  addInterval(st, { hole_id: "DH-T1", from_m: 2, to_m: 3, lithology: "Sn-W vein", sn_pct: 1.0, wo3_pct: 0.4, idempotency_key: "b" });
  addInterval(st, { hole_id: "DH-T1", from_m: 3, to_m: 5, lithology: "Gr2", sn_pct: 0.5, idempotency_key: "c" });
  const dup = addInterval(st, { hole_id: "DH-T1", from_m: 3, to_m: 5, sn_pct: 0.5, idempotency_key: "c" });
  assert(dup.duplicate && live(st.intervals).length === 3, "idempotent interval");
  throws(() => addInterval(st, { hole_id: "DH-T1", from_m: 4, to_m: 6, sn_pct: 0.1 }), "overlap without supersede rejected");
  const h = holeSummary(st, "DH-T1");
  assert(h.sn.grade === r((2 * 0.05 + 1 * 1 + 2 * 0.5) / 5, 3) && h.wo3.assayed_m === 1 && h.wo3.grade === 0.4, "length-weighted grade");
  const b = bestIntercept(st, { hole: "DH-T1", element: "sn", cutoff: 0.3 });
  assert(b.from === 2 && b.to === 5 && b.length_m === 3 && b.grade === r(2 / 3, 3), "best intercept = contiguous run above cutoff");
  assert(bestIntercept(st, { element: "sn", cutoff: 5 }) === null, "no intercept -> null, not a guess");
  const fix = addInterval(st, { hole_id: "DH-T1", from_m: 3, to_m: 5, sn_pct: 0.6, supersede: true, source: "re-assay" });
  assert(fix.superseded.length === 1 && holeSummary(st, "DH-T1").intervals === 3 && st.intervals.length === 4, "supersede keeps audit trail");
  throws(() => logShift(st, { zone: "Zone 9", ore_t: 1 }), "unknown zone rejected");
  throws(() => logShift(st, { zone: "Zone 1", ore_t: 100, feed_t: 100, feed_sn_pct: 0.5, conc_t: 1, conc_sn_pct: 60 }), "recovery > 100% rejected as data_error");
  const s1 = logShift(st, { date: "2026-10-01", zone: "Zone 1", ore_t: 100, waste_t: 250, feed_t: 100, feed_sn_pct: 0.5, conc_t: 0.5, conc_sn_pct: 60, fuel_l: 350, idempotency_key: "s1" });
  assert(s1.recovery_pct === 60, "recovery = conc×grade / feed×grade");
  logShift(st, { date: "2026-10-01", shift: "night", zone: "Zone 1", ore_t: 50, waste_t: 0, idempotency_key: "s2" });
  throws(() => logShift(st, { date: "2026-10-01", zone: "Zone 1", ore_t: 1 }), "duplicate shift without supersede rejected");
  const p = productionSummary(st, { zone: "Zone 1" });
  assert(p.shifts === 2 && p.strip_ratio === r(250 / 150) && p.recovery_pct === 60 && p.recovery_basis_shifts === 1, "production summary + strip ratio");
  assert(productionSummary(st, { zone: "Zone 3" }).recovery_pct === null, "no data -> null recovery");
  const inc = logIncident(st, { type: "slope", severity: 4, zone: "Zone 3", description: "test", idempotency_key: "i1" });
  assert(inc.id === "INC-0001" && inc.escalate, "incident numbered, severity 4 escalates");
  assert(logIncident(st, { type: "slope", severity: 4, description: "test", idempotency_key: "i1" }).duplicate && st.incidents.length === 1, "idempotent incident");
  throws(() => logIncident(st, { type: "slope", severity: 9, description: "x" }), "severity out of range rejected");
  closeIncident(st, { id: "INC-0001", closure: "barricaded + geotech inspected" });
  assert(st.incidents[0].status === "closed", "incident closed");
  const tl = rpc(st, { jsonrpc: "2.0", id: 1, method: "tools/list" }, () => {});
  assert(tl.result.tools.length === Object.keys(TOOLS).length, "tools/list over JSON-RPC");
  const bad = rpc(st, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "add_drill_interval", arguments: { hole_id: "X", from_m: 0, to_m: 1, sn_pct: 99 } } }, () => {});
  assert(bad.result.isError && /data_error/.test(bad.result.content[0].text), "data_error surfaced to the bot");
  console.log("ALL PASS");
}

if (process.argv.includes("--selftest")) selftest(); else serve();
