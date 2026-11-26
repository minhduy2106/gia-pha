// Chạy trên Cloudflare Pages (chế độ _worker.js) với database D1. Lõi app ở core.js.
// Cấu hình: biến GIAPHA_TEN_HO trong wrangler.toml; bí mật GIAPHA_MAT_KHAU_XEM, GIAPHA_MAT_KHAU_SUA, GIAPHA_SECRET đặt bằng `wrangler pages secret put`.
import core from './core.js';
import d1 from './db-d1.js';

const backup = {
  fact: 'Cloudflare D1 tự giữ lịch sử 30 ngày gần nhất, khôi phục được về bất kỳ thời điểm nào trong 30 ngày đó.',
  status: async () => 'Bản sao lưu tự động do Cloudflare D1 giữ (Time Travel, 30 ngày). Nên tải thêm file CSV về máy sau mỗi đợt sửa lớn.',
};

let app;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/style.css' || pathname === '/app.js') return env.ASSETS.fetch(request);
    if (!app) {
      const cfg = {
        TEN_HO: env.GIAPHA_TEN_HO,
        MK_XEM: env.GIAPHA_MAT_KHAU_XEM,
        MK_SUA: env.GIAPHA_MAT_KHAU_SUA,
        SECRET: env.GIAPHA_SECRET,
        HTTPS: true,
      };
      const problem = core.checkConfig(cfg);
      if (problem) return new Response(`Chưa cấu hình xong: ${problem}`, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      app = core.createApp({ db: d1.d1Db(env.DB), cfg, platform: { backup } });
    }
    return app.handle(request, { ip: request.headers.get('cf-connecting-ip') });
  },
};
