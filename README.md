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

## Đưa lên mạng

Cần một máy chủ chạy Node liên tục và có ổ đĩa giữ được dữ liệu, ví dụ VPS, Fly.io có volume, hoặc Railway. Vercel và Netlify không dùng được vì mất file SQLite. Đặt HTTPS phía trước (Caddy hoặc Cloudflare), và khai `GIAPHA_HTTPS=1`.

## Chưa làm

Ảnh, chữ Hán Nôm, nhận diện chữ (OCR), nhiều họ trên một máy, tài khoản riêng cho từng người, quy trình duyệt sửa, đổi mật khẩu trên web (hiện phải sửa file `.env` rồi khởi động lại).
