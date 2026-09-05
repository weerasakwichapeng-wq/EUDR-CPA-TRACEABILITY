/* build-db.js — สร้างฐานข้อมูลของเว็บ (data/db.js, data/geo.js) จากไฟล์ Excel ต้นทาง
 *
 * ใช้งาน (จากโฟลเดอร์ eudr-web):
 *     node tools/build-db.js
 *     node tools/build-db.js "C:\path\to\ไฟล์.xlsx"
 *
 * ไม่ต้องติดตั้งไลบรารีเพิ่ม — อ่านไฟล์ .xlsx ด้วย zlib ที่มากับ Node
 * เมื่อไฟล์ Excel ต้นทางมีการแก้ไข ให้รันคำสั่งนี้ซ้ำเพื่ออัปเดตฐานข้อมูลของเว็บ
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const nodePath = require('path');
const { StringDecoder } = require('string_decoder');

const XLSX_FILE = process.argv[2] ||
  nodePath.join(__dirname, '..', '..', '2026 Master POLYGON EUDR CPA (Real).xlsx');
const OUT = nodePath.join(__dirname, '..', 'data');
const HA_TO_RAI = 6.25;

if (!fs.existsSync(XLSX_FILE)) {
  console.error('ไม่พบไฟล์ Excel: ' + XLSX_FILE);
  console.error('ระบุพาธไฟล์เป็นอาร์กิวเมนต์: node tools/build-db.js "…\\ไฟล์.xlsx"');
  process.exit(1);
}

/* ---------------------------------------------------------- อ่านโครงสร้าง ZIP ของ .xlsx */
function zipEntries(file) {
  const b = fs.readFileSync(file);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ไฟล์ไม่ใช่ .xlsx ที่ถูกต้อง');
  const cnt = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const map = {};
  for (let i = 0; i < cnt; i++) {
    const nlen = b.readUInt16LE(p + 28), elen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32);
    map[b.toString('utf8', p + 46, p + 46 + nlen)] = { lho: b.readUInt32LE(p + 42) };
    p = p + 46 + nlen + elen + clen;
  }
  return { b, map };
}
function zipSlice(b, e) {
  const p = e.lho;
  const method = b.readUInt16LE(p + 8);
  const csize = b.readUInt32LE(p + 18);
  const nlen = b.readUInt16LE(p + 26), elen = b.readUInt16LE(p + 28);
  const start = p + 30 + nlen + elen;
  return { method, data: b.slice(start, start + csize) };
}
function zipRead(b, e) {
  const s = zipSlice(b, e);
  return s.method === 0 ? s.data : zlib.inflateRawSync(s.data, { maxOutputLength: 300 * 1024 * 1024 });
}

const { b, map } = zipEntries(XLSX_FILE);

