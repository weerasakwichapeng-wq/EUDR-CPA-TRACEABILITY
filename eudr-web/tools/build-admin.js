/* build-admin.js — เพิ่มชั้นขอบเขตอำเภอ/ตำบล และจับคู่แปลง → ตำบล
 *
 * ต้องรัน 'หลัง' build-db.js เสมอ (build-db.js เขียน data/db.js ใหม่ทับ)
 *     node tools/build-db.js
 *     node tools/build-admin.js
 *
 * ครั้งแรกจะดาวน์โหลดขอบเขตการปกครองของไทยมาเก็บไว้ที่ tools/cache/
 * (ต้องต่ออินเทอร์เน็ต) ครั้งต่อไปใช้ไฟล์ในแคชได้เลย
 *
 * ที่มาข้อมูลขอบเขต: github.com/chingchai/OpenGISData-Thailand (กรมการปกครอง)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const WEB = path.join(__dirname, '..');
const CACHE = path.join(__dirname, 'cache');
const SRC_URL = 'https://raw.githubusercontent.com/chingchai/OpenGISData-Thailand/master/';

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return get(r.headers.location).then(res, rej);
      if (r.statusCode !== 200) return rej(new Error("HTTP " + r.statusCode + " " + url));
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => res(Buffer.concat(chunks)));
    }).on("error", rej);
  });
}
async function ensure(name) {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) return f;
  fs.mkdirSync(CACHE, { recursive: true });
  console.log("ดาวน์โหลด " + name + " …");
  fs.writeFileSync(f, await get(SRC_URL + name));
  return f;
}
async function main() {

const PROV_F = await ensure("provinces.geojson");
const DIST_F = await ensure("districts.geojson");
const SUB_F  = await ensure("subdistricts.geojson");

global.window = {};
require(path.join(WEB, "data", "db.js"));
require(path.join(WEB, "data", "geo.js"));
const DB = window.EUDR_DB, GEO = window.EUDR_GEO;

/* ---------- กรอบพื้นที่ของแปลงทั้งหมด ---------- */
let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
for (const k in GEO) for (const p of GEO[k]) {
  if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
  if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
}
const PAD = 0.15;
const BOX = [minX - PAD, minY - PAD, maxX + PAD, maxY + PAD];
console.log('กรอบพื้นที่แปลง', BOX.map(v => v.toFixed(3)).join(', '));

/* ---------- Douglas–Peucker ---------- */
function sqSegDist(p, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}
function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const sq = tol * tol;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const seg = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = seg[0] + 1; i < seg[1]; i++) {
      const d = sqSegDist(pts[i], pts[seg[0]], pts[seg[1]]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sq) { keep[idx] = 1; stack.push([seg[0], idx], [idx, seg[1]]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out.length >= 4 ? out : pts;
}
const round = pts => pts.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);

function ringBox(r) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const p of r) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }
  return [a, b, c, d];
}
const boxHit = (x, y) => !(x[2] < y[0] || x[0] > y[2] || x[3] < y[1] || x[1] > y[3]);

/* ---------- แปลง feature → รูปทรงที่ย่อแล้ว ---------- */
function convert(features, tol, propMap) {
  const out = [];
  for (const f of features) {
    const polys = [];
    for (const poly of f.geometry.coordinates) {
      const rings = [];
      for (let i = 0; i < poly.length; i++) {
        const s = round(simplify(poly[i], tol));
        // เก็บเฉพาะวงที่ยังมีรูปร่าง (วงในเล็ก ๆ ตัดทิ้งได้)
        if (s.length >= 4) rings.push(s);
      }
      if (rings.length) polys.push(rings);
    }
    if (!polys.length) continue;
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    polys.forEach(rs => { const bb = ringBox(rs[0]);
      a = Math.min(a, bb[0]); b = Math.min(b, bb[1]); c = Math.max(c, bb[2]); d = Math.max(d, bb[3]); });
    if (!boxHit([a, b, c, d], BOX)) continue;
    out.push(Object.assign({ bbox: [+a.toFixed(5), +b.toFixed(5), +c.toFixed(5), +d.toFixed(5)], polys }, propMap(f.properties)));
  }
  return out;
}

const prov = JSON.parse(fs.readFileSync(PROV_F, 'utf8'));
const dist = JSON.parse(fs.readFileSync(DIST_F, 'utf8'));
const sub = JSON.parse(fs.readFileSync(SUB_F, 'utf8'));

