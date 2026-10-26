const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
function setup(){
  const buttons=[],sent=[];
  const suggest={set innerHTML(value){assert.equal(value,'');buttons.length=0},appendChild(b){buttons.push(b)}};
  const ctx={suggest,busy:false,pendingChip:null,ask:q=>sent.push(q),document:{createElement(){return {addEventListener(type,fn){assert.equal(type,'click');this.click=fn}}}}};
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('  function suggestLabel('),html.indexOf('  async function open(){'))+';this.api={suggestLabel,fillSuggest};',ctx);
  return {ctx,api:ctx.api,buttons,sent};
}
test('既存の日時候補を商品や話題について聞く文言に変える',()=>{
  const {api}=setup();
  for(const [q,label] of [
    ['ゴジラぴよりんはいつから？','ゴジラぴよりんについて'],
    ['ゴジラぴよりんはいつまで？','ゴジラぴよりんについて'],
    ['紅茶ぴよりんセットはいつ発売？','紅茶ぴよりんセットについて'],
    ['限定ぴよりんは何日から？','限定ぴよりんについて'],
    ['限定ぴよりんはいつまで買える？','限定ぴよりんについて'],
    ['限定ぴよりんの発売日は？','限定ぴよりんについて'],
    ['限定ぴよりんの販売期間は？','限定ぴよりんについて'],
    ['山口県へはいつおでかけ？','山口県へのおでかけについて'],
    ['山口県へいつおでかけ？','山口県へのおでかけについて'],
  ]){assert.equal(api.suggestLabel(q),label,q);assert.equal(api.suggestLabel(label),label)}
});
test('日時以外の候補と手がかりが足りない質問は書き換えない',()=>{
  const {api}=setup();
  for(const q of ['カレンダーはいくら？','クリスマスケーキの予約は？','紅茶ぴよりんセットの値段は？','どこで買える？','いま買える限定ぴよりんは？','これからのイベントは？','いつから？','「いつから」という名前について'])assert.equal(api.suggestLabel(q),q);
});
test('候補とクリックして送る質問文が一致し、元の候補データは変更しない',()=>{
  const h=setup(),list=['ゴジラぴよりんはいつまで？','カレンダーはいくら？'];h.api.fillSuggest(list);
  assert.equal(h.buttons[0].textContent,'ゴジラぴよりんについて');h.buttons[0].click();
  assert.deepEqual(h.sent,['ゴジラぴよりんについて']);assert.equal(h.ctx.pendingChip,h.buttons[0]);
  h.ctx.busy=true;h.buttons[1].click();assert.equal(h.sent.length,1);
  assert.deepEqual(list,['ゴジラぴよりんはいつまで？','カレンダーはいくら？']);
});
