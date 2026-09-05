/* ระบบตรวจสอบย้อนกลับวัตถุดิบ EUDR — ยางพารา
   ข้อมูลแปลง/แหล่งวัตถุดิบ: อ่านอย่างเดียวจาก data/db.js (สร้างจากไฟล์ Excel ต้นทาง)
   ข้อมูลรับซื้อ/ตั้งค่า: เก็บใน localStorage ของเครื่องนี้ */
(function () {
'use strict';

/* ============================== ค่าคงที่ / ยูทิลิตี้ ============================== */
const DB    = window.EUDR_DB;
const GEO   = window.EUDR_GEO || {};
const ADMIN = window.EUDR_ADMIN || { provinces: [], amphoes: [], tambons: [] };
const TILES = window.EUDR_TILES || null;   // ภาพดาวเทียมที่ฝังมาในไฟล์ (ถ้ามี)
const PROT  = window.EUDR_PROTECT || { types: [], areas: [] };
const LS   = { tx: 'eudr_tx_v1', cfg: 'eudr_cfg_v1', ov: 'eudr_override_v1', ui: 'eudr_ui_v1' };

/* hex = สีบนพื้นหลังแผนที่ถนน, sat = สีสว่างสำหรับทับภาพดาวเทียม */
const CAT = {
  estate:    { label: 'สวนรายใหญ่', hex: '#2d6a4f', sat: '#5ef08f' },
  promotion: { label: 'ส่งเสริม',   hex: '#b07d2b', sat: '#ffd166' },
  collector: { label: 'ผู้รวบรวม',  hex: '#2f5d8c', sat: '#6fc6ff' }
};
const DOC = { chanote: 'โฉนด', spk: 'ส.ป.ก.', nor_sor_3: 'น.ส.3' };
const PRODUCT = {
  cuplump: 'ยางก้อนถ้วย', latex: 'น้ำยางสด', ussheet: 'ยางแผ่นดิบ',
  scrap: 'เศษยาง / ขี้ยาง', dry: 'ยางแห้ง'
};
const CAT_KEYS = ['estate', 'promotion', 'collector'];
const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EQUAL_MONTH = Array(12).fill(+(100 / 12).toFixed(1));
const DEFAULT_CFG = {
  yield: { estate: 280, promotion: 250, collector: 250 },
  mode: 'warn', warnAt: 90, deductFlag: 1,
  /* สัดส่วนผลผลิตรายเดือน (%) ต่อประเภทแหล่ง — ค่าเริ่มต้นแบ่งเท่ากันทุกเดือน ปรับได้ในหน้าตั้งค่า */
  season: { estate: EQUAL_MONTH.slice(), promotion: EQUAL_MONTH.slice(), collector: EQUAL_MONTH.slice() }
};

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

const nf0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = v => nf0.format(Math.round(v || 0));
const n2 = v => nf2.format(v || 0);
const be = y => y + 543;                                        // ค.ศ. → พ.ศ.
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, 3200);
}
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { toast('บันทึกลงเบราว์เซอร์ไม่สำเร็จ — พื้นที่จัดเก็บอาจเต็ม', true); return false; }
}
/* นามสกุลที่หน้าเว็บแบบฝัง (Artifact) อนุญาตให้บันทึกได้ */
const SAFE_EXT = ['csv', 'json', 'txt', 'md', 'html', 'svg', 'pdf', 'png'];
const DL_ERR = {
  declined: 'ยกเลิกการบันทึกไฟล์',
  too_large: 'ไฟล์ใหญ่เกิน 16 MB — กรองข้อมูลให้แคบลงแล้วส่งออกใหม่',
  rate_limited: 'กำลังมีกล่องบันทึกไฟล์เปิดอยู่ — ปิดก่อนแล้วลองใหม่',
  rejected_extension: 'รูปแบบไฟล์นี้บันทึกไม่ได้ในหน้านี้'
};
function download(name, text, mime) {
  // ในหน้าเว็บแบบฝังบนคลาวด์ ต้องบันทึกผ่านตัวช่วยของระบบ (ลิงก์ดาวน์โหลดปกติถูกปิดกั้น)
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('downloads').then(dl => {
      if (!dl) return blobDownload(name, text, mime);
      let fn = name;
      const ext = (fn.split('.').pop() || '').toLowerCase();
      if (SAFE_EXT.indexOf(ext) < 0) fn = fn.replace(/\.[^.]*$/, '') + '.json';
      dl.save({ filename: fn, data: '﻿' + text })
        .then(() => toast('บันทึกไฟล์ ' + fn + ' แล้ว'),
              e => toast(DL_ERR[e && e.code] || 'บันทึกไฟล์ไม่สำเร็จ', true));
    }, () => blobDownload(name, text, mime));
    return;
  }
  blobDownload(name, text, mime);
}
function blobDownload(name, text, mime) {
  const blob = new Blob(['﻿' + text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function csv(rows) {
  return rows.map(r => r.map(c => {
    const s = c == null ? '' : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

/* ============================== ไฟล์แนบ (IndexedDB) ==============================
   รูปใบชั่งเก็บใน IndexedDB ไม่ใช่ localStorage เพราะ localStorage มีพื้นที่ราว 5 MB
   ซึ่งไม่พอสำหรับรูป ส่วนรูปจะถูกย่อขนาดก่อนเก็บเสมอ */
const FILES = (function () {
  const DB_NAME = 'eudr_files_v1', STORE = 'files';
  let dbp = null, broken = false;
  function open() {
    if (broken) return Promise.reject(new Error('no-idb'));
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { broken = true; return rej(new Error('no-idb')); }
      let rq;
      try { rq = indexedDB.open(DB_NAME, 1); }
      catch (e) { broken = true; return rej(e); }
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE, { keyPath: 'id' });
          st.createIndex('txId', 'txId', { unique: false });
        }
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => { broken = true; rej(rq.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      let out;
      try { out = fn(st); } catch (e) { return rej(e); }
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('aborted'));
    }));
  }
  return {
    available: () => !broken && !!window.indexedDB,
    put: rec => tx('readwrite', st => st.put(rec)),
    get: id => tx('readonly', st => st.get(id)),
    byTx: txId => tx('readonly', st => st.index('txId').getAll(txId)),
    all: () => tx('readonly', st => st.getAll()),
    del: id => tx('readwrite', st => st.delete(id)),
    delByTx: txId => open().then(db => new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readwrite');
      const idx = t.objectStore(STORE).index('txId');
      const rq = idx.openCursor(IDBKeyRange.only(txId));
      rq.onsuccess = () => { const c = rq.result; if (c) { c.delete(); c.continue(); } };
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    }))
  };
})();

const IMG_MAX_SIDE = 1600;     // ตัวเลขบนใบชั่งต้องยังอ่านออก
const IMG_QUALITY = 0.72;
const FILE_MAX = 8 * 1024 * 1024;

/** ย่อรูปแล้วคืนค่าเป็น data URL — PDF เก็บตามเดิม */
function readAttachment(file) {
  if (file.size > FILE_MAX && file.type !== 'application/pdf')
    return Promise.reject(new Error('ไฟล์ใหญ่เกิน 8 MB'));
  if (file.type === 'application/pdf') {
    if (file.size > FILE_MAX) return Promise.reject(new Error('ไฟล์ PDF ใหญ่เกิน 8 MB'));
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res({ name: file.name, type: file.type, data: fr.result });
      fr.onerror = () => rej(new Error('อ่านไฟล์ไม่สำเร็จ'));
      fr.readAsDataURL(file);
    });
  }
  if (file.type.indexOf('image/') !== 0)
    return Promise.reject(new Error('รองรับเฉพาะไฟล์รูปและ PDF'));
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      const sc = Math.min(1, IMG_MAX_SIDE / Math.max(w, h));
      w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      let data;
      try { data = c.toDataURL('image/jpeg', IMG_QUALITY); }
      catch (e) { return rej(new Error('แปลงรูปไม่สำเร็จ')); }
      res({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data: data });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('เปิดไฟล์รูปไม่ได้')); };
    img.src = url;
  });
}
const dataSize = d => Math.round((String(d).length - (String(d).indexOf(',') + 1)) * 0.75);
function fileSizeText(b) {
  return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
}

/* ============================== สถานะแอป ============================== */
const S = {
  cfg: Object.assign({}, DEFAULT_CFG, load(LS.cfg, {})),
  tx: load(LS.tx, []),
  ov: load(LS.ov, {}),
  ui: load(LS.ui, {}),
  season: 0,
  supById: new Map(),
  plotsBySup: new Map(),
  plotByUid: new Map(),
  txVer: 0,
  view: 'dashboard'
};
S.cfg.yield = Object.assign({}, DEFAULT_CFG.yield, S.cfg.yield || {});
S.cfg.season = S.cfg.season || {};
CAT_KEYS.forEach(cat => {
  const a = S.cfg.season[cat];
  S.cfg.season[cat] = (Array.isArray(a) && a.length === 12) ? a.slice() : DEFAULT_CFG.season[cat].slice();
});

DB.suppliers.forEach(s => S.supById.set(s.id, s));
DB.plots.forEach(p => {
  if (!S.plotsBySup.has(p.supplierId)) S.plotsBySup.set(p.supplierId, []);
  S.plotsBySup.get(p.supplierId).push(p);
  S.plotByUid.set(p.uid, p);
});

/* ============================== ตรรกะโควต้า ============================== */
function quotaOf(sup) {
  const ov = S.ov[sup.id];
  if (ov != null && ov !== '' && !isNaN(ov)) return { kg: +ov, source: 'override', rai: sup.areaRai };
  const rai = S.cfg.deductFlag ? Math.max(0, sup.areaRai - (sup.flagRai || 0)) : sup.areaRai;
  const rate = S.cfg.yield[sup.category] || 0;
  return { kg: rai * rate, source: 'calc', rai: rai, rate: rate };
}
function usedOf(supId, season) {
  const y = season == null ? S.season : season;
  let kg = 0;
  for (const t of S.tx) if (t.supplierId === supId && t.season === y) kg += t.dryKg;
  return kg;
}
/* ---------- โควต้าระดับแปลง ----------
   EUDR ไม่ได้ขอให้แตกน้ำหนักเป็นกิโลรายแปลง สิ่งที่ต้องยื่นคือ "รายชื่อแปลงต้นทางของล็อต"
   ตัวเลขกิโลรายแปลงข้างล่างนี้เป็น "ค่าคำนวณภายใน" ใช้เป็นสัญญาณเตือนเรื่องมวลสารเท่านั้น
   ห้ามนำไปใส่เอกสารว่าเป็นน้ำหนักที่วัดได้จริงของแปลงนั้น */

/** ปรับให้ผลรวมโควต้ารายแปลง = โควต้าของแหล่งพอดี (เผื่อกรณีหักพื้นที่เสี่ยงหรือกำหนดเอง) */
function plotQuotaFactor(sup) {
  const raw = sup.areaRai * (S.cfg.yield[sup.category] || 0);
  return raw > 0 ? quotaOf(sup).kg / raw : 0;
}
function quotaOfPlot(p) {
  const s = S.supById.get(p.supplierId);
  if (!s) return 0;
  return p.areaRai * (S.cfg.yield[s.category] || 0) * plotQuotaFactor(s);
}
/** แปลงต้นทางของล็อต — ไม่ระบุ = ทั้งกลุ่มของแหล่งนั้น */
function scopePlotsOf(t) {
  if (t.scope === 'sel' && t.plotIds && t.plotIds.length)
    return t.plotIds.map(id => S.plotByUid.get(id)).filter(Boolean);
  return S.plotsBySup.get(t.supplierId) || [];
}
/** ยอดที่เฉลี่ยลงแต่ละแปลงในปีการผลิตปัจจุบัน (ค่าคำนวณ) */
let _usage = null, _usageKey = '';
function plotUsage() {
  const key = S.season + '|' + S.txVer;
  if (_usage && _usageKey === key) return _usage;
  const m = new Map();
  for (const t of S.tx) {
    if (t.season !== S.season) continue;
    if (t.alloc && t.alloc.length) {
      // บัญชีจริงจากระบบตัดโควต้าอัตโนมัติ
      for (const a of t.alloc) m.set(a.uid, (m.get(a.uid) || 0) + a.kg);
      continue;
    }
    // สำรอง: รายการเก่าก่อนมีระบบตัดอัตโนมัติ (หรือกู้คืนจากไฟล์สำรองรุ่นเก่า) — เฉลี่ยตามสัดส่วนพื้นที่
    const ps = scopePlotsOf(t);
    let tot = 0;
    for (const p of ps) tot += p.areaRai;
    if (!tot) continue;
    for (const p of ps) m.set(p.uid, (m.get(p.uid) || 0) + t.dryKg * p.areaRai / tot);
  }
  _usage = m; _usageKey = key;
  return m;
}
/** สรุปโควต้าของขอบเขตแปลงชุดหนึ่ง */
function scopeSummary(plots) {
  const use = plotUsage();
  let rai = 0, quota = 0, used = 0;
  for (const p of plots) {
    rai += p.areaRai;
    quota += quotaOfPlot(p);
    used += use.get(p.uid) || 0;
  }
  const pct = quota > 0 ? used / quota * 100 : (used > 0 ? 999 : 0);
  return { plots: plots, count: plots.length, rai: rai, quota: quota, used: used,
           remain: quota - used, pct: pct, st: statusOf(pct) };
}
/* ---------- ระบบตัดโควต้าอัตโนมัติรายแปลง ----------
   เงื่อนไข: (1) ตัดจากตำบลที่ใกล้กันก่อน โดยเริ่มจากตำบลที่แหล่งนั้นมีพื้นที่มากที่สุด
   แล้วไล่ไปตำบลถัดไปตามระยะทาง (2) ภายในตำบลเดียวกัน ตัดให้เต็มโควต้ารายเดือนของแปลง
   ใหญ่สุดก่อน แล้วค่อยขยับไปแปลงถัดไป ทำซ้ำจนน้ำหนักที่รับเข้าหมดพอดี
   ผลลัพธ์นี้คือ "บัญชีที่ระบบตัดจริง" ใช้ควบคุมปริมาณ ไม่ใช่การชั่งน้ำหนักแยกรายแปลง */

/** สัดส่วนผลผลิตแต่ละเดือน (รวมเป็น 1.0) ของประเภทแหล่งหนึ่ง */
function monthShareOf(cat) {
  const arr = (S.cfg.season && S.cfg.season[cat]) || EQUAL_MONTH;
  const sum = arr.reduce((a, b) => a + b, 0);
  return sum > 0 ? arr.map(v => v / sum) : EQUAL_MONTH.map(v => v / 100);
}
/** โควต้าของแปลงหนึ่งเฉพาะเดือน (ym = 'YYYY-MM') */
function monthlyQuotaOfPlot(p, ym) {
  const s = S.supById.get(p.supplierId);
  if (!s) return 0;
  const mi = +ym.slice(5, 7) - 1;
  return quotaOfPlot(p) * (monthShareOf(s.category)[mi] || 0);
}
/* บัญชีการตัดจริงรายเดือน สร้างจาก t.alloc ของทุกรายการรับซื้อ (คีย์ตามปีเดือนของวันที่ซื้อ) */
let _monthUsage = null, _monthUsageKey = '';
function plotMonthlyUsageMap() {
  if (_monthUsage && _monthUsageKey === S.txVer) return _monthUsage;
  const m = new Map();
  for (const t of S.tx) {
    if (!t.alloc) continue;
    const ym = t.date.slice(0, 7);
    for (const a of t.alloc) m.set(a.uid + '|' + ym, (m.get(a.uid + '|' + ym) || 0) + a.kg);
  }
  _monthUsage = m; _monthUsageKey = S.txVer;
  return m;
}
function plotMonthlyUsage(uid, ym) { return plotMonthlyUsageMap().get(uid + '|' + ym) || 0; }
function monthlyRemainOfPlot(p, ym) { return monthlyQuotaOfPlot(p, ym) - plotMonthlyUsage(p.uid, ym); }
/** กำลังผลิตที่เหลือของทั้งขอบเขตในเดือนนั้น (ผลรวมโควต้ารายเดือนคงเหลือของทุกแปลง) */
function monthlyPoolRemain(plots, ym) {
  let sum = 0;
  for (const p of plots) sum += Math.max(0, monthlyRemainOfPlot(p, ym));
  return sum;
}

/** จัดกลุ่มแปลงตามตำบล พร้อมจุดศูนย์กลางถ่วงน้ำหนักด้วยพื้นที่ (ใช้จัดลำดับความใกล้) */
function groupByTambon(plots) {
  const g = new Map();
  for (const p of plots) {
    const key = p.subdistrictCode || p.subdistrict || ('_plot_' + p.uid);
    if (!g.has(key)) g.set(key, {
      key: key, name: p.subdistrict || p.districtGis || p.district || '(ไม่ทราบตำบล)',
      plots: [], areaSum: 0, sx: 0, sy: 0, wSum: 0
    });
    const grp = g.get(key);
    grp.plots.push(p);
    grp.areaSum += p.areaRai;
    if (p.lat != null && p.lng != null) {
      grp.sx += p.lng * p.areaRai; grp.sy += p.lat * p.areaRai; grp.wSum += p.areaRai;
    }
  }
  g.forEach(grp => {
    grp.lat = grp.wSum ? grp.sy / grp.wSum : null;
    grp.lng = grp.wSum ? grp.sx / grp.wSum : null;
  });
  return Array.from(g.values());
}
function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/** เรียงตำบล: เริ่มจากตำบล "บ้าน" (พื้นที่มากสุดของแหล่งนี้) แล้วไล่ตามระยะทางใกล้→ไกล */
function orderTambonsByProximity(groups) {
  if (groups.length <= 1) return groups;
  let home = groups[0];
  for (const g of groups) if (g.areaSum > home.areaSum) home = g;
  const rest = groups.filter(g => g !== home);
  rest.sort((a, b) => haversineKm(home.lat, home.lng, a.lat, a.lng) - haversineKm(home.lat, home.lng, b.lat, b.lng));
  return [home].concat(rest);
}
/** ภายในตำบลเดียวกัน ตัดแปลงใหญ่สุดก่อน (ใช้แปลงจำนวนน้อยที่สุดในการตัดให้ครบ) */
function orderPlotsWithinTambon(plots) {
  return plots.slice().sort((a, b) => b.areaRai - a.areaRai || a.code.localeCompare(b.code));
}
/* ต่ำกว่านี้ถือว่าเป็นเศษปัดเศษ (แสดงผลเป็น 0.00 กก. อยู่ดี) ไม่ใช่โควต้าที่เหลือใช้ได้จริง
   ต้องตัดออกจากบัญชี ไม่งั้นแปลงที่โควต้าหมดแล้วจะโผล่มาเป็นแถว 0.00 กก. ในรอบถัดไป */
