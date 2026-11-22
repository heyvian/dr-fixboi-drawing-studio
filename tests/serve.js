// Tiny static server: `npm run serve` then open http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.jsx': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wasm': 'application/wasm',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};
const vendor = '/vendor/rhino3dm/';
const readerFiles = new Set(['rhino3dm.module.min.js', 'rhino3dm.wasm']);

http
  .createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      res.writeHead(400).end('Invalid path');
      return;
    }
    const readerFile = rel.startsWith(vendor) ? rel.slice(vendor.length) : '';
    const file = readerFiles.has(readerFile)
      ? path.join(root, 'node_modules', 'rhino3dm', readerFile)
      : path.resolve(root, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(8080, () => console.log('http://localhost:8080'));
