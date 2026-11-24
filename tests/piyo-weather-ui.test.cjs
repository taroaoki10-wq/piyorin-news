// 2026-11-22（版 -5）：ぴよの天気の画面側
//  1. infobase の札で、ほかの町に名古屋の予報を答えない（docs/infobase.js の briefAnswer）
//  2. ほかの町の天気は、その町の予報で答える（docs/index.html の ask・placeAsk）。見つからない・取れないときの文・覚えておく
//  3. 3 時間ごとの天気（hourly の URL・days[].hours）  4. 図の切り替え（委任の click・scroll・CSS）  5. 版
// 偽の PiyoExtras（X）で動かす。本物の piyo-extras.js の進み具合では合否が変わらない。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const html=read('docs/index.html');
const part=(from,to)=>{const i=html.indexOf(from);assert.ok(i>=0,from);const j=html.indexOf(to,i);assert.ok(j>i,to);return html.slice(i,j)};
const mem=(init={})=>{const m=new Map(Object.entries(init));return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),has:k=>m.has(k),keys:()=>[...m.keys()]}};

// ---- 1：infobase.js の断り ----
const infobaseSrc=read('docs/infobase.js');
function infobase({brief,X}){
  const calls={cards:0};
  const sandbox={document:{readyState:'complete',getElementById:()=>null},
    localStorage:{getItem:()=>JSON.stringify({url:'https://pool.example',key:'k',enabled:true}),setItem(){}},
    InfobaseClient:{create:()=>({enabled:true,cards:async()=>{calls.cards++;return[]},feedback:async()=>{}}),toOpenMeteo:()=>null},
    InfobaseBrief:{create:()=>({enabled:true,answer:async()=>({briefs:[brief]}),get:async()=>null}),voice:s=>s},
    InfobaseGuard:{guard:text=>({ok:true,text})},
    PiyoExtras:X,Date,Promise,Array,Number,Object,JSON,Math,String,RegExp};
  sandbox.globalThis=sandbox;vm.createContext(sandbox);vm.runInContext(infobaseSrc,sandbox);
  return{answer:q=>sandbox.PiyoInfobase.answer(q),calls};
}
const card=(id,topic='weather')=>({id,topic,title:'天気',say:'今日は晴れです。',as_of:'2026-11-22T03:00:00Z',facts:null,sources:[{id:'002-0001',url:'https://example.test/w',attribution:'気象庁'}]});
const PLACES=/東京|大阪|京都|横浜|豊橋/;
const withPlace={weatherPlace:q=>PLACES.test(q)?{label:'どこか',lat:null,lon:null}:null};

test('infobase：名古屋の札を返す部品でも、ほかの町（東京など）の天気は null（ほかの答え方へ回す）',async()=>{
  const ib=infobase({brief:card('weather:名古屋市:7日'),X:withPlace});
  for(const q of ['東京の天気','明日の大阪の天気は？','豊橋の天気','京都の天気','横浜は雨？'])assert.equal(await ib.answer(q),null,q);
});
test('infobase：名古屋・町の名前なしの天気は、今までどおり札で答える（now の札も）',async()=>{
  const ib=infobase({brief:card('weather:名古屋市:7日'),X:withPlace});
  for(const q of ['名古屋の天気','今日の天気','明日の天気は？']){const r=await ib.answer(q);assert.ok(r&&r.brief==='weather:名古屋市:7日',q);assert.match(r.text,/今日は晴れ/)}
  const now=infobase({brief:card('now:名古屋市:気温','now'),X:withPlace});
  const r=await now.answer('今の名古屋の気温は？');assert.ok(r&&r.brief==='now:名古屋市:気温');
  assert.equal(await now.answer('今の東京の気温は？'),null);
});
test('infobase：weatherPlace が無い（piyo-extras.js が古い・読めていない）ときは、札の町が質問に無く、ほかの町の言葉があるときだけ断る',async()=>{
  const a=infobase({brief:card('weather:名古屋市:7日'),X:{}});
  assert.equal(await a.answer('東京の天気'),null);assert.equal(await a.answer('明日の大阪の天気は？'),null);
  assert.ok(await a.answer('今日の天気'));assert.ok(await a.answer('名古屋の天気'));
  const b=infobase({brief:card('weather:岐阜市:7日'),X:{}});
  assert.ok(await b.answer('岐阜の天気'),'札の町が質問に入っていれば答える');
  assert.equal(await b.answer('東京の天気'),null);
  const c=infobase({brief:card('weather:名古屋市:7日'),X:undefined});assert.equal(await c.answer('京都の天気'),null);
});
test('infobase：警報の札は、聞いた町の県の札のときだけ答える（2026-11-22 から。前は「東京の警報」に愛知県の札で答えていた）',async()=>{
  const ib=infobase({brief:{...card('warning:愛知県','warning'),title:'警報'},X:withPlace});
  assert.equal(await ib.answer('東京の警報'),null,'ほかの県の町には愛知県の札で答えない');
  assert.ok(await ib.answer('愛知の警報'),'愛知の警報は札で答える');
  assert.ok(await ib.answer('警報出てる？'),'町の無い質問は今までどおり札で答える');
});
test('infobase.js の断りの 2 つの道は、ソースにも書いてある',()=>{
  assert.match(infobaseSrc,/weatherPlace/);assert.match(infobaseSrc,/OTHER_PLACE/);
});