const QUOTA_EPS = 0.005;
/* ใช้กับยอดรวมทั้งปี/รายเดือนที่แสดงเป็นจำนวนเต็ม (n0) — กันเตือน "เกิน 0 กก." จากเศษปัดเศษสะสม */
const WARN_EPS = 0.5;
/** ตัดโควต้าอัตโนมัติ: คืนรายการ {uid, code, tambon, kg, seq, over} เรียงตามลำดับที่ตัดจริง
    over = true หมายถึงส่วนที่เกินกำลังผลิตรายเดือนของทั้งขอบเขต ถูกกระจายตามสัดส่วนพื้นที่แทน */
function autoAllocate(scopePlots, needKg, ym) {
  const rows = [];
  let left = needKg, seq = 0;
  const groups = orderTambonsByProximity(groupByTambon(scopePlots));
  for (const grp of groups) {
    if (left <= QUOTA_EPS) break;
    for (const p of orderPlotsWithinTambon(grp.plots)) {
      if (left <= QUOTA_EPS) break;
      const remain = Math.max(0, monthlyRemainOfPlot(p, ym));
      if (remain <= QUOTA_EPS) continue;   // โควต้ารายเดือนของแปลงนี้หมดแล้ว (หรือเหลือแค่เศษปัดเศษ) — ข้าม
      const take = Math.min(remain, left);
      if (take <= QUOTA_EPS) continue;     // เศษที่เหลือให้ตัดน้อยเกินจะแสดงผลเป็น 0.00 — ข้าม ไม่ตัด
      rows.push({ uid: p.uid, code: p.code, tambon: grp.name, kg: +take.toFixed(2), seq: ++seq, over: false });
      left -= take;
    }
  }
  if (left > QUOTA_EPS) {
    // ทุกแปลงเต็มโควต้ารายเดือนแล้วแต่ยังตัดไม่หมด — กระจายส่วนเกินตามสัดส่วนพื้นที่ พร้อมทำเครื่องหมายไว้
    let tot = 0;
    for (const p of scopePlots) tot += p.areaRai;
    if (tot > 0) {
      for (const p of scopePlots) {
        const add = left * p.areaRai / tot;
        if (add <= QUOTA_EPS) continue;
        const exist = rows.find(r => r.uid === p.uid);
        if (exist) { exist.kg = +(exist.kg + add).toFixed(2); exist.over = true; }
        else rows.push({ uid: p.uid, code: p.code, tambon: '(เกินกำลังผลิตรายเดือน)', kg: +add.toFixed(2), seq: ++seq, over: true });
      }
    }
  }
  return rows;
}

/** จัดกลุ่มแปลงของแหล่งตามชื่อเกษตรกร */
function farmersOf(supId) {
  const m = new Map();
  for (const p of (S.plotsBySup.get(supId) || [])) {
    const k = p.farmer || p.owner || '(ไม่ระบุชื่อ)';
    if (!m.has(k)) m.set(k, { name: k, plots: [], rai: 0 });
    const f = m.get(k);
    f.plots.push(p); f.rai += p.areaRai;
  }
  return Array.from(m.values()).sort((a, b) => b.rai - a.rai);
}

function statusOf(pct) {
  if (pct > 100) return { key: 'danger', label: 'เกินโควต้า' };
  if (pct >= S.cfg.warnAt) return { key: 'warn', label: 'ใกล้เต็ม' };
  return { key: 'ok', label: 'ปกติ' };
}
function quotaRow(sup, season) {
  const q = quotaOf(sup);
  const used = usedOf(sup.id, season);
  const pct = q.kg > 0 ? (used / q.kg) * 100 : (used > 0 ? 999 : 0);
  return { sup, quota: q.kg, source: q.source, used, remain: q.kg - used, pct, st: statusOf(pct) };
}
function seasonYears() {
  const now = new Date().getFullYear();
  const set = new Set([now, now - 1, now + 1]);
  S.tx.forEach(t => set.add(t.season));
  return Array.from(set).sort((a, b) => b - a);
}

/* ============================== แผนที่ (canvas + ไทล์แผนที่ออนไลน์) ============================== */
const BASEMAPS = {
  sat: {
    label: 'ภาพดาวเทียม',
    url: (z, x, y) => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x,
    attr: '© Esri, Maxar, Earthstar Geographics', alpha: 1, max: 19
  },
  osm: {
    label: 'แผนที่ถนน',
    url: (z, x, y) => 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png',
    attr: '© OpenStreetMap', alpha: 0.85, max: 19
  },
  none: { label: 'ไม่มีพื้นหลัง', url: null, attr: '', alpha: 1, max: 19 }
};
const BASE_ORDER = ['sat', 'osm', 'none'];

/* ชั้นขอบเขตการปกครอง — เปิด/ปิดได้อิสระต่อกัน */
const ADMIN_LAYERS = [
  { key: 'prov', label: 'จังหวัด', list: 'provinces', minZoom: 0,  minPx: 150, font: 14,   width: 2.4,
    on: 'rgba(255,255,255,.95)',  off: 'rgba(35,50,40,.9)',   dash: null },
  { key: 'amp',  label: 'อำเภอ',   list: 'amphoes',   minZoom: 0,  minPx: 110, font: 12.5, width: 1.7,
    on: 'rgba(255,235,150,.95)',  off: 'rgba(60,80,65,.9)',   dash: null },
  { key: 'tam',  label: 'ตำบล',    list: 'tambons',   minZoom: 10, minPx: 70,  font: 11,   width: 1,
    on: 'rgba(255,255,255,.55)',  off: 'rgba(90,110,95,.65)', dash: [4, 4] }
];
const DEFAULT_LAYERS = { prov: true, amp: true, tam: false };

/* พื้นที่อนุรักษ์ — สีแยกจากสีประเภทแหล่งวัตถุดิบ (เขียว/เหลือง/ฟ้า) ให้ชัด */
const PROT_STYLE = {
  np: { color: '#ff5a6e' }, ws: { color: '#c77dff' }, fp: { color: '#ff9c5a' },
  nh: { color: '#5ae0d0' }, rf: { color: '#b98a5a' }
};
const PROT_KEYS = PROT.types.filter(t => PROT.areas.some(a => a.type === t.key)).map(t => t.key);
const DEFAULT_PROT = PROT_KEYS.reduce((o, k) => { o[k] = true; return o; }, {});
const protLabel = k => (PROT.types.find(t => t.key === k) || {}).label || k;

function Map2(box, polys, opts) {
  opts = opts || {};
  const focus = opts.focus;
  const cv = document.createElement('canvas');
  box.innerHTML = '';
  box.appendChild(cv);
  const ctrl = document.createElement('div');
  ctrl.className = 'map-ctrl';
  ctrl.innerHTML = '<button data-a="in" title="ขยาย">+</button>' +
                   '<button data-a="out" title="ย่อ">−</button>' +
                   '<button data-a="fit" title="พอดีจอ">⤢</button>' +
                   '<button data-a="layers" title="เลือกชั้นแผนที่">☰</button>';
  box.appendChild(ctrl);

  let base = opts.base || S.ui.base || 'sat';
  if (!BASEMAPS[base]) base = 'sat';
  const layers = Object.assign({}, DEFAULT_LAYERS, S.ui.layers || {});
  const prot = Object.assign({}, DEFAULT_PROT, S.ui.prot || {});

  const panel = document.createElement('div');
  panel.className = 'map-layers';
  panel.innerHTML =
    '<div class="ml-group"><b>ภาพพื้นหลัง</b>' +
      BASE_ORDER.map(k => '<label><input type="radio" name="b' + (Map2._n = (Map2._n || 0) + 1) +
        '" value="' + k + '"' + (k === base ? ' checked' : '') + '> ' + BASEMAPS[k].label + '</label>').join('') +
    '</div>' +
    '<div class="ml-group"><b>ขอบเขตการปกครอง</b>' +
      ADMIN_LAYERS.map(l => '<label><input type="checkbox" data-l="' + l.key + '"' +
        (layers[l.key] ? ' checked' : '') + '> ' + l.label +
        (l.minZoom ? ' <i>(ซูม ' + l.minZoom + '+)</i>' : '') + '</label>').join('') +
    '</div>' +
    (PROT_KEYS.length ? '<div class="ml-group"><b>พื้นที่อนุรักษ์</b>' +
      PROT_KEYS.map(k => '<label><input type="checkbox" data-p="' + k + '"' +
        (prot[k] ? ' checked' : '') + '> <s style="background:' + PROT_STYLE[k].color + '"></s>' +
        protLabel(k) + '</label>').join('') +
    '</div>' : '');
  box.appendChild(panel);

  const info = document.createElement('div');
  info.className = 'map-info';
  box.appendChild(info);

  const ctx = cv.getContext('2d');
  const tiles = new Map();
  const embs = new Map();
  let z = 13, cx = 0, cy = 0, dpr = 1;

  const lon2x = (lon, zz) => (lon + 180) / 360 * 256 * Math.pow(2, zz);
  const lat2y = (lat, zz) => {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * Math.pow(2, zz);
  };
  const x2lon = (px, zz) => px / (256 * Math.pow(2, zz)) * 360 - 180;
  const y2lat = (py, zz) => {
    const n = Math.PI - 2 * Math.PI * py / (256 * Math.pow(2, zz));
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  };

  function bounds() {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    (focus && focus.length ? focus : polys).forEach(pg => pg.pts.forEach(p => {
      if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0];
      if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1];
    }));
    return a > c ? null : [a, b, c, d];
  }
  function fit() {
    const bb = bounds();
    if (!bb) return;
    const w = cv.clientWidth || box.clientWidth || 600, h = cv.clientHeight || box.clientHeight || 340;
    const pad = 26;
    for (let t = 19; t >= 3; t--) {
      const dx = Math.abs(lon2x(bb[2], t) - lon2x(bb[0], t));
      const dy = Math.abs(lat2y(bb[1], t) - lat2y(bb[3], t));
      if (dx <= w - pad * 2 && dy <= h - pad * 2) { z = t; break; }
    }
    cx = (bb[0] + bb[2]) / 2; cy = (bb[1] + bb[3]) / 2;
    draw();
  }
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || box.clientWidth, h = cv.clientHeight || box.clientHeight;
    if (!w || !h) return false;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    draw();
    return true;
  }
  // ภาพสดจากอินเทอร์เน็ต — ถ้าโหลดไม่ได้เลย (ออฟไลน์ หรือถูกนโยบายของหน้าปิดกั้น)
  // จะเลิกเรียกเอง แล้วใช้ภาพดาวเทียมที่ฝังมาในไฟล์แทน
  let tileOk = 0, tileFail = 0, tilesBlocked = false;
  function tile(tx, ty, tz) {
    const k = base + '/' + tz + '/' + tx + '/' + ty;
    if (tiles.has(k)) return tiles.get(k);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { tileOk++; draw(); };
    img.onerror = () => {
      img._bad = true;
      if (++tileFail >= 4 && !tileOk && !tilesBlocked) { tilesBlocked = true; draw(); }
    };
    img.src = BASEMAPS[base].url(tz, tx, ty);
    tiles.set(k, img);
    return img;
  }
  const embReady = !!(TILES && TILES.count);
  /** ภาพดาวเทียมที่ฝังไว้ — คืน null ระหว่างที่ยังถอดรหัสไม่เสร็จ */
  function emb(tz, tx, ty) {
    const k = tz + '/' + tx + '/' + ty;
    if (!TILES.t[k]) return null;
    let img = embs.get(k);
    if (!img) {
      img = new Image();
      img.onload = () => draw();
      img.src = 'data:image/jpeg;base64,' + TILES.t[k];
      embs.set(k, img);
    }
    return (img.complete && img.naturalWidth) ? img : null;
  }
  /** วาดไทล์ที่ฝังไว้ ถ้าซูมลึกกว่าที่มี ให้ขยายจากไทล์แม่ */
  function drawEmb(tx, ty, ox, oy, T) {
    if (!embReady) return false;
    for (let k = 0; k <= 8; k++) {
      const pz = z - k;
      if (pz < TILES.min) break;
      if (pz > TILES.max) continue;
      const n = 1 << k;
      const px = Math.floor(tx / n), py = Math.floor(ty / n);
      const img = emb(pz, px, py);
      if (!img) continue;
      const s = 256 / n;
      ctx.drawImage(img, (tx - px * n) * s, (ty - py * n) * s, s, s,
                    ox + tx * T, oy + ty * T, T, T);
      return true;
    }
    return false;
  }
  function offset() {
    const px = lon2x(cx, z) * dpr, py = lat2y(cy, z) * dpr;
    return [cv.width / 2 - px, cv.height / 2 - py];
  }
  function path(pg, ox, oy) {
    ctx.beginPath();
    pg.pts.forEach((p, i) => {
      const x = ox + lon2x(p[0], z) * dpr, y = oy + lat2y(p[1], z) * dpr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
  }
  /** กรอบพิกัดที่มองเห็นอยู่ ใช้คัดขอบเขตที่ไม่ต้องวาด */
  function viewBox(ox, oy) {
    return [
      x2lon((-ox) / dpr, z), y2lat((cv.height - oy) / dpr, z),
      x2lon((cv.width - ox) / dpr, z), y2lat((-oy) / dpr, z)
    ];
  }
  /* ชื่อกำกับทุกชั้นเก็บไว้ที่เดียว แล้วค่อยวาดทีหลังสุด เพื่อจัดการไม่ให้ทับกัน */
  let labelQ = [];
  /** เพิ่มวงหนึ่งวงเข้า path ปัจจุบัน — ไม่เริ่ม path ใหม่
      (ต้องไม่เรียก beginPath ที่นี่ ไม่งั้นวงนอกจะถูกล้างทิ้งตอนวาดวงในที่เจาะรู) */
  function ringSub(ring, ox, oy) {
    for (let i = 0; i < ring.length; i++) {
      const x = ox + lon2x(ring[i][0], z) * dpr, y = oy + lat2y(ring[i][1], z) * dpr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  /** พื้นที่อนุรักษ์ — ระบายทึบจาง ๆ ให้เห็นขอบเขตชัดโดยไม่บังภาพดาวเทียม */
  function drawProtect(ox, oy, sat) {
    if (!PROT.areas.length) return;
    const vb = viewBox(ox, oy);
    for (const a of PROT.areas) {
      if (!prot[a.type]) continue;
      const bb = a.bbox;
      if (bb[2] < vb[0] || bb[0] > vb[2] || bb[3] < vb[1] || bb[1] > vb[3]) continue;
      const col = (PROT_STYLE[a.type] || {}).color || '#888';
      for (const rings of a.polys) {
        ctx.beginPath();
        for (const ring of rings) ringSub(ring, ox, oy);   // วงแรก = ขอบนอก วงถัดไป = รูเจาะ
        ctx.fillStyle = col + (sat ? '2e' : '24');
        ctx.fill('evenodd');
        ctx.lineWidth = 1.4 * dpr;
        ctx.strokeStyle = col + 'cc';
        ctx.stroke();
      }
      const px = (lon2x(bb[2], z) - lon2x(bb[0], z)) * dpr;
      if (px >= 120 * dpr) labelQ.push({
        text: a.name, font: 11.5, rank: 3, color: col,
        x: ox + lon2x((bb[0] + bb[2]) / 2, z) * dpr,
        y: oy + lat2y((bb[1] + bb[3]) / 2, z) * dpr
      });
    }
  }
  /** วาดชื่อกำกับทั้งหมด เรียงตามลำดับความสำคัญ ข้ามอันที่ทับของเดิม */
  function placeLabels(sat) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labelQ.sort((a, b) => a.rank - b.rank);
    const placed = [];
    for (const l of labelQ) {
      ctx.font = (l.strong ? '600 ' : '') + (l.font * dpr) + 'px "IBM Plex Sans Thai", sans-serif';
      const halfW = ctx.measureText(l.text).width / 2 + 3 * dpr;
      const halfH = l.font * dpr * 0.8;
      const bx = [l.x - halfW, l.y - halfH, l.x + halfW, l.y + halfH];
      let clash = false;
      for (const q of placed) {
        if (!(bx[2] < q[0] || bx[0] > q[2] || bx[3] < q[1] || bx[1] > q[3])) { clash = true; break; }
      }
      if (clash) continue;
      placed.push(bx);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = sat ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = l.color ? l.color
        : sat ? (l.strong ? '#ffeb96' : 'rgba(255,255,255,.9)')
              : (l.strong ? '#2a3a2e' : 'rgba(70,90,75,.9)');
      ctx.fillText(l.text, l.x, l.y);
    }
  }
  /** วาดขอบเขตจังหวัด/อำเภอ/ตำบล */
  function drawAdminLayer(ox, oy, sat) {
    const vb = viewBox(ox, oy);
    // วาดจากละเอียดไปหยาบ เพื่อให้เส้นจังหวัดทับอยู่บนสุด
    const sets = [];
    for (let i = ADMIN_LAYERS.length - 1; i >= 0; i--) {
      const L = ADMIN_LAYERS[i];
      if (!layers[L.key] || z < L.minZoom) continue;
      const list = ADMIN[L.list];
      if (!list || !list.length) continue;
      sets.push({
        list: list, width: L.width, label: L.key === 'prov' ? 'จ.' : L.key === 'amp' ? 'อ.' : 'ต.',
        color: sat ? L.on : L.off, dash: L.dash, minPx: L.minPx, font: L.font, rank: i
      });
    }
    if (!sets.length) return;

    for (const set of sets) {
      ctx.lineWidth = set.width * dpr;
      ctx.strokeStyle = set.color;
      ctx.setLineDash(set.dash ? set.dash.map(v => v * dpr) : []);
      for (const f of set.list) {
        const bb = f.bbox;
        if (bb[2] < vb[0] || bb[0] > vb[2] || bb[3] < vb[1] || bb[1] > vb[3]) continue;
        for (const rings of f.polys) {
          for (const ring of rings) {
            ctx.beginPath();
            for (let i = 0; i < ring.length; i++) {
              const x = ox + lon2x(ring[i][0], z) * dpr, y = oy + lat2y(ring[i][1], z) * dpr;
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
        const px = (lon2x(bb[2], z) - lon2x(bb[0], z)) * dpr;
        if (px >= set.minPx * dpr) labelQ.push({
          text: set.label + f.name, font: set.font, rank: set.rank,
          x: ox + lon2x((bb[0] + bb[2]) / 2, z) * dpr,
          y: oy + lat2y((bb[1] + bb[3]) / 2, z) * dpr,
          strong: set.rank <= 1
        });
      }
    }
    ctx.setLineDash([]);
  }

  function draw() {
    const w = cv.width, h = cv.height;
    const bm = BASEMAPS[base];
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (matchMedia('(prefers-color-scheme: dark)').matches &&
       document.documentElement.getAttribute('data-theme') !== 'light');
    // ภาพดาวเทียมจะแสดงได้ทั้งจากอินเทอร์เน็ตและจากที่ฝังไว้ในไฟล์
    const satOn = base === 'sat' && (!tilesBlocked || embReady);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = satOn ? '#0b1a12' : (dark ? '#1f2620' : '#eef2ec');
    ctx.fillRect(0, 0, w, h);

    const off = offset(), ox = off[0], oy = off[1];
    const T = 256 * dpr;

    if (base !== 'none') {
      const t0x = Math.floor(-ox / T), t1x = Math.floor((w - ox) / T);
      const t0y = Math.floor(-oy / T), t1y = Math.floor((h - oy) / T);
      const max = Math.pow(2, z) - 1;
      const live = bm.url && !tilesBlocked;
      ctx.globalAlpha = base === 'osm' && dark ? 0.55 : bm.alpha;
      for (let tx = t0x; tx <= t1x; tx++) {
        for (let ty = t0y; ty <= t1y; ty++) {
          if (tx < 0 || ty < 0 || tx > max || ty > max) continue;
          let drew = false;
          if (live) {
            const img = tile(tx, ty, z);
            if (img.complete && !img._bad && img.naturalWidth) {
              ctx.drawImage(img, ox + tx * T, oy + ty * T, T, T);
              drew = true;
            }
          }
          // ยังไม่มีภาพสด → ใช้ภาพดาวเทียมที่ฝังไว้คั่นไปก่อน
          if (!drew && base === 'sat') drawEmb(tx, ty, ox, oy, T);
        }
      }
      ctx.globalAlpha = 1;
    }

    const sat = satOn;
    labelQ = [];
    drawProtect(ox, oy, sat);
    drawAdminLayer(ox, oy, sat);

    polys.forEach(pg => {
      path(pg, ox, oy);
      ctx.fillStyle = sat ? (pg.fillSat || pg.fill) : pg.fill;
      ctx.fill();
      ctx.lineWidth = (pg.hi ? 2.4 : pg.warn ? 2 : 1.2) * dpr;
      ctx.strokeStyle = pg.warn ? '#ff3b52' : (sat ? (pg.strokeSat || pg.stroke) : pg.stroke);
      ctx.stroke();
    });
    placeLabels(sat);
    let src;
    if (base === 'none') src = BASEMAPS.none.label;
    else if (!tilesBlocked) src = bm.label + ' ' + bm.attr;
    else if (satOn) src = 'ภาพดาวเทียมที่ฝังในไฟล์ ' + TILES.attr +
      (z > TILES.max ? ' (ซูมเกินความละเอียดที่ฝังไว้)' : '');
    else src = 'โหลดภาพแผนที่ไม่ได้ในหน้านี้';

    const shown = ADMIN_LAYERS.filter(l => layers[l.key] && ADMIN[l.list] && ADMIN[l.list].length);
    const pend = shown.filter(l => z < l.minZoom).map(l => l.label);
    const drawn = shown.filter(l => z >= l.minZoom).map(l => l.label);

    info.textContent = n0(polys.length) + ' แปลง · zoom ' + z + ' · ' + src +
      (drawn.length ? ' · ขอบเขต' + drawn.join('/') : '') +
      (pend.length ? ' (ซูมเข้าเพื่อดู' + pend.join('/') + ')' : '');
  }
  function pick(clientX, clientY) {
    const r = cv.getBoundingClientRect();
    const px = (clientX - r.left) * dpr, py = (clientY - r.top) * dpr;
    const off = offset();
    for (let i = polys.length - 1; i >= 0; i--) {
      path(polys[i], off[0], off[1]);
      if (ctx.isPointInPath(px, py)) return polys[i];
    }
    return null;
  }

  let drag = null;
  cv.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, cx, cy, moved: 0 };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    drag.moved = Math.max(drag.moved, Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y));
    const sc = 256 * Math.pow(2, z);
    cx = drag.cx - (e.clientX - drag.x) * 360 / sc;
    const dy = (e.clientY - drag.y);
    const yPix = lat2y(drag.cy, z) - dy;
    const n = Math.PI - 2 * Math.PI * yPix / sc;
    cy = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    draw();
  });
  cv.addEventListener('pointerup', e => {
    const wasClick = drag && drag.moved < 4;
    drag = null;
    if (wasClick && opts.onPick) {
      const hit = pick(e.clientX, e.clientY);
      if (hit) opts.onPick(hit);
    }
  });
  cv.addEventListener('pointercancel', () => { drag = null; });
  if (opts.onPick) cv.style.cursor = 'crosshair';
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    z = Math.max(3, Math.min(19, z + (e.deltaY < 0 ? 1 : -1)));
    draw();
  }, { passive: false });
  ctrl.addEventListener('click', e => {
    const a = e.target.getAttribute('data-a');
    if (a === 'in') z = Math.min(19, z + 1);
    else if (a === 'out') z = Math.max(3, z - 1);
    else if (a === 'fit') return fit();
    else if (a === 'layers') { panel.classList.toggle('open'); return; }
    draw();
  });
  panel.addEventListener('change', e => {
    const t = e.target;
    if (t.type === 'radio') {
      base = t.value;
      S.ui.base = base; save(LS.ui, S.ui);
    } else if (t.getAttribute('data-l')) {
      layers[t.getAttribute('data-l')] = t.checked;
      S.ui.layers = Object.assign({}, layers); save(LS.ui, S.ui);
    } else if (t.getAttribute('data-p')) {
      prot[t.getAttribute('data-p')] = t.checked;
      S.ui.prot = Object.assign({}, prot); save(LS.ui, S.ui);
    }
    draw();
  });
  // คลิกนอกแผงให้ปิด
  document.addEventListener('click', e => {
    if (panel.classList.contains('open') && !panel.contains(e.target) && !ctrl.contains(e.target))
      panel.classList.remove('open');
  });

  // ปรับขนาดทันที และลองซ้ำเผื่อ layout ยังไม่เสร็จ
  // (rAF ไม่ทำงานเมื่อแท็บถูกซ่อน และแท็บที่ซ่อนอยู่อาจรายงานขนาดเป็น 0
  //  จึงต้องรอจนกว่าจะได้ขนาดจริงแล้วค่อยจัดกรอบครั้งแรก)
  let fitted = false;
  function sizeThenFit() {
    if (!resize()) return false;
    if (!fitted) { fitted = true; fit(); }
    return true;
  }
  // แท็บที่ถูกซ่อนอยู่จะระงับทั้ง requestAnimationFrame และ ResizeObserver
  // จึงต้องใช้ตัวจับเวลา (ยังทำงานแม้แท็บถูกซ่อน) คอยเช็กจนกว่าจะได้ขนาดจริง
  let tries = 0;
  (function boot() {
    if (sizeThenFit()) return;
    if (box.isConnected && ++tries < 120) setTimeout(boot, tries < 20 ? 50 : 500);
  })();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => sizeThenFit());
    ro.observe(box);
  }
  window.addEventListener('resize', sizeThenFit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sizeThenFit();
  });
  return { fit: fit, redraw: draw };
}

