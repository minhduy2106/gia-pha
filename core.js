// Lõi của app: nhận Request, trả Response (chuẩn Web), không phụ thuộc nền tảng.
// Chạy trên máy qua server.js (Node + SQLite) và trên Cloudflare qua worker.js (Pages + D1).
const d = require('./data');
const { solarToLunar } = require('./lunar');

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

// Cấu hình thiếu hoặc yếu thì trả về lời nhắc, đủ thì trả null
function checkConfig(cfg) {
  if ((cfg.MK_XEM || '').length < 6 || (cfg.MK_SUA || '').length < 10 || cfg.MK_XEM === cfg.MK_SUA) {
    return 'Cần đặt GIAPHA_MAT_KHAU_XEM (>= 6 ký tự) và GIAPHA_MAT_KHAU_SUA (>= 10 ký tự, khác mật khẩu xem)';
  }
  if ((cfg.SECRET || '').length < 32) return 'Cần đặt GIAPHA_SECRET (chuỗi ngẫu nhiên, >= 32 ký tự)';
  return null;
}

// db: xem db-node.js / db-d1.js. cfg: TEN_HO, MK_XEM, MK_SUA, SECRET, HTTPS.
// platform.backup: { fact: chữ mô tả cách sao lưu, status: async () => chữ tình trạng sao lưu hiện tại }
function createApp({ db, cfg, platform }) {
const { TEN_HO = 'Gia phả', MK_XEM, MK_SUA, HTTPS } = cfg;
const hmacKey = crypto.subtle.importKey('raw', enc.encode(cfg.SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sign = async (s) => b64url(await crypto.subtle.sign('HMAC', await hmacKey, enc.encode(s)));
const sha = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(s))));
// So sánh không lộ thời gian: băm cả hai rồi so từng byte
async function safeEq(a, b) {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
const icsToken = sign('ics').then((s) => s.slice(0, 24));

// ---------- HTML: mọi giá trị chèn vào đều được escape, trừ khi bọc bằng raw() ----------
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : v == null || v === false ? '' : esc(v));
const h = (strings, ...vals) => raw(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? fmt(vals[i]) : ''), ''));

const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}
const redirect = (res, to, extra = {}) => { res.writeHead(303, { ...HEADERS, Location: to, ...extra }); res.end(); };

const FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#9a3324"/><text x="16" y="22" font-family="Georgia,serif" font-size="17" text-anchor="middle" fill="#fff">Gia</text></svg>');
const HO = TEN_HO.split(/\s+/).pop() || 'G'; // chữ cuối của tên họ, ví dụ "Nguyễn"

function page(res, who, title, body, status = 200) {
  const cur = res.activePath || '';
  const link = (href, text) => h`<a href="${href}" ${cur === href ? raw('aria-current="page"') : ''}>${text}</a>`;
  const nav = who ? h`<nav class="nav" aria-label="Chính">
    ${link('/', 'Cây gia phả')}${link('/gio', 'Ngày giỗ')}
    ${who.role === 'sua' ? h`${link('/them', 'Thêm người')}${link('/nhap', 'Nhập/Xuất')}${link('/nhat-ky', 'Nhật ký')}` : ''}
    <button type="button" data-print>In</button>
    <form method="post" action="/dang-xuat"><button>Thoát</button></form>
  </nav>` : '';
  send(res, status, 'text/html; charset=utf-8', h`<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${TEN_HO}</title>
<meta name="robots" content="noindex,nofollow"><link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/style.css"></head><body>
<a class="skip" href="#noi-dung">Bỏ qua, tới nội dung</a>
<header class="topbar"><a href="/" class="brand"><span class="brand-mark" aria-hidden="true">${HO[0]}</span><span class="brand-text">${TEN_HO}</span></a>${nav}</header>
<main id="noi-dung">${body}</main>
${who ? h`<footer class="foot no-print"><a href="/du-lieu">Dữ liệu này thuộc về dòng họ: xuất được bất cứ lúc nào, không bị khoá, không bị xoá</a></footer>` : ''}<script src="/app.js"></script></body></html>`.s);
}

const errorPage = (res, who, msg, status = 400) =>
  page(res, who, 'Lỗi', h`<div class="narrow"><div class="panel"><h1>Chưa làm được</h1><p class="notice warn">${msg}</p>
    <p><a href="/">Về trang chủ</a></p></div></div>`, status);