// ---- 共通の部品：画面の天気まわりを、画面なしで動かす ----
const WEATHER_FROM='  const WEATHER_KEEP=3*3600e3',WEATHER_TO='  // あいさつの天気の一言';
const hoursFor=(hourly,date)=>{ // 偽の hoursOf：その日の 3 時間ごと。temp が無ければ空
  if(!hourly||!Array.isArray(hourly.temperature_2m))return[];
  const out=[];hourly.time.forEach((t,i)=>{if(t.startsWith(date)&&Number(t.slice(11,13))%3===0)out.push({h:Number(t.slice(11,13)),temp:Math.round(hourly.temperature_2m[i]),word:'晴れ',rain:hourly.precipitation_probability[i]})});
  return out;
};
const forecast=(base=10,{temps=true}={})=>{
  const dates=[...Array(7)].map((_,i)=>new Date(Date.parse('2026-11-22T00:00:00Z')+i*86400e3).toISOString().slice(0,10));
  const time=[];for(const d of dates.slice(0,3))for(let h=0;h<24;h++)time.push(`${d}T${String(h).padStart(2,'0')}:00`);
  return{daily:{time:dates,weather_code:dates.map(()=>1),temperature_2m_max:dates.map((_,i)=>base+8+i),temperature_2m_min:dates.map((_,i)=>base+i),precipitation_probability_max:dates.map(()=>20),
      sunrise:dates.map(d=>d+'T06:30'),sunset:dates.map(d=>d+'T16:50'),uv_index_max:dates.map(()=>3),wind_speed_10m_max:dates.map(()=>4),precipitation_sum:dates.map(()=>0)},
    hourly:{time,precipitation_probability:time.map(()=>20),...(temps?{temperature_2m:time.map((_,i)=>base+(i%24)/2),weather_code:time.map(()=>1)}:{})}};
};
const GEO_URL='https://geocoding-api.open-meteo.com/v1/search';
function makeFx(extra={}){
  const figs=[];
  const FX={
    weatherAsk:t=>/天気|雨|傘/.test(t),
    weatherPlace:q=>/東京/.test(q)?{label:'東京',lat:35.69,lon:139.69}:/豊川/.test(q)?{label:'豊川',lat:null,lon:null}:/ほげ/.test(q)?{label:'ほげ',lat:null,lon:null}:/(町\d+)/.test(q)?{label:q.match(/町\d+/)[0],lat:30,lon:130}:null,
    geoNames:l=>[l+'市',l],
    pickGeo:rs=>rs&&rs.length?{label:rs[0].name,lat:rs[0].latitude,lon:rs[0].longitude,pref:rs[0].admin1}:null,
    hoursOf:hoursFor,
    localAnswer:(q,ctx)=>{
      if(!FX.weatherAsk(q))return null;
      const w=(ctx.weather||[]).filter(x=>x.date>=ctx.today);
      if(!w.length)return null;
      return{text:`${ctx.place||'名古屋'}の天気だぴよ！${w[0].word}、最高${w[0].max}℃`,kind:'weather',sources:'weather',...(ctx.place?{place:ctx.place}:{})};
    },
    weatherFigure:(days,today,o)=>{figs.push({days,today,o});return `<div class="piyo-wx2" data-place="${(o&&o.place)||''}"></div>`},
    ...extra};
  return{FX,figs};
}
// 答えの流れ全体（ask・answerLocal・天気の部分）。偽の fetch は {geo:{名前:results}, forecast:(lat,lon)=>json|null}
function chat({X,data,geo={},forecastFor,hourlyOnly,pooled=null,flags,weatherAt=null,localReplyNull=false,failFetch=false}={}){
  const now0=Date.parse('2026-11-22T03:00:00Z');let now=now0;
  const fx=X||makeFx(),users=[],piyos=[],keeps=[],turns=[],ends=[],fetched=[],sent=[],guards=[],stores=mem();
  const fakeFetch=async(url)=>{
    fetched.push(url);
    if(failFetch)throw new TypeError('Load failed');
    const u=new URL(url);
    if(url.startsWith(GEO_URL)){const r=geo[u.searchParams.get('name')];return{ok:true,json:async()=>({results:r||[]})}}
    const lat=u.searchParams.get('latitude'),lon=u.searchParams.get('longitude');
    if(hourlyOnly&&!u.searchParams.get('daily')&&hourlyOnly!==true)return{ok:false,json:async()=>null};
    const body=forecastFor?forecastFor(lat,lon,u):forecast(lat==='35.1709'?10:20);
    if(!body)return{ok:false,json:async()=>null};
    return{ok:true,json:async()=>body};
  };
  const c={PiyoExtras:fx.FX,data:data||{events:[],basics:null,koyomi:null,weather:[{date:'2026-11-22',word:'くもり',max:15,min:7,rain:30,rainHours:[]},{date:'2026-11-23',word:'晴れ',max:16,min:8,rain:10,rainHours:[]}],news:[],memo:{},greeting:null},
    apiKey:'sk-ant-test',mac:null,routeMode:'api',pendingQ:'',refMap:{},weatherAt,
    $:()=>({}),todayStr:()=>'2026-11-22',nextDay:s=>new Date(Date.parse(s+'T00:00:00Z')+86400e3).toISOString().slice(0,10),
    localStorage:stores,Math,OMIKUJI:'piyo-omikuji',AbortController,clearTimeout,
    setTimeout:(f,ms)=>setTimeout(f,Math.min(ms,5)), // 待ちは短く（本物の秒数は定数の試験で確かめる）
    Date:class extends Date{static now(){return now}},
    esc:s=>String(s),fmt:s=>s,piyoTone:s=>s,
    userMsg(t){const u={t,removed:false,remove(){u.removed=true}};users.push(u);return u},
    loop(){},idle(){},play(){},sync(){},consumeSuggest(){},featOn:()=>true,buyRecords:()=>[],
    piyoMsg:()=>{const ins=[];const m={said:[],removed:false,ins,
      el:{querySelector:s=>s==='.piyo-text'?{insertAdjacentHTML:(w,h)=>ins.push(h)}:(ins.length?{}:null)},
      say(text,done){m.said.push(text);done?.()},choices(){},links(){},remove(){m.removed=true}};piyos.push(m);return m},
    openKey(){},saveMac(){},NEED_MORE:{},SYSTEM_MAC:'MAC',knowledge:()=>'<knowledge></knowledge>',
    textOf:r=>(r.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim(),errText:()=>'API のエラーだぴよ。',
    callClaude:async b=>{sent.push(b);return{content:[{type:'text',text:'API の答えだぴよ。'}]}},
    keepTalk:items=>keeps.push(plain(items)),
    PiyoLog:{turn(q){turns.push(q);return 'lt'+turns.length},end(lt,r){ends.push({lt,...plain(r)})},isOpen:()=>true,newConv(){}},
    PiyoInfobase:{answer:async()=>null,guard:(text,q)=>{guards.push(q);return{ok:true,text}},weather:async()=>pooled},
    log:{addEventListener(){}},requestAnimationFrame:f=>f(),
    fetch:fakeFetch,freshWeather:()=>{c.freshCalls=(c.freshCalls||0)+1;return null},freshCalls:0};
  vm.createContext(c);
  const src='let history=[];const DATA_TTL=30*60*1000;'+html.match(/  const WEATHER='[^']+';[^\n]*\n  const WEATHER_HOURLY='[^']+';[^\n]*\n/)[0]
    +part(WEATHER_FROM,WEATHER_TO)
    +part('  let busy=false,pendingChip=null;','  const sync=()=>')+part('  function omikujiSeed(','  // ---- API キー');
  vm.runInContext(src+';this.ask=ask;this.history=()=>history;this.isBusy=()=>busy;this.loadWeather=loadWeather;this.cache=()=>placeWx;',c);
  return{c,users,piyos,keeps,turns,ends,fetched,sent,guards,figs:fx.figs,advance:ms=>{now+=ms},
    said:()=>piyos.filter(p=>!p.removed).flatMap(p=>p.said),
    urls:filter=>fetched.filter(u=>u.includes(filter))};
}
const TOKYO='東京の天気は？';

test('ほかの町（東京・位置あり）：待ち表示→東京の予報を取って、東京の名前で答える。guard・Claude・名古屋の取り直しは通らない',async()=>{
  const h=chat();
  await h.c.ask(TOKYO);
  assert.equal(h.users.length,1,'利用者の吹き出しは 1 つ');
  assert.equal(h.piyos[0].said[0],'東京の天気を見てるぴよ…');assert.equal(h.piyos[0].removed,true,'待ちの吹き出しは消す');
  const f=h.urls('api.open-meteo.com');assert.equal(f.length,1);
  const u=new URL(f[0]);assert.equal(u.searchParams.get('latitude'),'35.69');assert.equal(u.searchParams.get('longitude'),'139.69');
  assert.ok(u.searchParams.get('hourly').includes('temperature_2m'));assert.equal(h.urls(GEO_URL).length,0,'位置が分かる町は地名検索しない');
  const last=h.said().at(-1);assert.match(last,/^東京の天気だぴよ！/);assert.match(last,/最高28℃/,'名古屋ではなく東京（base 20）の予報');
  assert.equal(h.guards.length,0,'名古屋の札との照らし合わせは通さない');
  assert.equal(h.sent.length,0);assert.equal(h.c.freshCalls,0);assert.equal(h.c.isBusy(),false);
  assert.deepEqual(h.keeps,[[{r:'u',t:TOKYO},{r:'p',t:last}]]);
  assert.equal(h.turns.length,1);assert.equal(h.ends.length,1);assert.equal(h.ends[0].status,'ok');
  assert.deepEqual(plain(h.c.history().map(m=>m.role)),['user','assistant']);
  // 図：その町の日の配列と place
  assert.equal(h.figs.length,1);assert.equal(h.figs[0].o.place,'東京');assert.equal(h.figs[0].days[0].max,28);assert.equal(h.figs[0].today,'2026-11-22');
  assert.ok(Number.isFinite(h.figs[0].o.nowHour));assert.equal(h.figs[0].o.nowHour,12,'日本時間の今の時（03:00Z＝12 時）');
  assert.ok(h.figs[0].days[0].hours.length>=2,'日の hours（3 時間ごと）が付く');
  assert.ok(!/取った予報/.test(last),'名古屋の weatherNote は付けない');
});
test('ほかの町：名古屋の予報が古いとき、名古屋の質問には「取った予報」の一言が付くが、東京の答えには付かない',async()=>{
  const h=chat({weatherAt:Date.parse('2026-11-22T00:00:00Z')});
  await h.c.ask(TOKYO);assert.ok(!/取った予報/.test(h.said().at(-1)));
  const g=chat({weatherAt:Date.parse('2026-11-22T00:00:00Z')});
  await g.c.ask('今日の天気は？');assert.match(g.said().at(-1),/取った予報/);assert.equal(g.guards.length,1,'名古屋の答えは今までどおり guard を通す');
  assert.equal(g.urls(GEO_URL).length+g.urls('api.open-meteo.com').length,0);
});
test('ほかの町（位置なし）：地名検索（count=5・language=ja・countryCode=JP）で引き、見つかった町の名前で答える',async()=>{
  const geo={'豊川市':[{name:'豊川',latitude:34.84,longitude:137.37,admin1:'愛知県'}]};
  const h=chat({geo});
  await h.c.ask('豊川の天気は？');
  const g=h.urls(GEO_URL);assert.equal(g.length,1);const u=new URL(g[0]);
  assert.equal(u.searchParams.get('name'),'豊川市');assert.equal(u.searchParams.get('count'),'5');assert.equal(u.searchParams.get('language'),'ja');assert.equal(u.searchParams.get('countryCode'),'JP');
  const f=new URL(h.urls('api.open-meteo.com/v1/forecast')[0]);assert.equal(f.searchParams.get('latitude'),'34.84');assert.equal(f.searchParams.get('longitude'),'137.37');
  assert.match(h.said().at(-1),/^豊川の天気だぴよ/);assert.equal(h.figs[0].o.place,'豊川');assert.equal(h.c.isBusy(),false);assert.equal(h.users.length,1);
});
test('ほかの町：最初の名前で見つからなければ次の名前を試す。どれも見つからなければ「どこか分からなかった」で終わり（Claude へ回さない・予報は取らない）',async()=>{
  const h=chat({geo:{'豊川':[{name:'豊川',latitude:34.84,longitude:137.37,admin1:'愛知県'}]}});
  await h.c.ask('豊川の天気は？');
  assert.equal(h.urls(GEO_URL).length,2);assert.match(h.said().at(-1),/^豊川の天気だぴよ/);
  const n=chat();await n.c.ask('ほげの天気は？');
  assert.equal(n.urls(GEO_URL).length,2);assert.equal(n.urls('v1/forecast').length,0);assert.equal(n.sent.length,0);
  assert.equal(n.said().at(-1),'ほげがどこか分からなかったぴよ。市の名前で聞いてみてね。');
  assert.equal(n.users.length,1);assert.equal(n.c.isBusy(),false);assert.equal(n.guards.length,0);
  assert.equal(n.keeps.length,1);assert.equal(n.ends.length,1);assert.equal(n.figs.length,0,'図は出さない');
});
test('ほかの町：予報が取れなかったら「いま取れなかった」と答える（3 回まで試す）。busy は戻り、利用者の吹き出しは 1 つ',async()=>{
  const h=chat({failFetch:true});
  await h.c.ask(TOKYO);
  assert.equal(h.urls('v1/forecast').length,3);
  assert.equal(h.said().at(-1),'東京の天気をいま取れなかったぴよ…少しあとで聞いてね。');
  assert.equal(h.sent.length,0);assert.equal(h.c.isBusy(),false);assert.equal(h.users.length,1);assert.equal(h.figs.length,0);
  assert.equal(h.piyos[0].removed,true);
  // 地名検索だけが取れないときも同じ文
  const g=chat({failFetch:true});await g.c.ask('豊川の天気は？');
  assert.equal(g.said().at(-1),'豊川の天気をいま取れなかったぴよ…少しあとで聞いてね。');assert.equal(g.c.isBusy(),false);
});
test('ほかの町：30 分は覚えておく（同じ町を聞き直しても通信しない）。30 分たつと取り直す。20 か所まで',async()=>{
  const h=chat();
  await h.c.ask(TOKYO);await h.c.ask('東京は雨？');
  assert.equal(h.urls('v1/forecast').length,1);assert.equal(h.users.length,2);
  h.advance(29*60e3);await h.c.ask(TOKYO);assert.equal(h.urls('v1/forecast').length,1);
  h.advance(2*60e3);await h.c.ask(TOKYO);assert.equal(h.urls('v1/forecast').length,2);
  const g=chat();
  for(let i=1;i<=25;i++)await g.c.ask(`町${i}の天気は？`);
  assert.equal(g.c.cache().size,20);assert.ok(!g.c.cache().has('町1')&&g.c.cache().has('町25'));
  // 日付（日本時間）が変わったら、30 分以内でも使わない
  const d=chat();await d.c.ask(TOKYO);d.advance(13*3600e3);d.c.todayStr=()=>'2026-11-23';await d.c.ask(TOKYO);assert.equal(d.urls('v1/forecast').length,2);
});
test('名古屋・町の名前なしの質問は今までどおり（ほかの町の道を通らない）。天気でない質問も',async()=>{
  const h=chat();await h.c.ask('今日の天気は？');
  assert.equal(h.urls(GEO_URL).length+h.urls('v1/forecast').length,0);assert.match(h.said().at(-1),/^名古屋の天気だぴよ/);assert.equal(h.guards.length,1);
  assert.equal(h.figs.length,1);assert.equal(h.figs[0].o.place,undefined,'place が無ければ名古屋の図');assert.equal(h.figs[0].days[0].max,15,'名古屋の日の配列');
  const g=chat();await g.c.ask('ぴよりんって何？');assert.equal(g.urls(GEO_URL).length,0);assert.equal(g.sent.length,1);assert.equal(g.users.length,1);
});
test('ほかの町の答えを作れなかったとき（localAnswer が null）は、利用者の吹き出しを 2 回出さずに今までの流れ（Claude）へ',async()=>{
  const X=makeFx({localAnswer:()=>null});
  const h=chat({X});await h.c.ask(TOKYO);
  assert.equal(h.users.length,1);assert.equal(h.sent.length,1);assert.equal(h.c.isBusy(),false);assert.equal(h.piyos[0].removed,true);
});
test('X.weatherPlace が無いときは、ほかの町の道を通らない（今までの流れ）',async()=>{
  const X=makeFx();delete X.FX.weatherPlace;
  const h=chat({X});await h.c.ask(TOKYO);assert.equal(h.urls('v1/forecast').length,0);assert.equal(h.users.length,1);
});
test('ask のソース：ほかの町の道は freshWeather より前・infobase のあと。待ちの try/finally は今のまま',()=>{
  const src=part('  async function ask(q){','  async function askApi(');
  const iInfo=src.indexOf('PiyoInfobase.answer(q)'),iPlace=src.indexOf('wxPlaceOf('),iFresh=src.indexOf('freshWeather()');
  assert.ok(iInfo>=0&&iPlace>iInfo&&iFresh>iPlace,'infobase → ほかの町 → 取り直し');
  assert.ok(src.indexOf('placeAsk(')>iInfo);assert.ok(src.includes('setTimeout(r,1500)'));
  assert.match(src,/try\{[\s\S]*await[\s\S]*\}finally\{[\s\S]*busy=false;sync\(\)/);
  assert.ok(src.includes('天気を見てるぴよ…'),'名古屋の待ち表示は残る');
});
test('answerLocal：place のある答えでは guard と weatherNote を通さない（ソース）',()=>{
  const src=part('  function answerLocal(q,a){','  // 返事を作りながら');
  assert.match(src,/a\.place\?null:globalThis\.PiyoInfobase\?\.guard/);assert.match(src,/!a\.place&&typeof weatherNote/);
});

// ---- 3：3 時間ごと ----
test('WEATHER の URL：hourly に temperature_2m・weather_code・precipitation_probability。緯度経度と forecast_days は今のまま',()=>{
  const u=new URL(html.match(/const WEATHER='([^']+)'/)[1]);
  const hr=u.searchParams.get('hourly').split(',');
  for(const k of ['temperature_2m','weather_code','precipitation_probability'])assert.ok(hr.includes(k),k);
  assert.equal(u.searchParams.get('latitude'),'35.1709');assert.equal(u.searchParams.get('longitude'),'136.8815');assert.equal(u.searchParams.get('forecast_days'),'7');
  const h=new URL(html.match(/const WEATHER_HOURLY='([^']+)'/)[1]);
  assert.equal(h.searchParams.get('latitude'),'35.1709');assert.equal(h.searchParams.get('longitude'),'136.8815');assert.equal(h.searchParams.get('timezone'),'Asia/Tokyo');
  for(const k of ['temperature_2m','weather_code','precipitation_probability'])assert.ok(h.searchParams.get('hourly').split(',').includes(k),k);
});
test('loadWeather（Open-Meteo 直）：今日と明日の日に hours が付く。3 日目以降は付かない。rainHours は今までどおり',async()=>{
  const h=chat();const days=await h.c.loadWeather(1,1500);
  assert.equal(days.length,7);
  assert.ok(days[0].hours.length>=2&&days[1].hours.length>=2);assert.equal(days[0].hours[0].h,0);
  assert.equal(days[2].hours,undefined);assert.equal(days[0].rainHours.length,8);assert.equal(h.urls('v1/forecast').length,1);
});
test('loadWeather（infobase の札から作った予報）：hourly に気温が無ければ、Open-Meteo から hourly だけ取って hours を付ける',async()=>{
  const pooled=forecast(10,{temps:false});
  const h=chat({pooled});const days=await h.c.loadWeather(1,1500);
  assert.equal(h.urls('v1/forecast').length,1);const u=new URL(h.urls('v1/forecast')[0]);
  assert.equal(u.searchParams.get('daily'),null,'hourly だけ');assert.ok(u.searchParams.get('hourly').includes('temperature_2m'));
  assert.ok(days[0].hours.length>=2);assert.equal(days[0].max,18,'日ごとの値は札の予報のまま');assert.equal(days[0].rainHours.length,8);
});
test('loadWeather（札の予報）：hourly が取れなくても予報は返る（hours 無し）。札に気温があれば追加の通信はしない',async()=>{
  const h=chat({pooled:forecast(10,{temps:false}),failFetch:true});const days=await h.c.loadWeather(1,1500);
  assert.equal(days.length,7);assert.equal(days[0].hours,undefined);
  const g=chat({pooled:forecast(10)});const d2=await g.c.loadWeather(1,1500);assert.equal(g.fetched.length,0);assert.ok(d2[0].hours.length>=2);
  const k=chat({X:makeFx({hoursOf:undefined})});const d3=await k.c.loadWeather(1,1500);assert.equal(d3[0].hours,undefined,'X.hoursOf が無いときは hours 無し');
});

// ---- 4：図の切り替え ----
function pager(){
  const handlers=[],rafs=[],marks=[],scrolls=[];
  const mkTab=n=>{const t={n,on:n===0,attrs:{'data-page':String(n),'aria-selected':n===0?'true':'false'},
    classList:{toggle(c,on){if(c==='on')t.on=!!on}},getAttribute:k=>t.attrs[k],setAttribute(k,v){t.attrs[k]=v},closest:s=>s==='.piyo-wx-tab'?t:s==='.piyo-wx2'?box:null};return t};
  const tabs=[mkTab(0),mkTab(1)];
  const pages={clientWidth:300,scrollLeft:0,classList:{contains:c=>c==='piyo-wx-pages'},closest:s=>s==='.piyo-wx2'?box:null,scrollTo(o){scrolls.push(o)}};
  const box={querySelectorAll:s=>s==='.piyo-wx-tab'?tabs:[],querySelector:s=>s==='.piyo-wx-pages'?pages:null};
  const root={addEventListener:(type,fn,cap)=>handlers.push({type,fn,cap})};
  const c={log:{addEventListener(){}},setTimeout:f=>{rafs.push(f);return rafs.length},matchMedia:()=>({matches:false}),Number,String};
  vm.createContext(c);
  vm.runInContext(part('  // ---- 天気の図の切り替え','  // 取り直せずに前の予報で答えるときの一言')+';this.setup=wxPagerSetup;',c);
  c.setup(root);
  return{handlers,tabs,pages,box,rafs,scrolls,click:t=>handlers.find(x=>x.type==='click').fn({target:t}),scroll:t=>handlers.find(x=>x.type==='scroll').fn({target:t}),marks};
}
test('図の切り替え：log に click と scroll（capture）を 1 つずつ付ける（委任）',()=>{
  const p=pager();assert.deepEqual(p.handlers.map(h=>[h.type,!!h.cap]),[['click',false],['scroll',true]]);
});
test('図の切り替え：ボタンを押すと、その枚へなめらかにスクロールし、押したボタンを on・aria-selected にする',()=>{
  const p=pager();
  p.click(p.tabs[1]);
  assert.deepEqual(plain(p.scrolls),[{left:300,behavior:'smooth'}]);assert.equal(p.tabs[1].on,true);assert.equal(p.tabs[1].attrs['aria-selected'],'true');
  assert.equal(p.tabs[0].on,false);assert.equal(p.tabs[0].attrs['aria-selected'],'false');
  p.click(p.tabs[0]);assert.deepEqual(plain(p.scrolls.at(-1)),{left:0,behavior:'smooth'});assert.equal(p.tabs[0].on,true);
  p.click({closest:()=>null});assert.equal(p.scrolls.length,2,'ボタン以外を押しても何もしない');
});
test('図の切り替え：指で滑らせたら、近い方のボタンを on にする（scroll は間引く）。図の外の scroll は無視',()=>{
  const p=pager();
  p.pages.scrollLeft=200;for(let i=0;i<5;i++)p.scroll(p.pages);
  assert.equal(p.rafs.length,1,'続けて来ても 1 回だけ読む');p.rafs.shift()();
  assert.equal(p.tabs[1].on,true);assert.equal(p.tabs[1].attrs['aria-selected'],'true');assert.equal(p.tabs[0].on,false);
  p.pages.scrollLeft=100;p.scroll(p.pages);p.rafs.shift()();assert.equal(p.tabs[0].on,true);assert.equal(p.tabs[1].on,false);
  p.scroll({classList:{contains:()=>false}});assert.equal(p.rafs.length,0);
});
test('図の切り替え：動きを減らす設定のときは、すぐ切り替える（behavior:auto）',()=>{
  const p=pager();
  const c={log:{addEventListener(){}},requestAnimationFrame:()=>1,matchMedia:()=>({matches:true}),Number,String};vm.createContext(c);
  vm.runInContext(part('  // ---- 天気の図の切り替え','  // 取り直せずに前の予報で答えるときの一言')+';this.setup=wxPagerSetup;',c);
  const hs=[];c.setup({addEventListener:(t,f,cap)=>hs.push({t,f})});hs.find(x=>x.t==='click').f({target:p.tabs[1]});
  assert.equal(p.scrolls.at(-1).behavior,'auto');
});
test('図の切り替え：画面の log に付けている（ソース）',()=>{
  assert.match(html,/wxPagerSetup\(log\)/);
});
test('CSS：横スクロール・スナップ・漏れ止め・縦は邪魔しない・ボタンは 32px 以上・明るい／暗いの変数だけ',()=>{
  const rule=sel=>{const m=html.match(new RegExp(sel.replace(/[.\[\]="]/g,'\\$&')+'\\{([^}]*)\\}'));assert.ok(m,sel);return m[1]};
  const pages=rule('.piyo-wx-pages');
  for(const p of ['display:flex','overflow-x:auto','scroll-snap-type:x mandatory','scrollbar-width:none','-webkit-overflow-scrolling:touch','overscroll-behavior-x:contain','touch-action:pan-x pan-y'])assert.ok(pages.includes(p),p);
  assert.ok(html.includes('.piyo-wx-pages::-webkit-scrollbar{display:none}'));
  const page=rule('.piyo-wx-page');assert.ok(page.includes('flex:0 0 100%')&&page.includes('scroll-snap-align:start'));
  const tab=rule('.piyo-wx-tab');assert.match(tab,/min-height:32px/);assert.match(tab,/min-width:32px/);assert.match(tab,/border-radius:99px/);
  assert.match(rule('.piyo-wx-tab.on'),/var\(--/);assert.ok(rule('.piyo-wx-hr').includes('flex'));
  assert.match(html,/\.piyo-wx-page \.piyo-wx\{[^}]*margin-top:0/);
});

// ---- 5：版 ----
test('版は 2026.11.23-1（meta・PN_VERSION・piyo-extras.js?v=8・infobase.js?v=7）',()=>{
  assert.match(html,/<meta name="piyo-ver" content="\d{4}\.\d{2}\.\d{2}-\d+">/);
  assert.match(html,/const PN_VERSION='\d{4}\.\d{2}\.\d{2}-\d+（[^）]+）'/);
  assert.ok(+(html.match(/<script src="piyo-extras\.js\?v=(\d+)"><\/script>/)||[])[1]>=8); // 2026-11-24 に 9（購入記録の同期の鍵 buygist）assert.match(html,/<script src="infobase\.js\?v=7"><\/script>/);
  assert.ok(!html.includes('piyo-extras.js?v=7')&&!html.includes('infobase.js?v=6'));
});
test('画面の <script>（中身があるもの）に構文の誤りが無い',()=>{
  const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
  assert.ok(scripts.length>=1);scripts.forEach((s,i)=>assert.doesNotThrow(()=>new vm.Script(s,{filename:'index.html#'+i})));
  assert.doesNotThrow(()=>new vm.Script(infobaseSrc,{filename:'infobase.js'}));
});

test('警報の札：ほかの県の町には答えない／東海の町はその県の札で答える',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const c={window:{},localStorage:{getItem(){return null},setItem(){}},document:{getElementById(){return null},addEventListener(){}}};c.globalThis=c.window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','docs/piyo-cal.js'),'utf8'),c);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','docs/piyo-extras.js'),'utf8'),c);
  const src=fs.readFileSync(path.join(__dirname,'..','docs/infobase.js'),'utf8');
  const body=src.slice(src.indexOf('const OTHER_PLACE='),src.indexOf(' async function briefAnswer'));
  const f=new Function('root',body+';return {otherTown};')(c.window);
  const aichi={topic:'warning',id:'warning:愛知県'},mie={topic:'warning',id:'warning:三重県'};
  for(const q of ['東京の警報','大阪に警報出てる？','札幌に大雪警報は？','津の警報'])assert.equal(f.otherTown(aichi,q),true,q);
  for(const q of ['警報出てる？','愛知の警報','名古屋に警報出てる？','豊橋の警報','一宮に大雨警報は？'])assert.equal(f.otherTown(aichi,q),false,q);
  assert.equal(f.otherTown(mie,'津の警報'),false);assert.equal(f.otherTown(mie,'四日市に警報出てる？'),false);
  assert.equal(f.otherTown({topic:'weather',id:'weather:名古屋市:2026-11-22'},'東京の天気'),true);
  assert.equal(f.otherTown({topic:'weather',id:'weather:名古屋市:2026-11-22'},'今日の天気'),false);
  assert.equal(f.otherTown({topic:'quake',id:'quake:latest'},'東京の地震'),false);
});
