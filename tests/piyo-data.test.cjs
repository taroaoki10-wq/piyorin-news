const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
const source=html.slice(html.indexOf('  const DATA_TTL='),html.indexOf('  // ---- 開いている間は'));
function setup(){
  let now=Date.parse('2026-10-26T03:00:00Z'),version=1,fail='',calls=0,release=null;
  const ctx={AbortController,setTimeout,clearTimeout,WEATHER:'weather',Date:class extends Date{static now(){return now}},
    fetch:async(url,opts)=>{
      calls++;
      if(release)await release;
      if(url.includes(fail)&&fail)throw Error('offline');
      const value=url==='weather'?{daily:{time:['2026-10-26'],weather_code:[version===1?1:63],temperature_2m_max:[25],temperature_2m_min:[15],precipitation_probability_max:[20]}}:
        url.includes('piyo-greeting')?{lines:['summary'+version],suggest:['question'+version]}:
        url.includes('piyo-memo')?{id:{memo:'memo'+version}}:
        url.includes('piyo-basics')?{lines:['basics'+version]}:[{id:'item'+version}];
      return {ok:!url.includes('http-error'),json:async()=>value};
    }};
  vm.createContext(ctx);vm.runInContext(source+'\nthis.api={loadData,weatherLine,get data(){return data}};',ctx);
  return {ctx,api:ctx.api,advance:n=>now+=n,setTime:n=>now=Date.parse(n),version:n=>version=n,fail:s=>fail=s,get calls(){return calls},hold:()=>{let done;release=new Promise(r=>done=r);return ()=>{release=null;done()}}};
}
test('初回取得、30分未満は再取得せず、30分ちょうどで全データ更新',async()=>{
  const h=setup();assert.equal(await h.api.loadData(),true);assert.equal(h.calls,6);
  h.advance(30*60000-1);assert.equal(await h.api.loadData(),false);assert.equal(h.calls,6);
  h.version(2);h.advance(1);await h.api.loadData();assert.equal(h.calls,12);
  assert.equal(h.api.data.greeting.lines[0],'summary2');assert.equal(h.api.data.memo.id.memo,'memo2');
  assert.equal(h.api.data.events[0].id,'item2');assert.equal(h.api.data.news[0].id,'item2');assert.equal(h.api.data.basics.lines[0],'basics2');assert.equal(h.api.data.weather[0].word,'雨');
});
test('日本時間の日付変更時は30分未満でも更新',async()=>{
  const h=setup();h.setTime('2026-10-26T14:59:00Z');await h.api.loadData();h.advance(60000);await h.api.loadData();assert.equal(h.calls,12);
});
test('部分失敗では既存メモを保持、成功分更新、次回再試行',async()=>{
  const h=setup();await h.api.loadData();h.advance(1800000);h.version(2);h.fail('piyo-memo');await h.api.loadData();
  assert.equal(h.api.data.memo.id.memo,'memo1');assert.equal(h.api.data.greeting.lines[0],'summary2');
  h.fail('');await h.api.loadData();assert.equal(h.calls,18);assert.equal(h.api.data.memo.id.memo,'memo2');
});
test('天気取得失敗時は古い予報を使わず次回回復',async()=>{
  const h=setup();await h.api.loadData();h.advance(1800000);h.fail('weather');await h.api.loadData();assert.equal(h.api.data.weather,null);assert.equal(h.api.weatherLine(),'');
  h.fail('');await h.api.loadData();assert.ok(h.api.data.weather.length);
});
test('初回オフラインでも安全な空データを作り次回回復',async()=>{
  const h=setup();h.fail('a');assert.equal(await h.api.loadData(),false);assert.equal(Object.keys(h.api.data.memo).length,0);
  h.fail('');await h.api.loadData();assert.equal(h.api.data.memo.id.memo,'memo1');
});
test('同時呼び出しの通信を共有し時計が戻った場合も再取得',async()=>{
  const h=setup(),done=h.hold(),a=h.api.loadData(),b=h.api.loadData();assert.equal(a,b);done();await a;assert.equal(h.calls,6);
  h.advance(-1);await h.api.loadData();assert.equal(h.calls,12);
});
test('再オープン時に更新したまとめと候補を表示、会話を消さない',async()=>{
  const h=setup(),messages=[],chips=[];const nodes={};
  Object.assign(h.ctx,{$:id=>nodes[id]||(nodes[id]={}),guardOn(){},layer:{hidden:true},lockPage(){},fit(){},frame(){},toBottom(){},play:(name,fn)=>fn?.(),idle(){},piyoMsg:()=>({say:s=>messages.push(s)}),fmt:s=>s,DEFAULT_SUGGEST:[],setTimeout:fn=>{fn();return 0},clearTimeout(){},fillSuggest:list=>chips.push(list),suggest:{children:[1]},idleEl:{hidden:true},idleHide(){},slideFrom(){}});
  const open=html.slice(html.indexOf('  async function open(){',html.indexOf('  const DATA_TTL=')),html.indexOf('  function close('));
  vm.runInContext('let greeted=false,openId=0;'+open+';this.open=open;',h.ctx);
  await Promise.all([h.ctx.open(),h.ctx.open()]);await h.ctx.open();assert.equal(messages.length,1);
  h.advance(1800000);h.version(2);await h.ctx.open();assert.equal(messages.length,2);assert.match(messages[1],/summary2/);assert.equal(chips[1][0],'question2');
});
test('待機のぴよ：下へ引いても待機の位置で止まり、それより下へ行かない',()=>{
  const fn=html.slice(html.indexOf('  function holdPet('),html.indexOf('  function fadeRest('));
  const pet={style:{}},ctx={pet,innerHeight:812,H:104,idleRect:{top:698},petTop0:584};
  vm.createContext(ctx);vm.runInContext(fn+';this.holdPet=holdPet;',ctx);
  ctx.holdPet(60);assert.equal(pet.style.transform,'');      // まだ待機の位置より上
  ctx.holdPet(114);assert.equal(pet.style.transform,'');     // ちょうど待機の位置
  ctx.holdPet(240);assert.equal(pet.style.transform,'translateY(-126px)'); // 引いた分を打ち消して待機の位置に止める
});
test('待機のぴよ：呼ぶボタンは無く、待機のぴよと右の位置がチャットのぴよとそろう',()=>{
  assert.ok(!html.includes('id="piyo-call"'));
  assert.match(html,/id="piyo-idle"[^>]*aria-label="ぴよと話す"/);
  assert.match(html,/\.piyo-idle\{[^}]*right:26px/);
  assert.match(html,/\.piyo-layer\{[^}]*padding:0 12px/);assert.match(html,/\.piyo-pet\{[^}]*margin-right:14px/);
});