// ---------- Đăng nhập ----------
// Cookie: vai.hết_hạn.tên(base64url).chữ_ký
const COOKIE = 'gp';
const MAX_AGE = 90 * 24 * 3600;
async function readSession(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get('cookie') || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 4) return null;
  const [role, exp, name, sig] = parts;
  if (!(await safeEq(sig, await sign(`${role}.${exp}.${name}`)))) return null;
  if (Number(exp) < Date.now() / 1000 || !['xem', 'sua'].includes(role)) return null;
  return { role, name: fromB64url(name) };
}
async function sessionCookie(role, name) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${role}.${exp}.${b64url(enc.encode(name))}`;
  return `${COOKIE}=${payload}.${await sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${HTTPS ? '; Secure' : ''}`;
}

// Chặn dò mật khẩu: sai 5 lần thì khoá IP đó 15 phút. Đếm trong database để chạy được cả trên Cloudflare.
const LOCK_MS = 15 * 60 * 1000;
const locked = async (ip) => ((await db.first('SELECT khoa_den FROM dang_nhap_sai WHERE ip = ?', [ip]))?.khoa_den || 0) > Date.now();
const noteFail = (ip) => db.batch([{
  sql: `INSERT INTO dang_nhap_sai (ip, so_lan, khoa_den) VALUES (?, 1, 0) ON CONFLICT (ip) DO UPDATE SET
    khoa_den = CASE WHEN so_lan + 1 >= 5 THEN ? ELSE khoa_den END,
    so_lan = CASE WHEN so_lan + 1 >= 5 THEN 0 ELSE so_lan + 1 END`,
  params: [ip, Date.now() + LOCK_MS],
}]);
const clearFails = (ip) => db.batch([{ sql: 'DELETE FROM dang_nhap_sai WHERE ip = ?', params: [ip] }]);

const loginPage = (res, msg = '', status = 200) => page(res, null, 'Đăng nhập', h`
<div class="login"><div class="panel">
  <p class="muted" style="margin:0">Gia phả dòng họ</p>
  <h1>${TEN_HO}</h1>
  ${msg ? h`<p class="notice warn" role="alert">${msg}</p>` : ''}
  <form method="post" action="/dang-nhap">
    <label for="mk">Mật khẩu của họ</label>
    <input id="mk" name="mat_khau" type="password" autocomplete="current-password" required autofocus>
    <label for="ten">Tên của bạn <span class="muted" style="font-weight:400">(không bắt buộc, dùng để ghi nhật ký khi sửa)</span></label>
    <input id="ten" name="ten" type="text" maxlength="60">
    <p style="margin:1.25rem 0 0"><button class="btn" style="width:100%;justify-content:center">Vào xem gia phả</button></p>
  </form>
</div></div>`, status);

// ---------- Thành phần hiển thị ----------
const WEEKDAY = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const dmy = ([dd, mm, yy]) => `${dd}/${mm}/${yy}`;
const weekday = (jd) => WEEKDAY[(jd + 1) % 7];
const initial = (p) => (p.ho_ten.trim().split(/\s+/).pop() || '?')[0].toUpperCase();
const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
function life(p) {
  if (!p.con_song) return `${p.nam_sinh || '?'} – ${p.nam_mat || '?'}`;
  return p.nam_sinh ? `Sinh ${p.nam_sinh}` : '';
}
const parentWord = (p) => (p.gioi_tinh === 'nam' ? 'cha' : p.gioi_tinh === 'nu' ? 'mẹ' : 'cha/mẹ');
const spouseWord = (of) => (of.gioi_tinh === 'nu' ? 'chồng' : 'vợ');

// Thẻ một người, dùng chung cho sơ đồ và trang chi tiết
function pcard(m, p, { kind = '', note = '' } = {}) {
  const cls = ['pcard', kind, p.con_song ? '' : 'dead'].filter(Boolean).join(' ');
  const meta = [`Đời ${m.doi.get(p.id)}`, life(p)].filter(Boolean).join(' · ');
  return h`<a class="${cls}" href="/nguoi/${p.id}" title="${p.ho_ten}">
    <span class="av ${p.gioi_tinh}" aria-hidden="true">${initial(p)}</span>
    <span class="pc"><span class="pc-name">${p.ho_ten}</span><span class="pc-meta">${meta}</span>${note ? h`<span class="pc-note">${note}</span>` : ''}</span>
    ${p.tranh_chap ? h`<span class="dot" role="img" aria-label="Thông tin đang tranh chấp"></span>` : ''}
  </a>`;
}

// Ghi chú cho con: con nuôi/thừa tự, và con của vợ nào khi có nhiều vợ
function childNote(m, r, spouses, spouseIds) {
  const notes = [];
  if (r.kieu !== 'ruot') notes.push(`con ${d.KIEU_CON[r.kieu]}`);
  if (spouses.length > 1) {
    const other = (m.parentsOf.get(r.b) || []).find((x) => spouseIds.has(x.a));
    if (other) { const op = m.byId.get(other.a); notes.push(`${parentWord(op)}: ${op.ho_ten.split(/\s+/).pop()}`); }
  }
  return notes.join(' · ');
}

function chartNode(m, p, onPath, note = '') {
  if (onPath.has(p.id)) return '';
  onPath.add(p.id);
  const spouses = m.spousesOf.get(p.id) || [];
  const kids = m.childrenOf.get(p.id) || [];
  const spouseIds = new Set(spouses.map((s) => s.other));
  const unit = h`<div class="unit">${pcard(m, p, { note })}${spouses.map((s) =>
    pcard(m, m.byId.get(s.other), { kind: 'spouse', note: `${spouseWord(p)}${spouses.length > 1 && s.thu_tu ? ` ${s.thu_tu}` : ''}` }))}</div>`;
  const children = kids.map((r) => chartNode(m, m.byId.get(r.b), onPath, childNote(m, r, spouses, spouseIds)));
  onPath.delete(p.id);
  return h`<li>${unit}${kids.length ? h`<button type="button" class="fold" aria-expanded="true" data-n="${kids.length}">− ${kids.length} con</button><ul>${children}</ul>` : ''}</li>`;
}

function outlineNode(m, p, depth, onPath, note = '') {
  if (onPath.has(p.id)) return '';
  onPath.add(p.id);
  const spouses = m.spousesOf.get(p.id) || [];
  const kids = m.childrenOf.get(p.id) || [];
  const spouseIds = new Set(spouses.map((s) => s.other));
  const row = (caret) => h`<span class="row-person">${caret}<a class="name" href="/nguoi/${p.id}">${p.ho_ten}</a>
    <span class="sub">Đời ${m.doi.get(p.id)}${life(p) ? ` · ${life(p)}` : ''}${p.chi ? ` · ${p.chi}` : ''}${note ? ` · ${note}` : ''}</span>
    ${p.tranh_chap ? h`<span class="chip warn">đang tranh chấp</span>` : ''}
    ${spouses.length ? h`<span class="sub" style="flex-basis:100%;padding-left:1rem">${spouses.map((s, i) => h`${i ? ', ' : ''}${spouseWord(p)}${spouses.length > 1 && s.thu_tu ? ` ${s.thu_tu}` : ''}: <a href="/nguoi/${s.other}">${m.byId.get(s.other).ho_ten}</a>`)}</span>` : ''}
  </span>`;
  const children = kids.map((r) => outlineNode(m, m.byId.get(r.b), depth + 1, onPath, childNote(m, r, spouses, spouseIds)));
  onPath.delete(p.id);
  if (!kids.length) return h`<li>${row(h`<span class="caret"></span>`)}</li>`;
  return h`<li><details ${depth < 3 ? raw('open') : ''}><summary>${row(h`<span class="caret" aria-hidden="true">›</span>`)}</summary><ul>${children}</ul></details></li>`;
}

// Lời nhắn để gửi vào nhóm Zalo / Messenger của họ
const gioMessage = (x) => `Kính báo: giỗ ${x.p.ho_ten} vào ${weekday(x.jd)}, ngày ${dmy(x.date)} (tức ${solarToLunar(...x.date)[0]}/${x.p.gio_thang} âm lịch). ${TEN_HO}.`;
const shareBtn = (x) => h`<button type="button" class="btn small quiet share" data-share="${gioMessage(x)}">Báo cho họ hàng</button>`;

function gioItem(x, today) {
  const actualDay = solarToLunar(...x.date)[0];
  const left = x.jd - today;
  return h`<li class="gio ${left === 0 ? 'today' : ''}">
    <div class="gio-date"><b>${x.date[0]}</b><span>Th${x.date[1]}</span></div>
    <div><a class="gio-name" href="/nguoi/${x.p.id}">${x.p.ho_ten}</a>
      <span class="gio-sub">${weekday(x.jd)}, ${dmy(x.date)} · ${x.p.gio_ngay}/${x.p.gio_thang} âm lịch${actualDay !== x.p.gio_ngay ? ` (tháng thiếu, làm ngày ${actualDay})` : ''}</span></div>
    <span class="gio-count">${left === 0 ? 'Hôm nay' : `còn ${left} ngày`}<br>${shareBtn(x)}</span>
  </li>`;
}

const SEARCH_ICON = raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>');

function personOptions(m, excludeId) {
  return [...m.people].filter((p) => p.id !== excludeId).sort((a, b) => a.ho_ten.localeCompare(b.ho_ten, 'vi'))
    .map((p) => h`<option value="${p.id}">${p.ho_ten} (đời ${m.doi.get(p.id)}${p.nam_sinh ? `, ${p.nam_sinh}` : ''})</option>`);
}

function personForm(action, p = {}, extraHidden = '') {
  const v = (k) => p[k] ?? '';
  return h`<form method="post" action="${action}">${extraHidden}
    <label for="ho_ten">Họ và tên *</label><input id="ho_ten" name="ho_ten" type="text" required maxlength="200" value="${v('ho_ten')}">
    <div class="grid-form">
      <div><label for="gioi_tinh">Giới tính</label><select id="gioi_tinh" name="gioi_tinh">
        ${[['', '—'], ['nam', 'Nam'], ['nu', 'Nữ']].map(([val, t]) => h`<option value="${val}" ${v('gioi_tinh') === val ? raw('selected') : ''}>${t}</option>`)}
      </select></div>
      <div><label for="chi">Chi / nhánh</label><input id="chi" name="chi" type="text" maxlength="100" value="${v('chi')}"></div>
      <div><label for="doi">Đời <span class="muted" style="font-weight:400">(trống = tự tính)</span></label><input id="doi" name="doi" type="number" min="1" max="200" value="${v('doi')}"></div>
    </div>
    <div class="grid-form">
      <div><label for="nam_sinh">Năm sinh</label><input id="nam_sinh" name="nam_sinh" type="text" maxlength="50" value="${v('nam_sinh')}"></div>
      <div><label for="nam_mat">Năm mất</label><input id="nam_mat" name="nam_mat" type="text" maxlength="50" value="${v('nam_mat')}"></div>
      <div><label for="gio_ngay">Giỗ: ngày (âm)</label><input id="gio_ngay" name="gio_ngay" type="number" min="1" max="30" value="${v('gio_ngay')}"></div>
      <div><label for="gio_thang">Giỗ: tháng (âm)</label><input id="gio_thang" name="gio_thang" type="number" min="1" max="12" value="${v('gio_thang')}"></div>
    </div>
    <label for="ngay_mat_duong">Chỉ biết ngày mất theo dương lịch? <span class="muted" style="font-weight:400">Nhập ngày/tháng/năm, để trống ô giỗ âm, sẽ tự đổi ra ngày giỗ</span></label>
    <input id="ngay_mat_duong" name="ngay_mat_duong" type="text" inputmode="numeric" placeholder="ví dụ 12/3/1995" maxlength="10" style="max-width:14rem">
    <label class="check"><input type="checkbox" name="con_song" ${p.con_song === 0 ? '' : raw('checked')}>Còn sống</label>
    <label class="check"><input type="checkbox" name="tranh_chap" ${p.tranh_chap ? raw('checked') : ''}>Thông tin đang tranh chấp / chưa chắc chắn</label>
    <label for="ghi_chu">Ghi chú</label><textarea id="ghi_chu" name="ghi_chu" rows="4" maxlength="5000">${v('ghi_chu')}</textarea>
    <p class="actions"><button class="btn">Lưu</button></p>
  </form>`;
}

// ---------- Các trang ----------
const routes = [];
const route = (method, pattern, role, fn) => routes.push({ method, pattern, role, fn });

route('GET', /^\/$/, 'xem', async (req, res, who, _m, url) => {
  const m = (await d.loadAll(db));
  const today = d.todayJd();
  const soon = d.upcomingGio(m.people, today, 60);
  const view = url.searchParams.get('xem') === 'ds' ? 'ds' : 'so-do';
  const soDoi = Math.max(0, ...m.doi.values());
  const soChi = new Set(m.people.map((p) => p.chi).filter(Boolean)).size;
  const roots = d.roots(m);
  const [first, ...rest] = soon;

  const hero = h`<section class="hero">
    <h1>${TEN_HO}</h1>
    <ul class="stats">
      <li><b>${m.people.length}</b><span>người</span></li>
      <li><b>${soDoi}</b><span>đời</span></li>
      ${soChi ? h`<li><b>${soChi}</b><span>chi</span></li>` : ''}
      <li><b>${m.people.filter((p) => !p.con_song).length}</b><span>người đã khuất</span></li>
    </ul>
    <form class="search" action="/tim" method="get" role="search">${SEARCH_ICON}
      <input name="q" type="search" placeholder="Tìm tên, không cần dấu" aria-label="Tìm người"></form>
  </section>`;

  const next = h`<section class="panel next" aria-labelledby="gio-sap-toi">
    <div class="next-head"><h2 id="gio-sap-toi">Giỗ sắp tới</h2><a class="link" href="/gio">Cả năm</a></div>
    ${first ? h`
      <div class="next-feature">
        <span class="countdown">${first.jd === today ? h`<b>Nay</b><span>hôm nay</span>` : h`<b>${first.jd - today}</b><span>ngày nữa</span>`}</span>
        <span><a href="/nguoi/${first.p.id}"><strong>Giỗ ${first.p.ho_ten}</strong></a><span class="muted">${weekday(first.jd)}, ${dmy(first.date)} · ${first.p.gio_ngay}/${first.p.gio_thang} âm lịch</span>
          <span style="display:block;margin-top:.5rem">${shareBtn(first)}</span></span>
      </div>
      ${rest.length ? h`<ul class="gio-list">${rest.slice(0, 3).map((x) => gioItem(x, today))}</ul>` : ''}`
    : h`<p class="muted">Không có giỗ nào trong 60 ngày tới.</p>`}
  </section>`;

  const tree = !m.people.length
    ? h`<div class="panel empty"><h2>Gia phả còn trống</h2>
        <p class="muted">Bắt đầu từ cụ tổ, rồi thêm dần con cháu. Nếu đã chép sổ gia phả ra Excel thì nhập một lần là xong.</p>
        ${who.role === 'sua' ? h`<p class="actions" style="justify-content:center"><a class="btn" href="/them">Thêm cụ tổ</a><a class="btn ghost" href="/nhap">Nhập từ Excel</a></p>` : ''}</div>`
    : h`<section aria-labelledby="cay">
        <div class="tree-head">
          <h2 id="cay">Cây gia phả</h2>
          <div class="tabs" role="tablist">
            <a href="/" ${view === 'so-do' ? raw('aria-current="page"') : ''}>Sơ đồ</a>
            <a href="/?xem=ds" ${view === 'ds' ? raw('aria-current="page"') : ''}>Danh sách</a>
          </div>
        </div>
        ${view === 'so-do' ? h`
          <div class="tree-head no-print">
            <div class="legend"><span><i class="l-blood"></i>Người trong họ</span><span><i class="l-spouse"></i>Dâu, rể</span><span><i class="l-dead"></i>Đã khuất (ảnh xám)</span></div>
            <div class="tools"><button type="button" data-zoom="out" aria-label="Thu nhỏ">−</button><button type="button" data-zoom="in" aria-label="Phóng to">+</button><button type="button" class="wide" data-zoom="fit">Vừa khung</button></div>
          </div>
          <div class="chart-wrap" tabindex="0" aria-label="Sơ đồ cây gia phả, kéo để di chuyển"><div class="chart"><ul>${roots.map((p) => chartNode(m, p, new Set()))}</ul></div></div>`
        : h`<div class="panel"><ul class="outline">${roots.map((p) => outlineNode(m, p, 0, new Set()))}</ul></div>`}
      </section>`;

  page(res, who, 'Cây gia phả', h`<div class="home-top">${hero}${next}</div>${tree}`);
});

route('GET', /^\/tim$/, 'xem', async (req, res, who, _m, url) => {
  const q = url.searchParams.get('q') || '';
  const m = (await d.loadAll(db));
  const key = plain(q).trim();
  const found = key ? m.people.filter((p) => plain(p.ho_ten).includes(key)) : [];
  page(res, who, 'Tìm kiếm', h`<div class="narrow">
    <form class="search" action="/tim" method="get" role="search" style="max-width:none;margin-bottom:1.5rem">${SEARCH_ICON}
      <input name="q" type="search" value="${q}" placeholder="Tìm người trong họ" aria-label="Tìm người" autofocus></form>
    <h1 style="font-size:1.4rem;margin-bottom:1rem">${found.length} kết quả cho “${q}”</h1>
    ${found.length ? h`<div class="cards">${found.map((p) => pcard(m, p))}</div>` : h`<p class="muted">Không thấy ai có tên như vậy. Thử gõ ít chữ hơn, ví dụ chỉ tên gọi.</p>`}
  </div>`);
});

route('GET', /^\/nguoi\/(\d+)$/, 'xem', async (req, res, who, [, id]) => {
  const m = (await d.loadAll(db));
  const p = m.byId.get(Number(id));
  if (!p) return errorPage(res, who, 'Không tìm thấy người này', 404);
  const isEditor = who.role === 'sua';
  const parents = m.parentsOf.get(p.id) || [];
  const spouses = m.spousesOf.get(p.id) || [];
  const kids = m.childrenOf.get(p.id) || [];
  const spouseIds = new Set(spouses.map((s) => s.other));
  const today = d.todayJd();
  const next = d.upcomingGio([p], today, 400)[0];

  const group = (title, items, emptyText) => h`<section><h2>${title}</h2>
    ${items.length ? h`<div class="cards">${items}</div>` : h`<p class="empty-line">${emptyText}</p>`}</section>`;

  const editor = !isEditor ? '' : h`
    <details class="editor no-print"><summary>Chỉnh sửa ${p.ho_ten}</summary>
      <div class="editor-grid">
        <div class="actions" style="margin:0"><a class="btn" href="/them?con_cua=${p.id}">+ Thêm con</a><a class="btn ghost" href="/them?vo_chong=${p.id}">+ Thêm ${spouseWord(p)}</a></div>
        <div class="panel"><h2 style="font-size:1.1rem">Thông tin</h2>${personForm(`/nguoi/${p.id}/sua`, p)}</div>
        <div class="panel"><h2 style="font-size:1.1rem">Nối với người đã có trong cây</h2>
          <form method="post" action="/nguoi/${p.id}/quan-he">
            <div class="grid-form">
              <div><label for="vai">Người kia là</label><select id="vai" name="vai">
                <option value="cha_me">cha / mẹ của ${p.ho_ten}</option>
                <option value="con">con của ${p.ho_ten}</option>
                <option value="vo_chong">vợ / chồng của ${p.ho_ten}</option></select></div>
              <div><label for="khac">Người</label><select id="khac" name="khac" required>${personOptions(m, p.id)}</select></div>
              <div><label for="kieu">Kiểu con</label><select id="kieu" name="kieu">
                ${Object.entries(d.KIEU_CON).map(([k, t]) => h`<option value="${k}">${t}</option>`)}</select></div>
              <div><label for="thu_tu">Thứ tự vợ</label><input id="thu_tu" name="thu_tu" type="number" min="1" max="20" placeholder="1, 2…"></div>
            </div>
            <p class="actions"><button class="btn">Nối</button></p>
          </form>
          ${parents.length + spouses.length + kids.length ? h`<h3 style="font-size:1rem;margin:1.25rem 0 .4rem">Quan hệ hiện có</h3><ul class="rel-list">
            ${parents.map((r) => relRow(m, p, r.a, `${parentWord(m.byId.get(r.a))}${r.kieu === 'ruot' ? '' : ` (${d.KIEU_CON[r.kieu]})`}`, r.id))}
            ${spouses.map((s) => relRow(m, p, s.other, `${spouseWord(p)}${s.thu_tu ? ` thứ ${s.thu_tu}` : ''}`, s.id))}
            ${kids.map((r) => relRow(m, p, r.b, `con${r.kieu === 'ruot' ? '' : ` ${d.KIEU_CON[r.kieu]}`}`, r.id))}
          </ul>` : ''}
        </div>
        <form method="post" action="/nguoi/${p.id}/xoa" data-confirm="Xóa ${p.ho_ten} và mọi quan hệ của người này? Nhật ký vẫn giữ bản cũ.">
          <button class="btn danger">Xóa người này</button></form>
      </div>
    </details>`;

  page(res, who, p.ho_ten, h`<div class="narrow">
    <div class="profile">
      <span class="av ${p.gioi_tinh}" aria-hidden="true">${initial(p)}</span>
      <div><h1>${p.ho_ten}</h1>
        <div class="chips">
          <span class="chip accent">Đời ${m.doi.get(p.id)}${p.doi ? ' (ghi tay)' : ''}</span>
          ${p.chi ? h`<span class="chip">${p.chi}</span>` : ''}
          ${p.gioi_tinh ? h`<span class="chip">${p.gioi_tinh === 'nam' ? 'Nam' : 'Nữ'}</span>` : ''}
          <span class="chip">${p.con_song ? 'Còn sống' : 'Đã khuất'}</span>
          ${p.tranh_chap ? h`<span class="chip warn">Thông tin đang tranh chấp</span>` : ''}
        </div></div>
    </div>
    <dl class="facts">
      <div class="fact"><dt>Năm sinh</dt><dd>${p.nam_sinh || '—'}</dd></div>
      ${p.con_song ? '' : h`<div class="fact"><dt>Năm mất</dt><dd>${p.nam_mat || '—'}</dd></div>`}
      ${p.gio_ngay ? h`<div class="fact"><dt>Ngày giỗ</dt><dd>${p.gio_ngay}/${p.gio_thang} âm lịch
        ${next ? h`<small>Lần tới: ${weekday(next.jd)}, ${dmy(next.date)}${next.jd === today ? ' (hôm nay)' : ` · còn ${next.jd - today} ngày`}</small>` : ''}</dd></div>` : ''}
    </dl>
    ${p.ghi_chu ? h`<p class="note-text">${p.ghi_chu}</p>` : ''}
    <div class="family">
      ${group('Cha mẹ', parents.map((r) => pcard(m, m.byId.get(r.a), { note: r.kieu === 'ruot' ? '' : `${d.KIEU_CON[r.kieu]}` })), 'Chưa có trong cây.')}
      ${group(spouses.length > 1 ? `Các ${spouseWord(p)}` : spouseWord(p) === 'vợ' ? 'Vợ' : 'Chồng', spouses.map((s) => pcard(m, m.byId.get(s.other), { kind: 'spouse', note: s.thu_tu ? `${spouseWord(p)} thứ ${s.thu_tu}` : '' })), 'Chưa có.')}
      ${group(`Con${kids.length ? ` (${kids.length})` : ''}`, kids.map((r) => pcard(m, m.byId.get(r.b), { note: childNote(m, r, spouses, spouseIds) })), 'Chưa có.')}
    </div>
    ${editor}
  </div>`);
});

function relRow(m, p, otherId, text, relId) {
  return h`<li><span><a class="link" href="/nguoi/${otherId}">${m.byId.get(otherId).ho_ten}</a> <span class="muted">· ${text}</span></span>
    <form method="post" action="/quan-he/${relId}/xoa" data-confirm="Bỏ quan hệ này?"><input type="hidden" name="ve" value="${p.id}"><button class="btn small quiet">Bỏ</button></form></li>`;
}

route('POST', /^\/nguoi\/(\d+)\/sua$/, 'sua', async (req, res, who, [, id], _url, body) => {
  await d.updatePerson(db, Number(id), body, who.name);
  redirect(res, `/nguoi/${id}`);
});

route('POST', /^\/nguoi\/(\d+)\/xoa$/, 'sua', async (req, res, who, [, id]) => {
  await d.deletePerson(db, Number(id), who.name);
  redirect(res, '/');
});

function relationFrom(id, vai, khac, kieu, thu_tu) {
  if (vai === 'cha_me') return { loai: 'cha_me', a: khac, b: id, kieu };
  if (vai === 'con') return { loai: 'cha_me', a: id, b: khac, kieu };
  if (vai === 'vo_chong') return { loai: 'vo_chong', a: id, b: khac, thu_tu };
  throw new Error('Quan hệ không hợp lệ');
}

route('POST', /^\/nguoi\/(\d+)\/quan-he$/, 'sua', async (req, res, who, [, id], _url, b) => {
  const thuTu = b.thu_tu ? Number(b.thu_tu) : null;
  if (thuTu !== null && !(Number.isInteger(thuTu) && thuTu >= 1 && thuTu <= 20)) throw new Error('Thứ tự vợ phải từ 1 đến 20');
  await d.addRelation(db, relationFrom(Number(id), b.vai, Number(b.khac), b.kieu || 'ruot', thuTu), who.name);
  redirect(res, `/nguoi/${id}`);
});

route('POST', /^\/quan-he\/(\d+)\/xoa$/, 'sua', async (req, res, who, [, id], _url, b) => {
  await d.deleteRelation(db, Number(id), who.name);
  redirect(res, /^\d+$/.test(b.ve || '') ? `/nguoi/${b.ve}` : '/');
});

route('GET', /^\/them$/, 'sua', async (req, res, who, _m, url) => {
  const m = (await d.loadAll(db));
  const conCua = m.byId.get(Number(url.searchParams.get('con_cua')));
  const voChong = m.byId.get(Number(url.searchParams.get('vo_chong')));
  const link = conCua ? h`<input type="hidden" name="con_cua" value="${conCua.id}">`
    : voChong ? h`<input type="hidden" name="vo_chong" value="${voChong.id}">` : '';
  const title = conCua ? `Thêm con của ${conCua.ho_ten}` : voChong ? `Thêm ${spouseWord(voChong)} của ${voChong.ho_ten}` : 'Thêm người';
  page(res, who, title, h`<div class="narrow"><h1 style="margin-bottom:1rem">${title}</h1>
    <div class="panel">${personForm('/them', voChong ? { gioi_tinh: voChong.gioi_tinh === 'nam' ? 'nu' : voChong.gioi_tinh === 'nu' ? 'nam' : '' } : {}, link)}</div></div>`);
});

route('POST', /^\/them$/, 'sua', async (req, res, who, _m, _url, b) => {
  const link = b.con_cua ? { loai: 'cha_me', voi: b.con_cua } : b.vo_chong ? { loai: 'vo_chong', voi: b.vo_chong } : null;
  const id = await d.createPerson(db, b, who.name, link);
  redirect(res, `/nguoi/${id}`);
});

route('GET', /^\/gio$/, 'xem', async (req, res, who, _m, url) => {
  const m = (await d.loadAll(db));
  const today = d.todayJd();
  const list = d.upcomingGio(m.people, today, 366);
  const icsUrl = `${url.protocol}//${url.host}/gio.ics?t=${await icsToken}`;
  const byMonth = new Map();
  for (const x of list) {
    const k = `Tháng ${x.date[1]}/${x.date[2]}`;
    (byMonth.get(k) || byMonth.set(k, []).get(k)).push(x);
  }
  page(res, who, 'Ngày giỗ', h`<div class="narrow">
    <h1 style="font-size:2rem">Ngày giỗ trong 12 tháng tới</h1>
    <p class="muted">Ngày dương lịch đã đổi sẵn từ ngày âm, theo múi giờ Việt Nam.</p>
    <div class="panel no-print" style="margin:1.25rem 0">
      <h2 style="font-size:1.1rem">Nhắc giỗ trên điện thoại</h2>
      <p class="muted" style="margin:.4rem 0 .8rem">Chép link này, mở Lịch trên iPhone hoặc Google Calendar, chọn <em>Thêm lịch qua URL</em> rồi dán vào. Ngày giỗ sẽ tự hiện trong lịch hằng năm.</p>
      <div style="display:flex;gap:.5rem"><input id="ics" type="text" readonly value="${icsUrl}" aria-label="Link lịch giỗ"><button class="btn" type="button" data-copy="ics">Chép</button></div>
    </div>
    ${list.length ? [...byMonth].map(([k, xs]) => h`<h2 class="month-label">${k}</h2><ul class="gio-list panel" style="padding:.25rem 1rem">${xs.map((x) => gioItem(x, today))}</ul>`)
      : h`<div class="panel empty"><h2>Chưa có ngày giỗ</h2><p class="muted">Ghi ngày mất (âm lịch) cho các cụ ở trang từng người, lịch giỗ sẽ tự hiện ở đây.</p></div>`}
  </div>`);
});

