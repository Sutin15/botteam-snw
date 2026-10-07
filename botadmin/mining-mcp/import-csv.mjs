// Bulk-load drill intervals (assay/lithology CSV from the lab or field log) into the running mining-data MCP.
// Goes through the same tool as the bots (add_drill_interval), so every physical-limit check still applies and a
// re-run is safe (idempotency key = sample_id, or hole@from-to). Rejected rows are listed, never silently dropped.
// CSV header (comma, UTF-8): hole_id,from_m,to_m,lithology,sn_pct,wo3_pct,sample_id   (lithology/sn/wo3/sample optional)
// usage: node import-csv.mjs <file.csv> "<source e.g. Lab report ABC-123 2026-10-07>" [--url http://127.0.0.1:7789/mcp]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [file, source] = process.argv.slice(2);
if (!file || !source) { console.error('usage: node import-csv.mjs <file.csv> "<source>" [--url ...]'); process.exit(2); }
const ui = process.argv.indexOf("--url"), URL_ = ui > 0 ? process.argv[ui + 1] : "http://127.0.0.1:7789/mcp";
const token = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "token"), "utf8").trim();

const rows = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
const head = rows.shift().split(",").map(h => h.trim().toLowerCase());
for (const need of ["hole_id", "from_m", "to_m"]) if (!head.includes(need)) { console.error(`CSV ต้องมีคอลัมน์ ${need}`); process.exit(2); }

let ok = 0, dup = 0, id = 0;
const bad = [];
for (const [n, line] of rows.entries()) {
  const v = line.split(",").map(x => x.trim()), a = Object.fromEntries(head.map((h, i) => [h, v[i] === "" ? undefined : v[i]]));
  a.source = source;
  a.idempotency_key = a.sample_id || `${a.hole_id}@${a.from_m}-${a.to_m}`;
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: "add_drill_interval", arguments: a } }) }).then(r => r.json());
  const text = res.result?.content?.[0]?.text || res.error?.message;
  if (res.result?.isError || res.error) bad.push(`แถว ${n + 2}: ${text}`);
  else if (/บันทึกไปแล้ว/.test(text)) dup++; else ok++;
}
console.log(`นำเข้าใหม่ ${ok} · ซ้ำ (ข้าม) ${dup} · ปฏิเสธ ${bad.length}`);
if (bad.length) { console.log(bad.join("\n")); process.exitCode = 1; }
