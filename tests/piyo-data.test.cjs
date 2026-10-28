const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
const source=html.slice(html.indexOf('  const DATA_TTL='),html.indexOf('  // ---- 開いている間は'));
function setup(){
  let now=Date.parse('2026-10-26T03:00:00Z'),version=1,fail='',calls=0,release=null;
  const overrides=new Map();
  const calendar={built:'2026-10-26',holidays_from:'2026-10-19',holidays_until:'2027-11-30',
    holidays:[{date:'2026-11-03',name:'文化の日'}],long_weekends:[{start:'2026-11-21',end:'2026-11-23',days:3}],
    sekki:[{date:'2026-10-23',name:'霜降'},{date:'2026-11-07',name:'立冬'}],
    moon:[{time:'2026-10-11T00:50',phase:'新月'},{time:'2026-10-26T13:12',phase:'満月'},{time:'2026-11-09T16:02',phase:'新月'}]};
  const forecast=()=>({daily:{time:Array.from({length:7},(_,i)=>new Date(Date.parse('2026-10-26T00:00:00Z')+i*86400e3).toISOString().slice(0,10)),weather_code:Array(7).fill(version===1?1:63),temperature_2m_max:Array(7).fill(25),temperature_2m_min:Array(7).fill(15),precipitation_probability_max:Array(7).fill(20),sunrise:Array(7).fill('2026-10-26T06:09'),sunset:Array(7).fill('2026-10-26T17:04'),uv_index_max:Array(7).fill(4.2),wind_speed_10m_max:Array(7).fill(5.4),precipitation_sum:Array(7).fill(0)},
    hourly:{time:Array.from({length:72},(_,i)=>'2026-10-'+(26+Math.floor(i/24))+'T'+String(i%24).padStart(2,'0')+':00'),precipitation_probability:Array.from({length:72},(_,i)=>[0,10,30][i%3])}});
  const ctx={AbortController,setTimeout,clearTimeout,WEATHER:'weather',Date:class extends Date{static now(){return now}},
    fetch:async(url,opts)=>{
      calls++;
      if(release)await release;
      if(url.includes(fail)&&fail)throw Error('offline');
      const value=overrides.has(url.split('?')[0])?overrides.get(url.split('?')[0]):url==='weather'?forecast():
        url.includes('koyomi')?calendar:
        url.includes('piyo-greeting')?{lines:['summary'+version],suggest:['question'+version]}:
        url.includes('piyo-memo')?{id:{memo:'memo'+version}}:
        url.includes('piyo-basics')?{lines:['basics'+version]}:[{id:'item'+version}];
      return {ok:!url.includes('http-error'),json:async()=>value};
    }};
  vm.createContext(ctx);vm.runInContext(source+'\n'+html.slice(html.indexOf('  function knowledge(){'),html.indexOf('  async function callClaude('))+'\nthis.api={loadData,weatherLine,knowledge,koyomiKnowledge,weatherKnowledge,get data(){return data}};',ctx);
  return {ctx,calendar,forecast,respond:(url,value)=>overrides.set(url,value),api:ctx.api,advance:n=>now+=n,setTime:n=>now=Date.parse(n),version:n=>version=n,fail:s=>fail=s,get calls(){return calls},hold:()=>{let done;release=new Promise(r=>done=r);return ()=>{release=null;done()}}};
}
test('初回取得、30分未満は再取得せず、30分ちょうどで全データ更新',async()=>{
  const h=setup();assert.equal(await h.api.loadData(),true);assert.equal(h.calls,7);
  h.advance(30*60000-1);assert.equal(await h.api.loadData(),false);assert.equal(h.calls,7);
  h.version(2);h.advance(1);await h.api.loadData();assert.equal(h.calls,14);
  assert.equal(h.api.data.greeting.lines[0],'summary2');assert.equal(h.api.data.memo.id.memo,'memo2');
  assert.equal(h.api.data.events[0].id,'item2');assert.equal(h.api.data.news[0].id,'item2');assert.equal(h.api.data.basics.lines[0],'basics2');assert.equal(h.api.data.weather[0].word,'雨');
});
test('日本時間の日付変更時は30分未満でも更新',async()=>{
  const h=setup();h.setTime('2026-10-26T14:59:00Z');await h.api.loadData();h.advance(60000);await h.api.loadData();assert.equal(h.calls,14);
});
test('部分失敗では既存メモを保持、成功分更新、次回再試行',async()=>{
  const h=setup();await h.api.loadData();h.advance(1800000);h.version(2);h.fail('piyo-memo');await h.api.loadData();
  assert.equal(h.api.data.memo.id.memo,'memo1');assert.equal(h.api.data.greeting.lines[0],'summary2');
  h.fail('');await h.api.loadData();assert.equal(h.calls,21);assert.equal(h.api.data.memo.id.memo,'memo2');
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
  const h=setup(),done=h.hold(),a=h.api.loadData(),b=h.api.loadData();assert.equal(a,b);done();await a;assert.equal(h.calls,7);
  h.advance(-1);await h.api.loadData();assert.equal(h.calls,14);
});
function chatSetup(){
  const h=setup(),chips=[],requests=[],animations=[],nodes={};
  let reduced=false,replyGate=null,fadeGate=null,fadeStarted=null,holdWave=false,waveDone=null;
  const log={children:[],scrollTop:0,get lastElementChild(){return this.children.at(-1)||null},
    set innerHTML(value){assert.equal(value,'');this.children.length=0},
    animate(){
      const animation={active:true,finished:fadeGate||Promise.resolve(),cancel(){this.active=false}};
      animations.push(animation);fadeStarted?.();return animation;
    }};
  const piyoMsg=()=>{const node={text:'',choices:[]};log.children.push(node);return{
    say(text,done){node.text=text;done?.()},choices(list){node.choices=list},
  }};
  vm.runInContext(html.slice(html.indexOf('  function piyoTone('),html.indexOf('  // 返事の文を表示用にする')),h.ctx);
  Object.assign(h.ctx,{$:id=>nodes[id]||(nodes[id]={}),log,guardOn(){},layer:{hidden:true},lockPage(){},fit(){},frame(){},toBottom(){log.scrollTop=log.children.length},
    play(name,done){if(done&&holdWave)waveDone=done;else done?.()},idle(){},loop(){},piyoMsg,
    userMsg:text=>log.children.push({text}),fmt:s=>s,DEFAULT_SUGGEST:[],
    setTimeout:fn=>{fn();return 0},clearTimeout(){},fillSuggest:list=>chips.push(list),consumeSuggest(){},suggest:{children:[1]},holdSuggest(){},showSuggest(){},fadeSuggest:()=>null,
    idleEl:{hidden:true},idleHide(){},slideFrom(){},matchMedia:()=>({matches:reduced}),
    apiKey:true,mac:null,routeMode:'mac-first',NEED_MORE:{},sync(){},textOf:r=>r.content[0].text,
    async callClaude({messages}){
      requests.push(JSON.parse(JSON.stringify(messages)));
      if(replyGate)await replyGate;
      return {content:[{type:'text',text:'回答だぴよ。'}]};
    }});
  const open=html.slice(html.indexOf('  async function open(){',html.indexOf('  const DATA_TTL=')),html.indexOf('  function close('));
  const ask=html.slice(html.indexOf('  let busy=false,pendingChip=null;'),html.indexOf('  const sync=()=>'));
  vm.runInContext('let greeted=false,openId=0,history=[];'+open+ask+`;this.chat={open,ask,
    get history(){return history},get busy(){return busy},get greeted(){return greeted},
    get pendingChip(){return pendingChip},set pendingChip(value){pendingChip=value}};`,h.ctx);
  return Object.assign(h,{log,chat:h.ctx.chat,chips,requests,animations,
    reduced:value=>{reduced=value},
    deferReply(){let release;replyGate=new Promise(r=>release=r);return ()=>{replyGate=null;release()}},
    deferFade(){let release;fadeGate=new Promise(r=>release=r);const started=new Promise(r=>fadeStarted=r);return {started,release:()=>{fadeGate=null;release()}}},
    holdWave:value=>{holdWave=value},finishWave:()=>{const done=waveDone;waveDone=null;done?.()},
  });
}
test('30分ちょうどで前の吹き出し・確認ボタン・記憶を消し、新しいまとめと候補を表示',async()=>{
  const h=chatSetup();await h.chat.open();await h.chat.ask('前の質問');
  h.log.children.push({text:'調べる？',choices:['調べる','やめる']});h.chat.pendingChip={};
  h.advance(1800000);h.respond('data/piyo-greeting.json',{lines:['運行します。','・発売しました。'],suggest:['question2']});
  await h.chat.open();assert.equal(h.log.children.length,1);assert.equal(h.chat.history.length,0);assert.equal(h.chat.pendingChip,null);
  assert.match(h.log.children[0].text,/運行するぴよ。/);assert.match(h.log.children[0].text,/・発売しました。/);
  assert.equal(h.chips.at(-1)[0],'question2');assert.equal(h.animations.length,1);assert.equal(h.animations[0].active,false);
  await h.chat.ask('新しい質問');assert.deepEqual(h.requests.at(-1),[{role:'user',content:'新しい質問'}]);
});
test('30分未満は吹き出しと記憶を保ち、次の質問にも前の会話を渡す',async()=>{
  const h=chatSetup();await h.chat.open();await h.chat.ask('前の質問');
  const nodes=h.log.children.slice();h.advance(1800000-1);await h.chat.open();
  assert.deepEqual(h.log.children,nodes);assert.equal(h.chips.length,1);assert.equal(h.animations.length,0);
  await h.chat.ask('続きの質問');assert.deepEqual(h.requests.at(-1).map(m=>m.content),['前の質問','回答だぴよ。','続きの質問']);
});
test('日本時間の日付変更時は30分未満でも表示と記憶を消す',async()=>{
  const h=chatSetup();h.setTime('2026-10-26T14:59:00Z');await h.chat.open();await h.chat.ask('昨日の質問');
  h.advance(60000);h.version(2);await h.chat.open();
  assert.equal(h.log.children.length,1);assert.match(h.log.children[0].text,/summary2/);assert.equal(h.chat.history.length,0);
});
test('返事待ちで開くと消さず、読込中に返事が完了しても次の呼び出しへ持ち越す',async()=>{
  const h=chatSetup();await h.chat.open();await h.chat.ask('前の質問');
  const finishReply=h.deferReply(),answer=h.chat.ask('返事待ちの質問');
  const nodes=h.log.children.slice(),history=JSON.stringify(h.chat.history);
  h.advance(1800000);h.version(2);const finishLoad=h.hold(),opening=h.chat.open();
  assert.equal(h.chat.busy,true);assert.deepEqual(h.log.children,nodes);assert.equal(JSON.stringify(h.chat.history),history);
  finishReply();await answer;finishLoad();await opening;
  assert.deepEqual(h.log.children,nodes);assert.equal(h.chat.history.length,4);assert.equal(h.chat.greeted,false);
  await h.chat.open();assert.equal(h.log.children.length,1);assert.match(h.log.children[0].text,/summary2/);assert.equal(h.chat.history.length,0);
});
for(const failed of ['piyo-greeting','weather'])test(failed+'だけの取得失敗でも成功したデータであいさつを更新し、会話を消す',async()=>{
  const h=chatSetup();await h.chat.open();await h.chat.ask('前の質問');
  h.advance(1800000);h.version(2);h.fail(failed);await h.chat.open();
  assert.equal(h.log.children.length,1);assert.equal(h.chat.history.length,0);assert.equal(h.animations.length,1);
});
test('まとめと天気の両方が取れないときは表示も記憶も消さない',async()=>{
  const h=chatSetup();await h.chat.open();await h.chat.ask('前の質問');const nodes=h.log.children.slice();
  h.advance(1800000);h.respond('data/piyo-greeting.json',null);h.respond('weather',null);await h.chat.open();
  assert.deepEqual(h.log.children,nodes);assert.equal(h.chat.history.length,2);assert.equal(h.animations.length,0);
});
test('同時に呼んでもあいさつは一つ、取得中にしまった場合は次に呼んで消す',async()=>{
  const h=chatSetup();await Promise.all([h.chat.open(),h.chat.open()]);assert.equal(h.log.children.length,1);assert.equal(h.calls,7);
  await h.chat.ask('前の質問');const nodes=h.log.children.slice();h.advance(1800000);h.version(2);
  const finishLoad=h.hold(),opening=h.chat.open();h.ctx.layer.hidden=true;finishLoad();await opening;
  assert.deepEqual(h.log.children,nodes);assert.equal(h.chat.greeted,false);
  await h.chat.open();assert.equal(h.log.children.length,1);assert.match(h.log.children[0].text,/summary2/);
});
test('動きを減らす設定では古い会話を薄くするアニメーションを使わない',async()=>{
  const h=chatSetup();h.reduced(true);await h.chat.open();await h.chat.ask('前の質問');h.advance(1800000);await h.chat.open();
  assert.equal(h.log.children.length,1);assert.equal(h.chat.history.length,0);assert.equal(h.animations.length,0);
});
test('消えかけでしまっても古い会話を保ち、次に呼んだとき消す',async()=>{
  const h=chatSetup();await h.chat.open();await h.chat.ask('前の質問');const nodes=h.log.children.slice();h.advance(1800000);
  const fade=h.deferFade(),opening=h.chat.open();await fade.started;h.ctx.layer.hidden=true;fade.release();await opening;
  assert.deepEqual(h.log.children,nodes);assert.equal(h.chat.history.length,2);assert.equal(h.animations[0].active,false);
  await h.chat.open();assert.equal(h.log.children.length,1);assert.equal(h.chat.history.length,0);
});
test('消えかけで新しい質問と返事が入ったら会話を消さず次回へ持ち越す',async()=>{
  const h=chatSetup();await h.chat.open();await h.chat.ask('前の質問');h.advance(1800000);
  const fade=h.deferFade(),opening=h.chat.open();await fade.started;await h.chat.ask('いまの質問');
  const nodes=h.log.children.slice();fade.release();await opening;
  assert.deepEqual(h.log.children,nodes);assert.equal(h.chat.history.length,4);assert.equal(h.animations[0].active,false);
  await h.chat.open();assert.equal(h.log.children.length,1);assert.equal(h.chat.history.length,0);
});
test('手を振る途中でしまっても裏であいさつせず次の呼び出しに表示する',async()=>{
  const h=chatSetup();h.holdWave(true);await h.chat.open();h.ctx.layer.hidden=true;h.finishWave();
  assert.equal(h.log.children.length,0);assert.equal(h.chat.greeted,false);
  h.holdWave(false);await h.chat.open();assert.equal(h.log.children.length,1);assert.equal(h.chat.greeted,true);
});
test('消した吹き出しの文字送りは次のタイマーで停止する',()=>{
  const children=[],timers=[];let done=0;
  const log={appendChild:node=>children.push(node)},document={createElement:()=>({text:{innerHTML:''},querySelector(){return this.text},get isConnected(){return children.includes(this)}})};
  const ctx={log,document,markLast(){},toBottom(){},setTimeout:fn=>timers.push(fn)};
  vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('  function piyoMsg('),html.indexOf('  // ---- データ'))+';this.piyoMsg=piyoMsg;',ctx);
  const msg=ctx.piyoMsg();msg.say('まだ文字を表示しているぴよ。',()=>done++);const node=children.pop(),text=node.text.innerHTML;
  assert.equal(timers.length,1);timers.shift()();assert.equal(node.text.innerHTML,text);assert.equal(timers.length,0);assert.equal(done,0);
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
test('7日分の天気、日の出・UV・風速・降水量と今日明日の3時間ごとの雨を知識に渡す',async()=>{
  const h=setup();await h.api.loadData();
  assert.equal(h.api.data.weather.length,7);
  const w=h.api.data.weather[0];assert.equal(w.sunrise,'06:09');assert.equal(w.sunset,'17:04');
  assert.equal(w.uv,4.2);assert.equal(w.wind,5.4);assert.equal(w.precipitation,0);
  assert.equal(w.rainHours.length,8);assert.equal(w.rainHours[0].rain,30);
  assert.equal(h.api.data.weather[1].rainHours.length,8);assert.equal(h.api.data.weather[2].rainHours.length,0);
  const text=h.api.knowledge();
  for(const fragment of ['日の出06:09','日の入り17:04','最大UV指数4.2','最大風速5.4m/s','降水量0mm','0〜3時 30%','3時間全体で雨が降る確率ではない'])assert.ok(text.includes(fragment),fragment);
  const url=new URL(html.match(/const WEATHER='([^']+)'/)[1]);
  assert.equal(url.searchParams.get('forecast_days'),'7');assert.equal(url.searchParams.get('wind_speed_unit'),'ms');
});
test('天気の追加項目が欠けても0と捏造せず、欠けた時間帯を省く',async()=>{
  const h=setup(),f=h.forecast();f.daily.uv_index_max[0]=null;f.daily.wind_speed_10m_max[0]=null;
  f.daily.precipitation_sum[0]=null;f.hourly.precipitation_probability[1]=null;
  h.respond('weather',f);await h.api.loadData();
  assert.equal(h.api.data.weather[0].uv,null);assert.equal(h.api.data.weather[0].rainHours.length,7);
  const first=h.api.weatherKnowledge().split('\n')[1];assert.ok(!first.includes('最大UV'));assert.ok(!first.includes('最大風速'));assert.ok(!first.includes('降水量'));
});
test('3時間の雨の集計は直前1時間の時刻を使い、深夜0時を翌日の区間へ混ぜない',async()=>{
  const h=setup(),f=h.forecast();f.hourly.precipitation_probability.fill(0);
  for(const [i,p] of [[0,100],[1,10],[2,20],[3,95],[24,77]])f.hourly.precipitation_probability[i]=p;
  h.respond('weather',f);await h.api.loadData();
  assert.equal(h.api.data.weather[0].rainHours[0].rain,95);
  assert.equal(h.api.data.weather[0].rainHours[7].rain,77);
  assert.equal(h.api.data.weather[1].rainHours[0].rain,0);
});
test('天気のHTTPエラーと気温欠損では古い予報を使わない',async()=>{
  const h=setup();await h.api.loadData();h.advance(1800000);
  const original=h.ctx.fetch;h.ctx.fetch=async(url,opts)=>url==='weather'?{ok:false,json:async()=>h.forecast()}:original(url,opts);
  await h.api.loadData();assert.equal(h.api.data.weather,null);assert.equal(h.api.weatherKnowledge(),'');
  h.ctx.fetch=original;const f=h.forecast();f.daily.temperature_2m_max.fill(null);h.respond('weather',f);
  await h.api.loadData();assert.equal(h.api.data.weather,null);
});
test('暦は日本時間の曜日・祝日・連休・今と次の節気・月齢を含む',async()=>{
  const h=setup();await h.api.loadData();const text=h.api.knowledge();
  for(const fragment of ['<today>2026-10-26（月）</today>','祝日ではない','2026-11-03 文化の日','2026-11-21〜2026-11-23（3連休）','霜降','立冬','次の新月','次の満月','月齢：15.5'])assert.ok(text.includes(fragment),fragment);
  h.setTime('2026-11-02T15:00:00Z');assert.match(h.api.knowledge(),/<today>2026-11-03（火）<\/today>/);assert.match(h.api.koyomiKnowledge(),/今日：.*文化の日/);
  h.setTime('2026-11-07T03:00:00Z');assert.ok(!h.api.koyomiKnowledge().includes('次の満月'));
});
test('暦の初回欠落でも既存データで動き、更新失敗時は前の暦を保持して再試行',async()=>{
  const h=setup();h.fail('koyomi');assert.equal(await h.api.loadData(),true);assert.equal(h.api.data.koyomi,null);
  assert.match(h.api.knowledge(),/暦データを取得できていない/);assert.ok(h.api.data.weather.length);
  h.fail('');await h.api.loadData();assert.ok(h.api.data.koyomi);assert.equal(h.calls,14);
  h.advance(1800000);h.fail('koyomi');await h.api.loadData();assert.ok(h.api.data.koyomi);
  h.setTime('2028-01-01T03:00:00Z');const text=h.api.koyomiKnowledge();
  assert.ok(text.includes('収録範囲外のため不明'));assert.ok(!text.includes('今の二十四節気'));assert.ok(!text.includes('おおよその月齢'));
});
test('あいさつの出典は天気の提供元とCC BY 4.0だけを表示する',()=>{
  assert.match(html,/piyoMsg\(true\)\.say/);
  assert.match(html,/class="piyo-sources"/);assert.match(html,/href="https:\/\/open-meteo.com\/"/);
  assert.match(html,/href="https:\/\/creativecommons.org\/licenses\/by\/4.0\/"/);
  const sources=html.match(/class="piyo-sources"[^>]*>(.*?)<\/div>/)[1];
  assert.ok(!sources.includes('祝日'));assert.ok(!sources.includes('内閣府'));
});
test('天気だけ取れないまま開き直しても会話と記憶を消さず、30分たったら新しいあいさつにする',async()=>{
  const h=chatSetup();h.fail('weather');await h.chat.open();await h.chat.ask('前の質問');const nodes=h.log.children.slice();
  for(let i=0;i<3;i++){h.advance(60000);await h.chat.open()}
  assert.deepEqual(h.log.children,nodes);assert.equal(h.chat.history.length,2);assert.equal(h.animations.length,0);
  h.fail('');h.advance(60000);await h.chat.open();assert.deepEqual(h.log.children,nodes); // 天気が取れても、取り直しだけなら消さない
  assert.ok(h.api.data.weather.length);
  h.advance(1800000);h.version(2);await h.chat.open();assert.equal(h.log.children.length,1);assert.equal(h.chat.history.length,0);
});
test('部分失敗の取り直しは新しいあいさつ扱いにしない',async()=>{
  const h=setup();assert.equal(await h.api.loadData(),true);h.advance(1800000);h.fail('weather');assert.equal(await h.api.loadData(),true);
  h.advance(60000);assert.equal(await h.api.loadData(),false);h.fail('');assert.equal(await h.api.loadData(),false);
  assert.equal(await h.api.loadData(),false);h.advance(1800000);assert.equal(await h.api.loadData(),true);
});
