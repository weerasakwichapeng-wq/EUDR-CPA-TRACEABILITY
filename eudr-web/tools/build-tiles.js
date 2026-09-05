/* build-tiles.js — ดาวน์โหลดภาพถ่ายดาวเทียมเฉพาะบริเวณที่มีแปลง แล้วฝังไว้ใน data/tiles.js
 *
 *     node tools/build-tiles.js            (ระดับซูม 7–12 ตามค่าเริ่มต้น)
 *     node tools/build-tiles.js 7 11       (กำหนดช่วงซูมเอง)
 *
 * ทำไมต้องฝัง: หน้าเว็บที่เผยแพร่เป็นลิงก์ (Artifact) ถูกนโยบายความปลอดภัยปิดกั้น
 * การโหลดภาพจากเซิร์ฟเวอร์ภายนอก ภาพดาวเทียมจึงต้องอยู่ในไฟล์เดียวกัน
 * เวอร์ชันที่รันในเครื่องยังโหลดภาพสดจากอินเทอร์เน็ตได้ตามปกติ และใช้ภาพที่ฝังไว้
 * เป็นตัวสำรองเมื่อออฟไลน์
 *
 * ภาพถ่าย: Esri World Imagery (© Esri, Maxar, Earthstar Geographics)
 * ต้องแสดงที่มาเสมอ และควรตรวจสอบเงื่อนไขการใช้งานก่อนเผยแพร่ออกนอกองค์กร
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const WEB = path.join(__dirname, '..');
const Z_MIN = +(process.argv[2] || 7);
const Z_MAX = +(process.argv[3] || 12);
const PAD_UPTO = 10;          // ขยายขอบ 1 ไทล์ เฉพาะซูมต่ำ (ไว้ให้เลื่อนแผนที่ไม่เจอที่ว่าง)
const BUDGET_MB = 8.6;        // งบขนาดหลังเข้ารหัส base64
const CONCURRENCY = 4;
const URL = (z, x, y) =>
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;

/* ---------- อ่านพิกัดแปลงทั้งหมด ---------- */
global.window = {};
require(path.join(WEB, 'data', 'geo.js'));
const GEO = window.EUDR_GEO;

const lon2t = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
const lat2t = (lat, z) => {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
};

/* ---------- รายการไทล์ที่ต้องใช้ ---------- */
const wanted = [];
for (let z = Z_MIN; z <= Z_MAX; z++) {
  const base = new Set();
  for (const k in GEO) for (const p of GEO[k]) base.add(lon2t(p[0], z) + '/' + lat2t(p[1], z));
  const set = new Set();
  for (const key of base) {
    const xy = key.split('/').map(Number);
    if (z <= PAD_UPTO) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) set.add((xy[0] + dx) + '/' + (xy[1] + dy));
    } else set.add(key);
  }
  const max = Math.pow(2, z) - 1;
  for (const key of set) {
    const xy = key.split('/').map(Number);
    if (xy[0] < 0 || xy[1] < 0 || xy[0] > max || xy[1] > max) continue;
    wanted.push({ z: z, x: xy[0], y: xy[1] });
  }
  console.log('ซูม ' + z + ': ' + set.size + ' ไทล์');
}
console.log('รวม ' + wanted.length + ' ไทล์ — เริ่มดาวน์โหลด…');

/* ---------- ดาวน์โหลด ---------- */
function get(url, tries) {
  tries = tries || 0;
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'EUDR-traceability/1.0 (internal FSC CoC tool)' } }, r => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      const c = [];
      r.on('data', d => c.push(d));
      r.on('end', () => res(Buffer.concat(c)));
    }).on('error', rej);
  }).catch(e => {
    if (tries >= 2) throw e;
    return new Promise(r => setTimeout(r, 400 * (tries + 1))).then(() => get(url, tries + 1));
  });
}

(async function () {
  const out = {};
  let done = 0, failed = 0, bytes = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < wanted.length) {
      const t = wanted[cursor++];
      try {
        const buf = await get(URL(t.z, t.x, t.y));
        out[t.z + '/' + t.x + '/' + t.y] = buf.toString('base64');
        bytes += buf.length;
      } catch (e) {
        failed++;
      }
      if (++done % 40 === 0)
        console.log('  ' + done + '/' + wanted.length + ' (' + (bytes / 1048576).toFixed(1) + ' MB)');
      await new Promise(r => setTimeout(r, 30));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('ดาวน์โหลดเสร็จ · ล้มเหลว ' + failed + ' ไทล์');

  /* ---------- ตัดซูมสูงสุดออกถ้าเกินงบ ---------- */
  let zMax = Z_MAX;
  const sizeMB = () => Object.keys(out).reduce((n, k) => n + out[k].length, 0) / 1048576;
  while (sizeMB() > BUDGET_MB && zMax > Z_MIN) {
    console.log('ขนาด ' + sizeMB().toFixed(2) + ' MB เกินงบ — ตัดซูม ' + zMax + ' ออก');
    for (const k of Object.keys(out)) if (+k.split('/')[0] === zMax) delete out[k];
    zMax--;
  }

  const data = {
    attr: '© Esri, Maxar, Earthstar Geographics',
    min: Z_MIN, max: zMax, count: Object.keys(out).length, t: out
  };
  const file = path.join(WEB, 'data', 'tiles.js');
  fs.writeFileSync(file, 'window.EUDR_TILES=' + JSON.stringify(data) + ';\n', 'utf8');
  console.log('เขียนไฟล์: data/tiles.js ' + (fs.statSync(file).size / 1048576).toFixed(2) + ' MB' +
              ' · ' + data.count + ' ไทล์ · ซูม ' + Z_MIN + '–' + zMax);
})().catch(e => { console.error(e); process.exit(1); });
