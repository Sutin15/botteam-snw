# BotTeam ฉบับใช้งานจริง — 3 profile + 2 โหมดเครื่อง

ส่วนนี้ต่อยอดจาก BotTeam ต้นฉบับ (ดู README และ RUNBOOK) **โดยไม่แตะแอป WPF, hotfix และ Rakazo**
ส่วนที่เพิ่มมีแค่ "ชุดทีม" (profile) และ MCP ข้อมูลเหมืองที่ใช้ข้อมูลจริง

| profile | ใช้ทำอะไร | บอท | ห้องประชุม | ข้อมูลที่เชื่อม |
|---|---|---|---|---|
| `company` (ค่าเริ่มต้น) | บริษัทสาธิตต้นฉบับ | 9 | 2 | demo-accounting (ข้อมูลสมมติ) |
| `mining` | ทีมโครงการเหมือง Sn-W รัฐฉาน | 9 | เทคนิค / ปฏิบัติการ | **mining-data (ข้อมูลจริง เริ่มว่าง)** |
| `consulting` | งานที่ปรึกษาและตรวจงานก่อสร้าง | 5 | 1 | — (แนบไฟล์ BOQ/แบบ/สัญญาในแชท) |
| `course` | Lab สอน AI agent ในหลักสูตร | 4 | 1 | demo-accounting (ปลอดภัยสำหรับผู้เรียน) |

ลงหลาย profile ในบัญชีเดียวกันได้ เพราะชื่อบอทไม่ชนกัน และสคริปต์รันซ้ำได้โดยไม่สร้างของซ้ำ

---

## 1. เลือกโหมดเครื่อง

| | 🖥 Local (Gemma 4 ในเครื่อง) | ⚡ Cloud (DeepSeek) |
|---|---|---|
| เครื่อง | GPU NVIDIA 16 GB + RAM ≥64 GB (ทดสอบบน RAM 96 GB) | ไม่ต้องมี GPU (ยังต้องใช้ WSL + Docker และ RAM ~3 GB ต่อบอท) |
| ข้อมูล | ไม่ออกนอกเครื่อง | แชท ผลเครื่องมือ **และภาพหน้าจอบอท** ถูกส่งออกไปคลาวด์ |
| ค่าใช้จ่าย | ค่าไฟ | คิดตาม token (ดูแท็บค่าใช้จ่าย) |
| เหมาะกับ | ข้อมูลโครงการเหมือง ข้อมูลลูกค้า | Lab สอน และงานที่ไม่มีข้อมูลลับ |

**กติกาที่แนะนำ:** profile `mining` และ `consulting` ใช้โหมด Local เท่านั้น ส่วน `course` ใช้ได้ทั้งสองโหมด
สลับโหมดได้ที่ปุ่ม 🖥/⚡ มุมซ้ายล่างของแอป สำหรับเครื่องที่ไม่มี GPU ให้ข้ามขั้น llama-server ใน README แล้วใส่คีย์ที่ `D:\localai\deepseek-api-key.txt`
ข้อจำกัดของโหมด Cloud: การ์ดแผนและการ์ดสรุปเรื่องรอยังเรียก Gemma ในเครื่องเสมอ (RUNBOOK 3c) จึงใช้ไม่ได้ถ้าไม่มี GPU

### 1b. ไฮบริดรายบอท (ตรวจกับ source Rakazo v0.1.6 แล้ว)
Rakazo เก็บโมเดลแยกรายบอทได้ (`bot.modelProvider/modelId`) และค่านี้**ชนะ**โมเดลเริ่มต้นที่ปุ่ม 🖥/⚡ ตั้งไว้ (`selectConfiguredModel` ใน `packages/adapters/src/model-selection.ts`)
seed-bots จึงใช้ค่านี้ "ปักหมุด" สมองของบอทได้ โดยใส่ช่องที่ 6 ของแถวบอท หรือใส่ `"model"` ระดับ profile

| ค่า | ความหมาย |
|---|---|
| `local` | ปักหมุด Gemma ในเครื่อง — **กด ⚡ แล้วก็ยังเป็น Local** |
| `deepseek` | ปักหมุด DeepSeek (ต้องกด ⚡ ในแอปครั้งหนึ่งก่อน เพื่อเชื่อมคีย์) |
| `default` | ตามปุ่ม 🖥/⚡ (แบบเดิม) |

ค่าที่ตั้งไว้: `mining` และ `consulting` = `local` ทุกตัว ส่วน `course` = `default`
ตัวอย่างไฮบริด: ให้ฝ่ายจัดซื้อหาราคาตลาดด้วย DeepSeek → ใส่ `"deepseek"` เป็นช่องที่ 6 ของบอทนั้น แล้วรัน seed-bots ซ้ำ (สคริปต์อัปเดตบอทเดิมให้ด้วย)

