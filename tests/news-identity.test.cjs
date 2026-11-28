const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = {window: {}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../docs/news-identity.js'), 'utf8'), ctx);
const api = ctx.window.PiyoNewsIdentity;
const item = {id:'main', merged_ids:['photo1', 'photo2']};

test('統合前の写真IDの非表示設定を参照する', () => {
  assert.equal(api.deletion(item, {photo1:{t:1,on:true}}).on, true);
  assert.equal(api.deletion(item, {}), undefined);
});
test('復元と再削除は全IDの最新操作を優先する', () => {
  const records = {photo1:{t:1,on:true}, main:{t:2,on:false}};
  assert.equal(api.deletion(item, records).on, false);
  records.photo2 = {t:3,on:true};
  assert.equal(api.deletion(item, records).on, true);
});
test('旧IDを保持し同期後も設定を参照できる', () => {
  const ids = new Set(api.ids(item));
  assert.equal(ids.has('photo1'), true);
  const records = JSON.parse(JSON.stringify({photo2:{t:4,on:false}}));
  assert.equal(api.deletion(item, records).on, false);
  assert.equal(api.ids({id:'unchanged'}).length, 1);
});

// 2026-11-28：判定待ちの記事（題に「ぴよりん」が無く、AI がまだ決めていない）は出さない
test('判定待ちの記事は pending（出さない）', () => {
  const p = n => api.pending(n);
  assert.equal(p({cat:'media', title:'カブス、佐藤輝明外野手と6年契約発表'}), true);
  assert.equal(p({cat:'media', title:'カブス、佐藤輝明外野手と6年契約発表', jw:'2026-11-28T11:03:12+09:00'}), true);
  assert.equal(p({cat:'media', title:'カブス、佐藤輝明外野手と6年契約発表', jg:{wait:'2026-11-28T11:03:12+09:00'}}), true); // 前の形
  assert.equal(p({cat:'media', title:'4周年のショッパー', jg:{v:1, ok:true}}), false); // AI が関係ありと判定
  assert.equal(p({cat:'media', title:'野党の記事', jg:{v:1, ok:false}}), false); // 関係なしは別の理由（by:'ai'）で隠す
  assert.equal(p({cat:'media', title:'サンタぴよりんが登場'}), false); // 題にぴよりん
  assert.equal(p({cat:'media', title:'ＰＩＹＯＲＩＮ cafe'}), false); // 全角でも
  assert.equal(p({cat:'official', title:'お知らせ'}), false); // 公式は判定の対象外
});
