// ぴよとの会話を楽しくする部品。手元のデータだけで動き、通信も料金もかからない（返事を流して出す部分だけは Claude の返事を読む）。
// index.html から window.PiyoExtras で使う。日付は日本時間の 'YYYY-MM-DD'、時刻は日本時間の時（0〜23）で受け取る。
window.PiyoExtras = (function () {
  const WD = '日月火水木金土';
  const wd = s => WD[new Date(s + 'T00:00:00Z').getUTCDay()];
  const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
  const diff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
  const jp = s => { const [, m, d] = s.split('-').map(Number); return `${m}月${d}日（${wd(s)}）`; };
  const endOf = e => e.end || e.start;
  const span = e => endOf(e) === e.start ? jp(e.start) : `${jp(e.start)}〜${jp(endOf(e))}`;
  // 全角の英数字・記号をそろえ、空白と文末の記号を外す（？は ? になる）
  const norm = q => String(q || '').normalize('NFKC').replace(/\s+/g, '').replace(/[?!。、]+$/, '');
  const hira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).toLowerCase();
  const OFFICIAL = '値段や時間は変わることがあるから、最新は公式サイトで確かめてぴよ。';

  // ---- 予定の名前と質問を、2文字ずつの並びで照らし合わせる ----
  const grams = s => {
    const t = hira(String(s).normalize('NFKC').replace(/[\s、。！？!?「」『』・（）()×～〜\-—:：/]/g, ''));
    const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g;
  };
  function matchEvents(t, events) {
    const list = (events || []).filter(e => e && e.start && e.title);
    if (!list.length) return [];
    const eg = list.map(e => grams(e.title)), count = new Map();
    eg.forEach(g => g.forEach(x => count.set(x, (count.get(x) || 0) + 1)));
    // 「ぴよ」「りん」「販売」のように、多くの予定に出てくる並びは手がかりにしない
    const common = x => count.get(x) > Math.max(2, list.length * 0.2) || ['ぴよ', 'より', 'りん', 'はん', 'ばい'].includes(x);
    const qg = grams(t);
    const scored = list.map((e, i) => [[...eg[i]].filter(x => !common(x) && qg.has(x)).length, e]).filter(([s]) => s >= 2);
    if (!scored.length) return [];
    const best = Math.max(...scored.map(([s]) => s));
    return scored.filter(([s]) => s >= best * 0.6).map(([, e]) => e).sort((a, b) => a.start.localeCompare(b.start));
  }
  function status(e, today) {
    const end = endOf(e);
    if (end < today) return 'もう終わったぴよ。';
    if (e.start <= today) return end === today ? '今日までだぴよ！' : `いま開催中で、${jp(end)}までだぴよ。`;
    const n = diff(today, e.start);
    return n === 1 ? '明日からだぴよ！' : `あと${n}日だぴよ！`;
  }
  const evRef = e => ({ type: 'event', id: e.id });

  // ---- おみくじ（日付と端末ごとの種で決まるので、同じ日に何度引いても同じ結果） ----
  function rng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const FORTUNES = [
    ['大吉', 20, ['思いきって並んでみると、いいことがありそうだぴよ！', '今日はなにをしてもうまくいく日だぴよ！']],
    ['中吉', 25, ['ちょっと寄り道すると、うれしい発見があるぴよ。', 'だれかと甘いものを分けると、もっとおいしくなるぴよ。']],
    ['小吉', 20, ['ゆっくり深呼吸すると、いい一日になるぴよ。', '小さないいことを3つ数えてみてぴよ。']],
    ['吉', 25, ['甘いものでひと休みすると、元気が出るぴよ。', 'いつもと違う道を歩くと、いいことがあるぴよ。']],
    ['末吉', 10, ['あとからじわじわ、いいことが来るぴよ。のんびりいこうぴよ。', '今日はがんばりすぎなくて大丈夫だぴよ。']],
  ];
  const COLORS = ['たまご色', 'ひよこ色', 'いちご色', '紅茶色', 'チョコ色', '空色', 'ミルク色', 'カラメル色'];
  function piyorinNames(basics) {
    const line = (basics && basics.lines || []).find(l => /^値段/.test(l)) || '';
    return [...new Set(line.split(/[、:：]/).flatMap(seg => { const m = seg.trim().match(/^(.+?)\s*各?[\d,]+円/); return m ? m[1].split('・') : []; })
      .map(s => s.trim()).filter(s => /ぴよりん$/.test(s)))];
  }
  function omikuji(ctx) {
    const r = rng(ctx.today + '|' + (ctx.omikuji && ctx.omikuji.seed || ''));
    let x = r() * 100, f = FORTUNES[FORTUNES.length - 1];
    for (const it of FORTUNES) { if ((x -= it[1]) < 0) { f = it; break; } }
    // 今売っている限定のぴよりんも、ラッキーぴよりんの候補にする
    const live = (ctx.events || []).filter(e => e.kind === 'sale' && e.start <= ctx.today && endOf(e) >= ctx.today)
      .map(e => (e.title.match(/^([^\s×]+ぴよりん)(販売)?$/) || [])[1]).filter(Boolean);
    const names = [...new Set([...piyorinNames(ctx.basics), ...live])];
    const times = (((ctx.basics && ctx.basics.lines || []).join('\n').match(/ぴよりんの販売は\s*([\d:・]+)/) || [])[1] || '').split('・').filter(Boolean);
    const lines = [`今日のぴよりんおみくじは……**${f[0]}**だぴよ！`];
    if (names.length) lines.push(`・ラッキーぴよりん：${pick(r, names)}`);
    if (times.length) lines.push(`・ラッキータイム：${pick(r, times)}`);
    lines.push(`・ラッキーカラー：${pick(r, COLORS)}`, pick(r, f[2]));
    return { fortune: f[0], text: lines.join('\n') };
  }

  // ---- その場で答える（天気・暦・予定・基本情報。分からない聞き方は null を返して Claude に任せる） ----
  const OTHER_PLACE = /東京|大阪|京都|横浜|札幌|福岡|神戸|仙台|広島|沖縄|北海道|海外|岐阜|三重|静岡|浜松|豊橋|岡崎|豊田|一宮|春日井|金沢|長野|[一-龯]{1,3}[都道府県]|[一-龯]{1,3}市|[一-龯]{1,3}区/;
  function dayLabel(date, today) {
    const n = diff(today, date);
    return n === 0 ? '今日' : n === 1 ? '明日' : n === 2 ? 'あさって' : jp(date);
  }
  function weather(t, ctx) {
    if (!/天気|予報|気温|暑い|寒い|何度|雨|傘|日の出|日の入|日没|降水|風速|強風|風が|風は|紫外線|uv|日焼け/i.test(t)) return null;
    if (/雨の日|雨でも|雨だと|雨なら/.test(t)) return null; // 天気予報ではない聞き方
    if (OTHER_PLACE.test(t.replace(/名古屋|愛知/g, ''))) return null;
    const w = (ctx.weather || []).filter(x => x.date >= ctx.today);
    if (!w.length) return { text: 'いま天気を取れてないぴよ…少しあとで、また呼んで聞いてね。', mood: 'sad', kind: 'weather' };
    const today = ctx.today;
    const nextWd = ch => { for (let i = 0; i < 7; i++) { const d = addDays(today, i); if (wd(d) === ch) return d; } };
    let dates;
    if (/週間|今週|一週間|この先|7日/.test(t)) dates = w.map(x => x.date);
    else if (/週末|土日/.test(t)) { const sat = nextWd('土'); dates = wd(today) === '日' ? [today] : [sat, addDays(sat, 1)]; }
    else if (/明後日|あさって/.test(t)) dates = [addDays(today, 2)];
    else if (/明日|あした|あす/.test(t)) dates = [addDays(today, 1)];
    else if (/今日|きょう|今夜|今晩|いま|今/.test(t)) dates = [today];
    else { const m = t.match(/([月火水木金土日])曜/); dates = [m ? nextWd(m[1]) : ctx.hour >= 17 ? addDays(today, 1) : today]; }
    const days = dates.map(d => w.find(x => x.date === d)).filter(Boolean);
    const last = w[w.length - 1].date;
    if (!days.length) return { text: `その日の天気はまだ分からないぴよ。分かるのは${jp(last)}までだぴよ。`, kind: 'weather', sources: 'weather' };
    if (days.length > 1) {
      return { text: ['名古屋の天気だぴよ！', ...days.map(d => `・${jp(d.date)} ${d.word} ${d.max}℃／${d.min}℃${d.rain != null ? ` 雨${d.rain}%` : ''}`)].join('\n'), kind: 'weather', sources: 'weather' };
    }
    const d = days[0], label = dayLabel(d.date, today);
    let text;
    if (/日の出|日の入|日没/.test(t)) {
      if (!d.sunrise || !d.sunset) return null;
      text = `${label}の名古屋の日の出は**${d.sunrise}**、日の入りは**${d.sunset}**だぴよ。`;
    } else if (/雨|傘|降水/.test(t)) {
      if (d.rain == null) return null;
      text = `${label}の名古屋の雨の確率は**${d.rain}%**だぴよ。`;
      const nowHour = d.date === today ? ctx.hour : -1;
      const wet = (d.rainHours || []).filter(h => h.to > nowHour && h.rain >= 30).sort((a, b) => b.rain - a.rain).slice(0, 2).sort((a, b) => a.from - b.from);
      if (wet.length) text += `降りやすいのは${wet.map(h => `${h.from}〜${h.to}時（${h.rain}%）`).join('と')}ごろだぴよ。`;
      text += d.rain >= 50 ? '傘を持っていってぴよ。' : d.rain < 20 ? '傘はいらなそうだぴよ。' : '折りたたみ傘があると安心だぴよ。';
    } else if (/気温|暑い|寒い|何度/.test(t)) {
      text = `${label}の名古屋は、最高**${d.max}℃**・最低${d.min}℃だぴよ。`;
      if (d.max >= 25) text += 'ぴよりんを持ち帰るなら保冷バッグがあると安心だぴよ。';
      else if (d.min <= 8) text += '朝と夜は冷えるから、あったかくしてぴよ。';
    } else if (/風/.test(t)) {
      if (d.wind == null) return null;
      text = `${label}の名古屋の最大風速は**${d.wind}m/s**だぴよ。` + (d.wind >= 10 ? '風が強いから気をつけてぴよ。' : '');
    } else if (/紫外線|uv|日焼け/i.test(t)) {
      if (d.uv == null) return null;
      text = `${label}の名古屋の紫外線の強さ（UV指数）は最大**${d.uv}**だぴよ。` + (d.uv >= 6 ? '日焼け止めがあると安心だぴよ。' : '');
    } else {
      text = `${label}の名古屋は**${d.word}**、最高${d.max}℃・最低${d.min}℃${d.rain != null ? `、雨の確率は${d.rain}%` : ''}だぴよ。`;
      if (d.rain >= 50) text += '傘を忘れずにぴよ。';
      else if (d.max >= 25) text += 'ぴよりんを持ち帰るなら保冷バッグがあると安心だぴよ。';
    }
    return { text, kind: 'weather', sources: 'weather' };
  }
  function moonTime(m) { const [d, hm] = m.time.split('T'); return `${jp(d)} ${Number(hm.slice(0, 2))}時ごろ`; }
  function koyomi(t, ctx) {
    const k = ctx.koyomi, today = ctx.today;
    const shop = /店|shop|ショップ|village|アトリエ|カフェ|定休|営業/i.test(t);
    const holiday = /祝日|祭日|祝休日|連休/.test(t) || (!shop && /休日|休み/.test(t) && /次|今度|いつ|何日|今日/.test(t));
    const sekki = /節気|立冬|立春|立夏|立秋|冬至|夏至|春分|秋分|大寒|小寒|霜降|啓蟄|大暑|小暑/.test(t);
    const moon = /満月|新月|月齢|お月さま|お月様|お月見|三日月|月の形/.test(t);
    if (!holiday && !sekki && !moon) return null;
    if (!k) return null;
    const until = k.holidays_until || '', from = k.holidays_from || k.built || '';
    if (holiday) {
      if (today < from || today > until) return null;
      if (/連休/.test(t)) {
        const lw = (k.long_weekends || []).find(x => x.end >= today && x.end <= until);
        return { text: lw ? `次の連休は**${jp(lw.start)}〜${jp(lw.end)}**の${lw.days}連休だぴよ！${lw.start <= today ? 'いまがその連休だぴよ。' : `あと${diff(today, lw.start)}日だぴよ。`}` : `${jp(until)}までに連休はないぴよ。`, kind: 'koyomi' };
      }
      const now = (k.holidays || []).find(h => h.date === today), next = (k.holidays || []).find(h => h.date > today && h.date <= until);
      let text = /今日/.test(t) ? (now ? `今日は祝日の**${now.name}**だぴよ！` : '今日は祝日じゃないぴよ。') : (now ? `今日は祝日の**${now.name}**だぴよ！` : '');
      text += next ? `次の祝日は**${jp(next.date)}の${next.name}**で、あと${diff(today, next.date)}日だぴよ。` : `${jp(until)}までに祝日はもうないぴよ。`;
      return { text, kind: 'koyomi' };
    }
    if (sekki) {
      const named = (k.sekki || []).filter(s => t.includes(s.name) && s.date >= addDays(today, -15))[0];
      if (named) return { text: `**${named.name}**は${jp(named.date)}だぴよ。${named.date > today ? `あと${diff(today, named.date)}日だぴよ。` : ''}日にちは計算したおおよその値だぴよ。`, kind: 'koyomi' };
      const cur = (k.sekki || []).filter(s => s.date <= today).at(-1), next = (k.sekki || []).find(s => s.date > today);
      if (!cur || !next) return null;
      return { text: `いまは二十四節気の**${cur.name}**（${jp(cur.date)}から）、次は**${next.name}**（${jp(next.date)}）だぴよ。日にちは計算したおおよその値だぴよ。`, kind: 'koyomi' };
    }
    const ms = m => Date.parse(m.time + '+09:00'), now = ctx.now || Date.now();
    const full = (k.moon || []).find(m => m.phase === '満月' && ms(m) > now), nw = (k.moon || []).find(m => m.phase === '新月' && ms(m) > now);
    const prev = (k.moon || []).filter(m => m.phase === '新月' && ms(m) <= now).at(-1);
    const parts = [];
    if (/新月/.test(t) && !/満月/.test(t)) { if (nw) parts.push(`次の新月は**${moonTime(nw)}**だぴよ。`); }
    else if (full) parts.push(`次の満月は**${moonTime(full)}**だぴよ。`);
    if (prev && nw) parts.push(`今日の月齢はだいたい${((now - ms(prev)) / 86400e3).toFixed(1)}だぴよ。`);
    if (!parts.length) return null;
    return { text: parts.join('') + '時刻は計算したおおよその値だぴよ。', kind: 'koyomi' };
  }
  function events(t, ctx) {
    const list = (ctx.events || []).filter(e => e && e.start && e.title), today = ctx.today;
    const hits = matchEvents(t, list);
    const when = /いつ|何日|何時から|まで|から|期間|日程|開催日|発売日|販売日|始ま|終わ|締め?切|最終日|開始|スタート/.test(t);
    if (hits.length) {
      if (!when || /値段|いくら|価格|どこ|場所|買い方|方法|どうやって/.test(t)) return null;
      // 「受付開始」のような1日だけの予定からは、いつまでかは分からない
      if (/まで|締め?切|最終日|終わ/.test(t) && hits.some(e => endOf(e) === e.start && e.kind === 'release')) return null;
      const live = hits.filter(e => endOf(e) >= today), shown = (live.length ? live : hits.slice(-3)).slice(0, 3);
      if (shown.length === 1) {
        const e = shown[0];
        return { text: `**${e.title}**は**${span(e)}**${e.place ? `、${e.place}` : ''}だぴよ。${status(e, today)}`, refs: [evRef(e)], kind: 'event', mood: endOf(e) >= today ? 'jump' : 'wave' };
      }
      return { text: ['見つけたぴよ！', ...shown.map(e => `・${e.title}：${span(e)}（${status(e, today).replace(/だ?ぴよ[。！]$/, '')}）`)].join('\n'), refs: shown.map(evRef), kind: 'event' };
    }
    const lines = es => es.map(e => `・${span(e)} ${e.title}`);
    if (/今日の(イベント|予定)|(いま|今)(?!日|月|年|週|後|度)|現在|開催中|販売中|やって(る|い)/.test(t) && /買え|販売|限定|イベント|開催|やって|予定|キャンペーン/.test(t)) {
      const sale = /買え|限定|販売中/.test(t) && !/イベント|キャンペーン/.test(t);
      const live = list.filter(e => e.start <= today && endOf(e) >= today && (!sale || e.kind === 'sale')).sort((a, b) => endOf(a).localeCompare(endOf(b)));
      if (!live.length) {
        const next = list.filter(e => e.start > today && (!sale || e.kind === 'sale')).sort((a, b) => a.start.localeCompare(b.start))[0];
        return { text: `いま${sale ? '販売中の限定' : '開催中の予定'}は、ぴよのカレンダーには入ってないぴよ。${next ? `次は**${next.title}**（${jp(next.start)}から）だぴよ！` : ''}`, refs: next ? [evRef(next)] : [], kind: 'event' };
      }
      return { text: [`いま${sale ? '販売中の限定' : '開催中'}はこれだぴよ！`, ...live.slice(0, 5).map(e => `・${e.title}（${jp(endOf(e))}まで）`), ...(sale ? ['定番のぴよりんは毎日売ってるぴよ。'] : [])].join('\n'), refs: live.slice(0, 3).map(evRef), kind: 'event' };
    }
    const month = /今月/.test(t) ? today.slice(0, 7) : /来月/.test(t) ? addDays(today.slice(0, 8) + '01', 32).slice(0, 7) : '';
    if (month && /予定|イベント|限定|販売|何がある|なにがある/.test(t)) {
      const inMonth = list.filter(e => e.start.slice(0, 7) <= month && endOf(e).slice(0, 7) >= month && endOf(e) >= today).sort((a, b) => a.start.localeCompare(b.start));
      const m = Number(month.slice(5));
      if (!inMonth.length) return { text: `${m}月の予定は、まだぴよのカレンダーに入ってないぴよ。`, kind: 'event' };
      return { text: [`${m}月の予定はこれだぴよ！`, ...lines(inMonth.slice(0, 6))].join('\n'), refs: inMonth.slice(0, 3).map(evRef), kind: 'event' };
    }
    if (/これから|今後|次の(イベント|予定|限定|販売)|予定は|予定って|イベントは|イベントある|スケジュール/.test(t)) {
      const up = list.filter(e => e.start > today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
      if (!up.length) return { text: 'これからの予定は、まだぴよのカレンダーに入ってないぴよ。', kind: 'event' };
      return { text: ['これからの予定はこれだぴよ！', ...up.map(e => `・${span(e)} ${e.title}（あと${diff(today, e.start)}日）`)].join('\n'), refs: up.slice(0, 3).map(evRef), kind: 'event' };
    }
    return null;
  }
  function basics(t, ctx) {
    const lines = ctx.basics && ctx.basics.lines;
    if (!Array.isArray(lines) || !lines.length) return null;
    const all = lines.join('\n'), line = re => lines.find(l => re.test(l)) || '';
    // 限定品や催しの名前が入った質問は、メモを読める Claude に任せる
    if (matchEvents(t, ctx.events).length) return null;
    const shops = lines.filter(l => /^店\d/.test(l)).map(l => {
      const m = l.match(/^店\d\s*(.+?)[:：]\s*(.+)$/); if (!m) return null;
      const place = m[2].split(/[（。]/)[0].trim();
      const hours = [...m[2].matchAll(/(カフェ|物販)?\s*(\d{1,2}:\d{2}〜\d{1,2}:\d{2})/g)].map(x => (x[1] || '') + x[2]);
      const sale = (m[2].match(/ぴよりんの販売は\s*([\d:・]+)/) || [])[1] || '';
      return { name: m[1].trim(), place, hours, sale, closed: /無休/.test(m[2]) };
    }).filter(Boolean);
    const shopIn = shops.filter(s => {
      const k = hira(s.name + ' ' + s.place);
      return (/アトリエ|勝川/.test(t) && /あとりえ|勝川/.test(k)) || (/village|ヴィレッジ|ビレッジ|カフェ/i.test(t) && /village/.test(k)) || (/うまいもん|広小路/.test(t) && /うまいもん/.test(k));
    });
    // 値段
    if (/いくら|値段|価格|何円|円\?/.test(t)) {
      const price = new Map();
      for (const l of [line(/^値段/), line(/^店\d.*village/i)]) {
        for (const m of l.matchAll(/([^\s、。:：（）「」]+?)\s+(各)?([\d,]+円)/g)) m[1].replace(/^限定の/, '').split('・').forEach(n => price.set(n, m[3]));
      }
      if (!price.size) return null;
      const want = [...price.keys()].filter(n => { const h = hira(t), k = hira(n); return h.includes(k) || (k.replace('ぴよりん', '').length >= 2 && h.includes(k.replace('ぴよりん', ''))); });
      // 一覧に無い「〇〇ぴよりん」（限定品など）は Claude に任せる
      const other = (t.match(/([^\sのはがを、]{2,})ぴよりん/) || [])[1];
      if (!want.length && other && !/定番|ふつう|普通|いつもの/.test(other)) return null;
      const names = want.length ? want : /定番|ぴよりん/.test(t) ? ['定番ぴよりん'].filter(n => price.has(n)) : [...price.keys()].filter(n => /ぴよりん$/.test(n)).slice(0, 5);
      if (!names.length) return null;
      if (names.length === 1) return { text: `**${names[0]}**は**${price.get(names[0])}**（税込）だぴよ。${OFFICIAL}`, kind: 'basics' };
      return { text: ['値段（税込）はこれだぴよ！', ...names.slice(0, 6).map(n => `・${n} ${price.get(n)}`), OFFICIAL].join('\n'), kind: 'basics' };
    }
    // 営業時間・販売時間
    if (/営業時間|何時から|何時まで|何時に|何時ごろ|何時頃|販売時間|開店|閉店|何時/.test(t)) {
      const list = shopIn.length ? shopIn : shops;
      if (!list.length || list.some(s => !s.hours.length)) return null;
      const body = list.map(s => `・${s.name}：${s.hours.join('・')}${s.sale ? `（ぴよりんの販売は${s.sale}）` : ''}`);
      return { text: [`${shopIn.length === 1 ? 'お店' : 'お店ごと'}の時間はこれだぴよ！`, ...body, ...(list.every(s => s.closed) ? [list.length === 1 ? 'お休みの日はないぴよ。' : 'どのお店もお休みの日はないぴよ。'] : []), OFFICIAL].join('\n'), kind: 'basics' };
    }
    // 買える場所
    if (/どこで(買|売|手に入)|どこに(売|ある)|どこ(で|に)?ある|お店|店舗|売り場|買える場所|売ってる場所|どこで食べ|どこで買/.test(t)) {
      if (/[^\sのはがを、]{2,}ぴよりん/.test(t.replace(/定番ぴよりん/, ''))) return null;
      if (!shops.length) return null;
      const list = shopIn.length ? shopIn : shops;
      return { text: [`ぴよりんが買えるのは、${list.length === 1 ? 'ここ' : `この${list.length}つのお店`}だぴよ！`, ...list.map(s => `・${s.name}：${s.place}${s.hours[0] ? `（${s.hours[0].replace(/^(カフェ|物販)/, '')}）` : ''}`),
        ...(/すぐ売り切れる/.test(all) ? ['すぐ売り切れることも多いから、早めに行くといいぴよ。'] : [])].join('\n'), kind: 'basics' };
    }
    // 消費期限
    if (/消費期限|賞味期限|日持ち|何日もつ|いつまで食べ/.test(t)) {
      const m = all.match(/消費期限は([^。、]+)/); if (!m) return null;
      return { text: `ぴよりんの消費期限は**${m[1]}**だぴよ。生菓子だから、買った日のうちに食べてぴよ。`, kind: 'basics' };
    }
    // 持ち帰り
    if (/持ち帰|持ち歩|保冷|おみやげ|お土産|何時間もつ|崩れ/.test(t)) {
      const m = all.match(/持ち歩きは([^（。]+?)が目安(（[^）]+）)?/); if (!m) return null;
      let text = `持ち歩きは**${m[1]}**が目安だぴよ${m[2] || ''}。`;
      const bag = (all.match(/保冷バッグを使うと約(\d+時間)/) || [])[1];
      if (/保冷剤[^。]*無料/.test(all)) text += `保冷剤は無料でもらえて${bag ? `、保冷バッグを使うと約${bag}もつぴよ` : 'るぴよ'}。`;
      if (/箱は水平/.test(all)) text += '箱は水平に持つのがコツだぴよ。';
      return { text, kind: 'basics' };
    }
    // 予約
    if (/予約/.test(t)) {
      if (!/予約不可/.test(all)) return null;
      let text = 'お店では予約できなくて、来た順に買うぴよ。';
      const smart = line(/^スマートぴよ約/);
      if (smart) text += `名古屋駅の無人受け取り「スマートぴよ約」なら、ネットで予約できるぴよ${/平日だけ/.test(smart) ? '（受け取りは平日だけ）' : ''}。`;
      if (/ぴよりんDX[^。]*アトリエ店だけ/.test(all)) text += 'ぴよりんDXは、アトリエ店で予約するぴよ。';
      return { text, kind: 'basics' };
    }
    // アレルギー・お酒
    if (/アレルギー|ラム酒|お酒|アルコール/.test(t)) {
      const m = all.match(/全商品に(.+?)を含み/);
      const parts = [];
      if (m && /アレルギー/.test(t)) parts.push(`全部の商品に${m[1]}が入ってるぴよ。${/アレルギー対応の商品はない/.test(all) ? 'アレルギーに対応した商品はないぴよ。' : ''}`);
      if (/ラム酒/.test(all) && /ラム酒|お酒|アルコール/.test(t)) parts.push('スポンジにほんの少しラム酒を使ってるぴよ（焼くときに飛ぶぴよ）。');
      return parts.length ? { text: parts.join(''), kind: 'basics' } : null;
    }
    // 名前の由来
    if (/由来|名前の意味|名前の理由|名前はなんで|なんでぴよりん|名前って/.test(t)) {
      if (!/ぴよぴよ.*プリン/.test(all)) return null;
      return { text: '「ぴよりん」は、ひよこの鳴き声「ぴよぴよ」と「プリン」を合わせた名前だぴよ。', kind: 'basics' };
    }
    // 中身
    if (/何でできて|なにでできて|材料|中身|中は|何層|層/.test(t)) {
      if (!/名古屋コーチン/.test(all) || !/ババロア/.test(all) || !/3層/.test(all)) return null;
      return { text: '中から、名古屋コーチンの卵を使ったプリン、なめらかなババロア、スポンジクラム（粉みたいなスポンジ）の**3層**になってるぴよ。1つずつ手作りだから、顔や色がちょっとずつ違うぴよ。', kind: 'basics' };
    }
    // どんなお菓子
    if (/ぴよりんって(何|なに|どんな)|ぴよりんとは|どんなお菓子|どんなスイーツ/.test(t)) {
      const y = (all.match(/(\d{4})年発売/) || [])[1];
      if (!/ひよこ型のスイーツ/.test(all)) return null;
      return { text: `ぴよりんは名古屋生まれの、ひよこの形のスイーツだぴよ。${y ? `${y}年に発売されたぴよ。` : ''}`, kind: 'basics' };
    }
    return null;
  }
  function localAnswer(q, ctx) {
    const t = norm(q);
    if (!t || t.length > 48) return null;
    const cal = calendarAsk(t, ctx);
    if (cal) return cal;
    if (/なぜ|どうして|理由|比べ|違い|おすすめ|オススメ|どっち|調べ|検索|ウェブ|web|ネット|記事/i.test(t)) return null;
    if (/おみくじ|占い|うらない|運勢/.test(t)) {
      if (!ctx.omikuji) return null;
      const o = omikuji(ctx);
      return { text: (ctx.omikuji.drawn ? '今日はもう引いたぴよ！結果をもう一度言うね。\n' : '') + o.text, kind: 'omikuji', mood: /大吉|中吉/.test(o.fortune) ? 'jump' : 'wave' };
    }
    return weather(t, ctx) || koyomi(t, ctx) || events(t, ctx) || basics(t, ctx) || null;
  }

  // ---- あいさつの先頭に足す一言（時間帯のあいさつと、近い予定の「あと◯日」） ----
  function greeting(ctx) {
    const h = ctx.hour, today = ctx.today;
    const hello = h >= 5 && h < 10 ? 'おはようぴよ！' : h >= 10 && h < 17 ? 'こんにちはぴよ！' : h >= 17 && h < 23 ? 'こんばんはぴよ！' : '夜ふかしさんだぴよ？こんばんはぴよ！';
    const list = (ctx.events || []).filter(e => e && e.start && e.title);
    const pickFirst = f => list.filter(f).sort((a, b) => a.start.localeCompare(b.start))[0];
    let e, text = '';
    if ((e = pickFirst(x => x.start < today && endOf(x) === today))) text = `**${e.title}**は今日までだぴよ！`;
    else if ((e = pickFirst(x => x.start === today))) text = endOf(e) === e.start ? `今日は**${e.title}**の日だぴよ！` : `今日から**${e.title}**だぴよ！`;
    else if ((e = pickFirst(x => x.start === addDays(today, 1)))) text = endOf(e) === e.start ? `明日は**${e.title}**の日だぴよ！` : `明日から**${e.title}**だぴよ！`;
    else if ((e = pickFirst(x => x.start > today && diff(today, x.start) <= 14))) text = `**${e.title}**まで、あと${diff(today, e.start)}日だぴよ！`;
    return { hello, countdown: text ? { text, event: e } : null };
  }

  // ---- ぴよを押したときのひとこと（同じ話を続けない） ----
  function tidbits(ctx) {
    const all = (ctx.basics && ctx.basics.lines || []).join('\n'), out = [], today = ctx.today, h = ctx.hour;
    const add = (key, ok, text) => { if (ok && text) out.push({ key, text }); };
    const year = (all.match(/(\d{4})年発売/) || [])[1];
    add('born', year, `ぴよりんが生まれたのは${year}年なんだぴよ。`);
    add('name', /ぴよぴよ.*プリン/.test(all), '「ぴよりん」は、「ぴよぴよ」と「プリン」を合わせた名前だぴよ。');
    add('cochin', /名古屋コーチン/.test(all), 'ぴよりんのプリンには、名古屋コーチンの卵を使ってるぴよ。');
    add('face', /個体差/.test(all), 'ぴよりんは1つずつ手作りだから、顔がちょっとずつ違うぴよ。お気に入りの顔を探してみてぴよ。');
    add('challenge', /#ぴよりんチャレンジ/.test(all), '崩さずに持ち帰る「#ぴよりんチャレンジ」が、SNSで話題になったことがあるぴよ。');
    add('fujii', /藤井聡太/.test(all), '藤井聡太さんが対局のおやつに「ぴよりんアイス」を選んで、全国に知られたぴよ。');
    const anniv = all.match(/(\d{4})年は(\d+)周年/);
    add('anniv', anniv && anniv[1] === today.slice(0, 4), anniv && `今年はぴよりんの${anniv[2]}周年だぴよ！`);
    add('dew', /結露/.test(all), 'ぴよりんの表面の水滴は結露だから、心配いらないぴよ。');
    add('box', /箱は水平/.test(all), 'ぴよりんの箱は、水平に持つのがコツだぴよ。');
    const k = ctx.koyomi;
    if (k) {
      const cur = (k.sekki || []).filter(s => s.date <= today).at(-1), next = (k.sekki || []).find(s => s.date > today);
      add('sekki', cur && next, cur && next && `いまは二十四節気の「${cur.name}」だぴよ。次の「${next.name}」は${jp(next.date)}だぴよ。`);
      const now = ctx.now || Date.now(), full = (k.moon || []).find(m => m.phase === '満月' && Date.parse(m.time + '+09:00') > now);
      add('moon', full, full && `次の満月は${moonTime(full)}だぴよ。お月見しようぴよ。`);
      const hol = (k.holidays || []).find(x => x.date > today && x.date <= (k.holidays_until || ''));
      add('holiday', hol, hol && `次の祝日は${jp(hol.date)}の${hol.name}だぴよ。`);
    }
    const g = greeting(ctx);
    if (g.countdown) out.push({ key: 'countdown', text: g.countdown.text.replace(/\*\*/g, ''), refs: [evRef(g.countdown.event)] });
    const tw = (ctx.weather || []).find(w => w.date === addDays(today, 1));
    add('weather', tw, tw && `明日の名古屋は${tw.word}の予報だぴよ。${tw.rain >= 50 ? '傘を忘れずにぴよ。' : ''}`);
    const first = (all.match(/ぴよりんの販売は\s*(\d{1,2}:\d{2})/) || [])[1];
    add('morning', h >= 5 && h < 10 && first, `ぴよりんshopの最初の販売は${first}からだぴよ。`);
    add('lunch', h >= 11 && h < 14, 'お昼ごはんのあとは、甘いものでひと休みもいいぴよ。');
    add('night', h >= 23 || h < 5, 'そろそろ寝る時間だぴよ。おやすみぴよ。');
    return out;
  }
  function tidbit(ctx, used, rand) {
    const pool = tidbits(ctx);
    if (!pool.length) return null;
    let left = pool.filter(x => !used.has(x.key));
    if (!left.length) { used.clear(); left = pool; }
    const it = left[Math.floor((rand || Math.random)() * left.length)];
    used.add(it.key);
    return it;
  }

  // ---- 返事の最後の参照 [[参照:m3,e2]] を外す ----
  function refs(text) {
    const s = String(text || ''), ids = [];
    const out = s.replace(/\s*\[\[\s*参照\s*[:：]\s*([^\]]*)\]\]\s*/g, (_, list) => { list.split(/[,、\s]+/).filter(Boolean).forEach(x => ids.push(x.trim())); return '\n'; }).trim();
    return { text: out, ids: [...new Set(ids)] };
  }
  // 作っている途中の返事から、言い終わった文までを返す（参照の印から先は出さない）
  function streamView(raw) {
    let s = String(raw || '');
    const i = s.indexOf('[['); if (i >= 0) s = s.slice(0, i);
    s = s.replace(/\[$/, '');
    const end = Math.max(s.lastIndexOf('。'), s.lastIndexOf('！'), s.lastIndexOf('？'), s.lastIndexOf('\n'));
    return end < 0 ? '' : s.slice(0, end + 1).replace(/\s+$/, '');
  }
  // Messages API のストリーム（SSE）を読み、文字が届くたびに onText(ここまでの文) を呼ぶ。最後に返事全体を返す
  const ERR = { overloaded_error: 529, rate_limit_error: 429, api_error: 500, invalid_request_error: 400, authentication_error: 401, permission_error: 403, not_found_error: 404, request_too_large: 413 };
  async function readMessage(response, onText) {
    const reader = response.body.getReader(), dec = new TextDecoder();
    const blocks = [], json = [];
    let buf = '', stop = null, text = '';
    const handle = ev => {
      if (ev.type === 'content_block_start') { blocks[ev.index] = { ...ev.content_block }; json[ev.index] = ''; }
      else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index]; if (!b) return;
        if (ev.delta.type === 'text_delta') { b.text = (b.text || '') + ev.delta.text; text += ev.delta.text; if (onText) onText(text); }
        else if (ev.delta.type === 'input_json_delta') json[ev.index] += ev.delta.partial_json || '';
      } else if (ev.type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b && b.type === 'tool_use') { try { b.input = json[ev.index] ? JSON.parse(json[ev.index]) : {}; } catch (_) { b.input = {}; } }
      } else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; }
      else if (ev.type === 'error') {
        const e = new Error('stream'); e.status = ERR[ev.error && ev.error.type] || 500; e.detail = ev.error && ev.error.message || ''; throw e;
      }
    };
    const flush = chunk => {
      const data = chunk.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (data) handle(JSON.parse(data));
    };
    for (;;) {
      const { value, done } = await reader.read();
      buf += dec.decode(value || new Uint8Array(), { stream: !done });
      const parts = buf.split(/\r?\n\r?\n/); buf = parts.pop();
      parts.forEach(flush);
      if (done) { if (buf.trim()) flush(buf); break; }
    }
    return { content: blocks.filter(Boolean), stop_reason: stop };
  }

  // ---- Mac の Claude（Claude Pet の窓口）で答える ----
  // 「つなぎ方」の 1 行（Claude Pet の設定の窓の「つなぎ方をコピー」）を読む。形: piyo-mac v1 https://<機器>.<tailnet>.ts.net <合言葉>
  // Claude Pet の parseLink と同じ決まり（https だけ・道なし・合言葉は英数字と - _ で 20 文字以上。前後の空白・改行は無視）
  function parseMacLink(text) {
    const m = /piyo-mac v1 (https:\/\/[^\s/]+)\/?\s+([A-Za-z0-9_-]{20,})/.exec(typeof text === 'string' ? text : '');
    return m ? { url: m[1], token: m[2] } : null;
  }
  // 窓口の返事（text/event-stream）を読む。event: text は「いまの答えのここまで」（調べたあとの書き直しは空から）で onText(文)、
  // event: status（thinking・searching・reading）で onStatus(state)。event: done で readMessage と同じ形を返す（調べる回数の上限で
  // 止まったら stop_reason は 'max_turns'）。event: error は e.kind（login・limit・timeout・failed）と e.resetsAt（秒）で投げる。
  // 終わりが届かずに切れた・idleMs のあいだ何も届かない（窓口は調べている間も 10 秒ごとに空の行を送る）ときは e.kind='cut'
  async function readRelay(response, onText, onStatus, idleMs = 35000) {
    const reader = response.body.getReader(), dec = new TextDecoder();
    const fail = kind => { const e = new Error('relay'); e.kind = kind; return e; };
    let buf = '', result = null;
    const handle = chunk => {
      let event = 'message'; const lines = [];
      for (const l of chunk.split(/\r?\n/)) {
        if (l.startsWith('event:')) event = l.slice(6).trim();
        else if (l.startsWith('data:')) lines.push(l.slice(5).trimStart());
      }
      if (!lines.length) return; // 「: ping」など
      let d = null; try { d = JSON.parse(lines.join('\n')); } catch (_) { return; }
      if (!d || typeof d !== 'object') return;
      if (event === 'text') { if (typeof d.text === 'string' && onText) onText(d.text); }
      else if (event === 'status') { if (typeof d.state === 'string' && onStatus) onStatus(d.state); }
      else if (event === 'done') result = { content: [{ type: 'text', text: typeof d.text === 'string' ? d.text : '' }], stop_reason: d.stop === 'max_turns' ? 'max_turns' : 'end_turn' };
      else if (event === 'error') { const e = fail(typeof d.kind === 'string' ? d.kind : 'failed'); e.resetsAt = typeof d.resetsAt === 'number' ? d.resetsAt : null; throw e; }
    };
    try {
      for (;;) {
        let timer = 0, step;
        const idle = new Promise((_, reject) => { timer = setTimeout(() => reject(fail('cut')), idleMs); });
        try { step = await Promise.race([reader.read(), idle]); }
        catch (e) { throw e && e.kind ? e : fail('cut'); } // 読んでいる途中で切れた（電波・Mac が寝た）
        finally { clearTimeout(timer); }
        buf += dec.decode(step.value || new Uint8Array(), { stream: !step.done });
        const parts = buf.split(/\r?\n\r?\n/); buf = parts.pop();
        parts.forEach(handle);
        if (step.done) { if (buf.trim()) handle(buf); break; }
      }
    } catch (e) {
      try { const p = reader.cancel(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* もう閉じている */ }
      throw e;
    }
    if (!result) throw fail('cut');
    return result;
  }

  // ---- 予定を iPhone のカレンダーに入れるファイル（.ics） ----
  function ics(e, now) {
    const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const d = s => s.replace(/-/g, '');
    const stamp = new Date(now || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    // 1行は75バイトまで。日本語の文字の途中で切らない
    const enc = new TextEncoder();
    const fold = line => {
      const out = []; let cur = '', size = 0;
      for (const ch of line) { const n = enc.encode(ch).length; if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; } cur += ch; size += n; }
      out.push(cur); return out.join('\r\n ');
    };
    const url = /^https?:\/\//.test(e.url || '') ? e.url : '';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//piyorin-news//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${String(e.id || e.start + e.title).replace(/[^\w.-]/g, '')}@piyorin-news`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d(e.start)}`, `DTEND;VALUE=DATE:${d(addDays(endOf(e), 1))}`, `SUMMARY:${esc(e.title)}`,
      ...(e.place ? [`LOCATION:${esc(e.place)}`] : []), ...(url ? [`URL:${url}`] : []),
      `DESCRIPTION:${esc('ぴよりんニュースより' + (url ? '\n' + url : ''))}`, 'END:VEVENT', 'END:VCALENDAR'];
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // ---- 答えの日付と値段を、手元の知識と照らす（知識に無い日付・値段を返す。通信も料金もかからない） ----
  // 「11月3日〜13日」「11月7日(土)・8日(日)」の書き方と、予定の start〜end（YYYY-MM-DD）は、間の日もすべて知っている日にする
  function factSet(text, today) {
    const t = String(text || '').normalize('NFKC'), dates = new Set(), prices = new Set();
    const year = Number(String(today || '').slice(0, 4)) || new Date().getUTCFullYear();
    const md = (m, d) => `${m}月${d}日`;
    const range = (m1, d1, m2, d2, y1 = year) => { // 年をまたぐ（12月→1月）ときは次の年まで
      let a = Date.UTC(y1, m1 - 1, d1);
      const b = Date.UTC(m2 < m1 ? y1 + 1 : y1, m2 - 1, d2);
      for (let i = 0; i < 400 && a <= b; i++, a += 86400e3) { const x = new Date(a); dates.add(md(x.getUTCMonth() + 1, x.getUTCDate())); }
    };
    for (const m of t.matchAll(/(20\d{2})-(\d{2})-(\d{2})/g)) dates.add(md(+m[2], +m[3]));
    for (const m of t.matchAll(/start="(20\d{2})-(\d{2})-(\d{2})" end="20\d{2}-(\d{2})-(\d{2})"/g)) range(+m[2], +m[3], +m[4], +m[5], +m[1]);
    for (const m of t.matchAll(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) dates.add(md(+m[1], +m[2]));
    const re = /(\d{1,2})月(\d{1,2})日/g;
    for (let m; (m = re.exec(t));) {
      let mon = +m[1], day = +m[2], rest = t.slice(re.lastIndex);
      dates.add(md(mon, day));
      for (let n; (n = rest.match(/^\s*(?:[(（][^)）]{1,4}[)）])?\s*([~〜\-–―・、,]|から)\s*(?:(\d{1,2})月)?(\d{1,2})日/));) {
        const mon2 = n[2] ? +n[2] : mon, day2 = +n[3];
        if (/[~〜\-–―]|から/.test(n[1])) range(mon, day, mon2, day2); else dates.add(md(mon2, day2));
        mon = mon2; day = day2; rest = rest.slice(n[0].length);
      }
    }
    for (const m of t.matchAll(/(\d[\d,]*)\s*円/g)) prices.add(m[1].replace(/,/g, ''));
    return { dates, prices };
  }
  function checkFacts(answer, sources, today) {
    const known = factSet(sources, today), seen = factSet(answer, today);
    if (today) for (let i = 0; i <= 7; i++) { const s = addDays(today, i); known.dates.add(`${+s.slice(5, 7)}月${+s.slice(8)}日`); } // 今日から1週間は <today> から数えられる
    return { dates: [...seen.dates].filter(d => !known.dates.has(d)), prices: [...seen.prices].filter(p => !known.prices.has(p)) };
  }

  // ---- 答えに使った記事や予定から、続けて聞けそうな質問を作る（手元のメモに答えがある質問だけ） ----
  // 日にちの質問は作らない（あいさつで伝えていて、「〇〇について」でまとめて聞けるため）
  function topicOf(title) {
    const t = String(title || '').normalize('NFKC');
    const quoted = [...t.matchAll(/[「『"]([^」』"]{2,30})[」』"]/g)].map(m => m[1].trim()).filter(x => x !== 'ぴよりん');
    const named = quoted.filter(x => x.includes('ぴよりん')).sort((a, b) => b.length - a.length)[0] || quoted[0];
    if (named) return named;
    const s = t.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').replace(/\s*(?:の)?(?:先行販売|販売開始|販売|発売|予約受付開始|予約受付|受取期間|開催|キャンペーン)$/, '').trim();
    return s.length >= 2 && s.length <= 24 ? s : '';
  }
  function followUps(refs, ctx) {
    const out = [];
    for (const r of refs || []) {
      let topic = '', text = '', place = '';
      if (r.type === 'event') {
        const e = (ctx.events || []).find(x => x.id === r.id); if (!e) continue;
        const memo = (ctx.memo || {})[e.src];
        topic = topicOf(e.title); place = e.place || ''; text = memo ? memo.memo || '' : '';
      } else {
        const n = (ctx.news || []).find(x => x.id === r.id), memo = (ctx.memo || {})[r.id];
        if (!n || !memo) continue;
        topic = topicOf(n.title); text = memo.memo || '';
      }
      if (!topic) continue;
      if (/\d\s*円/.test(text)) out.push(`${topic}の値段は？`);
      if (place || /(店|百貨店|会場|shop|village|館|ホテル|モール|パーク)/i.test(text)) out.push(`${topic}の場所は？`);
      if (/(整理券|先着|おひとり|1人|ひとり|予約)/.test(text)) out.push(`${topic}の買い方は？`);
      if (out.length >= 2) break;
    }
    return [...new Set(out)].slice(0, 2);
  }

  // ---- カレンダーに入れてほしい（「〇〇をカレンダーに入れて」「〇〇を知らせて」） ----
  // 予定の名前があればその予定、無ければ空（ページが、さっき話した予定を使う）。「知らせて」だけで予定の名前が無いときは、ふつうの質問にする
  function calendarAsk(t, ctx) {
    const cal = /カレンダー|リマインダ|リマインド/.test(t);
    if (!(cal && /入れ|追加|登録|して|設定|お願い/.test(t)) && !/知らせて|通知して/.test(t)) return null;
    const upcoming = (ctx.events || []).filter(e => e && e.start && e.title && endOf(e) >= ctx.today);
    // お願いの言葉（「カレンダーに入れて」など）は外してから探す（「カレンダー」が「ぴよりんカレンダー2027」に当たらないように）
    const name = t.replace(/^(?:iphoneの)?(?:カレンダー|リマインダー?|リマインド)(?:に|へ|で)?/i, '')
      .replace(/(?:を|の)?(?:iphoneの)?(?:カレンダー|リマインダー?|リマインド)?(?:に|へ|で)?(?:入れ|追加|登録|設定|知らせ|通知)(?:し)?(?:て|る)?(?:ね|ください|お願い|ほしい|欲しい|おいて)?$/i, '');
    const hits = name ? matchEvents(name, upcoming).slice(0, 3) : [];
    if (!hits.length && !cal) return null;
    return { kind: 'calendar', events: hits, text: '' };
  }

  // ---- カレンダーに入れた予定を、当日と前の日のあいさつで話す ----
  function plannedLine(planned, today) {
    const list = (planned || []).filter(p => p && p.start && p.title);
    const at = p => p.time ? `（${Number(p.time.slice(0, 2))}時${p.time.slice(3) !== '00' ? p.time.slice(3) + '分' : ''}から）` : '';
    const first = d => list.filter(p => p.start === d).sort((a, b) => (a.time || '').localeCompare(b.time || ''))[0];
    let p = first(today);
    if (p) return { id: p.id, text: `今日は**${p.title}**の日だぴよ${at(p)}！カレンダーに入れてたぴよね。` };
    p = first(addDays(today, 1));
    if (p) return { id: p.id, text: `明日は**${p.title}**だぴよ${at(p)}！カレンダーに入れてたぴよね。` };
    return null;
  }

  return { localAnswer, greeting, tidbit, tidbits, omikuji, matchEvents, refs, streamView, readMessage, parseMacLink, readRelay, ics, norm, checkFacts, followUps, topicOf, plannedLine };
})();
