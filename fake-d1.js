// Giả lập Cloudflare D1 trên SQLite trong bộ nhớ, chỉ dùng cho test: prepare().bind().all()/first(),
// batch() là một giao dịch, và bind giá trị undefined thì báo lỗi như D1 thật.
const { nodeDb } = require('./db-node');

function fakeD1() {
  const { raw } = nodeDb(':memory:');
  const run = (sql, p) => {
    if (p.some((x) => x === undefined)) throw new Error(`D1_TYPE_ERROR: undefined trong tham số của: ${sql}`);
    return raw.prepare(sql).all(...p);
  };
  return {
    prepare: (sql) => ({
      bind: (...p) => ({
        sql, p,
        all: async () => ({ results: run(sql, p) }),
        first: async () => run(sql, p)[0] ?? null,
      }),
    }),
    batch: async (stmts) => {
      raw.exec('BEGIN');
      try {
        const out = stmts.map((s) => ({ results: run(s.sql, s.p) }));
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

module.exports = { fakeD1 };