const provinces = convert(prov.features, 0.0004, p => ({
  code: p.pro_code, name: p.pro_th, nameEn: p.pro_en
}));
const amphoes = convert(dist.features, 0.00025, p => ({
  code: p.amp_code, name: p.amp_th, nameEn: p.amp_en,
  province: p.pro_th, provinceCode: p.pro_code
}));
const tambons = convert(sub.features, 0.00025, p => ({
  code: p.tam_code, name: p.tam_th, nameEn: p.tam_en,
  amphoe: p.amp_th, amphoeCode: p.amp_code,
  province: p.pro_th, provinceCode: p.pro_code
}));
console.log('จังหวัดในกรอบ', provinces.length, '· อำเภอ', amphoes.length, '· ตำบล', tambons.length);

/* ---------- จับคู่แปลง → ตำบล/อำเภอ (ray casting บนจุดศูนย์กลางแปลง) ---------- */
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function locate(x, y, list) {
  for (const f of list) {
    if (x < f.bbox[0] || x > f.bbox[2] || y < f.bbox[1] || y > f.bbox[3]) continue;
    for (const rings of f.polys) {
      if (!inRing(x, y, rings[0])) continue;
      let hole = false;
      for (let i = 1; i < rings.length; i++) if (inRing(x, y, rings[i])) { hole = true; break; }
      if (!hole) return f;
    }
  }
  return null;
}

let matchedT = 0, matchedA = 0;
const tambonStat = new Map();
for (const p of DB.plots) {
  const g = GEO[p.uid];
  if (!g) continue;
  let sx = 0, sy = 0;
  for (const pt of g) { sx += pt[0]; sy += pt[1]; }
  const x = sx / g.length, y = sy / g.length;

  const t = locate(x, y, tambons);
  if (t) {
    matchedT++;
    p.subdistrict = t.name;
    p.subdistrictCode = t.code;
    p.districtGis = t.amphoe;
    p.provinceGis = t.province;
    const k = t.code;
    if (!tambonStat.has(k)) tambonStat.set(k, { name: t.name, amphoe: t.amphoe, province: t.province, plots: 0, rai: 0 });
    const s = tambonStat.get(k);
    s.plots++; s.rai += p.areaRai;
  } else {
    const a = locate(x, y, amphoes);
    if (a) { p.districtGis = a.name; p.provinceGis = a.province; }
  }
  if (p.districtGis) matchedA++;
  p.lat = +y.toFixed(6);
  p.lng = +x.toFixed(6);
}
console.log('จับคู่ตำบลได้', matchedT, '/', DB.plots.length, '· อำเภอ', matchedA);

/* เก็บเฉพาะขอบเขตที่เกี่ยวข้องจริง: อำเภอที่มีแปลง + อำเภอข้างเคียงในกรอบ (คงไว้ทั้งหมดในกรอบ) */
const admin = {
  source: 'chingchai/OpenGISData-Thailand (กรมการปกครอง)',
  generated: new Date().toISOString(),
  bbox: BOX.map(v => +v.toFixed(4)),
  provinces, amphoes, tambons
};

fs.writeFileSync(path.join(WEB, 'data', 'admin.js'),
  'window.EUDR_ADMIN=' + JSON.stringify(admin) + ';\n', 'utf8');

/* เขียน db.js ใหม่ (แปลงมีฟิลด์ ตำบล/อำเภอ/พิกัดกลาง เพิ่ม) */
DB.meta.adminMatched = { tambon: matchedT, amphoe: matchedA };
fs.writeFileSync(path.join(WEB, 'data', 'db.js'),
  'window.EUDR_DB=' + JSON.stringify(DB) + ';\n', 'utf8');

const st = f => (fs.statSync(path.join(WEB, 'data', f)).size / 1048576).toFixed(2) + ' MB';
console.log('เขียนไฟล์: admin.js', st('admin.js'), '· db.js', st('db.js'));

const top = [...tambonStat.values()].sort((a, b) => b.rai - a.rai).slice(0, 12);
console.log('\nตำบลที่มีพื้นที่มากที่สุด:');
top.forEach(t => console.log('  ' + t.name.padEnd(18), 'อ.' + t.amphoe.padEnd(14), 'จ.' + t.province.padEnd(12),
  String(t.plots).padStart(5) + ' แปลง', t.rai.toFixed(0).padStart(8) + ' ไร่'));
console.log('รวมตำบลที่มีแปลง', tambonStat.size, 'ตำบล');

}
main().catch(e => { console.error(e); process.exit(1); });
