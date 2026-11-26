const { jdFromDate, jdToDate, solarToLunar, gioJd } = require('./lunar');

// Cấu trúc bảng ở migrations/0001_init.sql. Mọi hàm đọc ghi nhận `db` có all/first/batch (xem db-node.js, db-d1.js).
// Ghi luôn gom vào một batch: trọn gói hoặc không ghi gì, chạy được trên cả SQLite và Cloudflare D1.

const KIEU_CON = { ruot: 'ruột', nuoi: 'nuôi', thua_tu: 'thừa tự' };

const logStmt = (ai, viec, chiTiet) => ({
  sql: 'INSERT INTO nhat_ky (luc, ai, viec, chi_tiet) VALUES (?, ?, ?, ?)',
  params: [new Date().toISOString(), ai, viec, JSON.stringify(chiTiet ?? null)],
});

const truthy = (v) => v === true || v === 1 || ['1', 'on', 'x', 'có', 'co'].includes(String(v ?? '').trim().toLowerCase());

function intOrNull(v, min, max, label) {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} phải là số nguyên từ ${min} đến ${max}`);
  return n;
}

function text(v, max, label) {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} dài quá ${max} ký tự`);
  return s;
}

// "12/3/1995" -> [12, 3, 1995]; để trống thì trả null, sai ngày thì báo lỗi
function parseSolarDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  const date = m && [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!date || date[2] < 1000 || date[2] > 2200 || jdToDate(jdFromDate(...date)).join() !== date.join()) {
    throw new Error(`Ngày mất dương lịch "${s}" không hợp lệ, cần dạng ngày/tháng/năm, ví dụ 12/3/1995`);
  }
  return date;
}

// Kiểm tra dữ liệu người từ form hoặc từ file nhập
function cleanPerson(input) {
  const ho_ten = text(input.ho_ten, 200, 'Họ tên');
  if (!ho_ten) throw new Error('Thiếu họ tên');
  const gioi_tinh = String(input.gioi_tinh ?? '').trim().toLowerCase();
  if (!['nam', 'nu', ''].includes(gioi_tinh)) throw new Error('Giới tính phải là "nam", "nu" hoặc để trống');
  let gio_ngay = intOrNull(input.gio_ngay, 1, 30, 'Ngày giỗ');
  let gio_thang = intOrNull(input.gio_thang, 1, 12, 'Tháng giỗ');
  if ((gio_ngay === null) !== (gio_thang === null)) throw new Error('Ngày giỗ cần đủ cả ngày và tháng');
  // Chỉ biết ngày mất dương lịch thì tự đổi ra ngày giỗ âm lịch. Mất vào tháng nhuận thì giỗ vào tháng thường cùng số.
  const matDuong = parseSolarDate(input.ngay_mat_duong);
  if (matDuong && gio_ngay === null) [gio_ngay, gio_thang] = solarToLunar(...matDuong);
  return {
    ho_ten,
    gioi_tinh,
    chi: text(input.chi, 100, 'Chi'),
    doi: intOrNull(input.doi, 1, 200, 'Đời'),
    nam_sinh: text(input.nam_sinh, 50, 'Năm sinh'),
    nam_mat: text(input.nam_mat, 50, 'Năm mất') || (matDuong ? String(matDuong[2]) : ''),
    gio_ngay,
    gio_thang,
    con_song: truthy(input.con_song) && !matDuong ? 1 : 0,
    tranh_chap: truthy(input.tranh_chap) ? 1 : 0,
    ghi_chu: text(input.ghi_chu, 5000, 'Ghi chú'),
  };
}

const COLS_P = ['ho_ten', 'gioi_tinh', 'chi', 'doi', 'nam_sinh', 'nam_mat', 'gio_ngay', 'gio_thang', 'con_song', 'tranh_chap', 'ghi_chu'];

const getPerson = (db, id) => db.first('SELECT * FROM person WHERE id = ?', [id]);