ระบบป้องกัน 3 ชั้น:
1. บอทที่ได้ MCP ข้อมูลจริง (`"private": true` เช่น mining-data) ต้องเป็น `local` เท่านั้น ถ้าตั้งเป็นอย่างอื่น สคริปต์จะไม่ยอมรัน
2. บอททุกตัวในทีมจะรู้ว่าเพื่อนบอทตัวไหนใช้คลาวด์ และมีกติกาห้ามส่งข้อมูลโครงการหรือไฟล์แนบให้บอทเหล่านั้น
3. สคริปต์ไม่ยอมปักหมุด `local` ถ้ายังไม่ได้เชื่อม Local model ใน Rakazo

ข้อควรรู้: ปุ่มในแอปยังขึ้นข้อความว่า "บอททุกตัวใช้ DeepSeek" แต่ที่จริงบอทที่ปักหมุด local จะไม่เปลี่ยนตาม และถ้ามีคนลบการเชื่อมต่อ Gemma ออกจาก Rakazo บอทที่ปักหมุดไว้จะย้อนไปใช้โมเดลเริ่มต้นเงียบ ๆ (เป็นพฤติกรรมของ Rakazo) **จึงห้ามลบ credential "Gemma 4 (เครื่องนี้)"**
การ์ดแผนและการ์ดสรุปเรื่องรอใช้ Gemma ในเครื่องเสมอ ไม่ขึ้นกับค่าเหล่านี้

---

## 2. ติดตั้ง mining-data (ทำครั้งเดียว ใน WSL)

```bash
mkdir -p ~/rakazo/mining-mcp && cp /mnt/d/localai/botadmin/mining-mcp/server.mjs ~/rakazo/mining-mcp/
cd ~/rakazo/mining-mcp && node server.mjs --selftest          # ต้องขึ้น ALL PASS
openssl rand -hex 24 > token && chmod 600 token
sudo chown -R 1000:1001 ~/rakazo/mining-mcp
cp /mnt/d/localai/rakazo/docker-compose.override.yml ~/rakazo/   # มี service mining-data แล้ว
bash /mnt/d/localai/botadmin/rakazo.sh start                      # สร้าง rakazo-mining-data-1 ให้เอง
```
- ข้อมูลอยู่ที่ `~/rakazo/mining-mcp/data.json` และถูกรวมใน `rakazo.sh backup` อัตโนมัติ
- **ห้าม commit** `token` และ `data.json` (.gitignore กันไว้แล้ว)

## 3. สร้างทีม

```powershell
# เปิดแอปแบบ devtools ก่อน: BotAdmin.exe --devtools-port 9223
node D:\localai\botadmin\seed-bots.mjs --profile mining --dry-run   # ดูแผน ไม่แตะระบบ
node D:\localai\botadmin\seed-bots.mjs --profile mining
node D:\localai\botadmin\seed-bots.mjs --profile consulting
node D:\localai\botadmin\seed-bots.mjs --profile course
```
แก้ทีมได้ที่ `botadmin/profiles/<ชื่อ>.json` (บอท = `[หมวด, ชื่อ, ตำแหน่ง, คำสั่ง, (team|dedicated), (local|deepseek|default)]`, ห้องละ 2–6 บอท)

**เครื่องของบอท (ประหยัด RAM):** บอท `dedicated` 1 ตัวใช้ Linux VM ของตัวเอง 1 เครื่อง (2 CPU / 3 GB และเปิดค้างตลอด) ส่วนบอท `team` ทั้งหมดใช้ VM ร่วมกัน 1 เครื่อง
ทุก profile ตั้งค่าเริ่มต้นเป็น `team` และให้ `dedicated` เฉพาะบอทที่ต้องเปิดเว็บนานหรือรัน code (`--dry-run` แสดงตัวเลข `computers` ให้ดูก่อน)

| profile | dedicated | VM รวม | RAM ของ VM บอท |
|---|---|---|---|
| company (ต้นฉบับ) | 9 | 9 | ~27 GB |
| mining | จัดซื้อและขนส่ง, GeoAI และข้อมูล | 3 | ~9 GB |
| consulting | ประมาณราคา BOQ | 2 | ~6 GB |
| course | ผู้ออกแบบ Lab | 2 | ~6 GB |

ลงทั้ง 3 profile พร้อมกันจะใช้ประมาณ 7 VM (~21 GB) ไม่นับ Rakazo และโมเดล ถ้าเครื่องมี RAM น้อย ให้ลงเฉพาะ profile ที่ใช้งาน หรือปิด Computer ของบอทที่ไม่ใช้ในห้องควบคุม
ข้อควรระวัง: บอท `team` ที่ทำงานพร้อมกันบน VM เดียวกันอาจชนกัน (RUNBOOK ข้อ 10.3) ทุก profile จึงมีกติกาให้บอทใช้แท็บของตัวเอง และส่งงานเบราว์เซอร์หนักต่อให้บอท dedicated
บอทที่สร้างไปแล้วจะไม่ถูกเปลี่ยนโหมดโดยสคริปต์ ให้เปลี่ยนในแอปเอง หรือลบบอทแล้วรันสคริปต์ใหม่
ถ้าแก้คำสั่งของบอทที่สร้างไปแล้ว ให้แก้ในแอป (สตูดิโอตัวตน) เพราะสคริปต์จะไม่ทับบอทเดิม