/* ============================== GeoJSON ============================== */
function toGeoJSON(plots) {
  return {
    type: 'FeatureCollection',
    name: 'EUDR_plots',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3/CRS84' } },
    features: plots.filter(p => GEO[p.uid]).map(p => {
      const sup = S.supById.get(p.supplierId) || {};
      const ring = GEO[p.uid].slice();
      const f = ring[0], l = ring[ring.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      return {
        type: 'Feature',
        properties: {
          ProducerName: p.farmer || p.owner,
          ProductionPlace: p.code,
          Area: +p.areaHa.toFixed(4),
          SupplierId: p.supplierId,
          SupplierName: sup.name || '',
          SourceCategory: (CAT[sup.category] || {}).label || '',
          Village: sup.village || '',
          LandDocType: DOC[p.docType] || p.docType,
          LandDocNo: p.deed || '',
          Subdistrict: p.subdistrict || '',
          SubdistrictCode: p.subdistrictCode || '',
          District: p.districtGis || p.district || '',
          Province: p.provinceGis || p.province || '',
          AreaRai: +p.areaRai.toFixed(2),
          Registered: p.dateCreated || '',
          ProtectedArea: p.protect || '',
          ProtectedType: p.protect ? protLabel(p.protectType) : '',
          ProtectedOverlap: p.protect ? (p.protectHow === 'in' ? 'inside' : 'edge') : 'none'
        },
        geometry: { type: 'Polygon', coordinates: [ring] }
      };
    })
  };
}

/* ============================== แดชบอร์ด ============================== */
/** แปลงที่ทับเขตอนุรักษ์ — ประเด็นความเสี่ยงหลักของ EUDR */
const protPlots = DB.plots.filter(p => p.protect);

function renderProtectPanel() {
  const el = $('#protectPanel');
  if (!el) return;
  if (!protPlots.length) {
    el.innerHTML = '<p class="muted">ตรวจแล้วไม่พบแปลงที่ทับซ้อนเขตอนุรักษ์ที่มีข้อมูลในระบบ</p>';
    return;
  }
  const rows = protPlots.slice().sort((a, b) =>
    (a.protectHow === b.protectHow ? b.areaRai - a.areaRai : a.protectHow === 'in' ? -1 : 1));
  el.innerHTML = '<div class="table-wrap"><table class="tbl">' + table(
    ['รหัสแปลง', 'เกษตรกร', 'แหล่งวัตถุดิบ', 'เขตอนุรักษ์', 'ประเภท', 'ลักษณะ', 'ไร่'],
    rows.map(p => {
      const s = S.supById.get(p.supplierId) || {};
      return {
        attrs: 'class="clickable" data-plot="' + esc(p.uid) + '"',
        cells: [
          { h: esc(p.code), cls: 'code' },
          { h: esc(p.farmer || p.owner || '—'), cls: 'wide' },
          { h: esc(s.name || p.supplierId), cls: 'wide' },
          { h: esc(p.protect), cls: 'wide' },
          { h: esc(protLabel(p.protectType)) },
          { h: p.protectHow === 'in'
              ? '<span class="tag danger">อยู่ในเขต</span>'
              : '<span class="tag warn">ขอบล้ำเข้า</span>' },
          { h: n2(p.areaRai), cls: 'num' }
        ]
      };
    })) + '</table></div>';
}

function renderDashboard() {
  const cats = ['estate', 'promotion', 'collector'];
  const agg = {};
  cats.forEach(c => agg[c] = { rai: 0, plots: 0, sup: 0, quota: 0, used: 0 });
  let totQuota = 0, totUsed = 0, over = 0, near = 0;

  DB.suppliers.forEach(s => {
    const a = agg[s.category]; if (!a) return;
    a.rai += s.areaRai; a.plots += s.plotCount; a.sup++;
    const r = quotaRow(s);
    a.quota += r.quota; a.used += r.used;
    totQuota += r.quota; totUsed += r.used;
    if (r.pct > 100) over++; else if (r.pct >= S.cfg.warnAt) near++;
  });
  const totRai = cats.reduce((n, c) => n + agg[c].rai, 0);
  const txSeason = S.tx.filter(t => t.season === S.season);

  $('#kpiGrid').innerHTML = [
    kpi('พื้นที่ในระบบทั้งหมด', n0(totRai) + '<small>ไร่</small>',
        n2(totRai / 6.25) + ' เฮกตาร์ · ' + n0(DB.meta.totals.plots) + ' แปลง', 'accent'),
    kpi('แหล่งวัตถุดิบขึ้นทะเบียน', n0(DB.suppliers.length) + '<small>ราย</small>',
        cats.map(c => CAT[c].label + ' ' + n0(agg[c].sup)).join(' · ')),
    kpi('โควต้ารวมปี ' + be(S.season), n0(totQuota / 1000) + '<small>ตัน</small>',
        'ยางแห้ง · คำนวณจากพื้นที่ × ผลผลิตต่อไร่'),
    kpi('รับซื้อสะสมปี ' + be(S.season), n0(totUsed / 1000) + '<small>ตัน</small>',
        n0(txSeason.length) + ' รายการ · ใช้ไป ' + (totQuota ? n2(totUsed / totQuota * 100) : '0.00') + '%',
        totQuota && totUsed / totQuota > 1 ? 'danger' : ''),
    kpi('คงเหลือ', n0(Math.max(0, totQuota - totUsed) / 1000) + '<small>ตัน</small>',
        'จากโควต้ารวมทั้งระบบ'),
    kpi('แหล่งที่ต้องเฝ้าระวัง', n0(over + near) + '<small>ราย</small>',
        'เกินโควต้า ' + n0(over) + ' · ใกล้เต็ม ' + n0(near),
        over ? 'danger' : (near ? 'warn' : '')),
    kpi('แปลงทับเขตอนุรักษ์', n0(protPlots.length) + '<small>แปลง</small>',
        protPlots.length
          ? 'อยู่ในเขต ' + n0(protPlots.filter(p => p.protectHow === 'in').length) +
            ' · ขอบล้ำเข้า ' + n0(protPlots.filter(p => p.protectHow === 'edge').length) +
            ' · ' + n2(protPlots.reduce((n, p) => n + p.areaRai, 0)) + ' ไร่'
          : 'ไม่พบแปลงทับเขตอนุรักษ์',
        protPlots.length ? 'danger' : '')
  ].join('');

  renderProtectPanel();

  $('#catChart').innerHTML = cats.map(c => bar(
    CAT[c].label, agg[c].rai, totRai, CAT[c].hex,
    n0(agg[c].rai) + ' ไร่ · ' + n0(agg[c].plots) + ' แปลง'
  )).join('');

  $('#quotaSummary').innerHTML = '<div class="cat-chart">' + cats.map(c => {
    const pct = agg[c].quota ? agg[c].used / agg[c].quota * 100 : 0;
    const st = statusOf(pct);
    const col = st.key === 'danger' ? '#a32424' : st.key === 'warn' ? '#a86a00' : CAT[c].hex;
    return bar(CAT[c].label, Math.min(pct, 100), 100, col,
      n2(pct) + '% · ' + n0(agg[c].used / 1000) + '/' + n0(agg[c].quota / 1000) + ' ตัน');
  }).join('') + '</div>';

  const top = DB.suppliers.map(s => quotaRow(s)).filter(r => r.used > 0)
    .sort((a, b) => b.pct - a.pct).slice(0, 10);
  $('#topNote').textContent = top.length ? '' : 'ยังไม่มีการบันทึกรับซื้อในปีการผลิตนี้';
  $('#topQuotaTbl').innerHTML = table(
    ['แหล่งวัตถุดิบ', 'ประเภท', 'พื้นที่ (ไร่)', 'โควต้า (กก.)', 'รับซื้อแล้ว (กก.)', 'คงเหลือ (กก.)', 'ใช้ไป', 'สถานะ'],
    top.map(r => [
      { h: esc(r.sup.name) + (r.sup.village ? '<div class="muted">' + esc(r.sup.village) + '</div>' : ''), cls: 'wide' },
      { h: catTag(r.sup.category) },
      { h: n0(r.sup.areaRai), cls: 'num' },
      { h: n0(r.quota), cls: 'num' },
      { h: n0(r.used), cls: 'num' },
      { h: n0(r.remain), cls: 'num' },
      { h: meter(r.pct) },
      { h: '<span class="tag ' + r.st.key + '">' + r.st.label + '</span>' }
    ]), 'ยังไม่มีข้อมูลการรับซื้อ'
  );

  const docs = {};
  DB.plots.forEach(p => docs[p.docType] = (docs[p.docType] || 0) + p.areaRai);
  const dTot = Object.keys(docs).reduce((n, k) => n + docs[k], 0);
  const dCol = { chanote: '#2d6a4f', spk: '#2f5d8c', nor_sor_3: '#b07d2b' };
  $('#docChart').innerHTML = Object.keys(docs).sort((a, b) => docs[b] - docs[a])
    .map(k => bar(DOC[k] || k, docs[k], dTot, dCol[k] || '#777',
      n0(docs[k]) + ' ไร่ · ' + n2(docs[k] / dTot * 100) + '%')).join('');

  renderAreaChart();
}

/* ---------- พื้นที่ตามเขตปกครอง ---------- */
let areaLevel = 'prov';
function renderAreaChart() {
  const keyFn = areaLevel === 'prov' ? provOf
    : areaLevel === 'dist' ? (p => distOf(p) ? distOf(p) + ' · ' + provOf(p) : '')
    : (p => tamOf(p) ? tamOf(p) + ' · อ.' + distOf(p) : '');
  const agg = {};
  DB.plots.forEach(p => {
    const k = keyFn(p) || '(ไม่ระบุ)';
    if (!agg[k]) agg[k] = { rai: 0, plots: 0 };
    agg[k].rai += p.areaRai; agg[k].plots++;
  });
  const keys = Object.keys(agg).sort((a, b) => agg[b].rai - agg[a].rai);
  const top = keys.slice(0, 12);
  const max = agg[keys[0]] ? agg[keys[0]].rai : 1;
  let html = top.map(k => bar(k, agg[k].rai, max, '#2f5d8c',
    n0(agg[k].rai) + ' ไร่ · ' + n0(agg[k].plots) + ' แปลง')).join('');
  if (keys.length > top.length) {
    const rest = keys.slice(12).reduce((n, k) => n + agg[k].rai, 0);
    html += '<p class="muted">และอีก ' + n0(keys.length - 12) +
      (areaLevel === 'prov' ? ' จังหวัด' : areaLevel === 'dist' ? ' อำเภอ' : ' ตำบล') +
      ' รวม ' + n0(rest) + ' ไร่</p>';
  }
  $('#areaChart').innerHTML = html;
}
/* ---------- แผนที่ดาวเทียมภาพรวม ---------- */
const mapState = { cat: '', prov: '', dist: '', tam: '' };
const MAP_SEL = { prov: '#mapProvince', dist: '#mapDistrict', tam: '#mapTambon' };
function renderOverviewMap() {
  const box = $('#overviewMap');
  if (!box) return;
  const list = DB.plots.filter(p => {
    if (!matchArea(p, mapState)) return false;
    if (!mapState.cat) return true;
    const s = S.supById.get(p.supplierId);
    return s && s.category === mapState.cat;
  });
  const polys = [];
  let rai = 0;
  list.forEach(p => {
    const g = GEO[p.uid];
    if (!g) return;
    const c = CAT[(S.supById.get(p.supplierId) || {}).category] || CAT.collector;
    rai += p.areaRai;
    polys.push({
      pts: g, plot: p, warn: !!p.protect,      // แปลงที่ทับเขตอนุรักษ์ตีกรอบแดง
      fill: c.hex + '55', stroke: c.hex,
      fillSat: c.sat + '3d', strokeSat: c.sat
    });
  });
  $('#mapNote').textContent = 'แสดง ' + n0(polys.length) + ' แปลง · ' + n0(rai) + ' ไร่' +
    (mapState.cat || mapState.prov || mapState.dist || mapState.tam ? ' (ตามตัวกรอง)' : '') +
    ' · ระบบพิกัด WGS84 — ภาพพื้นหลังต้องเชื่อมต่ออินเทอร์เน็ต';
  if (!polys.length) {
    box.innerHTML = '<div class="empty">ไม่มีแปลงตามเงื่อนไขที่เลือก</div>';
    return;
  }
  Map2(box, polys, { base: S.ui.base || 'sat', onPick: pg => showPlot(pg.plot.uid) });
}

function kpi(label, value, sub, cls) {
  return '<div class="kpi ' + (cls || '') + '"><div class="label">' + esc(label) +
    '</div><div class="value">' + value + '</div><div class="sub">' + sub + '</div></div>';
}
function bar(name, v, max, color, right) {
  const w = max ? Math.max(1.5, v / max * 100) : 0;
  return '<div class="catrow"><span class="nm" title="' + esc(name) + '">' + esc(name) +
    '</span><span class="bar"><i style="width:' + w + '%;background:' + color + '"></i></span>' +
    '<span class="vl">' + right + '</span></div>';
}
function meter(pct) {
  const st = statusOf(pct);
  return '<div class="meter ' + (st.key === 'danger' ? 'd' : st.key === 'warn' ? 'w' : '') +
    '" title="' + n2(pct) + '%"><i style="width:' + Math.min(100, pct) + '%"></i></div>';
}
function catTag(c) {
  return '<span class="tag ' + c + '">' + ((CAT[c] || {}).label || c) + '</span>';
}
function table(heads, rows, emptyMsg) {
  const th = '<thead><tr>' + heads.map(h => '<th>' + h + '</th>').join('') + '</tr></thead>';
  if (!rows.length)
    return th + '<tbody><tr class="empty-row"><td colspan="' + heads.length + '">' +
      esc(emptyMsg || 'ไม่พบข้อมูล') + '</td></tr></tbody>';
  const tb = rows.map(r => {
    const attrs = r.attrs || '';
    const cells = (r.cells || r).map(c => typeof c === 'object'
      ? '<td class="' + (c.cls || '') + '">' + c.h + '</td>'
      : '<td>' + esc(c) + '</td>').join('');
    return '<tr ' + attrs + '>' + cells + '</tr>';
  }).join('');
  return th + '<tbody>' + tb + '</tbody>';
}

/* ============================== ทะเบียนแหล่งวัตถุดิบ ============================== */
const supState = { q: '', cat: '', sort: 'areaRai', page: 1, per: 40 };
function supFiltered() {
  const q = supState.q.trim().toLowerCase();
  let list = DB.suppliers.filter(s => {
    if (supState.cat && s.category !== supState.cat) return false;
    if (!q) return true;
    return (s.name + ' ' + (s.village || '') + ' ' + s.id + ' ' + (s.district || '')).toLowerCase().indexOf(q) >= 0;
  }).map(s => quotaRow(s));
  const k = supState.sort;
  list.sort((a, b) =>
    k === 'name' ? a.sup.name.localeCompare(b.sup.name, 'th')
    : k === 'usedPct' ? b.pct - a.pct
    : k === 'remain' ? a.remain - b.remain
    : b.sup.areaRai - a.sup.areaRai);
  return list;
}
function renderSuppliers() {
  const all = supFiltered();
  const totRai = all.reduce((n, r) => n + r.sup.areaRai, 0);
  $('#supCount').textContent = n0(all.length) + ' ราย · ' + n0(totRai) + ' ไร่';
  const start = (supState.page - 1) * supState.per;
  const page = all.slice(start, start + supState.per);
  $('#supTbl').innerHTML = table(
    ['แหล่งวัตถุดิบ', 'ประเภท', 'หมู่บ้าน / กลุ่ม', 'รหัส CV', 'แปลง', 'พื้นที่ (ไร่)',
     'โควต้า (กก.)', 'รับซื้อแล้ว', 'คงเหลือ', 'ใช้ไป', 'สถานะ'],
    page.map(r => ({
      attrs: 'class="clickable" data-sup="' + esc(r.sup.id) + '"',
      cells: [
        { h: esc(r.sup.name) + (r.sup.noPlots ? ' <span class="tag dim">ยังไม่มีแปลง</span>' : ''), cls: 'wide' },
        { h: catTag(r.sup.category) },
        { h: esc(r.sup.village || '—'), cls: 'wide' },
        { h: esc(r.sup.id), cls: 'code' },
        { h: n0(r.sup.plotCount), cls: 'num' },
        { h: n0(r.sup.areaRai), cls: 'num' },
        { h: n0(r.quota) + (r.source === 'override' ? ' *' : ''), cls: 'num' },
        { h: n0(r.used), cls: 'num' },
        { h: n0(r.remain), cls: 'num' },
        { h: meter(r.pct) },
        { h: '<span class="tag ' + r.st.key + '">' + r.st.label + '</span>' }
      ]
    })), 'ไม่พบแหล่งวัตถุดิบที่ตรงกับเงื่อนไข'
  );
  pager('#supPager', all.length, supState, renderSuppliers);
}

/* ============================== ที่ตั้งเชิงปกครอง (ใช้ร่วมกันหลายหน้า) ============================== */
const provOf = p => p.provinceGis || p.province || '';
const distOf = p => p.districtGis || p.district || '';
const tamOf  = p => p.subdistrict || '';

/** กรองตามจังหวัด/อำเภอ/ตำบล */
function matchArea(p, st) {
  if (st.prov && provOf(p) !== st.prov) return false;
  if (st.dist && distOf(p) !== st.dist) return false;
  if (st.tam && tamOf(p) !== st.tam) return false;
  return true;
}
/** เติมตัวเลือกแบบลดหลั่น: เลือกจังหวัด → เหลือเฉพาะอำเภอในจังหวัดนั้น ฯลฯ */
function fillAreaSelects(st, ids) {
  const provs = new Set(), dists = new Set(), tams = new Set();
  DB.plots.forEach(p => {
    if (provOf(p)) provs.add(provOf(p));
    if ((!st.prov || provOf(p) === st.prov) && distOf(p)) dists.add(distOf(p));
    if ((!st.prov || provOf(p) === st.prov) && (!st.dist || distOf(p) === st.dist) && tamOf(p)) tams.add(tamOf(p));
  });
  const opts = (set, all, cur) => '<option value="">' + all + '</option>' +
    Array.from(set).sort((a, b) => a.localeCompare(b, 'th'))
      .map(v => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  if (!dists.has(st.dist)) st.dist = '';
  if (!tams.has(st.tam)) st.tam = '';
  $(ids.prov).innerHTML = opts(provs, 'ทุกจังหวัด', st.prov);
  $(ids.dist).innerHTML = opts(dists, 'ทุกอำเภอ', st.dist);
  $(ids.tam).innerHTML = opts(tams, 'ทุกตำบล', st.tam);
}

/* ============================== แปลงปลูก ============================== */
const plotState = { q: '', cat: '', doc: '', prov: '', dist: '', tam: '', prot: '', page: 1, per: 50 };
const PLOT_SEL = { prov: '#plotProvince', dist: '#plotDistrict', tam: '#plotTambon' };
function plotFiltered() {
  const q = plotState.q.trim().toLowerCase();
  return DB.plots.filter(p => {
    if (plotState.doc && p.docType !== plotState.doc) return false;
    if (plotState.prot === 'any' && !p.protect) return false;
    if (plotState.prot === 'none' && p.protect) return false;
    if ((plotState.prot === 'in' || plotState.prot === 'edge') && p.protectHow !== plotState.prot) return false;
    if (!matchArea(p, plotState)) return false;
    if (plotState.cat) {
      const s = S.supById.get(p.supplierId);
      if (!s || s.category !== plotState.cat) return false;
    }
    if (!q) return true;
    return (p.code + ' ' + (p.farmer || '') + ' ' + (p.owner || '') + ' ' + (p.deed || '')).toLowerCase().indexOf(q) >= 0;
  });
}
function renderPlots() {
  const all = plotFiltered();
  const rai = all.reduce((n, p) => n + p.areaRai, 0);
  $('#plotCount').textContent = n0(all.length) + ' แปลง · ' + n0(rai) + ' ไร่';
  const start = (plotState.page - 1) * plotState.per;
  const page = all.slice(start, start + plotState.per);
  $('#plotTbl').innerHTML = table(
    ['รหัสแปลง', 'เกษตรกร / เจ้าของแปลง', 'แหล่งวัตถุดิบ', 'ประเภท', 'เอกสารสิทธิ์', 'เลขที่',
     'ตำบล', 'อำเภอ', 'จังหวัด', 'เขตอนุรักษ์', 'พื้นที่ (ไร่)', 'พื้นที่ (ha)'],
    page.map(p => {
      const s = S.supById.get(p.supplierId) || {};
      return {
        attrs: 'class="clickable" data-plot="' + esc(p.uid) + '"',
        cells: [
          { h: esc(p.code), cls: 'code' },
          { h: esc(p.farmer || p.owner || '—'), cls: 'wide' },
          { h: esc(s.name || p.supplierId) + (s.village ? '<div class="muted">' + esc(s.village) + '</div>' : ''), cls: 'wide' },
          { h: catTag(s.category) },
          { h: DOC[p.docType] || p.docType },
          { h: esc(p.deed || '—'), cls: 'code' },
          { h: esc(p.subdistrict || '—') },
          { h: esc(p.districtGis || p.district || '—') },
          { h: esc(p.provinceGis || p.province || '—') },
          { h: p.protect
              ? '<span class="tag ' + (p.protectHow === 'in' ? 'danger' : 'warn') + '" title="' +
                esc(p.protect) + '">' + esc(protLabel(p.protectType)) + '</span>'
              : '<span class="muted">—</span>' },
          { h: n2(p.areaRai), cls: 'num' },
          { h: n2(p.areaHa), cls: 'num' }
        ]
      };
    }), 'ไม่พบแปลงที่ตรงกับเงื่อนไข'
  );
  pager('#plotPager', all.length, plotState, renderPlots);
}
function pager(sel, total, st, rerender) {
  const pages = Math.max(1, Math.ceil(total / st.per));
  if (st.page > pages) st.page = pages;
  const el = $(sel);
  el.innerHTML = '<button data-p="prev"' + (st.page <= 1 ? ' disabled' : '') + '>‹ ก่อนหน้า</button>' +
    '<span>หน้า ' + st.page + ' / ' + pages + '</span>' +
    '<button data-p="next"' + (st.page >= pages ? ' disabled' : '') + '>ถัดไป ›</button>';
  el.onclick = e => {
    const p = e.target.getAttribute && e.target.getAttribute('data-p');
    if (!p) return;
    st.page += p === 'next' ? 1 : -1;
    st.page = Math.max(1, Math.min(pages, st.page));
    rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

/* ============================== ลิ้นชักรายละเอียด ============================== */
function openDrawer(title, sub, html) {
  $('#drawerTitle').textContent = title;
  $('#drawerSub').textContent = sub || '';
  $('#drawerBody').innerHTML = html;
  $('#drawer').classList.add('open');
  $('#scrim').classList.add('open');
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#scrim').classList.remove('open');
  $('#drawerBody').innerHTML = '';
}
function showSupplier(id) {
  const s = S.supById.get(id);
  if (!s) return;
  const r = quotaRow(s);
  const plots = (S.plotsBySup.get(id) || []).slice().sort((a, b) => b.areaRai - a.areaRai);
  const tx = S.tx.filter(t => t.supplierId === id).sort((a, b) => b.date.localeCompare(a.date));

  const html =
    '<dl class="dl">' +
      dd('ประเภทแหล่งวัตถุดิบ', catTag(s.category) + (s.subGroup ? ' <span class="muted">' + esc(s.subGroup) + '</span>' : '')) +
      dd('รหัสทะเบียน (CV)', '<span class="mono">' + esc(s.id) + '</span>') +
      dd('หมู่บ้าน / กลุ่ม', esc(s.village || '—')) +
      dd('พื้นที่ / อำเภอ', esc([s.district, s.province].filter(Boolean).join(' · ') || '—')) +
      (s.phone ? dd('โทรศัพท์', esc(s.phone)) : '') +
      dd('จำนวนแปลง', n0(s.plotCount) + ' แปลง') +
      dd('พื้นที่รวม', n2(s.areaRai) + ' ไร่ (' + n2(s.areaHa) + ' เฮกตาร์)') +
      (s.flagRai ? dd('พื้นที่เสี่ยง (ไฮไลต์เหลือง)', '<span class="tag warn">' + n2(s.flagRai) + ' ไร่</span>') : '') +
      dd('เอกสารสิทธิ์', Object.keys(s.docTypes || {}).map(k => (DOC[k] || k) + ' ' + n0(s.docTypes[k]) + ' แปลง').join(' · ') || '—') +
    '</dl>' +

    '<div class="subhead">โควต้าปีการผลิต ' + be(S.season) + '</div>' +
    '<div class="quota-meter ' + (r.st.key === 'danger' ? 'alert' : r.st.key === 'warn' ? 'near' : '') + '">' +
      qline('โควต้าทั้งปี', n0(r.quota) + ' กก.' +
        (r.source === 'override' ? ' (กำหนดเอง)'
          : ' (' + n0(quotaOf(s).rai) + ' ไร่ × ' + n0(S.cfg.yield[s.category]) + ' กก./ไร่)')) +
      qline('รับซื้อแล้ว', n0(r.used) + ' กก. (' + n2(r.pct) + '%)') +
      qline('คงเหลือ', n0(r.remain) + ' กก.') +
      '<div style="margin-top:8px">' + meter(r.pct) + '</div>' +
    '</div>' +

    (plots.length && plots.some(p => GEO[p.uid]) ?
      '<div class="subhead">แผนที่แปลงปลูก</div><div class="mapbox" id="supMap"></div>' +
      '<div class="map-legend"><span><i style="background:' + (CAT[s.category] || {}).hex + '"></i>แปลงของแหล่งนี้</span>' +
      '<span>ลากเพื่อเลื่อน · สกรอลล์เพื่อซูม · ปุ่ม 🗺 เปิด/ปิดแผนที่พื้นหลัง</span></div>' : '') +

    '<div class="subhead">รายการแปลง (' + n0(plots.length) + ')</div>' +
    '<div class="table-wrap"><table class="tbl">' + table(
      ['รหัสแปลง', 'เกษตรกร', 'เอกสาร', 'เลขที่', 'ไร่', 'ha'],
      plots.slice(0, 400).map(p => ({
        attrs: 'class="clickable" data-plot="' + esc(p.uid) + '"',
        cells: [
          { h: esc(p.code), cls: 'code' },
          { h: esc(p.farmer || '—'), cls: 'wide' },
          { h: DOC[p.docType] || p.docType },
          { h: esc(p.deed || '—'), cls: 'code' },
          { h: n2(p.areaRai), cls: 'num' },
          { h: n2(p.areaHa), cls: 'num' }
        ]
      })), 'ยังไม่มีแปลงในฐานข้อมูล') + '</table></div>' +
    (plots.length > 400 ? '<p class="muted">แสดง 400 แปลงแรก — ใช้แท็บ “แปลงปลูก” เพื่อดูทั้งหมด</p>' : '') +

    '<div class="subhead">ประวัติการรับซื้อ (' + n0(tx.length) + ')</div>' +
    '<div class="table-wrap"><table class="tbl">' + table(
      ['วันที่', 'เลขที่เอกสาร', 'Lot No.', 'ชนิด', 'น้ำหนัก (กก.)', '%DRC', 'ยางแห้ง (กก.)', 'ใบชั่ง'],
      tx.slice(0, 100).map(t => [
        t.date, t.doc || '—', { h: t.lot ? esc(t.lot) : '—', cls: 'code' },
        PRODUCT[t.product] || t.product,
        { h: n2(t.weightKg), cls: 'num' }, { h: n2(t.drc), cls: 'num' }, { h: n2(t.dryKg), cls: 'num' },
        { h: t.files ? '<button class="btn ghost" data-att-view="' + esc(t.id) + '">📎 ' + t.files + '</button>' : '—' }
      ]), 'ยังไม่มีการรับซื้อ') + '</table></div>' +

    '<div class="subhead">ส่งออก</div>' +
    '<div class="btn-col">' +
      '<button class="btn" data-exp="geo" data-id="' + esc(id) + '">GeoJSON แปลงของแหล่งนี้</button>' +
      '<button class="btn" data-exp="csv" data-id="' + esc(id) + '">CSV รายการแปลง</button>' +
      '<button class="btn primary" data-exp="buy" data-id="' + esc(id) + '">บันทึกการรับซื้อจากแหล่งนี้</button>' +
    '</div>';

  openDrawer(s.name, (CAT[s.category] || {}).label + ' · ' + (s.village || s.id), html);

  const box = $('#supMap');
  if (box) {
    const c = CAT[s.category] || CAT.estate;
    const polys = plots.filter(p => GEO[p.uid]).slice(0, 1200).map(p => ({
      pts: GEO[p.uid], plot: p,
      fill: c.hex + '55', stroke: c.hex,
      fillSat: c.sat + '44', strokeSat: c.sat
    }));
    Map2(box, polys, { onPick: pg => showPlot(pg.plot.uid) });
  }
}
function showPlot(uid) {
  const p = DB.plots.find(x => x.uid === uid);
  if (!p) return;
  const s = S.supById.get(p.supplierId) || {};
  const g = GEO[uid];
  let center = null;
  if (g) {
    let sx = 0, sy = 0;
    g.forEach(pt => { sx += pt[0]; sy += pt[1]; });
    center = [sy / g.length, sx / g.length];
  }
  const html =
    '<dl class="dl">' +
      dd('รหัสแปลง (Plantation Code)', '<span class="mono">' + esc(p.code) + '</span>') +
      dd('เกษตรกร / เจ้าของแปลง', esc(p.farmer || p.owner || '—')) +
      (p.citizenId ? dd('เลขทะเบียนเกษตรกร', '<span class="mono">' + esc(p.citizenId) + '</span>') : '') +
      dd('แหล่งวัตถุดิบ', '<a href="#" data-sup="' + esc(s.id) + '">' + esc(s.name || p.supplierId) + '</a> ' + catTag(s.category)) +
      dd('หมู่บ้าน / กลุ่ม', esc(s.village || '—')) +
      dd('เอกสารสิทธิ์', (DOC[p.docType] || p.docType) + ' เลขที่ ' + esc(p.deed || '—')) +
      dd('ที่ตั้ง (ตามขอบเขตการปกครอง)', esc(adminText(p) || '—')) +
      dd('อำเภอตามไฟล์ต้นทาง', esc([p.district, p.province].filter(Boolean).join(' · ') || '—')) +
      dd('พื้นที่', n2(p.areaRai) + ' ไร่ (' + n2(p.areaHa) + ' เฮกตาร์)') +
      dd('เขตอนุรักษ์', p.protect
        ? '<span class="tag ' + (p.protectHow === 'in' ? 'danger">อยู่ในเขต' : 'warn">ขอบล้ำเข้า') +
          '</span> ' + esc(p.protect) + ' <span class="muted">(' + esc(protLabel(p.protectType)) + ')</span>'
        : '<span class="tag ok">ไม่ทับเขตอนุรักษ์</span>') +
      dd('วันที่ขึ้นทะเบียน', esc(p.dateCreated || '—')) +
      (center ? dd('จุดศูนย์กลาง (WGS84)', '<span class="mono">' + center[0].toFixed(6) + ', ' + center[1].toFixed(6) + '</span>') : '') +
      (g ? dd('จำนวนจุดขอบแปลง', n0(g.length) + ' จุด') : '') +
    '</dl>' +
    (function () {
      const q = quotaOfPlot(p), u = plotUsage().get(p.uid) || 0;
      const pct = q > 0 ? u / q * 100 : (u > 0 ? 999 : 0);
      const st = statusOf(pct);
      const nowYm = new Date().toISOString().slice(0, 7);
      const mQ = monthlyQuotaOfPlot(p, nowYm), mU = plotMonthlyUsage(p.uid, nowYm);
      const mPct = mQ > 0 ? mU / mQ * 100 : (mU > 0 ? 999 : 0);
      const cuts = [];
      S.tx.forEach(t => {
        if (!t.alloc) return;
        const a = t.alloc.find(x => x.uid === p.uid);
        if (a) cuts.push({ t: t, a: a });
      });
      cuts.sort((x, y) => y.t.date.localeCompare(x.t.date));
      return '<div class="subhead">โควต้าระดับแปลง ปี ' + be(S.season) + '</div>' +
        '<div class="quota-meter' + (st.key === 'danger' ? ' alert' : st.key === 'warn' ? ' near' : '') + '">' +
          qline('โควต้าทั้งปี', n0(q) + ' กก.') +
          qline('ตัดไปแล้ว (บัญชีจริง)', n0(u) + ' กก. (' + n2(pct) + '%)') +
          qline('คงเหลือ', n0(q - u) + ' กก.') +
          '<div style="margin-top:8px">' + meter(pct) + '</div>' +
        '</div>' +
        '<div class="quota-meter' + (mPct > 100 ? ' alert' : mPct >= S.cfg.warnAt ? ' near' : '') + '" style="margin-top:8px">' +
          qline('โควต้าเดือน ' + nowYm, n0(mQ) + ' กก.') +
          qline('ตัดไปแล้วเดือนนี้', n0(mU) + ' กก. (' + n2(mPct) + '%)') +
          '<div style="margin-top:8px">' + meter(mPct) + '</div>' +
        '</div>' +
        '<p class="muted">ตัวเลขนี้คือปริมาณที่ระบบตัดจากบัญชีโควต้าของแปลงนี้จริงตามลำดับตำบลใกล้-ไกล ' +
        'ใช้ควบคุมปริมาณภายใน ไม่ใช่การชั่งน้ำหนักแยกรายแปลง</p>' +
        (cuts.length
          ? '<div class="table-wrap"><table class="tbl">' + table(
              ['วันที่', 'Lot No.', 'ลำดับตัด', 'กก.ที่ตัดจากแปลงนี้', 'สถานะ'],
              cuts.slice(0, 50).map(({ t, a }) => ({
                attrs: 'class="clickable" data-tx="' + esc(t.id) + '"',
                cells: [t.date, { h: esc(t.lot || t.doc || '—'), cls: 'code' }, a.seq,
                  { h: n2(a.kg), cls: 'num' },
                  { h: a.over ? '<span class="tag warn">เกิน</span>' : '<span class="tag ok">ปกติ</span>' }]
              }))) + '</table></div>'
          : '<p class="muted">แปลงนี้ยังไม่เคยถูกตัดโควต้าจากรายการรับซื้อ</p>');
    })() +
    (g ? '<div class="mapbox" id="plotMap"></div>' +
         '<div class="map-legend"><span><i style="background:#2d6a4f"></i>แปลงนี้</span>' +
         '<span><i style="background:#8899a0"></i>แปลงข้างเคียงของแหล่งเดียวกัน</span></div>' : '<p class="muted">แปลงนี้ไม่มีข้อมูลโพลิกอน</p>') +
    '<div class="btn-col">' +
      (center ? '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
        center[0].toFixed(6) + ',' + center[1].toFixed(6) + '">เปิดพิกัดใน Google Maps</a>' : '') +
      (g ? '<button class="btn" data-exp="geo1" data-id="' + esc(uid) + '">ดาวน์โหลด GeoJSON แปลงนี้</button>' : '') +
      (g ? '<button class="btn" data-exp="wkt" data-id="' + esc(uid) + '">คัดลอก WKT (POLYGON)</button>' : '') +
    '</div>';

  openDrawer(p.code, (p.farmer || p.owner || '') + ' · ' + n2(p.areaRai) + ' ไร่', html);

  const box = $('#plotMap');
  if (box && g) {
    const sib = (S.plotsBySup.get(p.supplierId) || []).filter(x => x.uid !== uid && GEO[x.uid]).slice(0, 400);
    const polys = sib.map(x => ({
      pts: GEO[x.uid], plot: x,
      fill: '#8899a033', stroke: '#8899a0',
      fillSat: '#ffffff22', strokeSat: '#ffffffaa'
    }));
    const me = {
      pts: g, plot: p, hi: true,
      fill: '#2d6a4f66', stroke: '#2d6a4f',
      fillSat: '#ffe15a44', strokeSat: '#ffe15a'
    };
    polys.push(me);
    // focus: จัดกรอบให้เห็นแปลงเป้าหมายเป็นหลัก
    Map2(box, polys, { focus: [me], onPick: pg => { if (pg.plot.uid !== p.uid) showPlot(pg.plot.uid); } });
  }
}
/** รายละเอียดล็อตรับซื้อ — แยกชัดว่าอะไรคือข้อมูลที่บันทึก อะไรคือค่าคำนวณ */
function showTx(txId) {
  const t = S.tx.find(x => x.id === txId);
  if (!t) return;
  const s = S.supById.get(t.supplierId) || {};
  const plots = scopePlotsOf(t);
  const sc = scopeSummary(plots);
  const tot = sc.rai || 1;
  const fallbackRows = plots.slice().sort((a, b) => b.areaRai - a.areaRai);
  const withProt = plots.filter(p => p.protect);

  const head =
    '<dl class="dl">' +
      dd('วันที่รับซื้อ', esc(t.date) + ' <span class="muted">(ปีการผลิต ' + be(t.season) + ')</span>') +
      dd('เลขที่ใบชั่ง', esc(t.doc || '—')) +
      dd('Lot No.', t.lot ? '<span class="mono">' + esc(t.lot) + '</span>' : '—') +
      dd('แหล่งวัตถุดิบ', '<a href="#" data-sup="' + esc(s.id) + '">' + esc(s.name || t.supplierId) + '</a> ' +
         catTag(s.category)) +
      dd('ชนิดวัตถุดิบ', PRODUCT[t.product] || t.product) +
      dd('น้ำหนักรับซื้อ', n2(t.weightKg) + ' กก. · DRC ' + n2(t.drc) + '% → ยางแห้ง <b>' + n2(t.dryKg) + ' กก.</b>') +
      (t.price ? dd('ราคา', n2(t.price) + ' บาท/กก. · รวม ' + n2(t.price * t.weightKg) + ' บาท') : '') +
      (t.note ? dd('หมายเหตุ', esc(t.note)) : '') +
    '</dl>' +

    '<div class="subhead">ขอบเขตแปลงต้นทาง <span class="req-tag">ข้อมูลที่ใช้ยื่น DDS</span></div>' +
    '<div class="quota-meter' + (sc.st.key === 'danger' ? ' alert' : sc.st.key === 'warn' ? ' near' : '') + '">' +
      qline('ที่บันทึกไว้', t.scope === 'sel'
        ? 'เลือกเฉพาะ ' + n0((t.farmers || []).length) + ' ราย'
        : 'ทั้งกลุ่มของแหล่งนี้') +
      qline('จำนวนแปลง', n0(sc.count) + ' แปลง · ' + n2(sc.rai) + ' ไร่') +
      qline('โควต้าขอบเขตนี้ทั้งปี', n0(sc.quota) + ' กก.') +
      qline('ใช้ไปแล้ว (รวมล็อตนี้)', n0(sc.used) + ' กก. (' + n2(sc.pct) + '%)') +
    '</div>' +
    (withProt.length
      ? '<p class="warn-line">⚠ ในขอบเขตนี้มี ' + n0(withProt.length) +
        ' แปลงที่ทับเขตอนุรักษ์ — ต้องตรวจก่อนใช้ยื่น DDS</p>' : '') +

    '<div class="btn-col" style="margin:12px 0 4px">' +
      '<button class="btn primary" data-lot="geo" data-id="' + esc(t.id) + '">GeoJSON แปลงต้นทางของล็อตนี้ (สำหรับ DDS)</button>' +
      '<button class="btn" data-lot="csv" data-id="' + esc(t.id) + '">CSV รายการแปลงต้นทาง</button>' +
    '</div>';

  const allocRows = (t.alloc && t.alloc.length) ? t.alloc.slice().sort((a, b) => a.seq - b.seq) : null;

  const allocTbl = allocRows
    ? '<div class="subhead">รายงานตัดโควต้ารอบนี้ <span class="req-tag">บัญชีที่ระบบตัดจริง</span></div>' +
      '<p class="muted">เรียงตัดจากตำบลที่ใกล้ที่สุดก่อน เติมโควต้ารายเดือนของแต่ละแปลงให้เต็มก่อนขยับไปแปลงถัดไป' +
      (allocRows.some(r => r.over)
        ? ' <b>แถวที่ทำเครื่องหมาย “เกิน” คือส่วนที่เกินกำลังผลิตรายเดือนของทุกแปลงในขอบเขต ถูกกระจายตามสัดส่วนพื้นที่แทน</b>'
        : '') + '</p>' +
      '<div class="table-wrap"><table class="tbl">' + table(
        ['ลำดับ', 'รหัสแปลง', 'เกษตรกร', 'ตำบลที่ตัด', 'กก.ที่ตัด', 'สถานะ'],
        allocRows.slice(0, 300).map(r => {
          const p = S.plotByUid.get(r.uid);
          return {
            attrs: p ? 'class="clickable" data-plot="' + esc(p.uid) + '"' : '',
            cells: [
              r.seq,
              { h: esc(p ? p.code : r.uid), cls: 'code' },
              { h: esc(p ? (p.farmer || p.owner || '—') : '—'), cls: 'wide' },
              esc(r.tambon || '—'),
              { h: n2(r.kg), cls: 'num' },
              { h: r.over ? '<span class="tag warn">เกินรายเดือน</span>' : '<span class="tag ok">ปกติ</span>' }
            ]
          };
        })) + '</table></div>' +
      (allocRows.length > 300 ? '<p class="muted">แสดง 300 แปลงแรกจาก ' + n0(allocRows.length) + ' แปลง</p>' : '') +
      '<div class="btn-col" style="margin-top:10px">' +
        '<button class="btn" data-lot="alloccsv" data-id="' + esc(t.id) + '">CSV รายงานตัดโควต้ารอบนี้</button>' +
      '</div>'
    : '<div class="subhead">การเฉลี่ยน้ำหนักรายแปลง <span class="calc-tag">ค่าคำนวณย้อนหลัง — ล็อตก่อนมีระบบตัดอัตโนมัติ</span></div>' +
      '<p class="muted">ล็อตนี้บันทึกไว้ก่อนมีระบบตัดโควต้าอัตโนมัติ (หรือกู้คืนจากไฟล์สำรองรุ่นเก่า) จึงไม่มีบัญชีรายแปลงจริง ' +
      'ตัวเลขข้างล่างเป็นการเฉลี่ยตามสัดส่วนพื้นที่เพื่อดูความสมเหตุสมผลเท่านั้น</p>' +
      '<div class="table-wrap"><table class="tbl">' + table(
        ['รหัสแปลง', 'เกษตรกร', 'ไร่', 'สัดส่วน', 'เฉลี่ยล็อตนี้ (กก.)'],
        fallbackRows.slice(0, 300).map(p => ({
          attrs: 'class="clickable" data-plot="' + esc(p.uid) + '"',
          cells: [
            { h: esc(p.code), cls: 'code' },
            { h: esc(p.farmer || p.owner || '—'), cls: 'wide' },
            { h: n2(p.areaRai), cls: 'num' },
            { h: n2(p.areaRai / tot * 100) + '%', cls: 'num' },
            { h: n2(t.dryKg * p.areaRai / tot), cls: 'num' }
          ]
        })), 'ไม่พบแปลง') + '</table></div>' +
      (fallbackRows.length > 300 ? '<p class="muted">แสดง 300 แปลงแรกจาก ' + n0(fallbackRows.length) + ' แปลง</p>' : '');

  openDrawer('ล็อต ' + (t.lot || t.doc || t.date), (s.name || t.supplierId) + ' · ' + n2(t.dryKg) + ' กก.แห้ง',
    head + allocTbl + '<div class="subhead">ไฟล์แนบใบชั่ง</div><p class="muted">กำลังเปิดไฟล์…</p>');

  FILES.byTx(txId).then(list => {
    const box = document.createElement('div');
    box.innerHTML = (!list || !list.length)
      ? '<p class="muted">ไม่มีไฟล์แนบ (ไฟล์แนบเก็บในเบราว์เซอร์เครื่องที่บันทึกเท่านั้น)</p>'
      : list.map(f => f.type === 'application/pdf'
        ? '<p><a class="btn" href="' + f.data + '" target="_blank" rel="noopener">เปิด ' +
          esc(f.name) + ' (' + fileSizeText(f.size) + ')</a></p>'
        : '<figure class="att-full"><img src="' + f.data + '" alt="' + esc(f.name) + '">' +
          '<figcaption class="muted">' + esc(f.name) + ' · ' + fileSizeText(f.size) + '</figcaption></figure>'
      ).join('');
    const body = $('#drawerBody');
    if (!body) return;
    const heads = body.querySelectorAll('.subhead');
    const last = heads[heads.length - 1];
    if (last && last.nextElementSibling) last.nextElementSibling.replaceWith(box);
  }, () => {});
}

function dd(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'; }
/** ที่ตั้งตามขอบเขตการปกครองจริง (จับคู่จากพิกัดแปลง) */
function adminText(p) {
  const a = [];
  if (p.subdistrict) a.push('ต.' + p.subdistrict);
  if (p.districtGis) a.push('อ.' + p.districtGis);
  if (p.provinceGis) a.push('จ.' + p.provinceGis);
  return a.join(' ');
}
function qline(k, v) { return '<div class="qline"><span>' + esc(k) + '</span><b>' + v + '</b></div>'; }

/* ============================== หน้ารับซื้อ ============================== */
const txState = { q: '', page: 1, per: 25 };
function fillSupDatalists() {
  const opts = DB.suppliers.map(s =>
    '<option value="' + esc(s.name + ' — ' + (s.village || (CAT[s.category] || {}).label) + ' [' + s.id + ']') + '"></option>'
  ).join('');
  $('#supList').innerHTML = opts;
  $('#supList2').innerHTML = opts;
}
function supFromInput(v) {
  const m = /\[(\d{6,12})\]\s*$/.exec(v || '');
  if (m && S.supById.has(m[1])) return S.supById.get(m[1]);
  const q = (v || '').trim().toLowerCase();
  if (!q) return null;
  if (S.supById.has(q)) return S.supById.get(q);
  const hit = DB.suppliers.filter(s => s.name.toLowerCase() === q);
  return hit.length === 1 ? hit[0] : null;
}
function recalcDry() {
  const w = parseFloat($('#f_weight').value) || 0;
  const d = parseFloat($('#f_drc').value) || 0;
  const dry = w * d / 100;
  $('#f_dry').value = dry ? n2(dry) : '';
  return dry;
}
function updateBuyPanel() {
  const sup = supFromInput($('#f_supSearch').value);
  const changed = $('#f_sup').value !== (sup ? sup.id : '');
  $('#f_sup').value = sup ? sup.id : '';
  if (changed) scopeReset();
  renderScope(sup);
  const dry = recalcDry();
  const meterEl = $('#quotaMeter');

  if (!sup) {
    $('#f_supInfo').textContent = $('#f_supSearch').value.trim()
      ? 'ยังไม่ตรงกับแหล่งใดในทะเบียน — เลือกจากรายการที่แนะนำ' : '';
    meterEl.className = 'quota-meter';
    meterEl.innerHTML = '<span class="muted">เลือกแหล่งวัตถุดิบเพื่อดูโควต้าคงเหลือ</span>';
    $('#supQuotaDetail').className = 'empty';
    $('#supQuotaDetail').textContent = 'ยังไม่ได้เลือกแหล่งวัตถุดิบ';
    renderAllocPreview([], '');
    return;
  }

  const r = quotaRow(sup);
  const scopePlotsNow = currentScopePlots(sup);
  const sc = scopeSummary(scopePlotsNow);
  const narrowed = scopeState.mode === 'sel';
  const after = sc.used + dry;
  const pctAfter = sc.quota > 0 ? after / sc.quota * 100 : (after > 0 ? 999 : 0);
  const stAfter = statusOf(pctAfter);

  const ym = ($('#f_date').value || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const monthlyRemain = monthlyPoolRemain(scopePlotsNow, ym);
  const overMonthly = Math.max(0, dry - monthlyRemain);

  $('#f_supInfo').innerHTML = catTag(sup.category) + ' ' + esc(sup.village || '') +
    ' · ' + n0(sup.plotCount) + ' แปลง · ' + n0(sup.areaRai) + ' ไร่';

  meterEl.className = 'quota-meter ' +
    (stAfter.key === 'danger' || overMonthly > WARN_EPS ? 'alert' : stAfter.key === 'warn' ? 'near' : '');
  meterEl.innerHTML =
    qline(narrowed ? 'โควต้าเฉพาะขอบเขตที่เลือก' : 'โควต้าปี ' + be(S.season) + ' (ทั้งกลุ่ม)',
          n0(sc.quota) + ' กก.') +
    qline('ตัดไปแล้ว', n0(sc.used) + ' กก.') +
    qline('คงเหลือก่อนบันทึก', n0(sc.remain) + ' กก.') +
    (dry ? qline('รายการนี้ตัด', n0(dry) + ' กก. → คงเหลือ ' + n0(sc.quota - after) + ' กก.') : '') +
    '<div style="margin-top:8px">' + meter(pctAfter) + '</div>' +
    (pctAfter > 100 && (after - sc.quota) > WARN_EPS
      ? '<div style="margin-top:8px;font-weight:600">⚠ เกินโควต้าทั้งปี ' + n0(after - sc.quota) + ' กก.' +
        (narrowed ? ' — พื้นที่ที่ระบุผลิตได้ไม่ถึงปริมาณนี้' : '') + '</div>'
      : '') +
    qline('กำลังผลิตเดือน ' + ym + ' ที่เหลือ', n0(monthlyRemain) + ' กก.') +
    (overMonthly > WARN_EPS
      ? '<div style="margin-top:4px;font-weight:600">⚠ เกินกำลังผลิตรายเดือน ' + n0(overMonthly) + ' กก.</div>'
      : '') +
    (narrowed ? '<div class="muted" style="margin-top:6px">ทั้งกลุ่มคงเหลือ ' + n0(r.remain) + ' กก.</div>' : '');

  renderAllocPreview(dry > 0 ? autoAllocate(scopePlotsNow, dry, ym) : [], ym);

  $('#supQuotaDetail').className = '';
  $('#supQuotaDetail').innerHTML =
    '<dl class="dl">' +
      dd('แหล่งวัตถุดิบ', esc(sup.name)) +
      dd('ประเภท', catTag(sup.category)) +
      dd('รหัส CV', '<span class="mono">' + esc(sup.id) + '</span>') +
      dd('หมู่บ้าน / กลุ่ม', esc(sup.village || '—')) +
      dd('พื้นที่ที่ใช้คำนวณ', n2(quotaOf(sup).rai) + ' ไร่' +
        (S.cfg.deductFlag && sup.flagRai ? ' <span class="muted">(หักพื้นที่เสี่ยง ' + n2(sup.flagRai) + ' ไร่)</span>' : '')) +
      dd('ผลผลิตต่อไร่', n0(S.cfg.yield[sup.category]) + ' กก./ไร่/ปี') +
      dd('โควต้าทั้งปี', n0(r.quota) + ' กก.') +
      dd('รับซื้อแล้ว', n0(r.used) + ' กก. (' + n2(r.pct) + '%)') +
      dd('คงเหลือ', '<b>' + n0(r.remain) + ' กก.</b>') +
      dd('สถานะ', '<span class="tag ' + r.st.key + '">' + r.st.label + '</span>') +
    '</dl>' +
    '<button class="btn" data-sup-open="' + esc(sup.id) + '">ดูรายละเอียดแหล่งและแผนที่แปลง</button>';
}
/* ---------- ตัวเลือกขอบเขตแปลงต้นทาง ---------- */
const scopeState = { mode: 'all', picked: new Set(), q: '' };
function scopeReset() {
  scopeState.mode = 'all';
  scopeState.picked = new Set();
  scopeState.q = '';
  const r = $('#scopeBlock') && $('#scopeBlock').querySelector('input[value="all"]');
  if (r) r.checked = true;
  if ($('#scopeSearch')) $('#scopeSearch').value = '';
  if ($('#scopeList')) $('#scopeList').hidden = true;
}
/** แปลงที่อยู่ในขอบเขตตามที่เลือกอยู่ตอนนี้ */
function currentScopePlots(sup) {
  if (!sup) return [];
  const all = S.plotsBySup.get(sup.id) || [];
  if (scopeState.mode === 'all') return all;
  const out = [];
  for (const f of farmersOf(sup.id)) if (scopeState.picked.has(f.name)) out.push.apply(out, f.plots);
  return out;
}
/** วาดรายชื่อเกษตรกรใหม่ — เรียกเฉพาะตอนเปลี่ยนแหล่งหรือเปลี่ยนคำค้น
    (ห้ามเรียกตอนติ๊กช่อง ไม่งั้น checkbox ที่เหลือจะหลุดจาก DOM) */
function renderScopeList(sup) {
  if (!sup || scopeState.mode !== 'sel') return;
  const q = scopeState.q.trim().toLowerCase();
  const fs = farmersOf(sup.id);
  const show = q ? fs.filter(f => f.name.toLowerCase().indexOf(q) >= 0) : fs;
  $('#scopeFarmers').innerHTML = show.slice(0, 400).map(f =>
    '<label class="scope-row"><input type="checkbox" data-f="' + esc(f.name) + '"' +
    (scopeState.picked.has(f.name) ? ' checked' : '') + '>' +
    '<span class="sf-name">' + esc(f.name) + '</span>' +
    '<span class="sf-num">' + n0(f.plots.length) + ' แปลง</span>' +
    '<span class="sf-num">' + n2(f.rai) + ' ไร่</span></label>').join('') +
    (show.length > 400 ? '<p class="muted">แสดง 400 รายแรก — พิมพ์ค้นหาเพื่อจำกัดให้แคบลง</p>' : '');
  $('#scopeFarmers').dataset.for = sup.id + '|' + q;
}
function renderScope(sup) {
  const blk = $('#scopeBlock');
  if (!blk) return;
  if (!sup) { blk.hidden = true; return; }
  blk.hidden = false;
  $('#scopeList').hidden = scopeState.mode !== 'sel';

  if (scopeState.mode === 'sel') {
    const q = scopeState.q.trim().toLowerCase();
    const fs = farmersOf(sup.id);
    const show = q ? fs.filter(f => f.name.toLowerCase().indexOf(q) >= 0) : fs;
    $('#scopeFound').textContent = 'เกษตรกรในกลุ่ม ' + n0(fs.length) + ' ราย' +
      (q ? ' · ตรงคำค้น ' + n0(show.length) : '') + ' · เลือกแล้ว ' + n0(scopeState.picked.size);
    if ($('#scopeFarmers').dataset.for !== sup.id + '|' + q) renderScopeList(sup);
  }

  const plots = currentScopePlots(sup);
  const sc = scopeSummary(plots);
  const el = $('#scopeSummary');
  if (!plots.length) {
    el.className = 'scope-summary bad';
    el.innerHTML = 'ยังไม่ได้เลือกเกษตรกร — ต้องเลือกอย่างน้อย 1 ราย';
    return;
  }
  el.className = 'scope-summary' + (sc.st.key === 'danger' ? ' bad' : sc.st.key === 'warn' ? ' near' : '');
  el.innerHTML =
    '<b>' + n0(sc.count) + ' แปลง · ' + n2(sc.rai) + ' ไร่</b>' +
    (scopeState.mode === 'sel' ? ' จาก ' + n0(scopeState.picked.size) + ' ราย' : ' (ทั้งกลุ่ม)') +
    ' · โควต้าขอบเขตนี้ ' + n0(sc.quota) + ' กก. · ใช้ไป ' + n0(sc.used) +
    ' · คงเหลือ ' + n0(sc.remain) + ' กก.';
}

/** ตัวอย่างผลการตัดโควต้าอัตโนมัติ — คำนวณสดก่อนบันทึกจริง ให้เห็นว่าจะตัดแปลงไหนบ้าง */
function renderAllocPreview(rows, ym) {
  const el = $('#allocPreview');
  if (!el) return;
  if (!rows.length) { el.innerHTML = ''; return; }
  const shown = rows.slice(0, 25);
  const overTot = rows.filter(r => r.over).reduce((n, r) => n + r.kg, 0);
  el.innerHTML =
    '<div class="subhead" style="margin-top:14px">ตัวอย่างการตัดโควต้ารายแปลง — เดือน ' + esc(ym) + '</div>' +
    '<div class="table-wrap"><table class="tbl">' + table(
      ['ลำดับ', 'รหัสแปลง', 'ตำบล', 'กก.'],
      shown.map(r => [
        r.seq, { h: esc(r.code), cls: 'code' }, esc(r.tambon || '—'),
        { h: (r.over ? '<span class="tag warn">เกิน</span> ' : '') + n2(r.kg), cls: 'num' }
      ])) + '</table></div>' +
    (rows.length > shown.length ? '<p class="muted">และอีก ' + n0(rows.length - shown.length) + ' แปลง</p>' : '') +
    (overTot > 0 ? '<p class="warn-line">มีส่วนเกินกำลังผลิตรายเดือนของขอบเขตนี้ ' + n2(overTot) +
      ' กก. — กระจายตามสัดส่วนพื้นที่</p>' : '');
}

/* ---------- ไฟล์แนบที่รอบันทึกพร้อมรายการรับซื้อ ---------- */
let pending = [];
function renderAttachList() {
  const el = $('#attachList');
  if (!el) return;
  if (!pending.length) { el.innerHTML = ''; return; }
  const total = pending.reduce((n, f) => n + dataSize(f.data), 0);
  el.innerHTML = pending.map((f, i) =>
    '<figure class="att">' +
      (f.type === 'application/pdf'
        ? '<div class="att-pdf">PDF</div>'
        : '<img src="' + f.data + '" alt="' + esc(f.name) + '">') +
      '<figcaption>' + esc(f.name.length > 18 ? f.name.slice(0, 16) + '…' : f.name) +
        '<br><span class="muted">' + fileSizeText(dataSize(f.data)) + '</span></figcaption>' +
      '<button type="button" class="att-del" data-att="' + i + '" title="เอาออก">✕</button>' +
    '</figure>').join('') +
    '<div class="muted att-total">' + pending.length + ' ไฟล์ · รวม ' + fileSizeText(total) + '</div>';
}
async function addAttachments(fileList) {
  if (!FILES.available()) return toast('เบราว์เซอร์นี้เก็บไฟล์แนบไม่ได้', true);
  const files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  let added = 0;
  for (const f of files) {
    try {
      pending.push(await readAttachment(f));
      added++;
    } catch (err) {
      toast(f.name + ': ' + (err.message || 'แนบไฟล์ไม่สำเร็จ'), true);
    }
  }
  if (added) {
    renderAttachList();
    toast('แนบไฟล์แล้ว ' + added + ' ไฟล์');
  }
}

function submitPurchase(e) {
  e.preventDefault();
  const sup = supFromInput($('#f_supSearch').value);
  if (!sup) return toast('กรุณาเลือกแหล่งวัตถุดิบจากทะเบียน', true);
  const date = $('#f_date').value;
  if (!date) return toast('กรุณาระบุวันที่รับซื้อ', true);
  const weight = parseFloat($('#f_weight').value);
  const drc = parseFloat($('#f_drc').value);
  if (!(weight > 0)) return toast('น้ำหนักรับซื้อต้องมากกว่า 0', true);
  if (!(drc > 0 && drc <= 100)) return toast('%DRC ต้องอยู่ระหว่าง 1–100', true);

  const scopePlots = currentScopePlots(sup);
  if (!scopePlots.length)
    return toast('เลือกเกษตรกรที่ส่งล็อตนี้อย่างน้อย 1 ราย', true);

  const dry = weight * drc / 100;
  const season = +date.slice(0, 4);
  const ym = date.slice(0, 7);
  const sc = scopeSummary(scopePlots);
  const after = sc.used + dry;
  const narrowed = scopeState.mode === 'sel';
  const overAnnual = Math.max(0, after - sc.quota);
  const monthlyRemain = monthlyPoolRemain(scopePlots, ym);
  const overMonthly = Math.max(0, dry - monthlyRemain);

  if (S.cfg.mode !== 'off' && (overAnnual > WARN_EPS || overMonthly > WARN_EPS)) {
    const where = narrowed ? 'ขอบเขตที่ระบุ (' + n0(sc.count) + ' แปลง · ' + n2(sc.rai) + ' ไร่)'
                           : 'กลุ่มนี้';
    const parts = [];
    if (overAnnual > WARN_EPS) parts.push('เกินโควต้าทั้งปีของ' + where + ' ' + n0(overAnnual) +
      ' กก. (คงเหลือทั้งปี ' + n0(sc.remain) + ' กก.)');
    if (overMonthly > WARN_EPS) parts.push('เกินกำลังผลิตเดือน ' + ym + ' ของ' + where + ' ' + n0(overMonthly) +
      ' กก. (กำลังผลิตเดือนนี้เหลือ ' + n0(monthlyRemain) + ' กก.)');
    if (S.cfg.mode === 'block') {
      return toast('บันทึกไม่ได้ — ' + parts.join(' · '), true);
    }
    if (!confirm('รายการนี้ ' + parts.join('\n') + '\n\n' +
                 (narrowed ? 'พื้นที่ที่ระบุผลิตได้ไม่ถึงปริมาณนี้ — ตรวจว่าระบุเกษตรกรครบหรือยัง\n\n' : '') +
                 'ยืนยันบันทึกหรือไม่?')) return;
  }

  const alloc = autoAllocate(scopePlots, dry, ym);
  const txId = 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const attach = pending.slice();
  S.tx.push({
    id: txId,
    date: date, season: season, supplierId: sup.id, doc: $('#f_doc').value.trim(),
    lot: $('#f_lot').value.trim(),
    product: $('#f_product').value, weightKg: +weight.toFixed(2), drc: +drc.toFixed(1),
    dryKg: +dry.toFixed(2), price: parseFloat($('#f_price').value) || 0,
    note: $('#f_note').value.trim(), files: attach.length,
    scope: narrowed ? 'sel' : 'all',
    plotIds: narrowed ? scopePlots.map(p => p.uid) : undefined,
    farmers: narrowed ? Array.from(scopeState.picked) : undefined,
    alloc: alloc.map(r => ({ uid: r.uid, kg: r.kg, tambon: r.tambon, seq: r.seq, over: !!r.over })),
    createdAt: new Date().toISOString()
  });
  S.txVer++;
  save(LS.tx, S.tx);
  toast('บันทึกแล้ว — ตัดโควต้า ' + n0(dry) + ' กก. จาก ' + sup.name);

  if (attach.length) {
    Promise.all(attach.map((f, i) => FILES.put({
      id: txId + '_' + i, txId: txId, name: f.name, type: f.type,
      size: dataSize(f.data), data: f.data, addedAt: new Date().toISOString()
    }))).then(() => renderTx(),
      () => toast('บันทึกรายการแล้ว แต่เก็บไฟล์แนบไม่สำเร็จ', true));
  }

  pending = [];
  renderAttachList();
  scopeReset();
  renderAllocPreview([], '');
  $('#f_doc').value = ''; $('#f_lot').value = ''; $('#f_weight').value = '';
  $('#f_note').value = ''; $('#f_dry').value = '';
  refreshSeasons();
  updateBuyPanel();
  renderTx();
  renderDashboard();
}
function txFiltered() {
  const q = txState.q.trim().toLowerCase();
  return S.tx.filter(t => {
    if (!q) return true;
    const s = S.supById.get(t.supplierId) || {};
    return ((s.name || '') + ' ' + (t.doc || '') + ' ' + (t.lot || '') + ' ' +
            (t.note || '') + ' ' + t.date).toLowerCase().indexOf(q) >= 0;
  }).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}
function renderTx() {
  const all = txFiltered();
  const start = (txState.page - 1) * txState.per;
  const page = all.slice(start, start + txState.per);
  $('#txTbl').innerHTML = table(
    ['วันที่', 'ปีผลิต', 'เลขที่เอกสาร', 'Lot No.', 'แหล่งวัตถุดิบ', 'ประเภท', 'ชนิดวัตถุดิบ',
     'ขอบเขตแปลง', 'น้ำหนัก (กก.)', '%DRC', 'ยางแห้ง (กก.)', 'มูลค่า (บาท)', 'ใบชั่ง', ''],
    page.map(t => {
      const s = S.supById.get(t.supplierId) || {};
      const np = scopePlotsOf(t).length;
      return {
        attrs: 'class="clickable" data-tx="' + esc(t.id) + '"',
        cells: [
          t.date, be(t.season), t.doc || '—',
          { h: t.lot ? esc(t.lot) : '—', cls: 'code' },
          { h: esc(s.name || t.supplierId), cls: 'wide' },
          { h: catTag(s.category) },
          PRODUCT[t.product] || t.product,
          { h: t.scope === 'sel'
              ? '<span class="tag warn">' + n0((t.farmers || []).length) + ' ราย · ' + n0(np) + ' แปลง</span>'
              : '<span class="tag dim">ทั้งกลุ่ม · ' + n0(np) + ' แปลง</span>' },
          { h: n2(t.weightKg), cls: 'num' },
          { h: n2(t.drc), cls: 'num' },
          { h: '<b>' + n2(t.dryKg) + '</b>', cls: 'num' },
          { h: t.price ? n2(t.price * t.weightKg) : '—', cls: 'num' },
          { h: t.files ? '📎 ' + t.files : '<span class="muted">—</span>' },
          { h: '<button class="btn ghost" data-del="' + esc(t.id) + '" title="ลบรายการ">ลบ</button>' }
        ]
      };
    }), 'ยังไม่มีรายการรับซื้อ — บันทึกรายการแรกจากฟอร์มด้านบน'
  );
  pager('#txPager', all.length, txState, renderTx);
}

/* ============================== รายงาน ============================== */
function reportRows(cat) {
  return DB.suppliers.filter(s => !cat || s.category === cat)
    .map(s => quotaRow(s))
    .sort((a, b) => b.pct - a.pct || b.sup.areaRai - a.sup.areaRai);
}
function renderReports() {
  const rows = reportRows($('#repCat').value);
  $('#repTbl').innerHTML = table(
    ['แหล่งวัตถุดิบ', 'ประเภท', 'หมู่บ้าน / กลุ่ม', 'CV', 'แปลง', 'ไร่', 'เฮกตาร์',
     'โควต้า (กก.)', 'รับซื้อ (กก.)', 'คงเหลือ (กก.)', '% ใช้', 'สถานะ'],
    rows.map(r => ({
      attrs: 'class="clickable" data-sup="' + esc(r.sup.id) + '"',
      cells: [
        { h: esc(r.sup.name), cls: 'wide' },
        { h: catTag(r.sup.category) },
        { h: esc(r.sup.village || '—'), cls: 'wide' },
        { h: esc(r.sup.id), cls: 'code' },
        { h: n0(r.sup.plotCount), cls: 'num' },
        { h: n2(r.sup.areaRai), cls: 'num' },
        { h: n2(r.sup.areaHa), cls: 'num' },
        { h: n0(r.quota), cls: 'num' },
        { h: n0(r.used), cls: 'num' },
        { h: n0(r.remain), cls: 'num' },
        { h: n2(r.pct), cls: 'num' },
        { h: '<span class="tag ' + r.st.key + '">' + r.st.label + '</span>' }
      ]
    })), 'ไม่พบข้อมูล'
  );
  $('#cntAll').textContent = n0(DB.plots.length);
}
function exportQuotaCsv() {
  const rows = reportRows($('#repCat').value);
  const out = [['ปีการผลิต (พ.ศ.)', 'แหล่งวัตถุดิบ', 'ประเภท', 'หมู่บ้าน/กลุ่ม', 'รหัส CV', 'จำนวนแปลง',
    'พื้นที่ (ไร่)', 'พื้นที่ (เฮกตาร์)', 'ผลผลิตต่อไร่ (กก.)', 'โควต้า (กก.)', 'รับซื้อแล้ว (กก.)',
    'คงเหลือ (กก.)', '% ใช้โควต้า', 'สถานะ']];
  rows.forEach(r => out.push([
    be(S.season), r.sup.name, (CAT[r.sup.category] || {}).label, r.sup.village || '', r.sup.id,
    r.sup.plotCount, r.sup.areaRai.toFixed(2), r.sup.areaHa.toFixed(4),
    r.source === 'override' ? 'กำหนดเอง' : S.cfg.yield[r.sup.category],
    r.quota.toFixed(2), r.used.toFixed(2), r.remain.toFixed(2), r.pct.toFixed(2), r.st.label
  ]));
  download('EUDR_quota_' + be(S.season) + '.csv', csv(out), 'text/csv');
}
function exportSuppliersCsv() {
  const out = [['รหัส CV', 'ชื่อแหล่งวัตถุดิบ', 'ประเภท', 'กลุ่มย่อย', 'หมู่บ้าน/กลุ่ม', 'อำเภอ', 'จังหวัด',
    'โทรศัพท์', 'จำนวนแปลง', 'พื้นที่ (ไร่)', 'พื้นที่ (เฮกตาร์)', 'พื้นที่เสี่ยง (ไร่)', 'เอกสารสิทธิ์']];
  DB.suppliers.forEach(s => out.push([
    s.id, s.name, (CAT[s.category] || {}).label, s.subGroup || '', s.village || '', s.district || '',
    s.province || '', s.phone || '', s.plotCount, s.areaRai.toFixed(2), s.areaHa.toFixed(4),
    (s.flagRai || 0).toFixed(2),
    Object.keys(s.docTypes || {}).map(k => (DOC[k] || k) + ':' + s.docTypes[k]).join(' ')
  ]));
  download('EUDR_suppliers.csv', csv(out), 'text/csv');
}
function exportPlotsCsv(list, name) {
  const out = [['รหัสแปลง', 'เกษตรกร/เจ้าของแปลง', 'เลขทะเบียนเกษตรกร', 'แหล่งวัตถุดิบ', 'รหัส CV', 'ประเภทแหล่ง',
    'หมู่บ้าน/กลุ่ม', 'เอกสารสิทธิ์', 'เลขที่เอกสาร', 'ตำบล', 'รหัสตำบล', 'อำเภอ', 'จังหวัด',
    'อำเภอ (ตามไฟล์ต้นทาง)', 'เขตอนุรักษ์', 'ประเภทเขตอนุรักษ์', 'ลักษณะการทับซ้อน',
    'พื้นที่ (ไร่)', 'พื้นที่ (เฮกตาร์)',
    'ขึ้นทะเบียน', 'ละติจูด (จุดกลาง)', 'ลองจิจูด (จุดกลาง)', 'มีโพลิกอน']];
  (list || DB.plots).forEach(p => {
    const s = S.supById.get(p.supplierId) || {};
    const g = GEO[p.uid];
    let la = p.lat || '', lo = p.lng || '';
    if (g && !la) {
      let sx = 0, sy = 0;
      g.forEach(pt => { sx += pt[0]; sy += pt[1]; });
      la = (sy / g.length).toFixed(6); lo = (sx / g.length).toFixed(6);
    }
    out.push([p.code, p.farmer || p.owner || '', p.citizenId || '', s.name || '', p.supplierId,
      (CAT[s.category] || {}).label || '', s.village || '', DOC[p.docType] || p.docType, p.deed || '',
      p.subdistrict || '', p.subdistrictCode || '', p.districtGis || '', p.provinceGis || '',
      p.district || '',
      p.protect || '', p.protect ? protLabel(p.protectType) : '',
      p.protect ? (p.protectHow === 'in' ? 'อยู่ในเขต' : 'ขอบล้ำเข้า') : 'ไม่ทับ',
      p.areaRai.toFixed(4), p.areaHa.toFixed(4),
      p.dateCreated || '', la, lo, g ? 'ใช่' : 'ไม่']);
  });
  download((name || 'EUDR_plots') + '.csv', csv(out), 'text/csv');
}
function exportTxCsv(list, name) {
  const out = [['วันที่', 'ปีการผลิต (พ.ศ.)', 'เลขที่เอกสาร', 'Lot No.', 'รหัส CV', 'แหล่งวัตถุดิบ', 'ประเภท',
    'หมู่บ้าน/กลุ่ม', 'ชนิดวัตถุดิบ', 'น้ำหนักรับซื้อ (กก.)', '%DRC', 'ยางแห้ง (กก.)',
    'ราคา/กก.', 'มูลค่า (บาท)', 'จำนวนไฟล์แนบ', 'หมายเหตุ']];
  (list || S.tx).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
    const s = S.supById.get(t.supplierId) || {};
    out.push([t.date, be(t.season), t.doc || '', t.lot || '', t.supplierId, s.name || '',
      (CAT[s.category] || {}).label || '', s.village || '', PRODUCT[t.product] || t.product,
      t.weightKg.toFixed(2), t.drc, t.dryKg.toFixed(2), t.price || '',
      t.price ? (t.price * t.weightKg).toFixed(2) : '', t.files || 0, t.note || '']);
  });
  download((name || 'EUDR_purchases') + '.csv', csv(out), 'text/csv');
}
/** รายงานตัดโควต้ารายรอบ — หนึ่งแถวต่อหนึ่งแปลงที่ถูกตัดในแต่ละรายการรับซื้อ */
function exportAllocCsv(list, name) {
  const out = [['วันที่', 'ปีการผลิต (พ.ศ.)', 'เลขที่ใบชั่ง', 'Lot No.', 'รหัส CV', 'แหล่งวัตถุดิบ',
    'ลำดับตัด', 'ตำบลที่ตัด', 'รหัสแปลง', 'เกษตรกร', 'กก.ที่ตัด (ยางแห้ง)', 'เกินกำลังผลิตรายเดือน']];
  (list || S.tx).forEach(t => {
    if (!t.alloc || !t.alloc.length) return;
    const s = S.supById.get(t.supplierId) || {};
    t.alloc.slice().sort((a, b) => a.seq - b.seq).forEach(a => {
      const p = S.plotByUid.get(a.uid);
      out.push([t.date, be(t.season), t.doc || '', t.lot || '', t.supplierId, s.name || '',
        a.seq, a.tambon || '', p ? p.code : a.uid, p ? (p.farmer || p.owner || '') : '',
        a.kg.toFixed(2), a.over ? 'ใช่' : 'ไม่']);
    });
  });
  if (out.length <= 1) return toast('ยังไม่มีบัญชีตัดโควต้าที่ส่งออกได้', true);
  download((name || 'EUDR_quota_cuts') + '.csv', csv(out), 'text/csv');
}
function exportGeo(kind) {
  let list;
  if (kind === 'all') list = DB.plots;
  else if (kind === 'protect') {
    list = protPlots;
    if (!list.length) return toast('ไม่พบแปลงที่ทับเขตอนุรักษ์', true);
  }
  else if (kind === 'traded') {
    const ids = new Set(S.tx.filter(t => t.season === S.season).map(t => t.supplierId));
    list = DB.plots.filter(p => ids.has(p.supplierId));
    if (!list.length) return toast('ยังไม่มีการรับซื้อในปีการผลิตนี้', true);
  } else list = DB.plots.filter(p => (S.supById.get(p.supplierId) || {}).category === kind);
  download('EUDR_' + kind + '.geojson', JSON.stringify(toGeoJSON(list)), 'application/geo+json');
  toast('ส่งออก ' + n0(list.length) + ' แปลงแล้ว');
}

/* ============================== ตั้งค่า ============================== */
/** ตารางสัดส่วนผลผลิตรายเดือน — ใช้คำนวณโควต้ารายเดือนของระบบตัดโควต้าอัตโนมัติ */
function renderSeasonTable() {
  const head = '<thead><tr><th>ประเภท</th>' +
    MONTH_TH.map(m => '<th class="num">' + m + '</th>').join('') + '<th class="num">รวม</th></tr></thead>';
  const body = CAT_KEYS.map(cat => {
    const arr = S.cfg.season[cat];
    const sum = arr.reduce((a, b) => a + b, 0);
    return '<tr><td>' + CAT[cat].label + '</td>' +
      arr.map((v, i) => '<td class="num"><input type="number" min="0" step="0.1" class="season-inp" ' +
        'data-season-cat="' + cat + '" data-season-m="' + i + '" value="' + v.toFixed(1) + '"></td>').join('') +
      '<td class="num" data-season-sum="' + cat + '">' + sum.toFixed(1) + '%</td></tr>';
  }).join('');
  $('#seasonTbl').innerHTML = head + '<tbody>' + body + '</tbody>';
}
function renderSettings() {
  $('#s_estate').value = S.cfg.yield.estate;
  $('#s_promotion').value = S.cfg.yield.promotion;
  $('#s_collector').value = S.cfg.yield.collector;
  $('#s_mode').value = S.cfg.mode;
  $('#s_warn').value = S.cfg.warnAt;
  $('#s_flag').value = String(S.cfg.deductFlag);
  renderSeasonTable();

  const q = ($('#ovSearch').value || '').trim().toLowerCase();
  let list = DB.suppliers;
  if (q) list = list.filter(s => (s.name + ' ' + (s.village || '') + ' ' + s.id).toLowerCase().indexOf(q) >= 0);
  const ovIds = Object.keys(S.ov);
  list = list.filter(s => ovIds.indexOf(s.id) >= 0 || q).slice(0, 60);

  $('#ovTbl').innerHTML = table(
    ['แหล่งวัตถุดิบ', 'ประเภท', 'พื้นที่ (ไร่)', 'โควต้าที่คำนวณได้ (กก.)', 'โควต้ากำหนดเอง (กก.)', ''],
    list.map(s => {
      const calcRai = S.cfg.deductFlag ? Math.max(0, s.areaRai - (s.flagRai || 0)) : s.areaRai;
      return [
        { h: esc(s.name) + (s.village ? '<div class="muted">' + esc(s.village) + '</div>' : ''), cls: 'wide' },
        { h: catTag(s.category) },
        { h: n2(s.areaRai), cls: 'num' },
        { h: n0(calcRai * (S.cfg.yield[s.category] || 0)), cls: 'num' },
        { h: '<input type="number" min="0" step="1" style="width:130px" data-ov="' + esc(s.id) + '" value="' + (S.ov[s.id] != null ? S.ov[s.id] : '') + '">' },
        { h: S.ov[s.id] != null ? '<button class="btn ghost" data-ovdel="' + esc(s.id) + '">ล้าง</button>' : '' }
      ];
    }), q ? 'ไม่พบแหล่งที่ตรงกับคำค้น' : 'ยังไม่มีการกำหนดโควต้าเฉพาะราย — ค้นหาชื่อแหล่งเพื่อเพิ่ม'
  );

  const bytes = (localStorage.getItem(LS.tx) || '').length + (localStorage.getItem(LS.cfg) || '').length;
  const nf = S.tx.reduce((n, t) => n + (t.files || 0), 0);
  $('#storeInfo').textContent = 'รายการรับซื้อ ' + n0(S.tx.length) + ' รายการ · ไฟล์แนบ ' + n0(nf) +
    ' ไฟล์ · ข้อมูลรายการใช้พื้นที่ ~' + n0(bytes / 1024) + ' KB' +
    (FILES.available() ? ' (ไฟล์แนบเก็บแยกใน IndexedDB)' : ' — เบราว์เซอร์นี้แนบไฟล์ไม่ได้');

  $('#metaInfo').innerHTML = [
    ['ไฟล์ต้นทาง', DB.meta.source],
    ['สร้างฐานข้อมูลเมื่อ', new Date(DB.meta.generated).toLocaleString('th-TH')],
    ['จำนวนแปลง', n0(DB.meta.totals.plots) + ' แปลง'],
    ['จำนวนแหล่งวัตถุดิบ', n0(DB.meta.totals.suppliers) + ' ราย'],
    ['พื้นที่รวม', n0(DB.meta.totals.areaRai) + ' ไร่ / ' + n2(DB.meta.totals.areaHa) + ' ha'],
    ['แปลงที่ไม่มีโพลิกอน', n0(DB.meta.plotsWithoutGeometry) + ' แปลง'],
    ['อัตราแปลงหน่วย', '1 เฮกตาร์ = ' + DB.meta.haToRai + ' ไร่'],
    ['ระบบพิกัด', 'WGS84 (EPSG:4326)'],
    ['จับคู่ตำบลจากพิกัดแปลง', DB.meta.adminMatched
      ? n0(DB.meta.adminMatched.tambon) + ' / ' + n0(DB.meta.totals.plots) + ' แปลง' : 'ยังไม่ได้จับคู่'],
    ['ขอบเขตการปกครอง', ADMIN.amphoes.length
      ? n0(ADMIN.amphoes.length) + ' อำเภอ · ' + n0(ADMIN.tambons.length) + ' ตำบล' : 'ไม่ได้โหลด'],
    ['ที่มาขอบเขตการปกครอง', ADMIN.source || '—'],
    ['ภาพแผนที่', 'Esri World Imagery · OpenStreetMap']
  ].map(r => '<div><b>' + esc(r[0]) + '</b>' + esc(r[1]) + '</div>').join('');
}
function saveSettings() {
  S.cfg.yield.estate = Math.max(0, +$('#s_estate').value || 0);
  S.cfg.yield.promotion = Math.max(0, +$('#s_promotion').value || 0);
  S.cfg.yield.collector = Math.max(0, +$('#s_collector').value || 0);
  S.cfg.mode = $('#s_mode').value;
  S.cfg.warnAt = Math.min(100, Math.max(1, +$('#s_warn').value || 90));
  S.cfg.deductFlag = +$('#s_flag').value;
  CAT_KEYS.forEach(cat => {
    const arr = [];
    for (let m = 0; m < 12; m++) {
      const inp = $('#seasonTbl input[data-season-cat="' + cat + '"][data-season-m="' + m + '"]');
      arr.push(Math.max(0, parseFloat(inp && inp.value) || 0));
    }
    S.cfg.season[cat] = arr;
  });
  save(LS.cfg, S.cfg);
  toast('บันทึกการตั้งค่าแล้ว');
  renderAll();
}

/* ============================== เชื่อมเหตุการณ์ ============================== */
function refreshSeasons() {
  const years = seasonYears();
  if (!S.season || years.indexOf(S.season) < 0) S.season = new Date().getFullYear();
  $('#seasonSel').innerHTML = years.map(y =>
    '<option value="' + y + '"' + (y === S.season ? ' selected' : '') + '>' + be(y) + ' (' + y + ')</option>').join('');
}
function renderAll() {
  renderDashboard();
  renderSuppliers();
  renderPlots();
  renderTx();
  renderReports();
  renderSettings();
  updateBuyPanel();
}
function switchView(v) {
  S.view = v;
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  window.scrollTo({ top: 0 });
}

function init() {
  document.documentElement.setAttribute('data-theme', S.ui.theme || '');
  $('#brandSub').textContent = 'ยางพารา · ' + n0(DB.meta.totals.plots) + ' แปลง · ' +
    n0(DB.meta.totals.areaRai) + ' ไร่ · จ.' + (DB.suppliers[0] || {}).province;

  refreshSeasons();
  fillSupDatalists();
  $('#f_date').value = new Date().toISOString().slice(0, 10);
  $('#f_drc').value = 60;

  // ตัวกรองพื้นที่ (จังหวัด → อำเภอ → ตำบล) ทั้งหน้าแผนที่และหน้าแปลงปลูก
  fillAreaSelects(mapState, MAP_SEL);
  fillAreaSelects(plotState, PLOT_SEL);

  function bindArea(st, sel, onChange) {
    ['prov', 'dist', 'tam'].forEach(key => {
      $(sel[key]).addEventListener('change', e => {
        st[key] = e.target.value;
        if (key === 'prov') { st.dist = ''; st.tam = ''; }
        else if (key === 'dist') st.tam = '';
        fillAreaSelects(st, sel);
        onChange();
      });
    });
  }
  bindArea(mapState, MAP_SEL, renderOverviewMap);
  bindArea(plotState, PLOT_SEL, () => { plotState.page = 1; renderPlots(); });

  $('#areaLevelChips').addEventListener('click', e => {
    const lv = e.target.getAttribute && e.target.getAttribute('data-lv');
    if (!lv) return;
    areaLevel = lv;
    $$('#areaLevelChips button').forEach(b => b.classList.toggle('active', b.getAttribute('data-lv') === lv));
    renderAreaChart();
  });

  // แผนที่ดาวเทียมภาพรวม
  $('#mapCatChips').addEventListener('click', e => {
    const c = e.target.getAttribute && e.target.getAttribute('data-cat');
    if (c == null) return;
    mapState.cat = c;
    $$('#mapCatChips button').forEach(b => b.classList.toggle('active', b.getAttribute('data-cat') === c));
    renderOverviewMap();
  });

  $('#tabs').addEventListener('click', e => {
    const v = e.target.getAttribute && e.target.getAttribute('data-view');
    if (v) switchView(v);
  });
  $('#seasonSel').addEventListener('change', e => { S.season = +e.target.value; renderAll(); });
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    S.ui.theme = next; save(LS.ui, S.ui);
  });

  // suppliers
  $('#supSearch').addEventListener('input', e => { supState.q = e.target.value; supState.page = 1; renderSuppliers(); });
  $('#supCatChips').addEventListener('click', e => {
    const c = e.target.getAttribute && e.target.getAttribute('data-cat');
    if (c == null) return;
    supState.cat = c; supState.page = 1;
    $$('#supCatChips button').forEach(b => b.classList.toggle('active', b.getAttribute('data-cat') === c));
    renderSuppliers();
  });
  $('#supSort').addEventListener('change', e => { supState.sort = e.target.value; renderSuppliers(); });

  // plots
  $('#plotSearch').addEventListener('input', e => { plotState.q = e.target.value; plotState.page = 1; renderPlots(); });
  $('#plotCat').addEventListener('change', e => { plotState.cat = e.target.value; plotState.page = 1; renderPlots(); });
  $('#plotDoc').addEventListener('change', e => { plotState.doc = e.target.value; plotState.page = 1; renderPlots(); });
  $('#plotProtect').addEventListener('change', e => { plotState.prot = e.target.value; plotState.page = 1; renderPlots(); });
  $('#plotExport').addEventListener('click', () => {
    const list = plotFiltered();
    if (!list.length) return toast('ไม่มีแปลงตามเงื่อนไขที่กรอง', true);
    download('EUDR_filtered.geojson', JSON.stringify(toGeoJSON(list)), 'application/geo+json');
    toast('ส่งออก ' + n0(list.length) + ' แปลงแล้ว');
  });

  // purchase form
  $('#f_product').addEventListener('change', e => {
    const o = e.target.selectedOptions[0];
    if (o && o.dataset.drc) $('#f_drc').value = o.dataset.drc;
    updateBuyPanel();
  });
  ['#f_supSearch', '#f_weight', '#f_drc', '#f_date'].forEach(s =>
    $(s).addEventListener('input', updateBuyPanel));
  $('#buyForm').addEventListener('submit', submitPurchase);
  $('#buyReset').addEventListener('click', () => {
    $('#buyForm').reset();
    $('#f_date').value = new Date().toISOString().slice(0, 10);
    $('#f_drc').value = 60;
    pending = [];
    renderAttachList();
    scopeReset();
    updateBuyPanel();
  });

  // ขอบเขตแปลงต้นทาง
  $('#scopeBlock').addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'scope') {
      scopeState.mode = t.value;
      if (t.value === 'all') scopeState.picked = new Set();
    } else if (t.getAttribute('data-f')) {
      const nm = t.getAttribute('data-f');
      if (t.checked) scopeState.picked.add(nm); else scopeState.picked.delete(nm);
    } else return;
    updateBuyPanel();
  });
  $('#scopeSearch').addEventListener('input', e => {
    scopeState.q = e.target.value;
    renderScope(supFromInput($('#f_supSearch').value));
  });
  $('#scopeNone').addEventListener('click', () => {
    scopeState.picked = new Set();
    $('#scopeFarmers').dataset.for = '';      // บังคับวาดใหม่ให้ช่องติ๊กหลุดหมด
    updateBuyPanel();
  });

  // ไฟล์แนบใบชั่ง
  if (!FILES.available()) {
    $('#attachBlock').style.display = 'none';
  } else {
    $('#f_files').addEventListener('change', e => { addAttachments(e.target.files); e.target.value = ''; });
    $('#f_cam').addEventListener('change', e => { addAttachments(e.target.files); e.target.value = ''; });
    $('#attachList').addEventListener('click', e => {
      const i = e.target.getAttribute && e.target.getAttribute('data-att');
      if (i == null) return;
      pending.splice(+i, 1);
      renderAttachList();
    });
  }
  $('#txSearch').addEventListener('input', e => { txState.q = e.target.value; txState.page = 1; renderTx(); });
  $('#txExport').addEventListener('click', () => exportTxCsv());

  // reports
  $('#repCat').addEventListener('change', renderReports);
  $('#repExport').addEventListener('click', exportQuotaCsv);
  $('#expSup').addEventListener('click', exportSuppliersCsv);
  $('#expPlot').addEventListener('click', () => exportPlotsCsv());
  $('#expTx').addEventListener('click', () => exportTxCsv());
  $('#expAlloc').addEventListener('click', () => exportAllocCsv());
  $$('[data-geo]').forEach(b => b.addEventListener('click', () => exportGeo(b.getAttribute('data-geo'))));

  // settings
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#seasonTbl').addEventListener('input', e => {
    const cat = e.target.getAttribute && e.target.getAttribute('data-season-cat');
    if (!cat) return;
    let sum = 0;
    $$('#seasonTbl input[data-season-cat="' + cat + '"]').forEach(i => sum += parseFloat(i.value) || 0);
    const c = $('#seasonTbl [data-season-sum="' + cat + '"]');
    if (c) c.textContent = sum.toFixed(1) + '%';
  });
  $('#seasonReset').addEventListener('click', () => {
    if (!confirm('รีเซ็ตสัดส่วนผลผลิตรายเดือนของทุกประเภทให้เท่ากันทุกเดือน?')) return;
    CAT_KEYS.forEach(cat => { S.cfg.season[cat] = EQUAL_MONTH.slice(); });
    renderSeasonTable();
  });
  $('#ovSearch').addEventListener('input', renderSettings);
  $('#ovTbl').addEventListener('change', e => {
    const id = e.target.getAttribute && e.target.getAttribute('data-ov');
    if (!id) return;
    const v = e.target.value.trim();
    if (v === '') delete S.ov[id]; else S.ov[id] = Math.max(0, +v || 0);
    save(LS.ov, S.ov); renderSettings(); renderDashboard(); renderSuppliers(); renderReports();
  });
  $('#ovTbl').addEventListener('click', e => {
    const id = e.target.getAttribute && e.target.getAttribute('data-ovdel');
    if (!id) return;
    delete S.ov[id]; save(LS.ov, S.ov);
    renderSettings(); renderDashboard(); renderSuppliers(); renderReports();
  });
  $('#backupBtn').addEventListener('click', () => {
    const make = files => {
      const body = { v: 2, exportedAt: new Date().toISOString(), tx: S.tx, cfg: S.cfg, ov: S.ov, files: files || [] };
      const txt = JSON.stringify(body);
      download('EUDR_backup_' + new Date().toISOString().slice(0, 10) + '.json', txt, 'application/json');
      toast('ไฟล์สำรอง ' + fileSizeText(txt.length) + ' · รวมไฟล์แนบ ' + (files ? files.length : 0) + ' ไฟล์');
    };
    if (!FILES.available()) return make([]);
    FILES.all().then(make, () => {
      toast('อ่านไฟล์แนบไม่ได้ — สำรองเฉพาะข้อมูลรายการ', true);
      make([]);
    });
  });
  $('#restoreInp').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (!d || !Array.isArray(d.tx)) throw 0;
        const nf = (d.files || []).length;
        if (!confirm('กู้คืนข้อมูล ' + d.tx.length + ' รายการ' + (nf ? ' และไฟล์แนบ ' + nf + ' ไฟล์' : '') +
                     ' — ข้อมูลรับซื้อและไฟล์แนบปัจจุบันจะถูกแทนที่ทั้งหมด ยืนยันหรือไม่?')) return;
        S.tx = d.tx; S.txVer++; S.cfg = Object.assign({}, DEFAULT_CFG, d.cfg || {});
        S.cfg.yield = Object.assign({}, DEFAULT_CFG.yield, (d.cfg || {}).yield || {});
        S.ov = d.ov || {};
        save(LS.tx, S.tx); save(LS.cfg, S.cfg); save(LS.ov, S.ov);
        const done = () => { refreshSeasons(); renderAll(); toast('กู้คืนข้อมูลแล้ว'); };
        if (nf && FILES.available()) {
          Promise.all(d.files.map(f => FILES.put(f))).then(done,
            () => { toast('กู้คืนรายการแล้ว แต่ไฟล์แนบบางส่วนไม่สำเร็จ', true); done(); });
        } else done();
      } catch (err) { toast('ไฟล์สำรองไม่ถูกต้อง', true); }
    };
    fr.readAsText(f);
    e.target.value = '';
  });
  $('#wipeBtn').addEventListener('click', () => {
    if (!S.tx.length) return toast('ไม่มีรายการให้ลบ');
    const nf = S.tx.reduce((n, t) => n + (t.files || 0), 0);
    if (!confirm('ลบรายการรับซื้อทั้งหมด ' + S.tx.length + ' รายการ' +
                 (nf ? ' และไฟล์แนบ ' + nf + ' ไฟล์' : '') +
                 '?\nการกระทำนี้ย้อนกลับไม่ได้ — ควรดาวน์โหลดไฟล์สำรองก่อน')) return;
    const ids = S.tx.map(t => t.id);
    S.tx = []; S.txVer++; save(LS.tx, S.tx);
    if (FILES.available()) ids.forEach(id => FILES.delByTx(id).catch(() => {}));
    refreshSeasons(); renderAll(); toast('ลบรายการทั้งหมดแล้ว');
  });

  // การคลิกทั่วเอกสาร (แถวตาราง / ปุ่มในลิ้นชัก)
  document.addEventListener('click', e => {
    const t = e.target;
    const lot = t.getAttribute && t.getAttribute('data-lot');
    if (lot) {
      const rec = S.tx.find(x => x.id === t.getAttribute('data-id'));
      if (!rec) return;
      const ps = scopePlotsOf(rec);
      const tag = (rec.lot || rec.doc || rec.date).replace(/[^\w.-]/g, '_');
      if (lot === 'geo') {
        download('DDS_' + tag + '.geojson', JSON.stringify(toGeoJSON(ps)), 'application/geo+json');
        toast('ส่งออก ' + n0(ps.length) + ' แปลงต้นทางของล็อตนี้');
      } else if (lot === 'alloccsv') {
        exportAllocCsv([rec], 'EUDR_quota_cut_' + tag);
      } else exportPlotsCsv(ps, 'DDS_plots_' + tag);
      return;
    }
    const del = t.getAttribute && t.getAttribute('data-del');
    if (del) {
      const i = S.tx.findIndex(x => x.id === del);
      if (i < 0) return;
      const rec = S.tx[i];
      const extra = rec.files ? ' พร้อมไฟล์แนบ ' + rec.files + ' ไฟล์' : '';
      if (confirm('ลบรายการรับซื้อนี้' + extra + ' และคืนโควต้า ' + n0(rec.dryKg) + ' กก.?')) {
        S.tx.splice(i, 1); S.txVer++; save(LS.tx, S.tx);
        if (rec.files) FILES.delByTx(rec.id).catch(() => {});
        renderTx(); renderDashboard(); renderSuppliers(); renderReports(); updateBuyPanel();
        toast('ลบรายการแล้ว');
      }
      return;
    }
    const so = t.getAttribute && t.getAttribute('data-sup-open');
    if (so) { showSupplier(so); return; }
    const exp = t.getAttribute && t.getAttribute('data-exp');
    if (exp) {
      const id = t.getAttribute('data-id');
      if (exp === 'geo') {
        const list = S.plotsBySup.get(id) || [];
        download('EUDR_' + id + '.geojson', JSON.stringify(toGeoJSON(list)), 'application/geo+json');
        toast('ส่งออก ' + n0(list.length) + ' แปลงแล้ว');
      } else if (exp === 'csv') {
        exportPlotsCsv(S.plotsBySup.get(id) || [], 'EUDR_plots_' + id);
      } else if (exp === 'buy') {
        const s = S.supById.get(id);
        closeDrawer(); switchView('purchase');
        $('#f_supSearch').value = s.name + ' — ' + (s.village || (CAT[s.category] || {}).label) + ' [' + s.id + ']';
        updateBuyPanel();
        $('#f_weight').focus();
      } else if (exp === 'geo1') {
        const p = DB.plots.find(x => x.uid === id);
        download('EUDR_' + p.code.replace(/[^\w.-]/g, '_') + '.geojson', JSON.stringify(toGeoJSON([p])), 'application/geo+json');
      } else if (exp === 'wkt') {
        const g = GEO[id];
        const wkt = 'POLYGON ((' + g.map(p => p[0] + ' ' + p[1]).join(', ') + '))';
        navigator.clipboard ? navigator.clipboard.writeText(wkt).then(() => toast('คัดลอก WKT แล้ว'), () => prompt('คัดลอกข้อความนี้', wkt))
          : prompt('คัดลอกข้อความนี้', wkt);
      }
      return;
    }
    const row = t.closest && t.closest('[data-sup],[data-plot],[data-tx]');
    if (row) {
      const sid = row.getAttribute('data-sup');
      const pid = row.getAttribute('data-plot');
      const tid = row.getAttribute('data-tx');
      if (sid) { e.preventDefault(); showSupplier(sid); }
      else if (pid) { e.preventDefault(); showPlot(pid); }
      else if (tid) { e.preventDefault(); showTx(tid); }
    }
  });
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  renderAll();
  document.body.classList.add('ready');
  renderOverviewMap();   // หลัง body พร้อมแล้ว เพื่อให้ canvas วัดขนาดได้
}

if (!DB || !DB.suppliers) {
  document.getElementById('boot').textContent =
    'ไม่พบไฟล์ฐานข้อมูล data/db.js — กรุณาเปิดจากโฟลเดอร์ eudr-web ทั้งโฟลเดอร์';
} else {
  init();
}
})();
