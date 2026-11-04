// ぴよ共通の会話記録：記録の形（版 1）と、送る前に必ず通す確かめ・伏せ字。
// ブラウザ（ぴよりんニュース・blue tree）と Node（Claude Pet・収集窓口）の両方で読めるように書く。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PiyoLogSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  const APPS = ['piyorin-news', 'blue-tree', 'claude-pet'];
  const KINDS = ['turn.start', 'turn.end', 'feedback', 'delete'];
  const STATUSES = ['ok', 'error', 'timeout', 'aborted', 'cut', 'interrupted'];
  const ROUTES = ['local', 'infobase', 'relay', 'api', 'web', 'other'];
  const LIMITS = { question: 8000, answer: 20000, comment: 2000, sources: 20, ctxRefs: 20, event: 64 * 1024 };

  // 記録に入れてはいけない名前（認証まわり）。見つけたら中身ごと捨てる。
  const SECRET_KEY = /^(api[-_]?key|apikey|x-api-key|token|access[-_]?token|refresh[-_]?token|relay[-_]?token|secret|client[-_]?secret|password|passwd|authorization|auth|cookie|set-cookie|bearer)$/i;
  // URL の中の秘密になりやすい値。
  const SECRET_PARAM = /^(key|api[-_]?key|token|access[-_]?token|sig|signature|auth|secret|code|password|session|sid)$/i;
  // 文の中に紛れた鍵（Anthropic・GitHub・一般的な Bearer）。
  const SECRET_TEXT = [
    /sk-ant-[A-Za-z0-9_\-]{10,}/g,
    /gh[pousr]_[A-Za-z0-9]{20,}/g,
    /github_pat_[A-Za-z0-9_]{20,}/g,
    /Bearer\s+[A-Za-z0-9._\-]{16,}/gi,
    /piyo-mac v1 \S+ \S+/g, // Claude Pet のつなぎ方（合言葉入り）
    /piyo-log v1 \S+ \S+/g, // 会話記録のつなぎ方（合言葉入り）
  ];
  const MASK = '[伏せた]';

  function redactText(s) {
    if (typeof s !== 'string') return s;
    let out = s;
    for (const re of SECRET_TEXT) out = out.replace(re, MASK);
    return out;
  }

  function redactUrl(u) {
    if (typeof u !== 'string') return u;
    try {
      const url = new URL(u);
      if (url.username || url.password) { url.username = ''; url.password = ''; }
      for (const k of Array.from(url.searchParams.keys())) {
        if (SECRET_PARAM.test(k)) url.searchParams.set(k, 'REDACTED');
      }
      return url.toString();
    } catch (_) {
      return redactText(u);
    }
  }

  // 名前が秘密っぽい項目を落とし、文字列の中の鍵を伏せる。元の物は変えない。
  function sanitize(value, depth) {
    depth = depth || 0;
    if (depth > 8) return undefined;
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1)).filter((v) => v !== undefined);
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) {
        if (SECRET_KEY.test(k)) continue;
        const v = (k === 'url' || k === 'href') ? redactUrl(value[k]) : sanitize(value[k], depth + 1);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    return value;
  }

  const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_\-:.]{6,80}$/.test(s);
  const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /Z$/.test(s);
  const isBool = (b) => typeof b === 'boolean';
  const len = (s) => (typeof s === 'string' ? s.length : 0);

  function validate(ev) {
    const e = [];
    if (!ev || typeof ev !== 'object') return { ok: false, errors: ['not-object'] };
    if (ev.v !== VERSION) e.push('version');
    if (!KINDS.includes(ev.kind)) e.push('kind');
    if (!APPS.includes(ev.app)) e.push('app');
    if (!isId(ev.eventId)) e.push('eventId');
    if (!isId(ev.deviceId)) e.push('deviceId');
    if (!isIso(ev.at)) e.push('at');
    if (typeof ev.appVer !== 'string' || ev.appVer.length > 40) e.push('appVer');
    if (ev.kind !== 'delete') {
      if (!isId(ev.convId)) e.push('convId');
      if (!isId(ev.turnId)) e.push('turnId');
    }
    if (ev.kind === 'turn.start') {
      if (typeof ev.question !== 'string') e.push('question');
      else if (len(ev.question) > LIMITS.question) e.push('question-too-long');
      if (!Number.isInteger(ev.seq) || ev.seq < 0) e.push('seq');
      const f = ev.flags || {};
      if (!isBool(f.aiSafe) || !isBool(f.share)) e.push('flags');
      if (ev.ctxRefs && (!Array.isArray(ev.ctxRefs) || ev.ctxRefs.length > LIMITS.ctxRefs || !ev.ctxRefs.every(isId))) e.push('ctxRefs');
    }
    if (ev.kind === 'turn.end') {
      if (!STATUSES.includes(ev.status)) e.push('status');
      if (ev.answer != null && typeof ev.answer !== 'string') e.push('answer');
      if (len(ev.answer) > LIMITS.answer) e.push('answer-too-long');
      if (ev.route != null && !ROUTES.includes(ev.route)) e.push('route');
      if (ev.sources && (!Array.isArray(ev.sources) || ev.sources.length > LIMITS.sources)) e.push('sources');
      if (ev.ms != null && (typeof ev.ms !== 'number' || ev.ms < 0)) e.push('ms');
    }
    if (ev.kind === 'feedback') {
      if (![null, 'good', 'bad'].includes(ev.rating == null ? null : ev.rating)) e.push('rating');
      if (len(ev.comment) > LIMITS.comment || len(ev.correction) > LIMITS.answer) e.push('feedback-too-long');
    }
    if (ev.kind === 'delete') {
      if (!['turn', 'conv', 'all'].includes(ev.scope)) e.push('scope');
      if (ev.scope !== 'all' && !isId(ev.targetId)) e.push('targetId');
    }
    try {
      if (JSON.stringify(ev).length > LIMITS.event) e.push('event-too-large');
    } catch (_) { e.push('not-json'); }
    return { ok: e.length === 0, errors: e };
  }

  function newId(prefix) {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    let r;
    if (c && c.randomUUID) r = c.randomUUID().replace(/-/g, '');
    else if (c && c.getRandomValues) r = Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    else throw new Error('no-crypto');
    return (prefix || 'e') + '_' + r;
  }

  return { VERSION, APPS, KINDS, STATUSES, ROUTES, LIMITS, MASK, sanitize, redactUrl, redactText, validate, newId };
});
