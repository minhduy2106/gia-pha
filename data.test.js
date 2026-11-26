const test = require('node:test');
const assert = require('node:assert');
const d = require('./data');
const { jdFromDate } = require('./lunar');

const SAMPLE = [
  'ma;ho_ten;gioi_tinh;chi;doi;nam_sinh;nam_mat;gio_am;con_song;tranh_chap;ma_cha_me;ma_vo_chong;ghi_chu',
  'P1;Nguyễn Văn Tổ;nam;;;1900;1970;15/3;;;;"P2:1;P3:2";"Cụ tổ; đời đầu"',
  'P2;Trần Thị Cả;nu;;;1905;1980;30/12;;;;;',
  'P3;Lê Thị Hai;nu;;;1910;;;;;;;',
  'P4;Nguyễn Văn Con;nam;Chi 1;;1930;;;;;"P1;P2";;',
  'P5;Nguyễn Văn Nuôi;nam;Chi 2;;1935;;;;1;P1:nuoi;;',
  'P6;Phạm Thị Dâu;nu;;;1932;;;;;;P4;',
  'P7;Nguyễn Văn Cháu;nam;Chi 1;;1960;;;;;"P4;P6";;',
].join('\n');

const fresh = () => d.openDb(':memory:');

test('parseCsv: BOM, dấu ;, ngoặc kép, xuống dòng trong ô', () => {
  const rows = d.parseCsv('﻿a;b\r\n"x;y";"dòng 1\ndòng ""2"""\r\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['x;y', 'dòng 1\ndòng "2"']]);
  assert.deepStrictEqual(d.parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('importCsv + tính đời + gốc cây', () => {
  const db = fresh();
  const stats = d.importCsv(db, SAMPLE, 'test');
  assert.deepStrictEqual(stats, { them: 7, sua: 0, quan_he: 8 });
  const m = d.loadAll(db);
  const doi = (ma) => m.doi.get(m.people.find((p) => p.ma === ma).id);
  assert.deepStrictEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].map(doi), [1, 1, 1, 2, 2, 2, 3]);
  assert.deepStrictEqual(d.roots(m).map((p) => p.ma), ['P1']);
  const p1 = m.people.find((p) => p.ma === 'P1');
  assert.strictEqual(p1.ghi_chu, 'Cụ tổ; đời đầu');
  assert.strictEqual(p1.con_song, 0);
  assert.strictEqual(m.people.find((p) => p.ma === 'P3').con_song, 1);
  assert.strictEqual(m.people.find((p) => p.ma === 'P5').tranh_chap, 1);
  assert.deepStrictEqual(m.spousesOf.get(p1.id).map((s) => s.thu_tu), [1, 2]);
});

test('Đời ghi tay thắng đời tính tự động', () => {
  const db = fresh();
  d.importCsv(db, SAMPLE.replace('P4;Nguyễn Văn Con;nam;Chi 1;;', 'P4;Nguyễn Văn Con;nam;Chi 1;10;'), 'test');
  const m = d.loadAll(db);
  assert.strictEqual(m.doi.get(m.people.find((p) => p.ma === 'P7').id), 11);
});

test('Xuất CSV rồi nhập lại được đúng dữ liệu ban đầu', () => {
  const db1 = fresh();
  d.importCsv(db1, SAMPLE, 'test');
  const csv1 = d.toCsv(d.loadAll(db1));
  const db2 = fresh();
  d.importCsv(db2, csv1, 'test');
  assert.strictEqual(d.toCsv(d.loadAll(db2)), csv1);
  // nhập lại vào chính db cũ thì chỉ cập nhật, không sinh người trùng
  assert.deepStrictEqual(d.importCsv(db1, csv1, 'test').them, 0);
});

test('Có một dòng lỗi là không ghi gì cả', () => {
  const db = fresh();
  const bad = SAMPLE + '\nP8;Ai Đó;nam;;;;;45/3;;;;;';
  assert.throws(() => d.importCsv(db, bad, 'test'), (e) => e.errors.some((x) => x.startsWith('Dòng 9')));
  assert.strictEqual(d.loadAll(db).people.length, 0);
});

test('Chặn quan hệ tạo vòng lặp', () => {
  const db = fresh();
  d.importCsv(db, SAMPLE, 'test');
  const m = d.loadAll(db);
  const id = (ma) => m.people.find((p) => p.ma === ma).id;
  assert.throws(() => d.addRelation(db, { loai: 'cha_me', a: id('P7'), b: id('P1') }, 'test'), /vòng lặp/);
  assert.throws(() => d.addRelation(db, { loai: 'cha_me', a: id('P1'), b: id('P1') }, 'test'), /chính mình/);
});

test('Nhật ký chỉ ghi thêm, không sửa không xóa được', () => {
  const db = fresh();
  d.createPerson(db, { ho_ten: 'A' }, 'test');
  assert.throws(() => db.exec('DELETE FROM nhat_ky'), /chi ghi them/);
  assert.throws(() => db.exec("UPDATE nhat_ky SET ai = 'x'"), /chi ghi them/);
});

test('GEDCOM có đủ người, gia đình, con nuôi', () => {
  const db = fresh();
  d.importCsv(db, SAMPLE, 'test');
  const g = d.toGedcom(d.loadAll(db));
  assert.match(g, /^0 HEAD/);
  assert.match(g, /0 TRLR\r\n$/);
  assert.strictEqual((g.match(/ INDI\r\n/g) || []).length, 7);
  assert.match(g, /1 NAME \/Nguyễn\/ Văn Tổ/);
  assert.match(g, /2 PEDI adopted/);
  assert.match(g, /1 NOTE Cụ tổ; đời đầu/);
});

test('Nhập ngày mất dương lịch thì tự ra ngày giỗ âm lịch', () => {
  const p = d.cleanPerson({ ho_ten: 'A', con_song: 'on', ngay_mat_duong: '1/5/2026' });
  assert.deepStrictEqual([p.gio_ngay, p.gio_thang, p.nam_mat, p.con_song], [15, 3, '2026', 0]);
  // mất ngày 1 tháng 2 nhuận năm 2023 thì giỗ ngày 1 tháng 2
  assert.deepStrictEqual([d.cleanPerson({ ho_ten: 'A', ngay_mat_duong: '22-03-2023' }).gio_thang], [2]);
  // ngày giỗ ghi tay thì giữ nguyên
  assert.strictEqual(d.cleanPerson({ ho_ten: 'A', ngay_mat_duong: '1/5/2026', gio_ngay: 3, gio_thang: 4 }).gio_ngay, 3);
  assert.throws(() => d.cleanPerson({ ho_ten: 'A', ngay_mat_duong: '31/2/2020' }), /không hợp lệ/);
});

test('Xuất GEDCOM rồi nhập lại vào db mới cho đúng dữ liệu cũ', () => {
  const db1 = fresh();
  d.importCsv(db1, SAMPLE.replace('P4;Nguyễn Văn Con;nam;Chi 1;;', 'P4;Nguyễn Văn Con;nam;Chi 1;2;').replace('P1:nuoi', 'P1:thua_tu'), 'test');
  const m1 = d.loadAll(db1);
  const db2 = fresh();
  assert.deepStrictEqual(d.importAny(db2, d.toGedcom(m1), 'test').them, 7);
  assert.strictEqual(d.toCsv(d.loadAll(db2)), d.toCsv(m1));
});

test('Nhập GEDCOM từ phần mềm khác (tên kiểu Tây, ngày mất đầy đủ, con nuôi)', () => {
  const ged = [
    '0 HEAD', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Văn Ba /Lê/', '1 SEX M', '1 BIRT', '2 DATE ABT 1920', '1 DEAT', '2 DATE 1 MAY 2026', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Thị Tư /Phan/', '1 SEX F', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Văn Năm /Lê/', '1 SEX M', '1 FAMC @F1@',
    '0 @I4@ INDI', '1 NAME Thị Sáu /Lê/', '1 FAMC @F1@', '2 PEDI adopted', '1 NOTE dòng một', '2 CONT dòng hai',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I4@',
    '0 TRLR',
  ].join('\n');
  const db = fresh();
  assert.deepStrictEqual(d.importAny(db, ged, 'test'), { them: 4, sua: 0, quan_he: 5 });
  const m = d.loadAll(db);
  const by = (ma) => m.people.find((p) => p.ma === ma);
  assert.strictEqual(by('I1').ho_ten, 'Lê Văn Ba');
  assert.deepStrictEqual([by('I1').nam_sinh, by('I1').nam_mat, by('I1').gio_ngay, by('I1').gio_thang, by('I1').con_song], ['1920', '2026', 15, 3, 0]);
  assert.strictEqual(m.parentsOf.get(by('I4').id)[0].kieu, 'nuoi');
  assert.strictEqual(by('I4').ghi_chu, 'dòng một\ndòng hai');
  assert.strictEqual(m.doi.get(by('I3').id), 2);
});

test('Giỗ sắp tới và file .ics', () => {
  const db = fresh();
  d.importCsv(db, SAMPLE, 'test');
  const { people } = d.loadAll(db);
  // 15/3 âm lịch năm 2026 là ngày 1/5/2026 dương lịch
  const from = jdFromDate(25, 4, 2026);
  const up = d.upcomingGio(people, from, 30);
  assert.deepStrictEqual(up.map((x) => [x.p.ma, x.date]), [['P1', [1, 5, 2026]]]);
  const ics = d.toIcs(people, from);
  assert.match(ics, /DTSTART;VALUE=DATE:20260501/);
  assert.match(ics, /SUMMARY:Giỗ Nguyễn Văn Tổ/);
  assert.match(ics, /TRIGGER:-PT15H/);
});
