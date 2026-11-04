// ぴよ共通の会話記録：確かめた改善の配り方（版つきのデータ）。ブラウザと Node の両方で読める。
// 改善は「候補 → 根拠確認 → 3 つで検証 → 採用 → 配布」。配るのは status が adopted のものだけ。
// 中身には会話の原文・個人の情報を入れない（例は架空のものに置きかえる）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PiyoLogRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const APPS = ['piyorin-news', 'blue-tree', 'claude-pet'];
  // 直す所（仕様案 6.）。指示文を足すだけで直らないものは、コードの直し（needs）を書く
  const AREAS = ['source', 'parse', 'context', 'fresh', 'fetch', 'grounding', 'format', 'tone'];
  const STATUSES = ['candidate', 'checked', 'verified', 'adopted', 'retired'];
  const isVer = (s) => typeof s === 'string' && /^\d{4}\.\d{2}\.\d{2}-\d+$/.test(s);

  function validate(doc) {
    const e = [];
    if (!doc || doc.v !== 1) e.push('v');
    if (!isVer(doc && doc.version)) e.push('version');
    if (!doc || !Array.isArray(doc.rules)) return { ok: false, errors: e.concat('rules') };
    const ids = new Set();
    doc.rules.forEach((r, i) => {
      const at = 'rules[' + i + ']';
      if (!r || typeof r.id !== 'string' || !/^R\d{3,}$/.test(r.id)) e.push(at + '.id');
      else if (ids.has(r.id)) e.push(at + '.id-dup'); else ids.add(r.id);
      if (!STATUSES.includes(r.status)) e.push(at + '.status');
      if (!AREAS.includes(r.area)) e.push(at + '.area');
      if (!Array.isArray(r.apps) || !r.apps.length || !r.apps.every((a) => APPS.includes(a))) e.push(at + '.apps');
      if (typeof r.guidance !== 'string' || !r.guidance.trim() || r.guidance.length > 600) e.push(at + '.guidance');
      if (r.kinds && (!Array.isArray(r.kinds) || !r.kinds.every((k) => typeof k === 'string'))) e.push(at + '.kinds');
      if (r.needs && (!Array.isArray(r.needs) || !r.needs.every((k) => typeof k === 'string'))) e.push(at + '.needs');
      if (r.expires && Number.isNaN(Date.parse(r.expires))) e.push(at + '.expires');
      if (r.status === 'adopted' && (!Array.isArray(r.tests) || !r.tests.length)) e.push(at + '.tests'); // 再発の試験の無い改善は配らない
    });
    return { ok: e.length === 0, errors: e };
  }

  // そのアプリ・その種類の質問に使う改善だけ。壊れたデータ・期限切れ・足りない機能のものは使わない
  // has: アプリが持っている機能の名前（needs に書いた物が全部あるときだけ使う）
  function select(doc, app, { kind, now = new Date(), has = [] } = {}) {
    if (!validate(doc).ok) return [];
    return doc.rules.filter((r) => r.status === 'adopted' && r.apps.includes(app)
      && (!r.kinds || !kind || r.kinds.includes(kind))
      && (!r.expires || Date.parse(r.expires) > now.getTime())
      && (!r.needs || r.needs.every((n) => has.includes(n))));
  }

  // 新しい版を使うか。取れなかった・壊れていたときは、最後に確かめた版のまま
  function pick(current, incoming) {
    if (!incoming || !validate(incoming).ok) return current || null;
    if (current && validate(current).ok && current.version >= incoming.version) return current;
    return incoming;
  }

  return { APPS, AREAS, STATUSES, validate, select, pick };
});
