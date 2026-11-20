const http = require('http');
const fs = require('fs');
const path = require('path');

const root = fs.realpathSync.native(__dirname);
const publicFiles = new Set(['index.html', '_raf_test.html']);
const publicDirectories = new Set(['src', 'vendor']);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function isPublicFile(file) {
  const relative = path.relative(root, file);
  const segments = relative.split(path.sep);
  if (path.isAbsolute(relative) || segments.some((segment) => segment.startsWith('.') || segment.includes(':'))) {
    return false;
  }
  return publicFiles.has(relative) || publicDirectories.has(segments[0]);
}

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname.includes('\0')) throw new Error('invalid path');
  } catch {
    sendError(res, 400, 'bad request');
    return;
  }
  if (pathname.includes('\\') || pathname.includes(':')) {
    sendError(res, 403, 'forbidden');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(root, '.' + pathname);
  if (!isPublicFile(file)) {
    sendError(res, 403, 'forbidden');
    return;
  }
  fs.realpath.native(file, (err, realFile) => {
    if (err) {
      sendError(res, 404, 'not found');
      return;
    }
    if (!isPublicFile(realFile)) {
      sendError(res, 403, 'forbidden');
      return;
    }
    fs.readFile(realFile, (readError, data) => {
      if (readError) {
        sendError(res, 404, 'not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
});

const port = Number(process.env.PORT) || 5173;
server.listen(port, '127.0.0.1', () => {
  console.log(`candle  http://127.0.0.1:${port}`);
});
