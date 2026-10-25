const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../docs/news-archive.js'), 'utf8');
function api(fetch) {
  const context = {window: {}, fetch, AbortController, setTimeout, clearTimeout};
  vm.runInNewContext(source, context);
  return context.window.PiyoNewsArchive;
}
test('記事IDを保ち、移動時の重複は最新の判定を優先する', () => {
  const result = api().combine([{id:'a',date:'2026-10-25',jg:{ok:false}}], [{id:'a',date:'2026-10-25'}, {id:'b',date:'2014-11-09'}]);
  assert.equal(result.length, 2);
  assert.equal(result[0].jg.ok, false);
  assert.equal(result[1].id, 'b');
});
test('複数年の保管記事をすべて読み込む', async () => {
  const pages = {index: {years:['2015','2014']}, '2015':[{id:'a',date:'2015-01-01'}], '2014':[{id:'b',date:'2014-11-09'}]};
  const result = await api(async url => ({ok:true, json:async()=>pages[url.match(/\/([^/]+)\.json/)[1]]})).load('?t=test');
  assert.equal(result.length, 2);
  assert.equal(result[1].id, 'b');
});
test('一部の年が取得できなければ部分的な結果で上書きしない', async () => {
  await assert.rejects(api(async url => url.includes('index') ? {ok:true,json:async()=>({years:['2014']})} : {ok:false}).load(''));
});
test('不正な保管先を取得しない', async () => {
  let calls=0;
  await assert.rejects(api(async () => {calls++;return {ok:true,json:async()=>({years:['../news']})};}).load(''));
  assert.equal(calls,1);
});
