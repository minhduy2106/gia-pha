// Kết nối Cloudflare D1, cùng giao diện với db-node.js. D1 không cho BEGIN/COMMIT, nên ghi nhiều câu thì dùng batch (một giao dịch).
function d1Db(D1) {
  const stmt = (sql, params = []) => D1.prepare(sql).bind(...params);
  return {
    all: async (sql, params) => (await stmt(sql, params).all()).results,
    first: async (sql, params) => (await stmt(sql, params).first()) ?? null,
    batch: async (list) => (await D1.batch(list.map(({ sql, params }) => stmt(sql, params)))).map((r) => r.results ?? []),
  };
}

module.exports = { d1Db };
