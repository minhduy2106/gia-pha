-- Người và quan hệ lưu dạng đồ thị (không dùng parent_id) để chứa được nhiều vợ, con nuôi, con thừa tự, kết hôn trong họ.
-- Dùng chung cho SQLite trên máy (db-node.js) và Cloudflare D1 (wrangler d1 migrations apply).
CREATE TABLE IF NOT EXISTS person (
  id INTEGER PRIMARY KEY,
  ma TEXT UNIQUE,
  ho_ten TEXT NOT NULL,
  gioi_tinh TEXT NOT NULL DEFAULT '',
  chi TEXT NOT NULL DEFAULT '',
  doi INTEGER,
  nam_sinh TEXT NOT NULL DEFAULT '',
  nam_mat TEXT NOT NULL DEFAULT '',
  gio_ngay INTEGER,
  gio_thang INTEGER,
  con_song INTEGER NOT NULL DEFAULT 1,
  tranh_chap INTEGER NOT NULL DEFAULT 0,
  ghi_chu TEXT NOT NULL DEFAULT ''
);

-- loai='cha_me': a là cha/mẹ của b. loai='vo_chong': luôn lưu a < b, thu_tu là vợ thứ mấy.
CREATE TABLE IF NOT EXISTS quan_he (
  id INTEGER PRIMARY KEY,
  loai TEXT NOT NULL CHECK (loai IN ('cha_me', 'vo_chong')),
  a INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kieu TEXT NOT NULL DEFAULT 'ruot' CHECK (kieu IN ('ruot', 'nuoi', 'thua_tu')),
  thu_tu INTEGER,
  UNIQUE (loai, a, b)
);

CREATE TABLE IF NOT EXISTS nhat_ky (
  id INTEGER PRIMARY KEY,
  luc TEXT NOT NULL,
  ai TEXT NOT NULL,
  viec TEXT NOT NULL,
  chi_tiet TEXT
);
CREATE TRIGGER IF NOT EXISTS nhat_ky_khong_sua BEFORE UPDATE ON nhat_ky BEGIN SELECT RAISE(ABORT, 'nhat_ky chi ghi them'); END;
CREATE TRIGGER IF NOT EXISTS nhat_ky_khong_xoa BEFORE DELETE ON nhat_ky BEGIN SELECT RAISE(ABORT, 'nhat_ky chi ghi them'); END;

-- Đếm số lần nhập sai mật khẩu theo IP; lưu trong database vì trên Cloudflare bộ nhớ không giữ được giữa các lần gọi
CREATE TABLE IF NOT EXISTS dang_nhap_sai (
  ip TEXT PRIMARY KEY,
  so_lan INTEGER NOT NULL,
  khoa_den INTEGER NOT NULL DEFAULT 0
);
