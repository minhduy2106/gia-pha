const test = require('node:test');
const assert = require('node:assert');
const { jdFromDate, jdToDate, solarToLunar, lunarToSolar, gioJd } = require('./lunar');

test('Tết đã biết', () => {
  assert.deepStrictEqual(lunarToSolar(1, 1, 2024), [10, 2, 2024]);
  assert.deepStrictEqual(lunarToSolar(1, 1, 2025), [29, 1, 2025]);
  assert.deepStrictEqual(lunarToSolar(1, 1, 2026), [17, 2, 2026]);
});

test('Tết 1985: Việt Nam (UTC+7) khác Trung Quốc (UTC+8)', () => {
  assert.deepStrictEqual(lunarToSolar(1, 1, 1985, 0, 7), [21, 1, 1985]);
  assert.deepStrictEqual(lunarToSolar(1, 1, 1985, 0, 8), [20, 2, 1985]);
});

test('Tháng 2 nhuận năm 2023', () => {
  assert.deepStrictEqual(solarToLunar(22, 3, 2023), [1, 2, 2023, 1]);
  assert.deepStrictEqual(lunarToSolar(1, 2, 2023, 1), [22, 3, 2023]);
  assert.strictEqual(lunarToSolar(1, 3, 2023, 1), null);
});

test('Đổi dương -> âm -> dương khớp nhau với mọi ngày 1990-2040', () => {
  for (let jd = jdFromDate(1, 1, 1990); jd <= jdFromDate(31, 12, 2040); jd++) {
    const [d, m, y] = jdToDate(jd);
    const [ld, lm, ly, leap] = solarToLunar(d, m, y);
    assert.deepStrictEqual(lunarToSolar(ld, lm, ly, leap), [d, m, y], `${d}/${m}/${y}`);
  }
});

test('Giỗ ngày 30 rơi vào tháng thiếu thì làm ngày 29', () => {
  for (let y = 2000; y <= 2040; y++) {
    for (let m = 1; m <= 12; m++) {
      const [ld, lm, , leap] = solarToLunar(...jdToDate(gioJd(30, m, y)));
      assert.strictEqual(lm, m);
      assert.strictEqual(leap, 0);
      assert.ok(ld === 29 || ld === 30);
    }
  }
});
