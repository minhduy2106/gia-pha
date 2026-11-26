// Chạy trên máy: Node + SQLite. Lõi app ở core.js, bản Cloudflare ở worker.js.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const d = require('./data');
const { nodeDb } = require('./db-node');
const { createApp, checkConfig } = require('./core');

const PORT = Number(process.env.PORT || 3000);
const SAU_PROXY = process.env.GIAPHA_SAU_PROXY === '1';
const DATA_DIR = process.env.GIAPHA_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const secretFile = path.join(DATA_DIR, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });

const cfg = {
  TEN_HO: process.env.GIAPHA_TEN_HO,
  MK_XEM: process.env.GIAPHA_MAT_KHAU_XEM,
  MK_SUA: process.env.GIAPHA_MAT_KHAU_SUA,
  SECRET: process.env.GIAPHA_SECRET || fs.readFileSync(secretFile, 'utf8').trim(),
  HTTPS: process.env.GIAPHA_HTTPS === '1',
};
const problem = checkConfig(cfg);
if (problem) {
  console.error(`${problem} trong file .env`);
  process.exit(1);
}
const db = nodeDb(path.join(DATA_DIR, 'giapha.db'));

// Tự sao lưu ra CSV + GEDCOM trong data/backups, giữ 30 ngày gần nhất
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 30;
async function backupNow() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const m = await d.loadAll(db);
    if (!m.people.length) return;
    fs.writeFileSync(path.join(BACKUP_DIR, `giapha-${day}.csv`), d.toCsv(m), { mode: 0o600 });
    fs.writeFileSync(path.join(BACKUP_DIR, `giapha-${day}.ged`), d.toGedcom(m), { mode: 0o600 });
    const days = [...new Set(fs.readdirSync(BACKUP_DIR).filter((f) => /^giapha-\d{4}-\d{2}-\d{2}\.(csv|ged)$/.test(f)).map((f) => f.slice(7, 17)))].sort();
    for (const old of days.slice(0, -KEEP_BACKUPS)) for (const ext of ['csv', 'ged']) fs.rmSync(path.join(BACKUP_DIR, `giapha-${old}.${ext}`), { force: true });
  } catch (e) {
    console.error('Sao lưu thất bại:', e);
  }
}
backupNow();
setInterval(backupNow, 6 * 3600 * 1000).unref(); // 6 tiếng chạy một lần; trong ngày ghi đè lên file của ngày đó

const backup = {
  fact: `Máy chủ tự lưu bản sao mỗi ngày, giữ ${KEEP_BACKUPS} ngày gần nhất.`,
  status: async () => {
    let files = [];
    try { files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.csv')).sort().reverse(); } catch { /* chưa có thư mục */ }
    return files.length
      ? `Bản tự sao lưu gần nhất: ${files[0].slice(7, 17)} · đang giữ ${files.length} ngày, trong thư mục data/backups trên máy chủ.`
      : 'Chưa có bản tự sao lưu (gia phả còn trống).';
  },
};
const app = createApp({ db, cfg, platform: { backup } });

// File tĩnh nạp một lần lúc khởi động; tên file cố định nên không có đường dẫn nào do người dùng gửi lên.
const STATIC = {
  '/style.css': ['text/css; charset=utf-8', fs.readFileSync(path.join(__dirname, 'public/style.css'))],
  '/app.js': ['text/javascript; charset=utf-8', fs.readFileSync(path.join(__dirname, 'public/app.js'))],
};
const MAX_BODY = 5 * 1024 * 1024;
const SKIP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade']);

http.createServer(async (req, res) => {
  try {
    const file = req.method === 'GET' && STATIC[req.url.split('?')[0]];
    if (file) {
      res.writeHead(200, { 'Content-Type': file[0], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(file[1]);
    }
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Dữ liệu gửi lên quá lớn (tối đa 5MB)');
      }
      chunks.push(c);
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (!SKIP_HEADERS.has(k)) for (const x of [].concat(v)) headers.append(k, x);
    const request = new Request(`${cfg.HTTPS ? 'https' : 'http'}://${req.headers.host || 'localhost'}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    // Sau Cloudflare Tunnel thì lấy IP thật từ cf-connecting-ip; khi đó chỉ nghe ở 127.0.0.1 nên không ai gửi header giả vào thẳng được
    const ip = (SAU_PROXY && req.headers['cf-connecting-ip']) || req.socket.remoteAddress;
    const response = await app.handle(request, { ip });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Lỗi máy chủ');
  }
}).listen(PORT, SAU_PROXY ? '127.0.0.1' : undefined, () => console.log(`Gia phả chạy tại http://localhost:${PORT}`));
