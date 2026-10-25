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