route('GET', /^\/gio\.ics$/, null, async (req, res, who, _m, url) => {
  if (!(await safeEq(url.searchParams.get('t') || '', await icsToken))) return send(res, 403, 'text/plain; charset=utf-8', 'Sai link');
  send(res, 200, 'text/calendar; charset=utf-8', d.toIcs((await d.loadAll(db)).people, d.todayJd()));
});

function importPage(res, who, csv = '', result = null) {
  page(res, who, 'Nhập / Xuất', h`<div class="narrow">
    <h1 style="font-size:2rem;margin-bottom:1.25rem">Nhập / Xuất dữ liệu</h1>
    <section class="panel" style="margin-bottom:1.25rem">
      <h2 style="font-size:1.2rem">Sao lưu</h2>
      <p class="muted">Nên tải bản sao lưu về máy sau mỗi đợt sửa lớn. File Excel (CSV) nhập lại được ở dưới. File GEDCOM mở được bằng phần mềm gia phả khác (Gramps, MyHeritage...).</p>
      <p class="actions"><a class="btn" href="/xuat.csv">Tải Excel (CSV)</a><a class="btn ghost" href="/xuat.ged">Tải GEDCOM</a></p>
    </section>
    <section class="panel">
      <h2 style="font-size:1.2rem">Nhập từ Excel hoặc GEDCOM</h2>
      <p class="muted">Đang dùng MyHeritage, FamilySearch, Gramps, GensTree? Xuất file <strong>GEDCOM (.ged)</strong> ở đó rồi nhập vào đây. Ngày mất dương lịch trong file sẽ tự đổi ra ngày giỗ âm lịch.</p>
      <p class="muted">Với Excel: lưu file dạng <strong>CSV UTF-8</strong>, đúng các cột như <a href="/mau.csv">file mẫu</a>. Người có <code>ma</code> trùng với người đã có sẽ được cập nhật, mã mới thì thêm người mới. Chỉ cần một dòng lỗi là không ghi gì cả.</p>
      <ul class="muted" style="font-size:.92rem">
        <li><code>gio_am</code>: ngày/tháng âm lịch, ví dụ <code>15/3</code></li>
        <li><code>ma_cha_me</code>: mã cha mẹ, cách nhau bằng <code>;</code>. Con nuôi ghi <code>P9:nuoi</code>, con thừa tự ghi <code>P9:thua_tu</code></li>
        <li><code>ma_vo_chong</code>: ví dụ <code>P2:1;P3:2</code> (vợ cả, vợ hai)</li>
        <li><code>gioi_tinh</code>: <code>nam</code> / <code>nu</code>. <code>con_song</code>, <code>tranh_chap</code>: <code>1</code> / <code>0</code></li>
      </ul>
      ${result?.ok ? h`<p class="notice" role="status">Đã nhập: thêm ${result.ok.them} người, cập nhật ${result.ok.sua}, ${result.ok.quan_he} quan hệ. <a href="/">Xem cây</a></p>` : ''}
      ${result?.errors ? h`<div class="notice warn" role="alert"><strong>Chưa ghi gì, vì có lỗi:</strong><ul>${result.errors.map((e) => h`<li>${e}</li>`)}</ul></div>` : ''}
      <form method="post" action="/nhap">
        <label for="csv-file">Chọn file CSV hoặc GEDCOM</label><input id="csv-file" type="file" accept=".csv,.ged,text/csv">
        <label for="csv">hoặc dán nội dung vào đây</label><textarea id="csv" name="csv" rows="10" required>${csv}</textarea>
        <p class="actions"><button class="btn">Nhập</button></p>
      </form>
    </section></div>`);
}

