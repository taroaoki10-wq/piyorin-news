// infobase/app/src/shared/brief-client.cjs の写し（2026-11-04）。直すときは infobase 側を直して写し直す。
/*
 * ぴよ札の共通クライアント。ブラウザ（blue tree・ぴよりんニュース）と Node（Claude Pet）の両方で使う。
 *
 *  ・札はまとめて受け取り、手元に覚える（中身が変わっていなければ受け取り直さない）。
 *  ・質問の文は infobase に送らない。札の辞書（index）を使って、この端末の中で札を選ぶ。
 *  ・期限が過ぎた札、日付が変わった「今日」「明日」の札は、手元に覚えていても使わない。
 *  ・鍵・質問・返事はログに残さない。
 *
 * 使い方：
 *   const brief = InfobaseBrief.create({url, key});
 *   const r = await brief.answer('名古屋の明日の天気は？');
 *   // r.briefs[0].say … 口調のない文。アプリが口調を付けて言う。
 *   // r.briefs[0].status が 'あり' 以外なら、推測せず「まだ分からない」と言う。
 */
(function (root) {
  const DAY = 86400000;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const jstDay = value => new Date(+new Date(value) + 9 * 3600000).toISOString().slice(0, 10);
  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const has = (text, words) => (words || []).some(w => text.includes(norm(w)));
  const longest = (text, words) => (words || []).filter(w => text.includes(norm(w))).sort((a, b) => b.length - a.length)[0] || null;

  function usable(brief, bundle, now) {
    if (!brief) return false;
    if (brief.status !== 'あり') return true; // 「まだ無い」「古い」も、ぴよが正しく断るために使う
    if (brief.fresh_until && +new Date(brief.fresh_until) <= +new Date(now)) return false;
    if (brief.relative && bundle.built_day && bundle.built_day !== jstDay(now)) return false;
    return true;
  }
  function missing(id, reason) {
    return { id, topic: id.split(':')[0], status: 'まだ無い', reason, say: null, facts: null, headlines: [], ai_material: '', sources: [] };
  }
  /** 札を 1 枚取り出す。使えないときは「まだ無い」の札を返す（ぴよが推測で答えないため）。 */
  function pick(bundle, id, now = Date.now()) {
    const real = bundle?.aliases?.[id] || id;
    const brief = (bundle?.briefs || []).find(b => b.id === real);
    if (!brief) return missing(id, 'この札はまだ作っていません');
    if (!usable(brief, bundle, now)) return missing(id, '情報が古くなったので組み直しを待っています');
    return brief;
  }

  /** 曜日の言葉（「金曜」「土曜日」）から、今日から 7 日以内の日付を出す。 */
  function weekdayDate(text, now) {
    const today = jstDay(now);
    const base = new Date(today + 'T12:00:00+09:00');
    for (let i = 0; i < 7; i++) {
      const d = new Date(+base + i * DAY);
      const w = WEEK[d.getUTCDay()];
      if (text.includes(w + '曜')) return jstDay(d);
    }
    if (text.includes('週末') || text.includes('土日')) {
      for (let i = 0; i < 7; i++) { const d = new Date(+base + i * DAY); if (d.getUTCDay() === 6) return jstDay(d); }
    }
    return null;
  }
  function dayWord(text, days) {
    for (const [label, words] of Object.entries(days || {})) if (has(text, words)) return label;
    return null;
  }

  /**
   * 質問の文から、使う札の名前を選ぶ（最大 3 つ。先に置いたものほど合っている）。
   * 言い方の揺れ（「明日の天気」「あしたの天気は？」「名古屋あした晴れる？」）で答えが変わらないよう、
   * 決まった順番で見る。
   */
  function match(text, bundle, now = Date.now()) {
    const t = norm(text), ix = bundle?.index;
    if (!ix || !t) return [];
    const out = [];
    const add = id => { if (id && !out.includes(id)) out.push(id); };
    const day = dayWord(t, ix.weather?.days);
    const wd = weekdayDate(t, now);

    // 天気・今の気温
    if (ix.weather && (has(t, ix.weather.words) || has(t, ix.weather.now_words))) {
      const area = (ix.weather.areas.find(a => has(t, a.words)) || {}).area || ix.weather.default_area;
      if (has(t, ix.weather.now_words) && area === '名古屋市') add('now:名古屋市');
      if (day === '週間' && !wd) add(`weather:${area}:週間`);
      else if (wd && !['今日', '明日', '明後日'].includes(day)) add(`weather:${area}:${wd}`);
      else add(`weather:${area}:${day && day !== '週間' ? day : '今日'}`);
    }
    // 警報・注意報
    if (ix.warning && has(t, ix.warning.words)) {
      const pref = (ix.warning.prefs.find(p => has(t, p.words)) || {}).pref || ix.warning.default_pref;
      add(`warning:${pref}`);
    }
    if (ix.quake && has(t, ix.quake.words)) add('quake:latest');
    if (ix.fx) {
      if (has(t, ix.fx.eur_words)) add('fx:eur_jpy');
      if (has(t, ix.fx.usd_words)) add('fx:usd_jpy');
    }
    if (ix.piyorin && has(t, ix.piyorin.words)) { add('piyorin:latest'); add('news:001'); }
    if (ix.holiday && has(t, ix.holiday.words)) add(['今日', '明日'].includes(day) ? `calendar:${day}` : 'holiday:next');
    if (ix.date && has(t, ix.date.words)) add(day === '明日' ? 'date:明日' : 'date:今日');
    if (ix.calendar && has(t, ix.calendar.words) && ['今日', '明日'].includes(day)) add(`calendar:${day}`);
    // 分野のニュース（言葉がいちばん長く当たった分野を先に）
    if (ix.news) {
      const hits = ix.news.categories.map(c => ({ id: c.id, word: longest(t, c.words) })).filter(x => x.word).sort((a, b) => b.word.length - a.word.length);
      const asked = has(t, ix.news.generic_words);
      if (asked || !out.length) hits.slice(0, 2).forEach(x => add(x.id));
      if (asked && !hits.length) add(ix.news.default);
    }
    return out.slice(0, 3);
  }

  /**
   * 札の口調のない文（「〜です。」「〜ありません。」）を、ぴよの話し方にする。
   *  'piyo' … 語尾「ぴよ」（claudeぴよ・ぴよりんニュースのぴよ）。「157.90円だぴよ。」
   *  'blue' … 語尾なしのやわらかい話し方（blueぴよ）。「157.90円だよ。」
   * 文の終わりだけを変える。数字・日付・出典のかっこはそのまま。
   */
  const VOICE = {
    piyo: { 'ではありません': 'ではないぴよ', 'られません': 'られないぴよ', 'ありません': 'ないぴよ', 'ありました': 'あったぴよ', 'ています': 'ているぴよ', 'です': 'だぴよ', '': 'ぴよ' },
    blue: { 'ではありません': 'じゃないよ', 'られません': 'られないんだ', 'ありません': 'ないよ', 'ありました': 'あったよ', 'ています': 'ているよ', 'です': 'だよ', '': '' },
  };
  function voice(text, style = 'piyo') {
    const v = VOICE[style];
    if (!v || !text) return text || '';
    return String(text).replace(/([^。]*?)(ではありません|られません|ありません|ありました|ています|です)?((?:（[^）]*）)?)。/g, (m, body, end, paren, at, all) => `${body}${end ? v[end] : at + m.length >= all.trimEnd().length ? v[''] : ''}${paren}。`); // 動詞のない文（「晴れのち雨。」）は、最後の文だけに語尾を付ける
  }

  function create(config = {}) {
    const doFetch = config.fetch || ((...args) => fetch(...args));
    const base = String(config.url || '').replace(/\/$/, '');
    const enabled = config.enabled !== false && !!config.key && (/^https:\/\//.test(base) || /^http:\/\/127\.0\.0\.1:\d+$/.test(base));
    const maxAge = config.maxAgeMs ?? 60000;
    let bundle = null, fetchedAt = 0, pending = null;

    async function load(force = false) {
      if (!enabled) return null;
      if (!force && bundle && Date.now() - fetchedAt < maxAge) return bundle;
      if (pending) return pending;
      pending = (async () => {
        try {
          const q = bundle?.etag ? '?etag=' + encodeURIComponent(bundle.etag) : '';
          const res = await doFetch(base + '/v1/brief' + q, { headers: { Authorization: 'Bearer ' + config.key }, signal: AbortSignal.timeout(config.timeout || 2500), cache: 'no-store', redirect: 'error' });
          if (!res.ok) return bundle;
          const data = await res.json();
          if (!data.not_modified && Array.isArray(data.briefs)) bundle = data;
          fetchedAt = Date.now();
          return bundle;
        } catch { return bundle; } finally { pending = null; }
      })();
      return pending;
    }
    /** 質問に合う札を返す。つながらないときは、前に覚えた札で答える（期限は毎回確かめる）。 */
    async function answer(text, now = Date.now()) {
      const b = await load();
      if (!b) return { ids: [], briefs: [], offline: true };
      const ids = match(text, b, now);
      return { ids, briefs: ids.map(id => pick(b, id, now)) };
    }
    async function get(id, now = Date.now()) { const b = await load(); return b ? pick(b, id, now) : missing(id, 'infobase につながりません'); }
    /** 答えに使った札の反応を返す。札の元のカードの番号で送る（今のフィードバックの窓口のまま）。 */
    async function feedback(brief, kind) {
      const card = (brief?.sources || []).find(s => s.id);
      if (!enabled || !card) return null;
      try { const r = await doFetch(base + '/v1/feedback', { method: 'POST', headers: { Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ card_id: card.id, kind }), signal: AbortSignal.timeout(2500) }); return r.ok ? r.json() : null; } catch { return null; }
    }
    return { load, answer, get, feedback, enabled, get bundle() { return bundle; } };
  }

  const api = { create, match, pick, usable, voice };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.InfobaseBrief = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
