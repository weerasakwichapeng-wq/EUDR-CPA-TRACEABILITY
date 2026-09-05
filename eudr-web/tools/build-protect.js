/* build-protect.js — สร้างชั้นพื้นที่อนุรักษ์ (data/protect.js) และตรวจว่าแปลงใดทับเขตอนุรักษ์
 *
 *     node tools/build-protect.js
 *
 * ต้องรันหลัง build-db.js และ build-admin.js (สคริปต์นี้เขียนฟิลด์เพิ่มลงใน data/db.js)
 *
 * ที่มาข้อมูล: OpenStreetMap ผ่าน Overpass API (สัญญาอนุญาต ODbL — ต้องแสดงที่มา)
 * ดาวน์โหลดครั้งแรกเก็บไว้ที่ tools/cache/ ครั้งต่อไปใช้แคชได้เลย
 *
 * ขอบเขตที่ได้: อุทยานแห่งชาติ · เขตรักษาพันธุ์สัตว์ป่า · วนอุทยาน · เขตห้ามล่าสัตว์ป่า
 * ขอบเขต "ป่าสงวนแห่งชาติ" ไม่มีใน OpenStreetMap และ ArcGIS ของกรมป่าไม้/กรมอุทยานฯ
 * ต้องใช้โทเคน จึงยังไม่รวมอยู่ในชุดนี้ — ดูหัวข้อในไฟล์ README
 * ถ้าได้ไฟล์ขอบเขตป่าสงวนมาแล้ว วางเป็น tools/cache/reserved_forest.geojson
 * (GeoJSON, WGS84, มีฟิลด์ชื่อเป็น name/ชื่อ) สคริปต์นี้จะรวมให้อัตโนมัติ
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const WEB = path.join(__dirname, '..');
const CACHE = path.join(__dirname, 'cache');
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/* ---------- ประเภทพื้นที่อนุรักษ์ ---------- */
const TYPES = [
  { key: 'np',   label: 'อุทยานแห่งชาติ',        match: /^อุทยานแห่งชาติ/,     cls: ['2'] },
  { key: 'ws',   label: 'เขตรักษาพันธุ์สัตว์ป่า', match: /^เขตรักษาพันธุ์สัตว์ป่า/, cls: ['1a'] },
  { key: 'fp',   label: 'วนอุทยาน',              match: /^วนอุทยาน/,           cls: ['3'] },
  { key: 'nh',   label: 'เขตห้ามล่าสัตว์ป่า',      match: /^เขตห้ามล่าสัตว์ป่า/,   cls: ['4'] },
  { key: 'rf',   label: 'ป่าสงวนแห่งชาติ',        match: /^ป่าสงวนแห่งชาติ/,     cls: ['6'] }
];
function classify(tags) {
  const name = (tags['name:th'] || tags.name || '').trim();
  for (const t of TYPES) if (t.match.test(name)) return t.key;
  const c = tags.protect_class;
  for (const t of TYPES) if (t.cls.indexOf(c) >= 0) return t.key;
  if (tags.boundary === 'national_park') return 'np';
  return null;
}
const isThai = s => /[฀-๿]/.test(s || '');

/* ---------- ดึงข้อมูลจาก Overpass (พร้อมลองซ้ำเมื่อเซิร์ฟเวอร์ไม่ว่าง) ---------- */
function post(body) {
  return new Promise((res, rej) => {
    const req = https.request(OVERPASS, { method: 'POST', headers: {
      'Content-Type': 'text/plain', 'User-Agent': 'EUDR-traceability/1.0'
    } }, r => {
      const c = [];
      r.on('data', d => c.push(d));
      r.on('end', () => res(Buffer.concat(c).toString('utf8')));
    });
    req.on('error', rej);
    req.end(body);
  });
}
async function overpass(name, query) {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(CACHE, { recursive: true });
  for (let i = 1; i <= 6; i++) {
    console.log('ดึงข้อมูล ' + name + ' (ครั้งที่ ' + i + ') …');
    const txt = await post(query);
    if (txt.trim().charAt(0) === '{') {
      fs.writeFileSync(f, txt, 'utf8');
      return JSON.parse(txt);
    }
    console.log('  เซิร์ฟเวอร์ไม่ว่าง รออีก 25 วินาที');
    await new Promise(r => setTimeout(r, 25000));
  }
  throw new Error('ดึงข้อมูล ' + name + ' ไม่สำเร็จ — ลองใหม่ภายหลัง');
}

/* ---------- เรขาคณิต ---------- */
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