route('GET', /^\/du-lieu$/, 'xem', async (req, res, who) => {
  const backupStatus = who.role === 'sua' ? await platform.backup.status() : '';
  page(res, who, 'Dữ liệu của dòng họ', h`<div class="narrow">
    <h1 style="font-size:2rem">Dữ liệu này thuộc về dòng họ</h1>
    <p class="muted" style="max-width:62ch">Gia phả là thứ phải giữ cả trăm năm, lâu hơn bất kỳ phần mềm hay công ty nào. Vì vậy trang này cam kết:</p>
    <div class="facts" style="grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))">
      <div class="fact"><dt>Không khoá, không xoá</dt><dd style="font-size:1rem;font-family:var(--sans)">Không có chuyện hết hạn gói là khoá trang hay xoá dữ liệu.</dd></div>
      <div class="fact"><dt>Xuất bất cứ lúc nào</dt><dd style="font-size:1rem;font-family:var(--sans)">Tải toàn bộ ra Excel (CSV) hoặc GEDCOM, chuẩn chung mà mọi phần mềm gia phả đều đọc được.</dd></div>
      <div class="fact"><dt>Tự sao lưu</dt><dd style="font-size:1rem;font-family:var(--sans)">${platform.backup.fact}</dd></div>
      <div class="fact"><dt>Chuyển đến dễ dàng</dt><dd style="font-size:1rem;font-family:var(--sans)">Nhập được file GEDCOM từ MyHeritage, FamilySearch, Gramps, GensTree, hoặc file Excel.</dd></div>
    </div>
    ${who.role === 'sua' ? h`
      <section class="panel" style="margin-top:1.5rem">
        <h2 style="font-size:1.2rem">Tải bản sao lưu</h2>
        <p class="actions"><a class="btn" href="/xuat.csv">Tải Excel (CSV) mới nhất</a><a class="btn ghost" href="/xuat.ged">Tải GEDCOM mới nhất</a></p>
        <p class="muted" style="margin-top:1rem">${backupStatus}</p>
      </section>` : h`<p class="muted" style="margin-top:1.5rem">Người giữ sổ (có mật khẩu sửa) tải được bản sao lưu đầy đủ ở trang này.</p>`}
  </div>`);
});