/* ---------------------------------------------------------- ตัวช่วยอ่าน XML ของ SpreadsheetML */
function unesc(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
          .replace(/&#x([0-9a-fA-F]+);/g, (m, d) => String.fromCodePoint(parseInt(d, 16)))
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
let _ss = null;
function sharedStrings() {
  if (_ss) return _ss;
  const xml = zipRead(b, map['xl/sharedStrings.xml']).toString('utf8');
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let txt = '';
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tre.exec(m[1]))) txt += t[1];
    out.push(unesc(txt));
  }
  _ss = out;
  return out;
}
function colNum(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}
function parseCells(rowXml, ss) {
  const cells = [];
  const cRe = /<c r="([A-Z]+)\d+"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm;
  while ((cm = cRe.exec(rowXml))) {
    const col = colNum(cm[1]), attrs = cm[2] || '', body = cm[3] || '';
    const tM = /t="([^"]+)"/.exec(attrs);
    const t = tM ? tM[1] : 'n';
    let val = null;
    if (t === 'inlineStr') {
      let txt = '';
      const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let x;
      while ((x = tre.exec(body))) txt += x[1];
      val = unesc(txt);
    } else {
      const vM = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (vM) { val = vM[1]; val = (t === 's') ? ss[+val] : unesc(val); }
    }
    if (val !== null && val !== '') cells[col] = val;
  }
  return cells;
}
/** อ่านชีตขนาดเล็กทั้งแผ่น → array ของแถว (index 0 = แถวที่ 1) */
function parseSheet(pathInZip) {
  const ss = sharedStrings();
  const xml = zipRead(b, map[pathInZip]).toString('utf8');
  const rows = [];
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row[^>]*r="(\d+)"[^>]*\/>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) rows[+(rm[1] || rm[3]) - 1] = parseCells(rm[2] || '', ss);
  return rows;
}
/** อ่านชีตขนาดใหญ่แบบสตรีม (ชีตพ่อค้ามีขนาด ~190 MB เมื่อคลายบีบอัด) */
function streamSheet(pathInZip, ss, rowCb) {
  const s = zipSlice(b, map[pathInZip]);
  const inf = zlib.createInflateRaw();
  const dec = new StringDecoder('utf8');
  let buf = '';
  return new Promise((res, rej) => {
    inf.on('data', ch => {
      buf += dec.write(ch);
      let idx;
      while ((idx = buf.indexOf('</row>')) >= 0) {
        const rowXml = buf.slice(0, idx);
        const st = rowXml.lastIndexOf('<row');
        if (st >= 0) {
          const chunk = rowXml.slice(st);
          const rm = /<row[^>]*r="(\d+)"/.exec(chunk);
          if (rm) rowCb(+rm[1], parseCells(chunk, ss));
        }
        buf = buf.slice(idx + 6);
      }
    });
    inf.on('end', res);
    inf.on('error', rej);
    inf.end(s.data);
  });
}

/* ---------------------------------------------------------- ตัวช่วยแปลงค่า */
const clean = s => s == null ? '' : String(s).replace(/[\r\n]+/g, ' ').trim();
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
function excelDate(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const p = s.split('/').map(Number);
    const yy = p[2] > 2400 ? p[2] - 543 : p[2];
    return yy + '-' + String(p[1]).padStart(2, '0') + '-' + String(p[0]).padStart(2, '0');
  }
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}
function parsePoly(g) {
  if (!g || typeof g !== 'string') return null;
  const m = /\(\(([\s\S]*)\)\)/.exec(g);
  if (!m) return null;
  const pts = [];
  for (const part of m[1].split(',')) {
    const t = part.trim().split(/\s+/);
    if (t.length < 2) continue;
    const x = parseFloat(t[0]), y = parseFloat(t[1]);
    if (isNaN(x) || isNaN(y)) continue;
    pts.push([+x.toFixed(6), +y.toFixed(6)]);
  }
  return pts.length >= 3 ? pts : null;
}
/** รหัส CV คือเลข 9–10 หลักที่ฝังอยู่ในรหัสแปลง เช่น S_308068600_LEI_ML72 */
const cvOf = code => { const m = /(\d{9,10})/.exec(String(code || '')); return m ? m[1] : ''; };

const PROV = { LEI: 'เลย' };
const DIST = {
  DS: 'ด่านซ้าย', PR: 'ภูเรือ', ML: 'เมืองเลย', WSP: 'วังสะพุง', PKD: 'ภูกระดึง',
  PK: 'ผาขาว', ND: 'นาด้วง', ER: 'เอราวัณ', NH: 'นาแห้ว', TL: 'ท่าลี่',
  CK: 'เชียงคาน', PL: 'ปากชม', PPM: 'ภูหลวง', NW: 'หนองหิน'
};

/* ---------------------------------------------------------- สะสมข้อมูล */
const plots = [];
const suppliers = new Map();
let seq = 0;

