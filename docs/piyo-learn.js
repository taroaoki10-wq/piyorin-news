// 削除から学ぶ（2026-11-23）。手で削除した記事を「関係ない」の例、元に戻した記事を「関係ある」の例として覚え、
// 似た記事と、何度も削除した掲載元の記事を、一覧から隠す（隠した記事は「削除済み」に入り、元に戻すとそれも例になる）。
// 例は、この端末の削除の記録（piyo-del）と、Mac の定期の更新が同期先から集めた docs/data/learn.json の両方から取る。
// 計算だけ（画面・保存には触らない）。node の試験からも読む。
(function (root) {
  const DEF = {sim: 0.6, srcMin: 3, srcRate: 0.8};
  const STRIP = /ぴよりん|ピヨリン|piyorin|[\s\p{P}\p{S}]/giu;
  const norm = t => String(t || '').normalize('NFKC').toLowerCase().replace(STRIP, '');
  function grams(t) {
    const s = norm(t), g = new Set();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  }
  function dice(a, b) {
    if (a.size < 3 || b.size < 3) return 0; // 短すぎる題は比べない
    let n = 0;
    for (const x of a) if (b.has(x)) n++;
    return 2 * n / (a.size + b.size);
  }
  const ids = it => [it.id, ...(it.merged_ids || [])].filter(Boolean);
  const isOfficial = it => it && it.cat === 'official';

  // news: 今の記事（アーカイブも含めてよい）、dels: {記事ID:{t,on}}、ledger: learn.json（{del:[…],keep:[…]}）
  function build(news, dels, ledger, opt) {
    const o = Object.assign({}, DEF, opt || {});
    const byId = new Map();
    for (const n of news || []) for (const id of ids(n)) if (!byId.has(id)) byId.set(id, n);
    const last = new Map(); // 例の ID → {on, t, title, source}
    const put = (id, on, t, title, source) => {
      const c = last.get(id);
      if (!c || c.t < t) last.set(id, {on, t, title, source});
    };
    for (const k of ['del', 'keep']) for (const e of (ledger && Array.isArray(ledger[k]) ? ledger[k] : [])) {
      if (e && e.id && e.title) put(e.id, k === 'del', Number(e.t) || 0, e.title, e.source || '');
    }
    for (const [id, r] of Object.entries(dels || {})) {
      if (!r || typeof r.on !== 'boolean') continue;
      const n = byId.get(id), c = last.get(id);
      const title = n ? n.title : c && c.title, source = n ? n.source : c && c.source;
      if (title && !(n && isOfficial(n))) put(id, r.on, Number(r.t) || 0, title, source || '');
    }
    // 統合された記事は、いちばん新しい操作だけを使う
    const seen = new Set(), del = [], keep = [];
    for (const [id, e] of last) {
      const n = byId.get(id), key = n ? n.id : id;
      if (seen.has(key)) continue;
      seen.add(key);
      let best = e;
      if (n) for (const x of ids(n)) { const y = last.get(x); if (y && y.t > best.t) best = y; }
      (best.on ? del : keep).push({id: key, title: best.title, source: best.source, g: grams(best.title), t: best.t});
    }
    // 掲載元ごとの数：削除した数・戻した数・ほかに表示している記事の数
    const src = new Map();
    const s = name => { if (!src.has(name)) src.set(name, {del: 0, keep: 0, other: 0}); return src.get(name); };
    for (const e of del) if (e.source) s(e.source).del++;
    for (const e of keep) if (e.source) s(e.source).keep++;
    const decided = new Set([...del, ...keep].map(e => e.id)), counted = new Set();
    for (const n of news || []) {
      if (!n.source || decided.has(n.id) || isOfficial(n) || (n.jg && n.jg.ok === false)) continue;
      if (src.has(n.source)) { src.get(n.source).other++; counted.add(n.id); }
    }
    return {o, del, keep, src, counted, cache: new WeakMap()};
  }

  // 隠すなら理由の文、隠さないなら '' を返す（手で削除・戻した記事は呼ぶ側で先に決める）
  function why(item, m) {
    if (!item || !m || isOfficial(item) || !item.title) return '';
    let g = m.cache.get(item);
    if (!g) { g = grams(item.title); m.cache.set(item, g); }
    const mine = new Set(ids(item));
    let best = 0, hit = null;
    for (const e of m.del) {
      if (mine.has(e.id)) continue;
      const d = dice(g, e.g);
      if (d > best) { best = d; hit = e; }
    }
    if (hit && best >= m.o.sim) {
      // 戻した記事のほうが似ているなら隠さない
      const near = m.keep.some(k => !mine.has(k.id) && dice(g, k.g) >= best);
      if (!near) return '削除した「' + hit.title.slice(0, 24) + (hit.title.length > 24 ? '…' : '') + '」に似ている';
    }
    const c = item.source && m.src.get(item.source);
    const other = c ? c.other - (m.counted.has(item.id) ? 1 : 0) : 0; // 比べる記事そのものは数えない
    if (c && !c.keep && c.del >= m.o.srcMin && c.del / (c.del + other) >= m.o.srcRate) {
      return '「' + item.source + '」の記事を ' + c.del + ' 回削除している';
    }
    return '';
  }

  const api = {DEF, norm, grams, dice, build, why};
  root.PiyoLearn = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
