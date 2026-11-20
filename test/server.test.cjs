const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { before, after, test } = require('node:test');

let fixtureDirectory;
let server;
let port;

function request(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
    req.end();
  });
}

before(async () => {
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'candle-server-test-'));
  const appDirectory = path.join(fixtureDirectory, 'Candle');
  const privateDirectory = path.join(fixtureDirectory, 'Candle-private');
  for (const directory of ['src', 'vendor', '.git']) {
    fs.mkdirSync(path.join(appDirectory, directory), { recursive: true });
  }
  fs.mkdirSync(privateDirectory);
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(appDirectory, 'server.js'));
  for (const [file, contents] of [
    ['index.html', '<h1>Candle</h1>'],
    ['_raf_test.html', '<h1>debug</h1>'],
    ['src/main.js', 'export const candle = true;'],
    ['vendor/library.mjs', 'export default true;'],
    ['src/.env', 'private environment'],
    ['.git/HEAD', 'private repository metadata'],
    ['package.json', '{"private":true}'],
  ]) {
    fs.writeFileSync(path.join(appDirectory, file), contents);
  }
  fs.writeFileSync(path.join(privateDirectory, 'canary.txt'), 'private sibling file');
  fs.symlinkSync(privateDirectory, path.join(appDirectory, 'src', 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(path.join(appDirectory, '.git'), path.join(appDirectory, 'src', 'internal'), process.platform === 'win32' ? 'junction' : 'dir');

  server = spawn(process.execPath, ['--preserve-symlinks-main', path.join(appDirectory, 'server.js')], {
    cwd: appDirectory,
    env: { ...process.env, PORT: '0' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const [startupMessage] = await Promise.race([
      once(server.stdout, 'data', { signal: controller.signal }),
      once(server, 'exit', { signal: controller.signal }).then(([code]) => {
        throw new Error(`server exited during startup: ${code}`);
      }),
      once(server, 'error', { signal: controller.signal }).then(([error]) => { throw error; }),
    ]);
    const match = startupMessage.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/);
    assert.ok(match, 'server should report its listening port');
    port = Number(match[1]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  if (fixtureDirectory) {
    const resolved = path.resolve(fixtureDirectory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('candle-server-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('serves entry pages and public JavaScript with the correct MIME types', async () => {
  for (const pathname of ['/', '/index.html', '/_raf_test.html']) {
    const res = await request(pathname);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }
  for (const pathname of ['/src/main.js', '/vendor/library.mjs']) {
    const res = await request(pathname);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers['content-type'], /^text\/javascript/);
  }
  assert.equal((await request('/src/missing.js')).status, 404);
});

test('supports HEAD without a response body and rejects other HTTP methods', async () => {
  const head = await request('/src/main.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.match(head.headers['content-type'], /^text\/javascript/);
  assert.equal(head.body, '');

  const post = await request('/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('returns 400 for malformed encodings and null bytes, and keeps serving requests', async () => {
  for (const pathname of ['/%', '/%E0%A4%A', '/src/main.js%00']) {
    assert.equal((await request(pathname)).status, 400, pathname);
    assert.equal((await request('/')).status, 200);
  }
});

test('rejects repository metadata, server code, and dotfiles in public directories', async () => {
  for (const pathname of ['/.git/HEAD', '/%2egit/HEAD', '/server.js', '/package.json', '/src/.env', '/src/%2eenv']) {
    assert.equal((await request(pathname)).status, 403, pathname);
  }
});

test('rejects traversal into a sibling directory with the same name prefix', async () => {
  for (const pathname of [
    '/%2e%2e%2fCandle-private%2fcanary.txt',
    '/src/%2e%2e%2f%2e%2e%2fCandle-private%2fcanary.txt',
    '/src/%2e%2e%5c%2e%2e%5cCandle-private%5ccanary.txt',
    '/src/main.js:private',
  ]) {
    assert.equal((await request(pathname)).status, 403, pathname);
  }
});

test('rejects symbolic links to private files inside and outside the project', async () => {
  assert.equal((await request('/src/outside/canary.txt')).status, 403);
  assert.equal((await request('/src/internal/HEAD')).status, 403);
});
