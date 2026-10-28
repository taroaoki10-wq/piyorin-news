const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
function setup(realAsk=false){
  const buttons=[],sent=[];
  const suggest={style:{},get children(){return buttons},set innerHTML(value){assert.equal(value,'');buttons.length=0},appendChild(b){buttons.push(b)}};
  const ctx={suggest,data:null,busy:false,pendingChip:null,ask:q=>sent.push(q),
    todayStr:()=> '2026-10-26',nextDay:s=>new Date(Date.parse(s+'T00:00Z')+86400e3).toISOString().slice(0,10),
    fetch(){throw Error('候補補充で通信してはいけない')},
    document:{createElement(){return {remove(){const i=buttons.indexOf(this);if(i>=0)buttons.splice(i,1)},addEventListener(type,fn){assert.equal(type,'click');this.click=fn}}}}};
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('  function suggestLabel('),html.indexOf('  async function open(){'))+';this.api={suggestLabel,fillSuggest,consumeSuggest,suggestPool,holdSuggest,showSuggest};',ctx);
  if(realAsk){
    Object.assign(ctx,{apiKey:true,pendingQ:'',keyPrompts:0,openKey(){ctx.keyPrompts++},$:()=>({}),
      userMsg(){},piyoMsg:()=>({say(text,done){done?.()},choices(){}}),loop(){},idle(){},play(){},sync(){},fmt:s=>s,piyoTone:s=>s,
      NEED_MORE:{},textOf:r=>r.content?.[0]?.text||'',errText:()=> '接続できないぴよ。',esc:s=>s,
      callClaude:async body=>{sent.push(body);if(ctx.replyError)throw Error('offline');return ctx.reply||{content:[{type:'text',text:'回答だぴよ。'}]}}});
    vm.runInContext('let history=[];'+html.slice(html.indexOf('  let busy=false,pendingChip=null;'),html.indexOf('  const sync=()=>'))+';this.api.ask=ask;this.api.pending=()=>pendingChip;this.api.isBusy=()=>busy;',ctx);
  }
  return {ctx,api:ctx.api,buttons,sent};
}
function knownData(){
  return {basics:{lines:['ぴよりんはひよこ型のスイーツ。','名前は「ぴよぴよ」と「プリン」から。','プリンとババロア。','値段：定番ぴよりん450円。','ぴよりんshopで買える。','持ち帰りは水平に。','消費期限は当日中。','買い方：店の予約不可。']},
    memo:{id:{date:'2026-10-26',memo:'ぴよりんカレンダーの発売情報。'}},
    weather:[{date:'2026-10-26',word:'晴れ',max:25,min:15,rain:0,sunset:'17:04'},{date:'2026-10-27',word:'くもり',max:22,min:14,rain:null}]};
}
const initial=['ゴジラぴよりんについて','カレンダーはいくら？','ぴよりんの予約は？'];
const labels=h=>h.buttons.map(b=>b.textContent);
const settled=()=>new Promise(resolve=>setImmediate(resolve));
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
test('最初の表示はぴよりん候補だけで、補充候補を先回りして混ぜない',()=>{
  const h=setup();h.ctx.data=knownData();h.api.fillSuggest(initial);
  assert.deepEqual(labels(h),initial);
});
test('質問した候補を除き、残りの順番とボタンを保って右へ一つ補充する',()=>{
  const h=setup();h.ctx.data=knownData();h.api.fillSuggest(initial);const remaining=h.buttons.slice(1);
  h.api.consumeSuggest(initial[0]);
  assert.deepEqual(labels(h),[initial[1],initial[2],'今日の名古屋の天気は？']);
  assert.equal(h.buttons[0],remaining[0]);assert.equal(h.buttons[1],remaining[1]);
  h.api.consumeSuggest(initial[1]);assert.equal(h.buttons.at(-1).textContent,'ぴよりんってどんなお菓子？');
});
test('同じ会話では聞いた候補を繰り返さず、使い切ると空になる',()=>{
  const h=setup();h.ctx.data=knownData();h.api.fillSuggest(initial);const asked=new Set();
  for(let i=0;h.buttons.length&&i<40;i++){
    const q=h.buttons[0].textContent;assert.ok(!asked.has(q),q);asked.add(q);h.api.consumeSuggest(q);
    assert.equal(new Set(labels(h)).size,h.buttons.length);for(const s of labels(h))assert.ok(!asked.has(s),s);
  }
  assert.equal(h.buttons.length,0);assert.equal(h.ctx.suggest.hidden,true);assert.ok(asked.size>initial.length);
});
test('手入力で同じ候補を質問しても消し、先に聞いた補充候補は後から出さない',()=>{
  const h=setup();h.ctx.data=knownData();h.api.fillSuggest(initial);
  h.api.consumeSuggest('今日の名古屋の天気は？');assert.deepEqual(labels(h),initial);
  h.api.consumeSuggest(initial[0]);assert.equal(h.buttons.at(-1).textContent,'ぴよりんってどんなお菓子？');
});
test('新しいあいさつで候補を作り直したときだけ、聞いた候補の記録をリセットする',()=>{
  const h=setup();h.ctx.data=knownData();h.api.fillSuggest(initial);h.api.consumeSuggest(initial[0]);
  h.api.consumeSuggest('今日の名古屋の天気は？');h.api.fillSuggest(initial);h.api.consumeSuggest(initial[0]);
  assert.equal(h.buttons.at(-1).textContent,'今日の名古屋の天気は？');
});
test('使い切った候補は、データ更新のない開閉だけでは元に戻らない',async()=>{
  const h=setup();h.api.fillSuggest(['ぴよりんについて']);h.api.consumeSuggest('ぴよりんについて');
  Object.assign(h.ctx,{log:{lastElementChild:null},idleEl:{hidden:true},idleHide(){},guardOn(){},layer:{hidden:true},lockPage(){},fit(){},frame(){},toBottom(){},
    loadData:async()=>false,play(){},setTimeout:fn=>fn(),DEFAULT_SUGGEST:['ぴよりんについて']});
  vm.runInContext('let greeted=true,openId=0;'+html.slice(html.indexOf('  async function open(){'),html.indexOf('  function close('))+';this.api.open=open;',h.ctx);
  await h.api.open();assert.equal(h.buttons.length,0);assert.equal(h.ctx.suggest.hidden,true);
});
test('情報なし・古い天気・欠けた値から答えられない候補を作らない',()=>{
  const h=setup();assert.equal(h.api.suggestPool().length,0);
  h.ctx.data={basics:{lines:[]},memo:{},weather:[{date:'2026-10-25',word:'晴れ',max:25,min:15},{date:'2026-10-26',word:'晴れ',max:null,min:15}]};
  assert.equal(h.api.suggestPool().length,0);h.api.fillSuggest(['ぴよりんについて']);h.api.consumeSuggest('ぴよりんについて');
  assert.equal(h.buttons.length,0);assert.equal(h.ctx.suggest.hidden,true);
});
test('雨の確率0は使い、欠けた雨・日の入り・未収録の明日は候補にしない',()=>{
  const h=setup();h.ctx.data={weather:[{date:'2026-10-26',word:'晴れ',max:0,min:-5,rain:0,sunset:null}],memo:{}};
  assert.deepEqual(Array.from(h.api.suggestPool()),['今日の名古屋の天気は？','今日の名古屋の雨の確率は？']);
  h.ctx.data.weather[0].rain=null;assert.deepEqual(Array.from(h.api.suggestPool()),['今日の名古屋の天気は？']);
});
test('基本情報のある項目と知識に渡す80件内のメモだけを使う',()=>{
  const h=setup();h.ctx.data={basics:{lines:['消費期限は当日中。']},memo:{}};
  assert.deepEqual(Array.from(h.api.suggestPool()),['ぴよりんの消費期限は？']);
  h.ctx.data.memo=Object.fromEntries(Array.from({length:80},(_,i)=>[i,{date:'2026-10-26',memo:''}]));
  h.ctx.data.memo.old={date:'2026-10-01',memo:'範囲外の古い本文。'};
  assert.ok(!h.api.suggestPool().includes('最近のぴよりんニュースは？'));
  h.ctx.data.memo[0].memo='知識に入る本文。';assert.ok(h.api.suggestPool().includes('最近のぴよりんニュースは？'));
});
test('整形後に重なる候補・空文字を除き、初期件数を超えて増やさない',()=>{
  const h=setup();h.ctx.data=knownData();h.api.fillSuggest(['ゴジラはいつから？','ゴジラについて','',' ']);
  assert.deepEqual(labels(h),['ゴジラについて']);h.api.consumeSuggest('ゴジラについて');assert.equal(h.buttons.length,1);
});
test('キー未入力では候補を消さず、入力後の質問一回で一つ補充しAPIも一回だけ',async()=>{
  const h=setup(true);h.ctx.data=knownData();h.api.fillSuggest(initial);h.ctx.apiKey=false;
  h.buttons[0].click();await settled();assert.equal(h.ctx.keyPrompts,1);assert.deepEqual(labels(h),initial);assert.equal(h.sent.length,0);
  h.ctx.apiKey=true;await h.api.ask(h.ctx.pendingQ);
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].messages[0].content,initial[0]);
  assert.deepEqual(labels(h),[initial[1],initial[2],'今日の名古屋の天気は？']);assert.equal(h.api.pending(),null);
});
test('返事待ちの二重クリックを無視し、追加した質問も一回の通常回答へ送る',async()=>{
  const h=setup(true);h.ctx.data=knownData();h.api.fillSuggest(initial);
  h.buttons[0].click();h.buttons[0].click();assert.equal(h.sent.length,1);assert.equal(h.buttons.length,3);await settled();
  h.buttons.at(-1).click();await settled();assert.equal(h.sent.length,2);
  assert.equal(h.sent[1].messages.at(-1).content,'今日の名古屋の天気は？');assert.equal(h.buttons.length,3);
});
test('通信失敗や追加調査の確認でも、補充のための再送信をしない',async()=>{
  for(const failure of [true,false]){
    const h=setup(true);h.ctx.data=knownData();h.api.fillSuggest(initial);h.ctx.replyError=failure;
    h.ctx.reply={content:[{type:'tool_use',name:'need_more',input:{kind:'article',query:'詳細'}}]};
    h.buttons[0].click();await settled();assert.equal(h.sent.length,1);assert.equal(h.buttons.length,3);assert.equal(h.api.isBusy(),false);
  }
});
test('初回のあいさつ中に、仮の候補が見えてから別の候補へ入れ替わらない',async()=>{
  const h=setup(),seen=[];let finish;
  const greeting={lines:['こんにちはだぴよ。'],suggest:['ゴジラぴよりんについて','カレンダーはいくら？']};
  Object.assign(h.ctx,{log:{children:[],scrollTop:0,lastElementChild:null,set innerHTML(v){}},idleEl:{hidden:true},idleHide(){},guardOn(){},
    layer:{hidden:true},lockPage(){},fit(){},frame(){},toBottom(){},slideFrom(){},matchMedia:()=>({matches:true}),
    loadData:()=>new Promise(r=>finish=()=>{h.ctx.data={greeting};r(true)}),
    play(name,done){seen.push([h.ctx.suggest.style.visibility,labels(h).join('|')]);done?.()},idle(){},
    piyoMsg:()=>({say(){}}),fmt:s=>s,piyoTone:s=>s,weatherLine:()=>'',DEFAULT_SUGGEST:['いま買える限定ぴよりんは？']});
  vm.runInContext('let greeted=false,openId=0,history=[];'+html.slice(html.indexOf('  async function open(){'),html.indexOf('  function close('))+';this.api.open=open;',h.ctx);
  const opening=h.api.open();
  assert.equal(h.ctx.suggest.style.visibility,'hidden');assert.deepEqual(labels(h),['いま買える限定ぴよりんは？']); // 場所だけ取って見せない
  finish();await opening;
  assert.equal(h.ctx.suggest.style.visibility,'');assert.deepEqual(labels(h),greeting.suggest);
  assert.deepEqual(seen,[['','ゴジラぴよりんについて|カレンダーはいくら？']]); // あいさつの時点で、もう決まった候補が見えている
});
