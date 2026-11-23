const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../docs/piyo-learn.js');

const news = [
  {id: 'g1', cat: 'media', title: '神谷そら17位 米女子ゴルフ予選会', source: '名駅経済新聞'},
  {id: 'g2', cat: 'media', title: '神谷そら 米女子ゴルフ予選会で20位', source: '名駅経済新聞'},
  {id: 'p1', cat: 'media', title: 'ぴよりん 冬の限定味を名古屋駅で発売', source: '名駅経済新聞'},
  {id: 'p2', cat: 'media', title: 'ぴよりんカフェ 新メニュー登場', source: '名駅経済新聞'},
  {id: 'b1', cat: 'sns', title: '今日のぴよりん日記 その1', source: 'あるブログ'},
  {id: 'b2', cat: 'sns', title: '週末の買い物メモ', source: 'あるブログ'},
  {id: 'b3', cat: 'sns', title: '猫と散歩した話', source: 'あるブログ'},
  {id: 'b4', cat: 'sns', title: '新しい靴を買った', source: 'あるブログ'},
  {id: 'o1', cat: 'official', title: '神谷そら 米女子ゴルフ予選会 公式', source: '公式'},
];
const why = (dels, ledger, id, opt) => L.why(news.find(n => n.id === id), L.build(news, dels, ledger, opt));

test('削除した記事に似た記事を隠し、似ていない記事は隠さない', () => {
  const d = {g1: {t: 1, on: true}};
  assert.match(why(d, null, 'g2'), /似ている/);
  assert.equal(why(d, null, 'p1'), '');
  assert.equal(why(d, null, 'p2'), '');
});

test('公式の記事は学習で隠さない', () => {
  assert.equal(why({g1: {t: 1, on: true}}, null, 'o1'), '');
});

test('元に戻すと例から外れ、似た記事も戻る', () => {
  assert.equal(why({g1: {t: 2, on: false}}, null, 'g2'), '');
  // 同じくらい似た記事を戻していれば、新しい記事も隠さない（戻した記事そのものは画面が記録で先に表示に決める）
  const m = L.build(news, {g1: {t: 1, on: true}, g2: {t: 2, on: false}}, null);
  assert.equal(L.why({id: 'q', cat: 'media', title: news[1].title, source: 'z'}, m), '');
});

test('戻した記事のほうが似ているなら隠さない', () => {
  const extra = [...news, {id: 'g3', cat: 'media', title: '神谷そら17位 米女子ゴルフ予選会 ぴよりん差し入れ', source: 'x'}];
  const m = L.build(extra, {g1: {t: 1, on: true}, g3: {t: 2, on: false}}, null);
  assert.equal(L.why({id: 'q', title: '神谷そら17位 米女子ゴルフ予選会 ぴよりん差し入れ', source: 'y'}, m), '');
});

test('何度も削除した掲載元の記事を隠す（ほかの記事が多い掲載元は隠さない）', () => {
  const d = {b2: {t: 1, on: true}, b3: {t: 2, on: true}, b4: {t: 3, on: true}};
  assert.match(why(d, null, 'b1'), /3 回削除/);
  assert.equal(why(d, null, 'b1', {srcMin: 4}), '');
  const d2 = {g1: {t: 1, on: true}, g2: {t: 2, on: true}, b2: {t: 3, on: true}};
  assert.equal(why(d2, null, 'p1'), ''); // 名駅経済新聞はほかの記事があるので隠さない
});

test('掲載元で 1 回でも戻していれば、掲載元では隠さない', () => {
  const d = {b2: {t: 1, on: true}, b3: {t: 2, on: true}, b4: {t: 3, on: true}, b1: {t: 4, on: false}};
  const m = L.build([...news, {id: 'b5', cat: 'sns', title: 'カメラの話', source: 'あるブログ'}], d, null);
  assert.equal(L.why({id: 'b5', cat: 'sns', title: 'カメラの話', source: 'あるブログ'}, m), '');
});

test('帳面（learn.json）の例も使う。記事が一覧から消えていても題で比べる', () => {
  const ledger = {del: [{id: 'gone', title: '神谷そら17位 米女子ゴルフ予選会', source: '名駅経済新聞', t: 5}], keep: []};
  assert.match(why({}, ledger, 'g2'), /似ている/);
  // この端末で後から戻した記録が勝つ
  assert.equal(why({gone: {t: 9, on: false}}, ledger, 'g2'), '');
});

test('統合された記事は、いちばん新しい操作を使う', () => {
  const merged = [{id: 'm', merged_ids: ['m1'], cat: 'media', title: '神谷そら17位 米女子ゴルフ予選会', source: 's'}, ...news.slice(1)];
  const m = L.build(merged, {m1: {t: 1, on: true}, m: {t: 2, on: false}}, null);
  assert.equal(m.del.length, 0);
  assert.equal(m.keep.length, 1);
});

test('画面が学習の部品を読み込み、設定と版がそろっている', () => {
  const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
  assert.match(html, /<script src="piyo-learn\.js"><\/script>/);
  assert.match(html, /id="set-learn"/);
  assert.match(html, /by:'learn'/);
  assert.match(html, /'learn'\]\.map\(f=>fetch\('data\/'/);
  const ver = html.match(/name="piyo-ver" content="([^"]+)"/)[1];
  assert.ok(html.includes(`const PN_VERSION='${ver}（`));
});