function addSupplier(id, o) {
  if (!suppliers.has(id)) suppliers.set(id, {
    id: id, name: '', category: '', subGroup: '', village: '', collector: '',
    phone: '', province: '', district: '', plotCount: 0, areaHa: 0, docTypes: {}
  });
  const s = suppliers.get(id);
  for (const k in o) if (o[k] && !s[k]) s[k] = o[k];
  return s;
}
function addPlot(p) {
  p.uid = 'P' + (++seq);
  p.areaRai = +(p.areaHa * HA_TO_RAI).toFixed(4);
  plots.push(p);
  const s = suppliers.get(p.supplierId);
  if (!s) return;
  s.plotCount++;
  s.areaHa += p.areaHa;
  s.docTypes[p.docType] = (s.docTypes[p.docType] || 0) + 1;
  if (!s.province) s.province = p.province;
  if (!s.district) s.district = p.district;
}

/* 1) สวนรายใหญ่ — ชีต 1.1–1.4
      flagHa = พื้นที่ไฮไลต์เหลืองในไฟล์ต้นทาง (พื้นที่ที่ยังใช้ไม่ได้) */
const ESTATES = [
  { sheet: 'xl/worksheets/sheet1.xml', label: '1.1', doc: 'chanote',   flagHa: 57.23, layout: 'A' },
  { sheet: 'xl/worksheets/sheet2.xml', label: '1.2', doc: 'chanote',   flagHa: 45.22, layout: 'A' },
  { sheet: 'xl/worksheets/sheet3.xml', label: '1.3', doc: 'chanote',   flagHa: 0,     layout: 'A' },
  { sheet: 'xl/worksheets/sheet4.xml', label: '1.4', doc: 'nor_sor_3', flagHa: 0,     layout: 'B' }
];
for (const e of ESTATES) {
  const rows = parseSheet(e.sheet);
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (e.layout === 'A') {
      const code = clean(r[8]);
      if (!/\d{9}/.test(code)) continue;
      const cv = cvOf(code) || clean(r[2]);
      addSupplier(cv, { name: clean(r[0]), category: 'estate', subGroup: e.label, phone: clean(r[7]), collector: clean(r[0]) });
      addPlot({
        code: code, supplierId: cv, owner: clean(r[0]), farmer: clean(r[0]), deed: clean(r[1]), docType: e.doc,
        province: PROV[clean(r[3])] || clean(r[3]), district: DIST[clean(r[4])] || clean(r[4]),
        areaHa: num(r[10]), dateCreated: excelDate(r[11]), geom: parsePoly(r[12])
      });
    } else {
      const code = clean(r[10]);
      if (!/\d{9}/.test(code)) continue;
      const cv = cvOf(code) || clean(r[5]);
      addSupplier(cv, { name: clean(r[0]), category: 'estate', subGroup: e.label, phone: clean(r[9]), collector: clean(r[0]) });
      addPlot({
        code: code, supplierId: cv, owner: clean(r[0]), farmer: clean(r[1]), deed: clean(r[2]), docType: e.doc,
        province: PROV[clean(r[6])] || clean(r[6]), district: DIST[clean(r[7])] || clean(r[7]),
        areaHa: num(r[12]), dateCreated: excelDate(r[13]), geom: parsePoly(r[14])
      });
    }
  }
  const est = Array.from(suppliers.values()).find(s => s.subGroup === e.label);
  if (est) est.flagHa = e.flagHa;
}

/* 2) ส่งเสริม — ชีต "2.ส่งเสริม"
      คอลัมน์ CV/X/Y ในชีตนี้เยื้องไม่สม่ำเสมอ จึงถอด CV จากรหัสแปลงแทน */
{
  const rows = parseSheet('xl/worksheets/sheet5.xml');
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const code = clean(r[12]) || clean(r[11]);
    if (!/\d{9}/.test(code)) continue;
    const cv = cvOf(code);
    const farmer = clean(r[2]) || clean(r[1]) || '(ไม่ระบุชื่อ)';
    addSupplier(cv, {
      name: farmer, category: 'promotion',
      subGroup: clean(r[0]) === 'Factory' ? 'Factory' : 'Plant',
      phone: clean(r[10]), collector: farmer
    });
    addPlot({
      code: code, supplierId: cv, owner: farmer, farmer: farmer, deed: clean(r[3]), docType: 'chanote',
      province: PROV[clean(r[7])] || clean(r[7]), district: DIST[clean(r[8])] || clean(r[8]),
      areaHa: num(r[13]), dateCreated: excelDate(r[14]), geom: parsePoly(r[15])
    });
  }
}