## 4. นำเข้าข้อมูลจริง

- **ทีละรายการ:** สั่งบอทในแชท เช่น ฝ่ายธรณีวิทยา: "บันทึก DH-08 จาก 12.0 ถึง 12.4 m Sn-W vein Sn 1.35% WO3 0.42% ตัวอย่าง S-0815 แหล่ง lab report ..."
- **ทั้งไฟล์ (ผล lab):** CSV คอลัมน์ `hole_id,from_m,to_m,lithology,sn_pct,wo3_pct,sample_id`
  ```bash
  cd ~/rakazo/mining-mcp && node import-csv.mjs assay.csv "Lab report XYZ-123 2026-10-07"
  ```
  แถวที่ค่าเกินขีดจำกัดทางกายภาพ (Sn >78.7%, WO3 >76.5%, ช่วงความลึกผิด, ทับช่วงเดิม) จะถูกปฏิเสธพร้อมเลขแถว รันซ้ำได้ (กันบันทึกซ้ำด้วย sample_id)
- **แก้ข้อมูลผิด:** บันทึกใหม่ด้วย `supersede=true` ซึ่งเก็บประวัติเดิมไว้ ไม่ลบทิ้ง

เครื่องมือของ mining-data มี 9 ตัว: `data_status`, `add_drill_interval`, `get_hole_summary`, `find_best_intercept`, `log_shift_production`, `get_production_summary`, `log_incident`, `list_incidents`, `close_incident`
(best intercept เป็นการคำนวณเบื้องต้น ไม่ใช่การจำแนกทรัพยากรตาม JORC)

## 5. Workflow ใช้งานประจำวัน (profile mining)

1. **เช้า:** ศูนย์งาน → สรุปเช้า ตั้งให้ "ผู้ประสานงานโครงการ" สรุป BLUF ตอน 07:30 (เหตุการณ์เปิดค้าง ผลผลิตเมื่อวาน งานรอตัดสินใจ)
2. **ระหว่างวัน:** หัวหน้ากะบันทึกผลผลิตผ่านฝ่ายวิศวกรรมเหมือง และเหตุการณ์ผ่านฝ่าย HSE ส่วนผล lab ใช้ `import-csv.mjs`
3. **สั่งงานใหญ่:** ศูนย์งาน → ทีมงาน → พิมพ์หรือพูดเป้าหมายให้ผู้ประสานงาน แล้วระบบแตกงานให้ฝ่าย และรวมผลกลับมา
4. **ตรวจตัวเลข:** กด 🔎 ใต้คำตอบ (ตั้งผู้ตรวจเป็นฝ่ายธรณีวิทยาหรือวิศวกรรมเหมือง)
5. **กฎอนุมัติแนะนำ:** `write_file`, `message_bot` = ปกติ · การส่งอีเมลหรือข้อความออกนอกระบบ = ต้องขออนุญาต
6. **ศุกร์:** ให้ผู้ประสานงานทำ weekly BLUF แล้วกด `rakazo.sh backup`

## 6. Lab สอน (profile course)

| Lab | สิ่งที่ผู้เรียนได้ฝึก | ฟีเจอร์ BotTeam |
|---|---|---|
| 1 | คุยกับบอทเดียว แนบไฟล์ ถามด้วยเสียง | แชท 📎 🎤 |
| 2 | ถามตัวเลขจากระบบ แล้วตรวจข้อเท็จจริง | demo-accounting + 🔎 |
| 3 | ขออนุญาตก่อนทำ (human-in-the-loop) | การ์ดอนุมัติ + กฎอนุมัติ |
| 4 | สั่งงานใหญ่ให้หัวหน้าแตกงาน | ทีมงาน + Mission Control |
| 5 | สอนงานด้วยการทำให้ดู แล้วรันซ้ำ | 🎓 สอนงาน → ทักษะ |
| 6 | งานประจำและทริกเกอร์ (โหมดเฝ้าดู) | งานประจำ + ทริกเกอร์ |

ให้บอท "ผู้ออกแบบ Lab" ร่างโจทย์และ rubric แต่ละ Lab และให้ "ผู้ตรวจงาน" ตรวจตาม rubric โดยอาจารย์เป็นผู้ยืนยันคะแนน

## 7. ทดสอบหลังติดตั้ง

```bash
node botadmin/mining-mcp/server.mjs --selftest             # 24 ข้อ ALL PASS
node botadmin/seed-bots.mjs --profile mining --dry-run      # ตรวจ profile
```
แล้วถามบอทฝ่ายธรณีวิทยาว่า "ตอนนี้มีข้อมูลหลุมเจาะอะไรบ้าง" ถ้าบอทเรียก `data_status` แล้วตอบว่ายังไม่มีข้อมูล แปลว่าระบบเชื่อมต่อถูกต้อง