/** ต่อเส้นย่อยของ relation ให้เป็นวงปิด */
function buildRings(segments) {
  const rings = [];
  const pool = segments.filter(s => s && s.length >= 2).map(s => s.slice());
  const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  while (pool.length) {
    let ring = pool.shift();
    let changed = true;
    while (changed && key(ring[0]) !== key(ring[ring.length - 1])) {
      changed = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const tail = key(ring[ring.length - 1]), head = key(ring[0]);
        if (key(s[0]) === tail)              { ring = ring.concat(s.slice(1)); }
        else if (key(s[s.length - 1]) === tail) { ring = ring.concat(s.slice(0, -1).reverse()); }
        else if (key(s[s.length - 1]) === head) { ring = s.slice(0, -1).concat(ring); }
        else if (key(s[0]) === head)         { ring = s.slice(1).reverse().concat(ring); }
        else continue;
        pool.splice(i, 1); changed = true; break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
function ringBox(r) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const p of r) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }
  return [a, b, c, d];
}
/** พื้นที่ของวง (ตร.องศา) เครื่องหมายบอกทิศทางวง */
function ringArea(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------- main ---------- */
(async function () {
  const BBOX = '16.55,100.10,18.40,104.20';
  const q = kind => '[out:json][timeout:180];(' +
    kind + '["boundary"="protected_area"](' + BBOX + ');' +
    kind + '["boundary"="national_park"](' + BBOX + ');' +
    kind + '["leisure"="nature_reserve"](' + BBOX + '););out geom;';

  const ways = await overpass('protect_ways.json', q('way'));
  const rels = await overpass('protect_rels.json', q('relation'));

  const areas = [];
  function push(tags, ringSets) {
    const key = classify(tags);
    if (!key) return;
    const name = (tags['name:th'] || tags.name || '').trim();
    if (!isThai(name)) return;                    // ตัดพื้นที่ฝั่งลาวออก
    const polys = [];
    for (const rings of ringSets) {
      const kept = rings.map(r => round(simplify(r, 0.0002))).filter(r => r.length >= 4);
      if (kept.length) polys.push(kept);
    }
    if (!polys.length) return;
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    polys.forEach(rs => { const bb = ringBox(rs[0]);
      a = Math.min(a, bb[0]); b = Math.min(b, bb[1]); c = Math.max(c, bb[2]); d = Math.max(d, bb[3]); });
    areas.push({
      type: key, name: name, bbox: [+a.toFixed(5), +b.toFixed(5), +c.toFixed(5), +d.toFixed(5)], polys: polys
    });
  }

  for (const e of ways.elements) {
    if (!e.geometry) continue;
    push(e.tags || {}, [[e.geometry.map(p => [p.lon, p.lat])]]);
  }
  for (const e of rels.elements) {
    if (!e.members) continue;
    const outer = [], inner = [];
    for (const m of e.members) {
      if (!m.geometry) continue;
      const pts = m.geometry.map(p => [p.lon, p.lat]);
      (m.role === 'inner' ? inner : outer).push(pts);
    }
    const oRings = buildRings(outer), iRings = buildRings(inner);
    // จับรูเจาะเข้ากับวงนอกที่ "ครอบมันจริง" ไม่ใช่แค่กรอบสี่เหลี่ยมซ้อนกัน
    // ถ้ามีวงนอกครอบหลายวง ให้เลือกวงที่เล็กที่สุด
    const sets = oRings.map(o => [o]);
    for (const h of iRings) {
      const v = h[0];
      let best = -1, bestArea = Infinity;
      for (let i = 0; i < oRings.length; i++) {
        if (!inRing(v[0], v[1], oRings[i])) continue;
        const a = Math.abs(ringArea(oRings[i]));
        if (a < bestArea) { bestArea = a; best = i; }
      }
      if (best >= 0) sets[best].push(h);
      // รูที่หาวงนอกครอบไม่เจอ = ข้อมูลต้นทางไม่สอดคล้อง ทิ้งไปดีกว่าวาดผิด
      else console.log('  ⚠ ตัดรูเจาะที่ไม่มีวงนอกครอบ:', (e.tags['name:th'] || e.tags.name || '?'));
    }
    push(e.tags || {}, sets);
  }

  /* ป่าสงวนแห่งชาติจากไฟล์ที่ผู้ใช้วางไว้เอง (ถ้ามี) */
  const rfFile = path.join(CACHE, 'reserved_forest.geojson');
  if (fs.existsSync(rfFile)) {
    const gj = JSON.parse(fs.readFileSync(rfFile, 'utf8'));
    let n = 0;
    for (const f of (gj.features || [])) {
      const pr = f.properties || {};
      const name = (pr.name || pr['ชื่อ'] || pr.NAME || pr.FOREST_NAM || 'ป่าสงวนแห่งชาติ').trim();
      const g = f.geometry;
      if (!g) continue;
      const polyList = g.type === 'Polygon' ? [g.coordinates]
        : g.type === 'MultiPolygon' ? g.coordinates : [];
      const sets = polyList.map(rings => rings.map(r => r.map(p => [p[0], p[1]])));
      if (!sets.length) continue;
      push({ 'name:th': /^ป่าสงวน/.test(name) ? name : 'ป่าสงวนแห่งชาติ' + name, protect_class: '6' }, sets);
      n++;
    }
    console.log('รวมป่าสงวนแห่งชาติจากไฟล์ที่วางไว้ ' + n + ' พื้นที่');
  }

  const byType = {};
  areas.forEach(a => byType[a.type] = (byType[a.type] || 0) + 1);
  console.log('พื้นที่อนุรักษ์ที่ได้:');
  TYPES.forEach(t => console.log('  ' + t.label.padEnd(24) + (byType[t.key] || 0) + ' แห่ง'));

  /* ---------- ตรวจการทับซ้อนกับแปลง ---------- */
  global.window = {};
  require(path.join(WEB, 'data', 'db.js'));
  require(path.join(WEB, 'data', 'geo.js'));
  const DB = window.EUDR_DB, GEO = window.EUDR_GEO;

  function hit(x, y) {
    for (const a of areas) {
      if (x < a.bbox[0] || x > a.bbox[2] || y < a.bbox[1] || y > a.bbox[3]) continue;
      for (const rings of a.polys) {
        if (!inRing(x, y, rings[0])) continue;
        let hole = false;
        for (let i = 1; i < rings.length; i++) if (inRing(x, y, rings[i])) { hole = true; break; }
        if (!hole) return a;
      }
    }
    return null;
  }

  let inside = 0, partial = 0;
  const stat = {};
  for (const p of DB.plots) {
    delete p.protect; delete p.protectType; delete p.protectHow;
    const g = GEO[p.uid];
    if (!g) continue;
    let sx = 0, sy = 0;
    for (const pt of g) { sx += pt[0]; sy += pt[1]; }
    const a = hit(sx / g.length, sy / g.length);
    let found = a, how = a ? 'in' : null;
    if (!found) {
      for (const pt of g) {           // ขอบแปลงล้ำเข้าไปบางส่วนหรือไม่
        const b = hit(pt[0], pt[1]);
        if (b) { found = b; how = 'edge'; break; }
      }
    }
    if (!found) continue;
    p.protect = found.name;
    p.protectType = found.type;
    p.protectHow = how;
    if (how === 'in') inside++; else partial++;
    const k = found.name;
    if (!stat[k]) stat[k] = { type: found.type, plots: 0, rai: 0 };
    stat[k].plots++; stat[k].rai += p.areaRai;
  }

  const data = {
    source: 'OpenStreetMap contributors (ODbL) ผ่าน Overpass API',
    generated: new Date().toISOString(),
    types: TYPES.map(t => ({ key: t.key, label: t.label })),
    areas: areas
  };
  fs.writeFileSync(path.join(WEB, 'data', 'protect.js'),
    'window.EUDR_PROTECT=' + JSON.stringify(data) + ';\n', 'utf8');

  DB.meta.protect = { inside: inside, partial: partial, areas: areas.length };
  fs.writeFileSync(path.join(WEB, 'data', 'db.js'),
    'window.EUDR_DB=' + JSON.stringify(DB) + ';\n', 'utf8');

  const st = f => (fs.statSync(path.join(WEB, 'data', f)).size / 1048576).toFixed(2) + ' MB';
  console.log('\nแปลงที่อยู่ในเขตอนุรักษ์ทั้งแปลง : ' + inside);
  console.log('แปลงที่ขอบล้ำเข้าเขตอนุรักษ์     : ' + partial);
  console.log('เขียนไฟล์: protect.js ' + st('protect.js') + ' · db.js ' + st('db.js'));

  const top = Object.keys(stat).map(k => Object.assign({ name: k }, stat[k]))
    .sort((a, b) => b.rai - a.rai).slice(0, 15);
  if (top.length) {
    console.log('\nเขตอนุรักษ์ที่มีแปลงทับมากที่สุด:');
    top.forEach(t => console.log('  ' + t.name.padEnd(34) +
      String(t.plots).padStart(5) + ' แปลง ' + t.rai.toFixed(0).padStart(8) + ' ไร่'));
  }
})().catch(e => { console.error(e); process.exit(1); });