/* 3) เอกสารสิทธิ์รวม — จัดอยู่ในกลุ่มผู้รวบรวม (มีผู้รวบรวม 1 ราย รวมแปลงของเกษตรกรหลายราย) */
{
  const rows = parseSheet('xl/worksheets/sheet9.xml');
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const code = clean(r[10]);
    if (!/\d{9}/.test(code)) continue;
    const cv = cvOf(code) || clean(r[7]);
    addSupplier(cv, {
      name: clean(r[1]), category: 'collector', subGroup: 'เอกสารสิทธิ์รวม',
      village: clean(r[0]), collector: clean(r[1])
    });
    addPlot({
      code: code, supplierId: cv, owner: clean(r[1]), farmer: clean(r[2]), deed: clean(r[4]),
      docType: code.indexOf('S_') === 0 ? 'spk' : 'chanote', citizenId: clean(r[3]),
      province: PROV[clean(r[8])] || clean(r[8]), district: DIST[clean(r[9])] || clean(r[9]),
      areaHa: num(r[12]), dateCreated: excelDate(r[13]), geom: parsePoly(r[14])
    });
  }
}

/* 4) ผู้รวบรวม (พ่อค้า) — ชีต "3.1 พ่อค้า สปก." และ "3.พ่อค้า โฉนด" */
(async function () {
  const ss = sharedStrings();
  const TRADER = [
    ['xl/worksheets/sheet6.xml', 'spk'],
    ['xl/worksheets/sheet7.xml', 'chanote']
  ];
  for (const spec of TRADER) {
    await streamSheet(spec[0], ss, function (rn, r) {
      if (rn < 3) return;
      const code = clean(r[11]);
      if (!/\d{9}/.test(code)) return;
      const cv = cvOf(code) || clean(r[8]);
      addSupplier(cv, {
        name: clean(r[1]), category: 'collector', subGroup: 'พ่อค้า/ผู้รวบรวม',
        village: clean(r[0]), collector: clean(r[1])
      });
      addPlot({
        code: code, supplierId: cv, owner: clean(r[1]), farmer: clean(r[3]), deed: clean(r[5]),
        docType: spec[1], citizenId: clean(r[2]),
        province: PROV[clean(r[9])] || clean(r[9]), district: DIST[clean(r[10])] || clean(r[10]),
        areaHa: num(r[13]), dateCreated: excelDate(r[14]), geom: parsePoly(r[15])
      });
    });
  }

  /* 5) ชีต "List" — ทะเบียนหมู่บ้าน ↔ ผู้รวบรวม (ชื่อมาตรฐาน) */
  const listRows = parseSheet('xl/worksheets/sheet12.xml');
  const listByCv = new Map();
  for (let i = 1; i < listRows.length; i++) {
    const r = listRows[i];
    if (!r || !r[1]) continue;
    listByCv.set(clean(r[1]), { village: clean(r[0]), collector: clean(r[2]) });
  }
  let matched = 0;
  for (const s of suppliers.values()) {
    const l = listByCv.get(s.id);
    if (!l) continue;
    matched++;
    if (!s.village) s.village = l.village;
    // ชีตพ่อค้าสะกดชื่อผู้รวบรวมคลาดเคลื่อนหลายแบบ → ใช้ชื่อจากชีต List เป็นหลัก
    if (l.collector && s.category === 'collector') { s.name = l.collector; s.collector = l.collector; }
    s.inMasterList = true;
  }
  // ผู้รวบรวมที่ขึ้นทะเบียนไว้แต่ยังไม่มีแปลงในฐานข้อมูล
  for (const entry of listByCv) {
    const cv = entry[0], l = entry[1];
    if (suppliers.has(cv)) continue;
    const s = addSupplier(cv, {
      name: l.collector, category: 'collector', subGroup: 'พ่อค้า/ผู้รวบรวม',
      village: l.village, collector: l.collector, province: 'เลย'
    });
    s.inMasterList = true;
    s.noPlots = true;
  }

  /* ---------------------------------------------------------- เขียนไฟล์ */
  const sup = Array.from(suppliers.values()).map(s => Object.assign({}, s, {
    areaHa: +s.areaHa.toFixed(4),
    areaRai: +(s.areaHa * HA_TO_RAI).toFixed(2),
    flagHa: s.flagHa || 0,
    flagRai: +((s.flagHa || 0) * HA_TO_RAI).toFixed(2)
  })).sort((a, b) => b.areaHa - a.areaHa);

  fs.mkdirSync(OUT, { recursive: true });
  const geo = {};
  let noGeom = 0;
  const plotsLite = plots.map(p => {
    if (p.geom) geo[p.uid] = p.geom; else noGeom++;
    const q = Object.assign({}, p);
    delete q.geom;
    return q;
  });

  const meta = {
    source: nodePath.basename(XLSX_FILE),
    generated: new Date().toISOString(),
    totals: {
      plots: plots.length,
      suppliers: sup.length,
      areaHa: +plots.reduce((a, p) => a + p.areaHa, 0).toFixed(2),
      areaRai: +plots.reduce((a, p) => a + p.areaRai, 0).toFixed(2)
    },
    haToRai: HA_TO_RAI,
    plotsWithoutGeometry: noGeom
  };

  fs.writeFileSync(nodePath.join(OUT, 'db.js'),
    'window.EUDR_DB=' + JSON.stringify({ meta: meta, suppliers: sup, plots: plotsLite }) + ';\n', 'utf8');
  fs.writeFileSync(nodePath.join(OUT, 'geo.js'),
    'window.EUDR_GEO=' + JSON.stringify(geo) + ';\n', 'utf8');

  /* ---------------------------------------------------------- สรุปผลให้ตรวจสอบ */
  const byCat = {};
  for (const p of plots) {
    const s = suppliers.get(p.supplierId);
    const c = s ? s.category : '?';
    if (!byCat[c]) byCat[c] = { plots: 0, ha: 0, sup: new Set() };
    byCat[c].plots++; byCat[c].ha += p.areaHa; byCat[c].sup.add(p.supplierId);
  }
  const LBL = { estate: 'สวนรายใหญ่', promotion: 'ส่งเสริม', collector: 'ผู้รวบรวม' };
  console.log('--- สรุปผลการนำเข้า ---');
  for (const k in byCat) {
    console.log((LBL[k] || k).padEnd(12),
      String(byCat[k].plots).padStart(6) + ' แปลง',
      byCat[k].ha.toFixed(2).padStart(11) + ' ha',
      (byCat[k].ha * HA_TO_RAI).toFixed(2).padStart(12) + ' ไร่',
      String(byCat[k].sup.size).padStart(4) + ' ราย');
  }
  const dt = {};
  for (const p of plots) dt[p.docType] = (dt[p.docType] || 0) + p.areaRai;
  console.log('เอกสารสิทธิ์ (ไร่):', Object.keys(dt).map(k => k + '=' + dt[k].toFixed(2)).join('  '));
  console.log('รวม', plots.length, 'แปลง /', meta.totals.areaRai, 'ไร่ /', sup.length, 'แหล่ง',
              '· ไม่มีโพลิกอน', noGeom, 'แปลง');
  console.log('จับคู่ชีต List ได้', matched, 'จาก', listByCv.size, 'รายการ');
  console.log('เขียนไฟล์:',
    'db.js ' + (fs.statSync(nodePath.join(OUT, 'db.js')).size / 1048576).toFixed(2) + ' MB,',
    'geo.js ' + (fs.statSync(nodePath.join(OUT, 'geo.js')).size / 1048576).toFixed(2) + ' MB');
})().catch(e => { console.error(e); process.exit(1); });
