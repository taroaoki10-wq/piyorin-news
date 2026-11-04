// ぴよ共通の会話記録：各アプリの端末側。
// 質問を「送信待ち」に保存してから答えを作り、終わり（成功・失敗・中断）を別の記録で足す。
// 送るのは flush()。届かなければ送信待ちに残し、次に送る。容量を超えても黙って捨てない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./schema.js'));
  else root.PiyoLogRecorder = factory(root.PiyoLogSchema);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  const BATCH = 50;

  function memoryStorage(initial) {
    let state = initial ? JSON.parse(JSON.stringify(initial)) : null;
    return {
      async load() { return state ? JSON.parse(JSON.stringify(state)) : null; },
      async save(s) { state = JSON.parse(JSON.stringify(s)); },
      peek() { return state; },
    };
  }

  // localStorage など「文字列を読み書きする物」用。容量切れは save が投げる。
  function stringStorage(get, set) {
    return {
      async load() { const t = get(); return t ? JSON.parse(t) : null; },
      async save(s) { set(JSON.stringify(s)); },
    };
  }

  function emptyState() {
    return { v: 1, outbox: [], rejected: [], open: {}, seq: {}, paused: false, lastSyncAt: null, lastError: null, failures: 0, savedCount: 0 };
  }

  function createRecorder(o) {
    if (!o || !S.APPS.includes(o.app)) throw new Error('app');
    if (!o.deviceId) throw new Error('deviceId');
    const storage = o.storage || memoryStorage();
    const now = o.now || (() => new Date());
    const tz = o.tz || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
    const maxPending = o.maxPending || 2000;
    const warn = o.onWarn || (() => {});
    let state = null;
    let chain = Promise.resolve();

    // 書き込みは 1 本の列に並べる（同時に呼ばれても順番が崩れない）。
    function serial(fn) {
      const p = chain.then(fn);
      chain = p.catch(() => {});
      return p;
    }

    async function ready() {
      if (!state) state = Object.assign(emptyState(), (await storage.load()) || {});
      return state;
    }

    async function persist() {
      try {
        await storage.save(state);
        state.saveError = null;
      } catch (err) {
        // 保存に失敗したことを隠さない（全部保存できていると見せない）。
        state.saveError = String((err && err.name) || 'save-failed');
        warn('save-failed', state.saveError);
        throw err;
      }
    }

    function base(kind, extra) {
      return Object.assign({
        v: S.VERSION, kind, eventId: S.newId('ev'), app: o.app, appVer: String(o.appVer || ''),
        deviceId: o.deviceId, at: now().toISOString(), tz,
      }, extra);
    }

    async function push(ev) {
      const clean = S.sanitize(ev);
      const chk = S.validate(clean);
      if (!chk.ok) throw new Error('invalid:' + chk.errors.join(','));
      state.outbox.push(clean);
      state.savedCount += 1;
      if (state.outbox.length > maxPending && !state.overCap) {
        state.overCap = true;
        warn('over-cap', state.outbox.length);
      }
      await persist();
      return clean;
    }

    // 質問を受けた。答えを作る前に呼ぶ。止めている間は null を返す（記録しない）。
    function startTurn(p) {
      return serial(async () => {
        await ready();
        if (state.paused) return null;
        const convId = p.convId;
        const seq = state.seq[convId] = (state.seq[convId] == null ? 0 : state.seq[convId] + 1);
        const turnId = p.turnId || S.newId('tn');
        const flags = Object.assign({ aiSafe: true, share: true }, p.flags || {});
        await push(base('turn.start', {
          convId, turnId, seq, question: String(p.question || ''),
          ctxRefs: p.ctxRefs || undefined, parsed: p.parsed || undefined, flags,
        }));
        state.open[turnId] = convId;
        await persist();
        return turnId;
      });
    }

    // 答え終わった（または失敗・中断）。途中までの答えも answer に入れる。
    function endTurn(turnId, r) {
      return serial(async () => {
        await ready();
        const convId = state.open[turnId];
        if (!convId) return null; // 止めている間に始まった・もう終わった
        delete state.open[turnId];
        await push(base('turn.end', {
          convId, turnId, status: r.status, answer: r.answer == null ? undefined : String(r.answer),
          route: r.route, model: r.model, ruleVer: r.ruleVer, ms: r.ms, errorKind: r.errorKind,
          sources: r.sources,
        }));
        return true;
      });
    }

    function feedback(p) {
      return serial(async () => {
        await ready();
        if (state.paused) return null;
        await push(base('feedback', {
          convId: p.convId, turnId: p.turnId, rating: p.rating == null ? null : p.rating,
          reason: p.reason, comment: p.comment, correction: p.correction,
        }));
        return true;
      });
    }

    // 消す。止めている間でも受け付ける。まだ送っていない分はここで捨て、窓口にも消す記録を送る。
    function remove(scope, targetId) {
      return serial(async () => {
        await ready();
        const hit = (ev) => scope === 'all' || (scope === 'conv' ? ev.convId === targetId : ev.turnId === targetId);
        state.outbox = state.outbox.filter((ev) => ev.kind === 'delete' || !hit(ev));
        state.rejected = state.rejected.filter((x) => !hit(x.event));
        for (const t of Object.keys(state.open)) if (scope === 'all' || (scope === 'conv' ? state.open[t] === targetId : t === targetId)) delete state.open[t];
        if (scope !== 'turn') {
          for (const c of Object.keys(state.seq)) if (scope === 'all' || c === targetId) delete state.seq[c];
        }
        await push(base('delete', { scope, targetId: scope === 'all' ? undefined : targetId }));
        return true;
      });
    }

    function setPaused(b) {
      return serial(async () => { await ready(); state.paused = !!b; await persist(); return state.paused; });
    }

    // 起動したときに呼ぶ。前回、答えの途中で閉じた分を「途中で終わった」にする。
    function recover() {
      return serial(async () => {
        await ready();
        const ids = Object.keys(state.open);
        for (const turnId of ids) {
          const convId = state.open[turnId];
          delete state.open[turnId];
          await push(base('turn.end', { convId, turnId, status: 'interrupted' }));
        }
        return ids.length;
      });
    }

    // send(events) → { accepted:[id], duplicate:[id], rejected:[{eventId,reason}] }。投げたらつながっていない扱い。
    function flush(send) {
      return serial(async () => {
        await ready();
        let sent = 0;
        while (state.outbox.length) {
          const batch = state.outbox.slice(0, BATCH);
          let res;
          try {
            res = await send(batch);
          } catch (err) {
            state.failures += 1;
            state.lastError = { at: now().toISOString(), kind: String((err && err.code) || (err && err.name) || 'offline') };
            await persist();
            return { sent, pending: state.outbox.length, offline: true };
          }
          const done = new Set([...(res.accepted || []), ...(res.duplicate || [])]);
          const bad = new Map((res.rejected || []).map((x) => [x.eventId, x.reason]));
          for (const ev of batch) {
            if (bad.has(ev.eventId)) state.rejected.push({ event: ev, reason: bad.get(ev.eventId), at: now().toISOString() });
          }
          const before = state.outbox.length;
          state.outbox = state.outbox.filter((ev) => !done.has(ev.eventId) && !bad.has(ev.eventId));
          sent += before - state.outbox.length;
          if (before === state.outbox.length) { // 窓口が何も受け取らなかった：同じ物を送り続けない
            state.lastError = { at: now().toISOString(), kind: 'no-progress' };
            await persist();
            return { sent, pending: state.outbox.length, offline: false, stuck: true };
          }
        }
        state.failures = 0;
        state.lastError = null;
        state.lastSyncAt = now().toISOString();
        if (state.outbox.length <= maxPending) state.overCap = false;
        await persist();
        return { sent, pending: 0, offline: false };
      });
    }

    function status() {
      return serial(async () => {
        await ready();
        return {
          pending: state.outbox.length, rejected: state.rejected.length, open: Object.keys(state.open).length,
          paused: state.paused, lastSyncAt: state.lastSyncAt, lastError: state.lastError,
          overCap: !!state.overCap, saveError: state.saveError || null, savedCount: state.savedCount,
        };
      });
    }

    // つながらない回数が増えたら次に試すまでの間を延ばす（最大 30 分）。
    function nextRetryMs() {
      const f = state ? state.failures : 0;
      return f === 0 ? 0 : Math.min(30 * 60 * 1000, 15000 * Math.pow(2, f - 1));
    }

    return { startTurn, endTurn, feedback, remove, setPaused, recover, flush, status, nextRetryMs };
  }

  return { createRecorder, memoryStorage, stringStorage };
});
