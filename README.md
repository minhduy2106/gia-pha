# Gia phả

Web quản lý gia phả cho một dòng họ. Chỉ cần Node 22.13 trở lên, không có dependency.

Tính năng:
- Cây gia phả xem tốt trên điện thoại, tự tính đời, ghi được nhiều vợ, con nuôi, con thừa tự.
- Lịch giỗ âm lịch (múi giờ Việt Nam, UTC+7), xem các giỗ sắp tới và đồng bộ vào lịch điện thoại qua link `.ics`. Lịch nhắc trước 1 tuần và trước 1 ngày.
- Chỉ biết ngày mất dương lịch thì tự đổi ra ngày giỗ âm lịch.
- Nút "Báo cho họ hàng": gửi lời nhắc giỗ qua Zalo hoặc Messenger (trên điện thoại), hoặc chép lời nhắn (trên máy tính).
- Nhập từ Excel (CSV) hoặc GEDCOM (MyHeritage, FamilySearch, Gramps, GensTree...). Xuất ra CSV và GEDCOM; xuất rồi nhập lại không mất thông tin. In hoặc lưu PDF bằng nút In.
- Tự sao lưu mỗi ngày vào `data/backups`, giữ 30 ngày gần nhất.
- Hai mật khẩu: mật khẩu xem gửi cho cả họ, mật khẩu sửa chỉ 1-2 người giữ sổ biết.
- Nhật ký sửa đổi chỉ ghi thêm, không sửa hay xóa được.
- Đánh dấu được thông tin đang tranh chấp.

## Chạy

```bash
cp .env.example .env   # rồi đổi 2 mật khẩu
npm start              # http://localhost:3000
npm test
```

Dữ liệu nằm trong thư mục `data/` (file SQLite `giapha.db` và khóa ký cookie `secret`). Sao lưu thì chép cả thư mục này, hoặc tải file CSV ở trang Nhập/Xuất.

## Cấu trúc

- `core.js`: lõi app (trang, đăng nhập, phân quyền). Nhận `Request`, trả `Response` theo chuẩn Web, nên chạy được ở cả 2 nơi.
- `data.js`, `lunar.js`: dữ liệu gia phả, âm lịch, CSV/GEDCOM/iCalendar.
- `server.js` + `db-node.js`: chạy trên máy (Node + SQLite).
- `worker.js` + `db-d1.js`: chạy trên Cloudflare Pages + D1.
- `migrations/`: cấu trúc database, dùng chung cho cả SQLite và D1.

## Đưa lên Cloudflare (Pages + D1)

Làm một lần:

```bash
npx wrangler login
npx wrangler d1 create giapha            # chép database_id vào wrangler.toml
npx wrangler d1 migrations apply giapha --remote
npx wrangler pages project create sogiapha --production-branch main
npx wrangler pages secret put GIAPHA_MAT_KHAU_XEM --project-name sogiapha
npx wrangler pages secret put GIAPHA_MAT_KHAU_SUA --project-name sogiapha
openssl rand -hex 32 | npx wrangler pages secret put GIAPHA_SECRET --project-name sogiapha
```

Sau đó mỗi lần deploy: `npm run deploy`, hoặc push lên `main` để GitHub Actions tự deploy (cần secret `CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID` trong repo).

D1 tự giữ lịch sử 30 ngày (Time Travel), khôi phục được bằng `npx wrangler d1 time-travel restore giapha --timestamp=...`.

## Chưa làm

Ảnh, chữ Hán Nôm, nhận diện chữ (OCR), nhiều họ trên một máy, tài khoản riêng cho từng người, quy trình duyệt sửa, đổi mật khẩu trên web (hiện phải sửa file `.env` rồi khởi động lại).