route('GET', /^\/nhap$/, 'sua', async (req, res, who) => importPage(res, who));
route('POST', /^\/nhap$/, 'sua', async (req, res, who, _m, _url, b) => {
  try {
    importPage(res, who, '', { ok: await d.importAny(db, b.csv || '', who.name) });
  } catch (e) {
    importPage(res, who, b.csv, { errors: e.errors || [e.message] });
  }
});

const stamp = () => new Date().toISOString().slice(0, 10);
route('GET', /^\/xuat\.csv$/, 'sua', async (req, res) => send(res, 200, 'text/csv; charset=utf-8', d.toCsv((await d.loadAll(db))),
  { 'Content-Disposition': `attachment; filename="giapha-${stamp()}.csv"` }));
route('GET', /^\/xuat\.ged$/, 'sua', async (req, res) => send(res, 200, 'text/plain; charset=utf-8', d.toGedcom((await d.loadAll(db))),
  { 'Content-Disposition': `attachment; filename="giapha-${stamp()}.ged"` }));
route('GET', /^\/mau\.csv$/, 'sua', async (req, res) => send(res, 200, 'text/csv; charset=utf-8',
  '﻿' + [d.CSV_COLS.join(','),
    'P1,Nguyễn Văn A,nam,,1,1900,1970,15/3,0,0,,P2:1,Cụ tổ',
    'P2,Trần Thị B,nu,,,1905,1980,2/8,0,0,,P1,',
    'P3,Nguyễn Văn C,nam,Chi 1,,1930,,,1,0,"P1;P2",,'].join('\r\n') + '\r\n',
  { 'Content-Disposition': 'attachment; filename="mau-gia-pha.csv"' }));

