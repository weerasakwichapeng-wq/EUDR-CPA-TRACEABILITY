/* เซิร์ฟเวอร์สถิตขนาดเล็กสำหรับเปิดระบบในเบราว์เซอร์
   ใช้งาน:  node serve.js   แล้วเปิด http://localhost:8777  */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = __dirname;
const PORT = process.env.PORT || 8777;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml'
};
http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('ไม่พบไฟล์: ' + p); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log('EUDR traceability running at http://localhost:' + PORT));
