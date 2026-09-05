/* build-artifact.js — รวมทุกไฟล์เป็น HTML ไฟล์เดียวสำหรับเผยแพร่เป็นลิงก์ (Artifact)
 *
 *     node tools/build-artifact.js
 *
 * ผลลัพธ์: dist/eudr-traceability.html  (ฝัง CSS, JS และฐานข้อมูลทั้งหมดไว้ในไฟล์เดียว)
 * ต้องรันหลัง build-db.js และ build-admin.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(WEB, p), 'utf8');

const html = read('index.html');
const css = read('assets/app.css');
const js = read('assets/app.js');

// ดึงเฉพาะเนื้อใน <body> — ตัว Artifact จะเติม doctype/head/body ให้เอง
const bodyM = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
if (!bodyM) throw new Error('หา <body> ในไฟล์ index.html ไม่พบ');
let body = bodyM[1];

// ตัดแท็ก <script src> ออก แล้วฝังเนื้อไฟล์แทน
body = body.replace(/[\t ]*<script src="[^"]*"><\/script>\r?\n?/g, '');

const parts = [
  '<title>ตรวจสอบย้อนกลับวัตถุดิบ EUDR</title>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700' +
    '&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">',
  '<style>\n' + css + '\n</style>',
  body.trim(),
  '<script>\n' + read('data/db.js') + '</script>',
  '<script>\n' + read('data/geo.js') + '</script>',
  '<script>\n' + read('data/admin.js') + '</script>',
  '<script>\n' + read('data/protect.js') + '</script>',
  '<script>\n' + read('data/tiles.js') + '</script>',
  '<script>\n' + js + '\n</script>'
];

const out = path.join(WEB, 'dist');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'eudr-traceability.html');
fs.writeFileSync(file, parts.join('\n'), 'utf8');

const mb = fs.statSync(file).size / 1048576;
console.log('เขียนไฟล์:', file);
console.log('ขนาด:', mb.toFixed(2), 'MB', mb > 16 ? '— เกิน 16 MB เผยแพร่เป็น Artifact ไม่ได้!' : '(อยู่ในเกณฑ์ 16 MB)');