route('GET', /^\/nhat-ky$/, 'sua', async (req, res, who) => {
  const rows = await db.all('SELECT * FROM nhat_ky ORDER BY id DESC LIMIT 300');
  page(res, who, 'Nhật ký', h`<div class="narrow"><h1 style="font-size:2rem">Nhật ký sửa đổi</h1>
    <p class="muted">300 lần sửa gần nhất. Nhật ký chỉ ghi thêm, không ai sửa hay xóa được.</p>
    <div class="panel"><table class="log">${rows.map((r) => h`<tr><td class="muted num" style="white-space:nowrap">${new Date(r.luc).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td>
      <td>${r.ai}</td><td>${r.viec}<details><summary class="muted">chi tiết</summary><pre>${r.chi_tiet}</pre></details></td></tr>`)}</table></div></div>`);
});

route('GET', /^\/dang-nhap$/, null, async (req, res) => loginPage(res));
route('POST', /^\/dang-nhap$/, null, async (req, res, _who, _m, _url, b, info) => {
  const ip = info.ip || 'khong-ro';
  if (await locked(ip)) return loginPage(res, 'Sai quá nhiều lần, thử lại sau 15 phút', 429);
  const mk = b.mat_khau || '';
  const role = (await safeEq(mk, MK_SUA)) ? 'sua' : (await safeEq(mk, MK_XEM)) ? 'xem' : null;
  if (!role) { await noteFail(ip); return loginPage(res, 'Sai mật khẩu', 401); }
  await clearFails(ip);
  const name = String(b.ten || '').trim().slice(0, 60) || (role === 'sua' ? 'người sửa' : 'người xem');
  redirect(res, '/', { 'Set-Cookie': await sessionCookie(role, name) });
});
route('POST', /^\/dang-xuat$/, null, async (req, res) => redirect(res, '/dang-nhap', { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` }));

// ---------- Xử lý một request ----------
const MAX_BODY = 5 * 1024 * 1024;

// res giả: các hàm page/send/redirect ở trên ghi vào đây, cuối cùng đổi thành Response
function makeRes(path) {
  const r = { status: 200, headers: {}, body: null, headersSent: false, activePath: path };
  r.writeHead = (status, headers) => { r.status = status; r.headers = headers; r.headersSent = true; };
  r.end = (body) => { r.body = body ?? null; };
  return r;
}

// info.ip: IP người gửi, do nền tảng cung cấp (Cloudflare: cf-connecting-ip)
async function handle(req, info = {}) {
  const url = new URL(req.url);
  const res = makeRes(url.pathname);
  const who = await readSession(req);
  try {
    const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
    if (!r) errorPage(res, who, 'Không có trang này', 404);
    else if (r.role && !who) redirect(res, '/dang-nhap');
    else if (r.role === 'sua' && who.role !== 'sua') errorPage(res, who, 'Cần đăng nhập bằng mật khẩu sửa', 403);
    else {
      let body = {};
      if (req.method === 'POST') {
        const text = await req.text();
        if (Number(req.headers.get('content-length') || 0) > MAX_BODY || text.length > MAX_BODY) {
          throw Object.assign(new Error('Dữ liệu gửi lên quá lớn (tối đa 5MB)'), { status: 413 });
        }
        body = Object.fromEntries(new URLSearchParams(text));
      }
      await r.fn(req, res, who, url.pathname.match(r.pattern), url, body, info);
    }
  } catch (e) {
    // Lỗi kiểm tra dữ liệu (thông báo tiếng Việt) thì trả 400, lỗi khác trả 500 và ghi log
    if (e.status || /[À-ỹ]/.test(e.message)) errorPage(res, who, e.message, e.status || 400);
    else { console.error(e); errorPage(res, who, 'Lỗi máy chủ', 500); }
  }
  return new Response(res.body, { status: res.status, headers: res.headers });
}

return { handle };
}

module.exports = { createApp, checkConfig };
