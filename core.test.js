// Chạy cả app qua core.handle() với D1 giả lập: giống hệt đường đi trên Cloudflare, chỉ khác database.
const test = require('node:test');
const assert = require('node:assert');
const { createApp, checkConfig } = require('./core');
const { d1Db } = require('./db-d1');
const { fakeD1 } = require('./fake-d1');

const cfg = { TEN_HO: 'Họ Thử', MK_XEM: 'xem-123456', MK_SUA: 'sua-1234567890', SECRET: 'k'.repeat(40), HTTPS: false };
const backup = { fact: 'sao lưu thử', status: async () => 'tình trạng thử' };

function setup() {
  const app = createApp({ db: d1Db(fakeD1()), cfg, platform: { backup } });
  const call = (path, { method = 'GET', body, cookie, ip = '1.1.1.1' } = {}) =>
    app.handle(new Request(`http://gia.test${path}`, {
      method,
      body: body && new URLSearchParams(body),
      headers: cookie ? { cookie } : {},
    }), { ip });
  const login = async (mk, ip) => {
    const r = await call('/dang-nhap', { method: 'POST', body: { mat_khau: mk, ten: 'Tester' }, ip });
    return [r, (r.headers.get('set-cookie') || '').split(';')[0]];
  };
  return { call, login };
}

const CSV = [
  'ma,ho_ten,gioi_tinh,nam_sinh,nam_mat,gio_am,ma_cha_me,ma_vo_chong,ghi_chu',
  'P1,Nguyễn Văn Tổ,nam,1900,1970,15/3,,P2,<script>alert(1)</script>',
  'P2,Trần Thị Cả,nu,1905,1980,30/12,,,',
  'P3,Nguyễn Văn Con,nam,1930,,,"P1;P2",,',
].join('\n');

test('checkConfig bắt cấu hình yếu', () => {
  assert.strictEqual(checkConfig(cfg), null);
  assert.match(checkConfig({ ...cfg, MK_SUA: cfg.MK_XEM }), /GIAPHA_MAT_KHAU/);
  assert.match(checkConfig({ ...cfg, SECRET: 'ngan' }), /GIAPHA_SECRET/);
});

test('luồng chính: đăng nhập, nhập file, xem cây, giỗ, thêm con, phân quyền', async () => {
  const { call, login } = setup();
  const home0 = await call('/');
  assert.strictEqual(home0.status, 303);
  assert.strictEqual(home0.headers.get('location'), '/dang-nhap');

  const [bad] = await login('sai-mat-khau');
  assert.strictEqual(bad.status, 401);
  const [ok, sua] = await login(cfg.MK_SUA);
  assert.strictEqual(ok.status, 303);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);

  const imp = await (await call('/nhap', { method: 'POST', body: { csv: CSV }, cookie: sua })).text();
  assert.match(imp, /Đã nhập: thêm 3 người, cập nhật 0, 3 quan hệ/);

  const home = await call('/', { cookie: sua });
  const html = await home.text();
  assert.strictEqual(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.strictEqual((html.match(/class="pcard/g) || []).length, 3);

  const p1 = await (await call('/nguoi/1', { cookie: sua })).text();
  assert.ok(p1.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !p1.includes('<script>alert'));

  const gio = await (await call('/gio', { cookie: sua })).text();
  const token = /gio\.ics\?t=([\w-]+)/.exec(gio)[1];
  const ics = await call(`/gio.ics?t=${token}`);
  assert.strictEqual(ics.status, 200);
  assert.match(await ics.text(), /SUMMARY:Giỗ Nguyễn Văn Tổ/);
  assert.strictEqual((await call('/gio.ics?t=sai')).status, 403);

  const added = await call('/them', { method: 'POST', body: { ho_ten: 'Cháu Mới', ngay_mat_duong: '1/5/2026', con_cua: '3' }, cookie: sua });
  assert.strictEqual(added.status, 303);
  const kid = await (await call(added.headers.get('location'), { cookie: sua })).text();
  assert.match(kid, /Đời 3/);
  assert.match(kid, /15\/3 âm lịch/);

  const [, xem] = await login(cfg.MK_XEM, '2.2.2.2');
  assert.strictEqual((await call('/', { cookie: xem })).status, 200);
  assert.strictEqual((await call('/them', { cookie: xem })).status, 403);
  assert.strictEqual((await call('/xuat.csv', { cookie: xem })).status, 403);
  assert.strictEqual((await call('/nguoi/1/xoa', { method: 'POST', cookie: xem })).status, 403);

  // cookie bị sửa chữ ký thì coi như chưa đăng nhập
  const forged = sua.slice(0, -2) + (sua.endsWith('xx') ? 'yy' : 'xx');
  assert.strictEqual((await call('/', { cookie: forged })).status, 303);

  const csv = await call('/xuat.csv', { cookie: sua });
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.strictEqual((await csv.text()).trim().split('\r\n').length, 5);

  assert.match(await (await call('/du-lieu', { cookie: sua })).text(), /tình trạng thử/);
  assert.strictEqual((await call('/khong-co')).status, 404);
});

test('sai mật khẩu 5 lần thì khoá IP đó, IP khác vẫn vào được', async () => {
  const { login } = setup();
  for (let i = 0; i < 5; i++) assert.strictEqual((await login('sai', '9.9.9.9'))[0].status, 401);
  assert.strictEqual((await login(cfg.MK_SUA, '9.9.9.9'))[0].status, 429);
  assert.strictEqual((await login(cfg.MK_SUA, '8.8.8.8'))[0].status, 303);
});