// Thêm người (upsert = false: trùng mã thì báo lỗi) hoặc thêm/cập nhật theo mã (upsert = true, dùng khi nhập file)
const personStmt = (p, ma, upsert) => ({
  sql: `INSERT INTO person (ma, ${COLS_P.join(', ')}) VALUES (?, ${COLS_P.map(() => '?').join(', ')})` +
    (upsert ? ` ON CONFLICT (ma) DO UPDATE SET ${COLS_P.map((k) => `${k} = excluded.${k}`).join(', ')}` : ''),
  params: [ma, ...COLS_P.map((k) => p[k])],
});

// Quan hệ chỉ ra người bằng mã, nên dùng được cả với người vừa thêm trong cùng batch
const BY_MA = '(SELECT id FROM person WHERE ma = ?)';
function relStmt({ loai, a, b, kieu = 'ruot', thu_tu = null }) {
  if (loai === 'cha_me') {
    return {
      sql: `INSERT INTO quan_he (loai, a, b, kieu) SELECT 'cha_me', ${BY_MA}, ${BY_MA}, ? WHERE true ON CONFLICT (loai, a, b) DO UPDATE SET kieu = excluded.kieu`,
      params: [a, b, kieu],
    };
  }
  return {
    sql: `INSERT INTO quan_he (loai, a, b, thu_tu) SELECT 'vo_chong', min(x, y), max(x, y), ? FROM (SELECT ${BY_MA} AS x, ${BY_MA} AS y) WHERE true ON CONFLICT (loai, a, b) DO UPDATE SET thu_tu = COALESCE(excluded.thu_tu, thu_tu)`,
    params: [thu_tu, a, b],
  };
}

// Đồ thị cha mẹ theo mã: con -> tập mã cha mẹ
function parentGraph(m) {
  const g = new Map();
  for (const r of m.rels) if (r.loai === 'cha_me') addParent(g, m.byId.get(r.b).ma, m.byId.get(r.a).ma);
  return g;
}
const addParent = (g, child, parent) => (g.get(child) || g.set(child, new Set()).get(child)).add(parent);

// x có phải tổ tiên của y không (đi ngược lên theo quan hệ cha mẹ)
function isAncestor(g, x, y) {
  const seen = new Set([y]);
  const queue = [y];
  while (queue.length) {
    for (const a of g.get(queue.shift()) || []) {
      if (a === x) return true;
      if (!seen.has(a)) { seen.add(a); queue.push(a); }
    }
  }
  return false;
}

// Kiểm tra quan hệ (theo mã) trước khi ghi, rồi thêm vào đồ thị để kiểm tra các quan hệ sau trong cùng lần nhập
function checkRel(g, { loai, a, b, kieu = 'ruot' }) {
  if (a === b) throw new Error('Không thể tạo quan hệ với chính mình');
  if (loai === 'cha_me') {
    if (!KIEU_CON[kieu]) throw new Error('Kiểu con không hợp lệ');
    if (isAncestor(g, b, a)) throw new Error('Quan hệ này tạo vòng lặp (con lại là tổ tiên của cha/mẹ)');
    addParent(g, b, a);
  } else if (loai !== 'vo_chong') {
    throw new Error('Loại quan hệ không hợp lệ');
  }
}

// Mã cho người thêm bằng tay: P + (số lớn nhất đang dùng + 1)
const nextMa = (m) => `P${m.people.reduce((mx, p) => Math.max(mx, p.id, Number(/^P(\d+)$/.exec(p.ma || '')?.[1] || 0)), 0) + 1}`;

