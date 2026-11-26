// Kết nối SQLite trên máy (Node 22 có sẵn node:sqlite). Cùng giao diện với db-d1.js:
// all(sql, params) -> rows, first(sql, params) -> row | null, batch([{ sql, params }]) -> rows[] (chạy trọn gói hoặc không gì cả)
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATION = fs.readFileSync(path.join(__dirname, 'migrations/0001_init.sql'), 'utf8');

function nodeDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec(MIGRATION);
  return {
    raw,
    all: async (sql, params = []) => raw.prepare(sql).all(...params),
    first: async (sql, params = []) => raw.prepare(sql).get(...params) ?? null,
    batch: async (list) => {
      raw.exec('BEGIN');
      try {
        const out = list.map(({ sql, params = [] }) => raw.prepare(sql).all(...params));
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

module.exports = { nodeDb };
