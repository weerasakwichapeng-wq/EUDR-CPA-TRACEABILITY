/* build-pages.js — สร้างเว็บสำหรับเผยแพร่ "สาธารณะ" ผ่าน GitHub Pages
 *
 *     node tools/build-pages.js
 *
 * ต่างจาก build-artifact.js (ซึ่งสร้างไฟล์ไว้ใช้งานส่วนตัว/ทีมภายใน) ตรงที่ไฟล์นี้:
 *
 *   1. ตัดฟิลด์ที่เป็นข้อมูลส่วนบุคคลอ่อนไหวออกก่อนเสมอ — เลขบัตรประชาชนเกษตรกร (citizenId)
 *      และเบอร์โทรศัพท์ผู้ขาย (phone) จะไม่ถูกฝังลงในไฟล์ที่เผยแพร่สาธารณะ
 *   2. ไม่ฝังภาพดาวเทียม (data/tiles.js) เพราะเว็บที่โฮสต์จริงบน GitHub Pages โหลดภาพสด
 *      จากอินเทอร์เน็ตได้ตามปกติ (ไม่ถูกนโยบายความปลอดภัยแบบหน้า Artifact ปิดกั้น)
 *      ช่วยลดขนาดไฟล์จาก ~14.5 MB เหลือราว 7 MB
 *
 * ผลลัพธ์: ../docs/index.html (ที่ระดับรากของ repo) สำหรับตั้งค่า GitHub Pages ให้เสิร์ฟจาก
 * โฟลเดอร์ /docs ของ branch main — ไม่ต้องใช้ branch gh-pages แยกต่างหาก
 *
 * ไฟล์ต้นทาง data/*.js ที่มีข้อมูลจริง (รวมเลขบัตรประชาชน/เบอร์โทร) จะไม่ถูกคัดลอกหรือ commit
 * ขึ้น git เลย — ใช้ในเครื่องนี้เท่านั้น ดู .gitignore ที่ระดับรากของ repo
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const ROOT = path.join(WEB, '..');
const read = p => fs.readFileSync(path.join(WEB, p), 'utf8');

/* ---------- โหลดฐานข้อมูลแล้วตัดฟิลด์อ่อนไหวออก ---------- */
global.window = {};
require(path.join(WEB, 'data', 'db.js'));
const DB = window.EUDR_DB;

let strippedPlots = 0, strippedPhones = 0;
const publicDb = JSON.parse(JSON.stringify(DB));   // deep clone — ไม่แตะไฟล์ต้นฉบับ
publicDb.suppliers.forEach(s => { if (s.phone) { delete s.phone; strippedPhones++; } });
publicDb.plots.forEach(p => { if (p.citizenId) { delete p.citizenId; strippedPlots++; } });
publicDb.meta = Object.assign({}, publicDb.meta, {
  public: true,
  publicNote: 'ไฟล์นี้เป็นเวอร์ชันเผยแพร่สาธารณะ — ตัดเลขบัตรประชาชนเกษตรกรและเบอร์โทรศัพท์ผู้ขายออกแล้ว'
});
console.log('ตัดเลขบัตรประชาชนออก', strippedPlots, 'แปลง · ตัดเบอร์โทรออก', strippedPhones, 'ราย');

const dbJs = 'window.EUDR_DB=' + JSON.stringify(publicDb) + ';\n';

/* ---------- ประกอบหน้าเว็บ (เหมือน build-artifact.js แต่ไม่รวม tiles.js) ---------- */
const html = read('index.html');
const css = read('assets/app.css');
const js = read('assets/app.js');

const bodyM = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
if (!bodyM) throw new Error('หา <body> ในไฟล์ index.html ไม่พบ');
let body = bodyM[1].replace(/[\t ]*<script src="[^"]*"><\/script>\r?\n?/g, '');

const parts = [
  '<title>ตรวจสอบย้อนกลับวัตถุดิบ EUDR</title>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700' +
    '&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">',
  '<style>\n' + css + '\n</style>',
  body.trim(),
  '<script>\n' + dbJs + '</script>',
  '<script>\n' + read('data/geo.js') + '</script>',
  '<script>\n' + read('data/admin.js') + '</script>',
  '<script>\n' + read('data/protect.js') + '</script>',
  '<script>\n' + js + '\n</script>'
];

const outDir = path.join(ROOT, 'docs');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'index.html');
fs.writeFileSync(file, parts.join('\n'), 'utf8');

const mb = fs.statSync(file).size / 1048576;
console.log('เขียนไฟล์:', file);
console.log('ขนาด:', mb.toFixed(2), 'MB (ไม่รวมภาพดาวเทียมฝังไฟล์ — พึ่งพาโหลดสดจากอินเทอร์เน็ต)');