// Thêm người; `link` để nối luôn với người đã có: { loai: 'cha_me', voi: idChaMe } hoặc { loai: 'vo_chong', voi: idVoChong }
async function createPerson(db, input, ai, link = null) {
  const p = cleanPerson(input);
  const m = await loadAll(db);
  const ma = nextMa(m);
  const stmts = [personStmt(p, ma, false), logStmt(ai, 'them_nguoi', { ma, sau: p })];
  if (link) {
    const other = m.byId.get(Number(link.voi));
    if (!other) throw new Error('Không tìm thấy người để nối');
    const rel = link.loai === 'cha_me' ? { loai: 'cha_me', a: other.ma, b: ma, kieu: 'ruot' } : { loai: 'vo_chong', a: other.ma, b: ma };
    checkRel(parentGraph(m), rel);
    stmts.push(relStmt(rel), logStmt(ai, 'them_quan_he', rel));
  }
  await db.batch(stmts);
  return (await db.first('SELECT id FROM person WHERE ma = ?', [ma])).id;
}

async function updatePerson(db, id, input, ai) {
  const p = cleanPerson(input);
  const truoc = await getPerson(db, id);
  if (!truoc) throw new Error('Không tìm thấy người này');
  await db.batch([
    { sql: `UPDATE person SET ${COLS_P.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, params: [...COLS_P.map((k) => p[k]), id] },
    logStmt(ai, 'sua_nguoi', { id, truoc, sau: p }),
  ]);
}

async function deletePerson(db, id, ai) {
  const truoc = await getPerson(db, id);
  if (!truoc) throw new Error('Không tìm thấy người này');
  const quanHe = await db.all('SELECT * FROM quan_he WHERE a = ? OR b = ?', [id, id]);
  await db.batch([
    { sql: 'DELETE FROM quan_he WHERE a = ? OR b = ?', params: [id, id] },
    { sql: 'DELETE FROM person WHERE id = ?', params: [id] },
    logStmt(ai, 'xoa_nguoi', { id, truoc, quanHe }),
  ]);
}

// rel.a, rel.b là id người (từ form)
async function addRelation(db, rel, ai) {
  const m = await loadAll(db);
  const pa = m.byId.get(Number(rel.a)), pb = m.byId.get(Number(rel.b));
  if (!pa || !pb) throw new Error('Không tìm thấy người trong quan hệ');
  const byMa = { ...rel, a: pa.ma, b: pb.ma };
  checkRel(parentGraph(m), byMa);
  await db.batch([relStmt(byMa), logStmt(ai, 'them_quan_he', rel)]);
}

async function deleteRelation(db, id, ai) {
  const truoc = await db.first('SELECT * FROM quan_he WHERE id = ?', [id]);
  if (!truoc) throw new Error('Không tìm thấy quan hệ');
  await db.batch([{ sql: 'DELETE FROM quan_he WHERE id = ?', params: [id] }, logStmt(ai, 'xoa_quan_he', { truoc })]);
}

const push = (map, k, v) => (map.get(k) || map.set(k, []).get(k)).push(v);
const yearNum = (s) => (/\d{3,4}/.exec(s || '') || [Infinity])[0] * 1;

// Nạp toàn bộ họ vào bộ nhớ. Một họ chỉ vài nghìn người nên làm vậy là đủ.
async function loadAll(db) {
  const people = await db.all('SELECT * FROM person ORDER BY id');
  const rels = await db.all('SELECT * FROM quan_he ORDER BY id');
  const byId = new Map(people.map((p) => [p.id, p]));
  const parentsOf = new Map(), childrenOf = new Map(), spousesOf = new Map();
  for (const r of rels) {
    if (r.loai === 'cha_me') {
      push(parentsOf, r.b, r);
      push(childrenOf, r.a, r);
    } else {
      push(spousesOf, r.a, { ...r, other: r.b });
      push(spousesOf, r.b, { ...r, other: r.a });
    }
  }
  for (const list of childrenOf.values()) list.sort((x, y) => yearNum(byId.get(x.b).nam_sinh) - yearNum(byId.get(y.b).nam_sinh) || x.b - y.b);
  for (const list of spousesOf.values()) list.sort((x, y) => (x.thu_tu ?? 99) - (y.thu_tu ?? 99) || x.other - y.other);
  const m = { people, rels, byId, parentsOf, childrenOf, spousesOf };
  m.doi = computeDoi(m);
  return m;
}

// Đời: lấy theo cha trước (phụ hệ), không có cha mẹ trong cây thì lấy theo vợ/chồng (dâu, rể), còn lại là đời 1.
// Nếu đã ghi đời bằng tay thì dùng số ghi tay, để xử lý chỗ các chi đánh số đời lệch nhau.
function computeDoi({ people, byId, parentsOf, spousesOf }) {
  const memo = new Map();
  const hasParents = (id) => (parentsOf.get(id) || []).length > 0;
  function doi(id, seen) {
    if (memo.has(id)) return memo.get(id);
    const p = byId.get(id);
    if (p.doi) return memo.set(id, p.doi).get(id);
    if (seen.has(id)) return null;
    seen.add(id);
    let v = null;
    const parents = [...(parentsOf.get(id) || [])].sort((x, y) => (byId.get(y.a).gioi_tinh === 'nam') - (byId.get(x.a).gioi_tinh === 'nam'));
    for (const r of parents) {
      const d = doi(r.a, seen);
      if (d != null) { v = d + 1; break; }
    }
    if (v == null) {
      for (const s of spousesOf.get(id) || []) {
        if (hasParents(s.other) || byId.get(s.other).doi) {
          const d = doi(s.other, seen);
          if (d != null) { v = d; break; }
        }
      }
    }
    seen.delete(id);
    return memo.set(id, v ?? 1).get(id);
  }
  for (const p of people) doi(p.id, new Set());
  return memo;
}

// Gốc cây: người không có cha mẹ trong cây và không phải dâu/rể. Cặp vợ chồng gốc thì lấy người chồng làm gốc.
function roots(m) {
  const noParents = (id) => !(m.parentsOf.get(id) || []).length;
  const before = (s, p) => (s.gioi_tinh === 'nam') !== (p.gioi_tinh === 'nam') ? s.gioi_tinh === 'nam' : s.id < p.id;
  return m.people.filter((p) => noParents(p.id) && !(m.spousesOf.get(p.id) || []).some((s) => {
    const sp = m.byId.get(s.other);
    return !noParents(sp.id) || before(sp, p);
  }));
}

// Ngày hôm nay theo giờ Việt Nam, dạng Julian day
function todayJd(now = new Date()) {
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now).split('-').map(Number);
  return jdFromDate(d, mo, y);
}

function upcomingGio(people, fromJd, days) {
  const lunarYear = solarToLunar(...jdToDate(fromJd))[2];
  const out = [];
  for (const p of people) {
    if (!p.gio_ngay || !p.gio_thang) continue;
    for (const y of [lunarYear - 1, lunarYear, lunarYear + 1]) {
      const jd = gioJd(p.gio_ngay, p.gio_thang, y);
      if (jd >= fromJd && jd < fromJd + days) out.push({ p, jd, date: jdToDate(jd) });
    }
  }
  return out.sort((x, y) => x.jd - y.jd || x.p.id - y.p.id);
}

// ---------- CSV ----------
const CSV_COLS = ['ma', 'ho_ten', 'gioi_tinh', 'chi', 'doi', 'nam_sinh', 'nam_mat', 'gio_am', 'con_song', 'tranh_chap', 'ma_cha_me', 'ma_vo_chong', 'ghi_chu'];

// Excel bản tiếng Việt thường lưu CSV bằng dấu ";", nên tự đoán dấu phân cách từ dòng tiêu đề.
function parseCsv(input) {
  const s = input.replace(/^﻿/, '');
  const first = s.split(/\r?\n/, 1)[0];
  const sep = first.split(';').length > first.split(',').length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(m) {
  const lines = [CSV_COLS.join(',')];
  for (const p of m.people) {
    const chaMe = (m.parentsOf.get(p.id) || []).map((r) => m.byId.get(r.a).ma + (r.kieu === 'ruot' ? '' : `:${r.kieu}`));
    const voChong = (m.spousesOf.get(p.id) || []).map((s) => m.byId.get(s.other).ma + (s.thu_tu ? `:${s.thu_tu}` : ''));
    const row = {
      ...p,
      doi: p.doi ?? '',
      gio_am: p.gio_ngay ? `${p.gio_ngay}/${p.gio_thang}` : '',
      ma_cha_me: chaMe.join(';'),
      ma_vo_chong: voChong.join(';'),
    };
    lines.push(CSV_COLS.map((k) => csvCell(row[k])).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// "P1;P2:nuoi" -> [{ma:'P1', extra:''}, {ma:'P2', extra:'nuoi'}]
const splitRefs = (s) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean)
  .map((x) => { const [ma, extra = ''] = x.split(':').map((y) => y.trim()); return { ma, extra }; });

// Nhập CSV: cập nhật theo cột `ma`, mã chưa có thì thêm người mới. Có một lỗi là bỏ toàn bộ, không ghi gì.
async function importCsv(db, input, ai) {
  const rows = parseCsv(input);
  if (rows.length < 2) throw new Error('File trống hoặc chỉ có dòng tiêu đề');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  for (const need of ['ma', 'ho_ten']) if (!head.includes(need)) throw new Error(`Thiếu cột "${need}"`);
  const recs = rows.slice(1).map((r, i) => ({ label: `Dòng ${i + 2}`, ...Object.fromEntries(head.map((h, j) => [h, (r[j] ?? '').trim()])) }));
  return importRecords(db, recs, ai, 'nhap_csv');
}

// Nhận file CSV hoặc GEDCOM, tự nhận dạng theo nội dung
const importAny = (db, input, ai) =>
  (/^﻿?\s*0\s+HEAD/.test(input) ? importGedcom(db, input, ai) : importCsv(db, input, ai));

// Lõi nhập dùng chung cho CSV và GEDCOM. Mỗi bản ghi có dạng giống một dòng CSV, cộng thêm `label` để báo lỗi.
async function importRecords(db, recs, ai, viec) {
  const m = await loadAll(db);
  const existing = new Set(m.people.map((p) => p.ma));
  const errors = [];
  const stats = { them: 0, sua: 0, quan_he: 0 };
  const seenMa = new Set();
  const stmts = [];
  {
    for (const r of recs) {
      try {
        if (!r.ma) throw new Error('Thiếu mã');
        if (seenMa.has(r.ma)) throw new Error(`Mã ${r.ma} bị trùng trong file`);
        seenMa.add(r.ma);
        const gio = r.gio_am ? /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(r.gio_am) : null;
        if (r.gio_am && !gio) throw new Error('gio_am phải có dạng ngày/tháng, ví dụ 15/3');
        const p = cleanPerson({
          ...r,
          gio_ngay: gio?.[1],
          gio_thang: gio?.[2],
          con_song: r.con_song !== undefined && r.con_song !== '' ? r.con_song : !(r.nam_mat || r.gio_am || r.ngay_mat_duong),
        });
        stmts.push(personStmt(p, r.ma, true));
        if (existing.has(r.ma)) stats.sua++; else stats.them++;
      } catch (e) {
        errors.push(`${r.label}: ${e.message}`);
      }
    }
    if (!errors.length) {
      const known = new Set([...existing, ...seenMa]);
      const g = parentGraph(m);
      for (const r of recs) {
        try {
          for (const { ma, extra } of splitRefs(r.ma_cha_me)) {
            if (!known.has(ma)) throw new Error(`Không có mã cha/mẹ ${ma}`);
            const rel = { loai: 'cha_me', a: ma, b: r.ma, kieu: extra || 'ruot' };
            checkRel(g, rel);
            stmts.push(relStmt(rel));
            stats.quan_he++;
          }
          for (const { ma, extra } of splitRefs(r.ma_vo_chong)) {
            if (!known.has(ma)) throw new Error(`Không có mã vợ/chồng ${ma}`);
            const rel = { loai: 'vo_chong', a: r.ma, b: ma, thu_tu: intOrNull(extra, 1, 20, 'Thứ tự vợ/chồng') };
            checkRel(g, rel);
            stmts.push(relStmt(rel));
            stats.quan_he++;
          }
        } catch (e) {
          errors.push(`${r.label}: ${e.message}`);
        }
      }
    }
  }
  if (errors.length) throw Object.assign(new Error('Nhập thất bại, chưa ghi gì'), { errors });
  stmts.push(logStmt(ai, viec, stats));
  await db.batch(stmts);
  return stats;
}

// ---------- Đọc GEDCOM (từ MyHeritage, FamilySearch, Gramps, GensTree...) ----------
function parseGedcom(input) {
  const root = { children: [] };
  const stack = [root];
  for (const raw of input.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const m = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?: (.*))?$/.exec(raw);
    if (!m) continue;
    const level = Number(m[1]);
    const node = { xref: m[2] || null, tag: m[3].toUpperCase(), value: (m[4] ?? '').trim(), children: [] };
    stack.length = Math.min(stack.length, level + 1);
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
}
const gChild = (n, tag) => n?.children.find((c) => c.tag === tag);
const gChildren = (n, tag) => (n ? n.children.filter((c) => c.tag === tag) : []);
const gText = (n) => n.children.reduce((s, c) => (c.tag === 'CONT' ? `${s}\n${c.value}` : c.tag === 'CONC' ? s + c.value : s), n.value);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// "(khoảng 1900)" là ngày dạng chữ thì giữ nguyên chữ; còn lại lấy năm, ví dụ "ABT 1900" -> "1900"
const gYear = (s) => (!s ? '' : /^\(.*\)$/.test(s) ? s.slice(1, -1) : /\b(\d{3,4})\b/.exec(s)?.[1] ?? s);
function gFullDate(s) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{3,4})$/.exec((s || '').trim());
  const mo = m && MONTHS.indexOf(m[2].toUpperCase()) + 1;
  return mo ? `${Number(m[1])}/${mo}/${m[3]}` : '';
}

async function importGedcom(db, input, ai) {
  const top = parseGedcom(input);
  const indis = top.filter((n) => n.tag === 'INDI' && n.xref);
  if (!indis.length) throw new Error('File GEDCOM không có người nào');
  const famsById = new Map(top.filter((n) => n.tag === 'FAM' && n.xref).map((f) => [f.xref, f]));
  const maOf = new Map(indis.map((n) => [n.xref, gChild(n, 'REFN')?.value || n.xref.replace(/@/g, '')]));
  const recs = new Map();
  for (const n of indis) {
    // Tên GEDCOM dạng "Văn An /Nguyễn/" hoặc "/Nguyễn/ Văn An"; đưa họ lên đầu theo kiểu Việt
    const name = gChild(n, 'NAME')?.value || '';
    const nm = /^(.*?)\/(.*?)\/(.*)$/.exec(name);
    const ho_ten = (nm ? [nm[2], nm[1], nm[3]] : [name]).map((s) => s.trim()).filter(Boolean).join(' ') || 'Chưa rõ tên';
    const sex = gChild(n, 'SEX')?.value.toUpperCase();
    const deat = gChild(n, 'DEAT');
    const deathDate = gChild(deat, 'DATE')?.value;
    const r = {
      label: `Người ${n.xref} (${ho_ten})`,
      ma: maOf.get(n.xref),
      ho_ten,
      gioi_tinh: sex === 'M' ? 'nam' : sex === 'F' ? 'nu' : '',
      nam_sinh: gYear(gChild(gChild(n, 'BIRT'), 'DATE')?.value),
      nam_mat: gYear(deathDate),
      ngay_mat_duong: gFullDate(deathDate),
      con_song: deat ? '0' : '',
      doi: gChild(n, '_DOI')?.value || '',
      tranh_chap: gChild(n, '_TRANH_CHAP') ? '1' : '',
      gio_am: '', chi: '', ma_cha_me: '', ma_vo_chong: '',
    };
    const notes = [];
    for (const note of [...gChildren(n, 'NOTE'), ...gChildren(deat, 'NOTE')]) {
      if (note.value.startsWith('@')) continue; // ghi chú dạng con trỏ sang bản ghi khác, bỏ qua
      const t = gText(note).trim();
      const gio = /^Giỗ ngày (\d{1,2})\/(\d{1,2}) âm lịch$/.exec(t);
      const chi = /^Chi: (.+)$/.exec(t);
      if (gio) r.gio_am = `${gio[1]}/${gio[2]}`;
      else if (chi) r.chi = chi[1];
      else notes.push(t);
    }
    r.ghi_chu = notes.join('\n');
    if (r.gio_am) r.ngay_mat_duong = ''; // ngày giỗ ghi sẵn thì không đổi lại từ ngày mất
    recs.set(n.xref, r);
  }
  const add = (r, key, val) => { r[key] = r[key] ? `${r[key]};${val}` : val; };
  for (const [famId, f] of famsById) {
    const husb = gChild(f, 'HUSB')?.value, wife = gChild(f, 'WIFE')?.value;
    const parents = [husb, wife].filter((x) => x && recs.has(x));
    if (parents.length === 2) {
      const thuTu = gChild(f, '_THU_TU')?.value;
      add(recs.get(husb), 'ma_vo_chong', maOf.get(wife) + (thuTu ? `:${thuTu}` : ''));
    }
    for (const c of gChildren(f, 'CHIL')) {
      const child = indis.find((x) => x.xref === c.value);
      if (!child) continue;
      const famc = gChildren(child, 'FAMC').find((x) => x.value === famId);
      const pedi = (gChild(famc, 'PEDI')?.value || '').toLowerCase();
      const own = gChild(famc, '_KIEU')?.value;
      const kieu = KIEU_CON[own] && own !== 'ruot' ? `:${own}` : ['adopted', 'foster'].includes(pedi) ? ':nuoi' : '';
      for (const pid of parents) add(recs.get(c.value), 'ma_cha_me', maOf.get(pid) + kieu);
    }
  }
  return importRecords(db, [...recs.values()], ai, 'nhap_gedcom');
}

// ---------- GEDCOM 5.5.1 ----------
function gedText(level, tag, value) {
  const [first, ...rest] = String(value).split(/\r?\n/);
  return [`${level} ${tag} ${first}`, ...rest.map((l) => `${level + 1} CONT ${l}`)];
}

function toGedcom(m) {
  const fams = new Map(); // khóa: kiểu + danh sách id cha mẹ
  const famOf = (parentIds) => {
    const key = [...parentIds].sort((a, b) => a - b).join('-');
    if (!fams.has(key)) fams.set(key, { id: `F${fams.size + 1}`, parents: [...parentIds], children: [] });
    return fams.get(key);
  };
  const famc = new Map(); // id con -> [{fam, kieu}]
  for (const p of m.people) {
    const byKieu = new Map();
    for (const r of m.parentsOf.get(p.id) || []) push(byKieu, r.kieu, r.a);
    for (const [kieu, ids] of byKieu) {
      const f = famOf(ids);
      f.children.push(p.id);
      push(famc, p.id, { fam: f, kieu });
    }
  }
  for (const r of m.rels) if (r.loai === 'vo_chong') famOf([r.a, r.b]);
  const fams_ = new Map();
  for (const f of fams.values()) for (const id of f.parents) push(fams_, id, f);

  const out = ['0 HEAD', '1 SOUR GIAPHA', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];
  for (const p of m.people) {
    const [ho, ...ten] = p.ho_ten.split(/\s+/);
    out.push(`0 @I${p.id}@ INDI`, `1 NAME /${ho}/ ${ten.join(' ')}`.trimEnd(), `1 REFN ${p.ma}`);
    if (p.gioi_tinh) out.push(`1 SEX ${p.gioi_tinh === 'nam' ? 'M' : 'F'}`);
    // Thẻ riêng (bắt đầu bằng _) để xuất rồi nhập lại không mất thông tin; phần mềm khác sẽ bỏ qua
    if (p.doi) out.push(`1 _DOI ${p.doi}`);
    if (p.tranh_chap) out.push('1 _TRANH_CHAP Y');
    if (p.nam_sinh) out.push('1 BIRT', `2 DATE ${/^\d{3,4}$/.test(p.nam_sinh) ? p.nam_sinh : `(${p.nam_sinh})`}`);
    if (!p.con_song) {
      out.push('1 DEAT');
      if (p.nam_mat) out.push(`2 DATE ${/^\d{3,4}$/.test(p.nam_mat) ? p.nam_mat : `(${p.nam_mat})`}`);
      if (p.gio_ngay) out.push(`2 NOTE Giỗ ngày ${p.gio_ngay}/${p.gio_thang} âm lịch`);
    }
    if (p.chi) out.push(`1 NOTE Chi: ${p.chi}`);
    if (p.ghi_chu) out.push(...gedText(1, 'NOTE', p.ghi_chu));
    for (const f of fams_.get(p.id) || []) out.push(`1 FAMS @${f.id}@`);
    for (const { fam, kieu } of famc.get(p.id) || []) {
      out.push(`1 FAMC @${fam.id}@`);
      if (kieu !== 'ruot') out.push('2 PEDI adopted', `2 _KIEU ${kieu}`);
    }
  }
  for (const f of fams.values()) {
    out.push(`0 @${f.id}@ FAM`);
    const [x, y] = f.parents.map((id) => m.byId.get(id));
    const husbFirst = !y || x.gioi_tinh === 'nam' || y.gioi_tinh === 'nu';
    const [h, w] = husbFirst ? [x, y] : [y, x];
    out.push(`1 HUSB @I${h.id}@`);
    if (w) {
      out.push(`1 WIFE @I${w.id}@`);
      const rel = (m.spousesOf.get(h.id) || []).find((s) => s.other === w.id);
      if (rel?.thu_tu) out.push(`1 _THU_TU ${rel.thu_tu}`);
    }
    for (const c of f.children) out.push(`1 CHIL @I${c}@`);
  }
  out.push('0 TRLR');
  return out.join('\r\n') + '\r\n';
}

// ---------- iCalendar ----------
const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const ymd = ([d, mo, y]) => `${y}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}`;

function toIcs(people, fromJd) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//giapha//VI', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Ngày giỗ'];
  for (const { p, jd, date } of upcomingGio(people, fromJd - 30, 430)) {
    out.push(
      'BEGIN:VEVENT',
      `UID:gio-${p.id}-${jd}@giapha`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(date)}`,
      `DTEND;VALUE=DATE:${ymd(jdToDate(jd + 1))}`,
      `SUMMARY:${icsEsc(`Giỗ ${p.ho_ten}`)}`,
      `DESCRIPTION:${icsEsc(`Ngày ${p.gio_ngay}/${p.gio_thang} âm lịch`)}`,
      // Nhắc lúc 9 giờ sáng, trước 1 tuần và trước 1 ngày (sự kiện cả ngày bắt đầu lúc 0 giờ)
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(`Còn 1 tuần nữa là giỗ ${p.ho_ten}`)}`, 'TRIGGER:-P6DT15H', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(`Mai là giỗ ${p.ho_ten}`)}`, 'TRIGGER:-PT15H', 'END:VALARM',
      'END:VEVENT',
    );
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

module.exports = {
  KIEU_CON, CSV_COLS, cleanPerson, getPerson, createPerson, updatePerson, deletePerson,
  addRelation, deleteRelation, loadAll, roots, todayJd, upcomingGio, parseCsv, toCsv, importCsv, importGedcom, importAny, toGedcom, toIcs,
};
