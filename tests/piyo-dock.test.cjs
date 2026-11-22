// 2026-11-23（版 2026.11.23-1）：町の天気を well dock（infobase）から読む 3 段の道（docs/piyo-dock.js と docs/index.html）
//  1. 窓口の約束の形 → 日の配列（weatherDays と同じ形。hours・rainHours は今の hoursOf・weatherDays と同じ数え方）
//  2. 3 段の落ち方（直の道 → Cloudflare → Open-Meteo）と、直の道を 60 秒試さないこと（偽の fetch・偽の時計）
//  3. 画面の流れ（placeAsk・placeDays・weatherFig）：出典の行・覚える・古い中身・設定の切
// 窓口は偽物（約束の形だけを信じる）。本物の鍵・本物の Mac には触らない。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const D=require('../docs/piyo-dock.js');
const html=read('docs/index.html');
const ex={window:{},TextEncoder,TextDecoder};vm.runInNewContext(read('docs/piyo-extras.js'),ex);
const X=ex.window.PiyoExtras;
const mem=(init={})=>{const m=new Map(Object.entries(init));return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),has:k=>m.has(k)}};

const NOW=Date.parse('2026-11-23T03:40:00+09:00'),TODAY='2026-11-23';
const KEYVAL='test-key-not-real';
const pad=n=>String(n).padStart(2,'0');
const addDay=(s,n=1)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400e3).toISOString().slice(0,10);
// 偽の窓口の返事（約束の形）。hourly は 04:00 から 48 時間。0 時の行は前の日の「24 時」と書く
const WORDS=h=>h<6?'晴れ':h<12?'曇り':h<18?'雨':'くもり';
function atOf(date,h,style='24'){return style==='24'&&h===0?`${addDay(date,-1)}T24:00:00+09:00`:`${date}T${pad(h)}:00:00+09:00`}
function hourly(from='2026-11-23',startH=4,count=48,style='24'){
  const out=[];let date=from,h=startH;
  for(let i=0;i<count;i++){
    out.push({at:atOf(date,h,style),weather:WORDS(h),temp:5+((h*7)%11)/2+(date===from?0:1),pop:(h*13+(date===from?0:7))%90,rain:0});
    h++;if(h===24){h=0;date=addDay(date)}
  }
  return out;
}
function daily(n=7,over={}){
  return [...Array(n)].map((_,i)=>({date:addDay(TODAY,i),weather:i%2?'曇り':'晴れ',max:12+i,min:3+i,pop:10*i,...(over[i]||{})}));
}
function body(o={}){
  return{at:'2026-11-23T03:40:00+09:00',town:'東京',pref:'東京都',lat:35.69,lon:139.69,now:null,
    daily:daily(7,o.dailyOver),hourly:o.hourly||hourly(),
    sources:o.sources||{now:'気象庁アメダス',daily:'気象庁',hourly:'tenki.jp'},
    as_of:o.as_of||{now:'2026-11-23T03:30:00+09:00',daily:'2026-11-23T03:30:00+09:00',hourly:'2026-11-23T03:30:00+09:00'},
    ...(o.stale?{stale:true}:{})};
}
const res=(status,json)=>({ok:status>=200&&status<300,status,json:async()=>{if(json===undefined)throw new SyntaxError('no json');return json}});

// ---------------- 1：形を直す ----------------
test('word：空白を取る・「曇」→「くもり」・「晴」→「晴れ」（weatherKind が読める形）',()=>{
  assert.equal(D.word('曇り'),'くもり');assert.equal(D.word('晴'),'晴れ');assert.equal(D.word('晴れ　時々　曇'),'晴れ時々くもり');
  assert.equal(D.word(' 雨 '),'雨');assert.equal(D.word(null),'');assert.equal(D.word(3),'');
  assert.equal(X.weatherKind(D.word('曇り')),'cloud');assert.equal(X.weatherKind(D.word('晴時々曇')),'partly');
});
test('jstParts：hour 24 は次の日の 0 時。T24:30 など読めない時刻は null。時差の無い文字は日本時間',()=>{
  assert.deepEqual(plain(D.jstParts('2026-11-23T24:00:00+09:00')),{date:'2026-11-24',hour:0});
  assert.deepEqual(plain(D.jstParts('2026-11-23T24:00+09:00')),{date:'2026-11-24',hour:0});
  assert.equal(D.jstParts('2026-11-23T24:30:00+09:00'),null);assert.equal(D.jstParts('よめない'),null);assert.equal(D.jstParts(null),null);
  assert.deepEqual(plain(D.jstParts('2026-11-23T04:00:00+09:00')),{date:'2026-11-23',hour:4});
  assert.deepEqual(plain(D.jstParts('2026-11-22T19:00:00Z')),{date:'2026-11-23',hour:4},'ほかの時差は日本時間に直す');
  assert.deepEqual(plain(D.jstParts('2026-11-23T04:00:00')),{date:'2026-11-23',hour:4},'時差なしは日本時間');
  assert.deepEqual(plain(D.jstParts('2026-11-23T04:45:00+09:00')),{date:'2026-11-23',hour:4},'端数は切り捨て');
});
test('normalize：日の配列の形（weatherDays と同じ項目）。max・min は四捨五入、sunrise など無い物は null',()=>{
  const days=D.normalize(body(),TODAY);
  assert.equal(days.length,7);
  const d=days[0];
  assert.deepEqual(Object.keys(d).sort(),['date','hours','max','min','precipitation','rain','rainHours','sunrise','sunset','uv','wind','word'].sort());
  assert.equal(d.date,TODAY);assert.equal(d.word,'晴れ');assert.equal(d.max,12);assert.equal(d.min,3);assert.equal(d.rain,0);
  assert.equal(days[1].word,'くもり');assert.equal(days[1].rain,10);
  assert.equal(d.sunrise,null);assert.equal(d.uv,null);assert.equal(d.wind,null);
  assert.ok(days[2].rainHours.length===0&&days[2].hours===undefined,'3 日目からは hours も rainHours も無い（weatherDays と同じ）');
  const r=D.normalize(body({dailyOver:{0:{max:12.6,min:2.4}}}),TODAY);assert.equal(r[0].max,13);assert.equal(r[0].min,2);
});
test('normalize：今日と明日の hours・rainHours は、Open-Meteo の形に直して今の hoursOf・weatherDays に通した数と同じ',()=>{
  const rows=hourly();
  const CODE={'晴れ':0,'くもり':3,'雨':63};
  const om={time:rows.map(r=>{const p=D.jstParts(r.at);return `${p.date}T${pad(p.hour)}:00`}),temperature_2m:rows.map(r=>r.temp),weather_code:rows.map(r=>CODE[D.word(r.weather)]),precipitation_probability:rows.map(r=>r.pop)};
  const mine=D.normalize(body({hourly:rows}),TODAY);
  for(const date of [TODAY,addDay(TODAY)]){
    const want=X.hoursOf(om,date),got=mine.find(d=>d.date===date).hours;
    assert.deepEqual(plain(got),plain(want),date+' の hours');assert.ok(want.length>=4,'比べる点が少なすぎる');
  }
  // rainHours は index.html の weatherDays と同じ（部品を取り出して同じ入力を通す）
  const c={PiyoExtras:X,todayStr:()=>TODAY,nextDay:s=>addDay(s),Date,Number,Math,Array,Object,JSON,Map,Promise};vm.createContext(c);
  const wd=html.slice(html.indexOf('  function weatherDays('),html.indexOf('  // ---- ほかの町（名古屋以外）'));
  vm.runInContext(html.match(/  function weatherWord\(c\)\{[\s\S]*?\n  \}\n/)[0]+wd+';this.weatherDays=weatherDays',c);
  const omFull={daily:{time:mine.map(d=>d.date),weather_code:mine.map(()=>0),temperature_2m_max:mine.map(d=>d.max),temperature_2m_min:mine.map(d=>d.min),precipitation_probability_max:mine.map(d=>d.rain)},hourly:om};
  const base=plain(c.weatherDays(omFull));
  for(let i=0;i<2;i++){assert.deepEqual(mine[i].rainHours,base[i].rainHours,'rainHours '+i);assert.ok(mine[i].rainHours.length>=4)}
});
test('normalize：hour が 24 の行・T24:00 の行は次の日の 0 時として数える（雨の 21〜24 時の区間と、翌日 0 時の点が作れる）',()=>{
  const days=D.normalize(body({hourly:hourly('2026-11-23',4,48,'24')}),TODAY);
  const last=days[0].rainHours.find(h=>h.from===21);assert.ok(last,'21〜24 時の区間（24 時の行を使う）');
  assert.ok(days[1].hours.some(h=>h.h===0),'翌日 0 時の点（前の日の T24:00 から作る）');
  const alt=D.normalize(body({hourly:hourly('2026-11-23',4,48,'plain')}),TODAY); // 同じ内容を T00:00 の書き方で
  assert.deepEqual(plain(alt[1].hours),plain(days[1].hours));assert.deepEqual(plain(alt[0].rainHours),plain(days[0].rainHours));
  const bad=hourly();bad[3].at='2026-11-23T24:30:00+09:00';bad[4].at='ほげ';bad[5]=null;
  assert.ok(D.normalize(body({hourly:bad}),TODAY),'読めない行は捨てて、ほかの行で作る');
});
test('normalize：daily の max・min・pop が null の日は、1 日分の 1 時間ごとの点がそろうときだけ埋める。埋められない日は出さない',()=>{
  const rows=hourly('2026-11-23',4,48);                         // 今日は 04 時から（20 時間）、明日は 24 時間そろう
  const days=D.normalize(body({hourly:rows,dailyOver:{0:{max:null,min:null,pop:null},1:{max:null,min:null,pop:null}}}),TODAY);
  assert.equal(days.some(d=>d.date===TODAY),false,'今日は点が 22 時間に足りず、最高・最低が作れない → 出さない');
  const tomorrow=days.find(d=>d.date===addDay(TODAY));assert.ok(tomorrow,'明日は 24 時間そろうので埋める');
  const t=rows.filter(r=>D.jstParts(r.at).date===addDay(TODAY)||(D.jstParts(r.at).date===addDay(TODAY)));
  const temps=[...Array(24).keys()].map(h=>{const r=rows.find(x=>{const p=D.jstParts(x.at);return p.date===addDay(TODAY)&&p.hour===h});return r.temp});
  assert.equal(tomorrow.max,Math.round(Math.max(...temps)));assert.equal(tomorrow.min,Math.round(Math.min(...temps)));
  assert.ok(Number.isFinite(tomorrow.rain));
  // 今日の pop だけ null：残りの時間の最大で埋める（max・min は daily の値のまま）
  const p=D.normalize(body({hourly:rows,dailyOver:{0:{pop:null}}}),TODAY);assert.ok(Number.isFinite(p[0].rain));assert.equal(p[0].max,12);
  // pop が埋められず null のままでも、日は出る（rain は null。答えは「雨の確率」を言わない）
  const np=D.normalize(body({hourly:[],dailyOver:{0:{pop:null}}}),TODAY);assert.equal(np[0].rain,null);assert.equal(np[0].hours,undefined);
  assert.deepEqual(np[0].rainHours,[]);
  // 20 時・今日の max が null：夜に「これから先」の最大を最高にしない
  const night=hourly('2026-11-23',20,28);
  const n=D.normalize(body({hourly:night,dailyOver:{0:{max:null}}}),TODAY);assert.equal(n.some(d=>d.date===TODAY),false);
  // 言葉の無い日・形の違う日は出さない
  const w=D.normalize(body({dailyOver:{1:{weather:null},2:{date:'あした'}}}),TODAY);assert.equal(w.length,5);
});
test('normalize：約束の形でない物は null（daily が無い・配列でない・今日の日付がおかしい）',()=>{
  for(const b of [null,undefined,[],'x',{},{daily:null,hourly:[]},{daily:'x'}])assert.equal(D.normalize(b,TODAY),null);
  assert.equal(D.normalize(body(),'きょう'),null);assert.equal(D.normalize({daily:[]},TODAY),null);
});
test('図と答え：本物の weatherFigure・localAnswer に dock 由来の日を渡して、undefined・null・NaN が文と図に出ない',()=>{
  const days=D.normalize(body({hourly:hourly('2026-11-23',4,48,'24'),dailyOver:{0:{pop:null}}}),TODAY);
  const fig=X.weatherFigure(days,TODAY,{nowHour:4,place:'東京'});
  assert.ok(fig.includes('piyo-wx2')&&fig.includes('3時間ごと'),'3 時間ごとの図が出る');
  assert.doesNotMatch(fig,/undefined|null|NaN/);
  for(const q of ['東京の天気は？','明日の東京の天気は？','東京の週間天気','東京は傘いる？','東京の気温は？']){
    const a=X.localAnswer(q,{now:NOW,today:TODAY,hour:4,events:[],basics:null,koyomi:null,weather:days,place:'東京'});
    assert.ok(a&&a.kind==='weather',q);assert.doesNotMatch(a.text,/undefined|null|NaN/,q);
  }
  for(const q of ['東京の日の出は？','東京の風は？','東京の紫外線は？']){
    const a=X.localAnswer(q,{now:NOW,today:TODAY,hour:4,events:[],basics:null,koyomi:null,weather:days,place:'東京'});
    assert.ok(!a||a.kind!=='weather','dock には無い値なので、作れない（画面側が Open-Meteo で取り直す）');
  }
  const wk=X.weatherFigure(D.normalize(body({hourly:[]}),TODAY),TODAY,{nowHour:4,place:'東京'});
  assert.ok(wk.includes('piyo-wx')&&!wk.includes('3時間ごと'),'hourly が無ければ週間だけ');assert.doesNotMatch(wk,/undefined|null|NaN/);
});

// ---------------- 古さ・出典・住所 ----------------
test('古さ：stale:true、または as_of（daily と hourly の新しい方）が 3 時間より前。now の as_of は見ない。読めなければ古いと言わない',()=>{
  const old=Date.parse('2026-11-23T00:30:00+09:00');
  assert.equal(D.isStale(body({stale:true}),NOW),true);
  assert.equal(D.isStale(body(),NOW),false);
  const as=(d,h)=>({as_of:{now:'2026-11-23T03:30:00+09:00',daily:d,hourly:h}});
  assert.equal(D.isStale(body(as('2026-11-23T00:00:00+09:00','2026-11-23T00:30:00+09:00')),NOW),true,'3 時間と 10 分前');
  assert.equal(D.isStale(body(as('2026-11-22T20:00:00+09:00','2026-11-23T01:00:00+09:00')),NOW),false,'hourly が新しければ古くない');
  assert.equal(D.isStale({...body(),as_of:null},NOW),false);assert.equal(D.isStale({...body(),as_of:{daily:'へん'}},NOW),false);
  assert.equal(D.asOfMs(body(as('2026-11-23T01:00:00+09:00','2026-11-23T02:00:00+09:00'))),Date.parse('2026-11-23T02:00:00+09:00'));
  assert.equal(D.noteOf(old),'（0時30分に取った予報だぴよ。新しい予報はいま取れなかったぴよ。）');assert.match(D.noteOf(null),/少し前の予報/);
});
test('出典の名前：sources の daily・hourly（重なりは 1 つ）。無ければ「気象庁・tenki.jp」',()=>{
  assert.equal(D.sourceName(body()),'気象庁・tenki.jp');
  assert.equal(D.sourceName(body({sources:{daily:'気象庁',hourly:'気象庁'}})),'気象庁');
  assert.equal(D.sourceName(body({sources:{daily:'気象庁',hourly:'Open-Meteo'}})),'気象庁・Open-Meteo.com（CC BY 4.0）','Open-Meteo は決まりの書き方で');
  assert.equal(D.sourceName({}),'気象庁・tenki.jp');assert.equal(D.sourceName(body({sources:{daily:3,hourly:null}})),'気象庁・tenki.jp');
});
test('直の道の住所：hostname に :8444。つなぎ方の url にポートがあっても hostname だけ。町の名前は URL として入れる',()=>{
  assert.equal(D.directUrl('https://mac-studio.tail1234.ts.net','東京'),'https://mac-studio.tail1234.ts.net:8444/v1/weather?town=%E6%9D%B1%E4%BA%AC');
  assert.equal(D.directUrl('https://mac-studio.tail1234.ts.net:8443','豊川市'),'https://mac-studio.tail1234.ts.net:8444/v1/weather?town=%E8%B1%8A%E5%B7%9D%E5%B8%82');
  assert.equal(new URL(D.directUrl('https://m.ts.net:9','a&b=c')).searchParams.get('town'),'a&b=c');
  for(const bad of ['','http://m.ts.net','ほげ',null,'https://'])assert.equal(D.directUrl(bad,'東京'),'');
});
test('Cloudflare の道の住所：infobase の url の /v1/weather。https か 127.0.0.1 だけ',()=>{
  assert.equal(D.cloudUrl('https://pool.example.workers.dev/','大阪'),'https://pool.example.workers.dev/v1/weather?town=%E5%A4%A7%E9%98%AA');
  assert.equal(D.cloudUrl('http://127.0.0.1:47324','大阪'),'http://127.0.0.1:47324/v1/weather?town=%E5%A4%A7%E9%98%AA');
  for(const bad of ['','http://pool.example','ftp://x',null,undefined])assert.equal(D.cloudUrl(bad,'大阪'),'');
});
test('時間の決まり：直 2 秒・Cloudflare 2.5 秒・直を試さないのは 60 秒・古いのは 3 時間',()=>{
  assert.equal(D.DIRECT_MS,2000);assert.equal(D.CLOUD_MS,2500);assert.equal(D.SKIP_MS,60000);assert.equal(D.STALE_MS,3*3600e3);
  assert.equal(D.KEY_SETTING,'piyo-dockwx');assert.equal(D.KEY_INFOBASE,'piyo-infobase');
});

// ---------------- 2：3 段の落ち方 ----------------
const MAC={url:'https://mac-studio.tail1234.ts.net:8443',token:'macmacmacmacmacmacmacmacmac',name:'Mac'};
const CF='https://pool.example.workers.dev';
const DIRECT_PREFIX='https://mac-studio.tail1234.ts.net:8444/v1/weather?town=';
function rig({route,mac=MAC,cfg={url:CF,key:KEYVAL,enabled:true},storage,directMs=30,cloudMs=40,clock}={}){
  const calls=[];let now=clock??NOW;
  const st=storage||mem(cfg===null?{}:{'piyo-infobase':JSON.stringify(cfg)});
  const fetchFn=(url,opt)=>{calls.push({url,opt});return route(url,opt,calls.length)};
  const dock=D.create({fetch:fetchFn,storage:st,getMac:()=>mac,today:()=>TODAY,now:()=>now,directMs,cloudMs});
  return{dock,calls,st,advance:ms=>{now+=ms},direct:()=>calls.filter(c=>c.url.startsWith(DIRECT_PREFIX)),cloud:()=>calls.filter(c=>c.url.startsWith(CF))};
}
const ok=(o)=>async()=>res(200,body(o));
const never=()=>new Promise(()=>{}); // signal を無視して返らない fetch
const route2=(direct,cloud)=>(url,opt,n)=>url.startsWith(DIRECT_PREFIX)?direct(url,opt,n):cloud(url,opt,n);

test('直の道が通る：直の住所・Authorization は infobase の鍵だけ（Mac の合言葉は送らない）。Cloudflare は呼ばない',async()=>{
  const r=rig({route:route2(ok(),async()=>{throw new Error('呼ばないはず')})});
  const got=await r.dock.town('東京');
  assert.equal(got.via,'direct');assert.equal(got.stale,false);assert.equal(got.srcName,'気象庁・tenki.jp');assert.equal(got.days.length,7);
  assert.equal(r.calls.length,1);assert.equal(r.calls[0].url,DIRECT_PREFIX+encodeURIComponent('東京'));
  assert.equal(r.calls[0].opt.headers.Authorization,'Bearer '+KEYVAL);
  assert.ok(!JSON.stringify(r.calls[0]).includes(MAC.token),'合言葉を送らない');
});
test('落ち方：直が時間切れ（signal を無視して返らない fetch でも次へ進む）→ Cloudflare が通る。そのあと直は試さない',async()=>{
  const r=rig({route:route2(never,ok())});
  const t0=Date.now(),got=await r.dock.town('東京');
  assert.equal(got.via,'cloud');assert.ok(Date.now()-t0<1500,'直の時間切れで止まらない');
  assert.equal(r.direct().length,1);assert.equal(r.cloud().length,1);assert.equal(r.cloud()[0].url,CF+'/v1/weather?town=%E6%9D%B1%E4%BA%AC');
  assert.equal(r.cloud()[0].opt.headers.Authorization,'Bearer '+KEYVAL);
  assert.equal(r.dock.directDown(),true);
});
test('60 秒は直を試さない：次の町も Cloudflare から。60 秒たつと、また直を試す',async()=>{
  const r=rig({route:route2(async()=>{throw new TypeError('Load failed')},ok())});
  await r.dock.town('東京');assert.equal(r.direct().length,1);
  await r.dock.town('大阪');await r.dock.town('京都');assert.equal(r.direct().length,1,'直は 1 回だけ');assert.equal(r.cloud().length,3);
  r.advance(59e3);await r.dock.town('福岡');assert.equal(r.direct().length,1,'59 秒後はまだ');
  r.advance(1e3);await r.dock.town('札幌');assert.equal(r.direct().length,2,'60 秒たったので、また直を試す');assert.equal(r.cloud().length,5);
});
test('落ち方：直が 401・403・404（口が無い）・CORS の失敗（TypeError）・形の違う返事・JSON でない返事 → どれも Cloudflare へ。直は 60 秒止まる',async()=>{
  const cases={
    '401':async()=>res(401,{error:'鍵が違います'}),'403':async()=>res(403,{}),'404 口が無い':async()=>res(404,'<html>'),
    'CORS':async()=>{throw new TypeError('Load failed')},'形の違う':async()=>res(200,{hello:'world'}),'配列':async()=>res(200,[1,2]),'JSON でない':async()=>res(200,undefined),'500':async()=>res(500,{}),
  };
  for(const[name,direct]of Object.entries(cases)){
    const r=rig({route:route2(direct,ok())});const got=await r.dock.town('東京');
    assert.equal(got&&got.via,'cloud',name);assert.equal(r.dock.directDown(),true,name+'：直は止まる');
  }
});
test('落ち方：直が失敗して Cloudflare も 404・401・時間切れ・形の違う返事 → null（画面は Open-Meteo へ）',async()=>{
  const bad={'404':async()=>res(404,{error:'その町の天気はありません'}),'404 口が無い':async()=>res(404,undefined),'401':async()=>res(401,{}),'時間切れ':never,'形の違う':async()=>res(200,{daily:'x'}),'CORS':async()=>{throw new TypeError('x')}};
  for(const[name,cloud]of Object.entries(bad)){
    const r=rig({route:route2(async()=>{throw new TypeError('x')},cloud)});
    assert.equal(await r.dock.town('東京'),null,name);assert.equal(r.direct().length,1);assert.equal(r.cloud().length,1);
  }
});
test('知らない町の 404（窓口の決まった文）は「道の失敗」ではない：直を止めない。次の道には聞く',async()=>{
  const r=rig({route:route2(async()=>res(404,{error:'その町の天気はありません'}),async()=>res(404,{error:'その町の天気はありません'}))});
  assert.equal(await r.dock.town('ほげ'),null);assert.equal(r.dock.directDown(),false);
  await r.dock.town('ふが');assert.equal(r.direct().length,2,'次の町でも直を試す');
});
test('Mac のつなぎ方が無い・鍵が無い・infobase が切・設定が切 → 飛ばす（鍵が無い・設定が切は fetch も呼ばない）',async()=>{
  let r=rig({mac:null,route:route2(async()=>{throw new Error('直は呼ばない')},ok())});
  assert.equal((await r.dock.town('東京')).via,'cloud');assert.equal(r.direct().length,0);
  r=rig({cfg:{url:CF,enabled:true},route:async()=>{throw new Error('呼ばない')}});assert.equal(await r.dock.town('東京'),null);assert.equal(r.calls.length,0);
  r=rig({cfg:{url:CF,key:KEYVAL,enabled:false},route:async()=>{throw new Error('呼ばない')}});assert.equal(await r.dock.town('東京'),null);assert.equal(r.calls.length,0);
  r=rig({cfg:null,route:async()=>{throw new Error('呼ばない')}});assert.equal(await r.dock.town('東京'),null);assert.equal(r.calls.length,0);
  r=rig({storage:mem({'piyo-infobase':'{こわれた','piyo-dockwx':'1'}),route:async()=>{throw new Error('呼ばない')}});assert.equal(await r.dock.town('東京'),null);assert.equal(r.calls.length,0);
  r=rig({storage:mem({'piyo-infobase':JSON.stringify({url:CF,key:KEYVAL}),'piyo-dockwx':'0'}),route:async()=>{throw new Error('呼ばない')}});
  assert.equal(await r.dock.town('東京'),null);assert.equal(r.calls.length,0);assert.equal(r.dock.on(),false);
  r=rig({cfg:{url:'http://pool.example',key:KEYVAL},mac:null,route:async()=>{throw new Error('呼ばない')}});assert.equal(await r.dock.town('東京'),null,'http の道には鍵を送らない');
  r=rig({storage:mem({'piyo-infobase':JSON.stringify({url:CF,key:KEYVAL})}),route:route2(ok(),ok())});assert.equal((await r.dock.town('東京')).via,'direct','piyo-dockwx が無ければ入（既定）');
});
test('古い中身：直が古ければ Cloudflare も聞く。新しいのが取れればそれ。どちらも古ければ新しい方を stale つきで返す。今日が作れない中身は使わない',async()=>{
  const old=(h)=>({as_of:{daily:h,hourly:h}});
  let r=rig({route:route2(ok({stale:true}),ok())});let got=await r.dock.town('東京');assert.equal(got.via,'cloud');assert.equal(got.stale,false);assert.equal(r.direct().length,1);
  r=rig({route:route2(ok(old('2026-11-23T00:00:00+09:00')),ok(old('2026-11-23T00:20:00+09:00')))});got=await r.dock.town('東京');
  assert.equal(got.stale,true);assert.equal(got.via,'cloud','新しい方（0 時 20 分の方）');assert.equal(got.asOf,Date.parse('2026-11-23T00:20:00+09:00'));
  assert.equal(r.dock.directDown(),false,'古いだけなら直は止めない');
  r=rig({route:route2(ok({stale:true}),async()=>res(404,undefined))});got=await r.dock.town('東京');assert.equal(got.stale,true);assert.equal(got.via,'direct');
  const yesterday=body();yesterday.daily=yesterday.daily.map((d,i)=>({...d,date:addDay('2026-11-21',i)})).slice(0,2);
  r=rig({route:route2(async()=>res(200,yesterday),async()=>res(404,undefined))});{const y=await r.dock.town('東京');assert.equal(y&&y.days,null,'今日の日が無い中身は、答えには使わない（days なし）');}
});

test('古い中身の上限：同じ日で 6 時間以内だけ時刻つきで使う。前の日・6 時間より古い中身は使わない（Open-Meteo へ）',async()=>{
  const old=(h)=>({as_of:{daily:h,hourly:h}});
  const both=(h)=>route2(ok(old(h)),async()=>res(404,undefined));
  // 同じ日の 4 時間前（今は 13:40）→ 使う。古さの時刻を添える
  let r=rig({route:both('2026-11-23T09:40:00+09:00'),clock:Date.parse('2026-11-23T13:40:00+09:00')});let got=await r.dock.town('東京');
  assert.equal(got&&got.stale,true);assert.equal(got.asOf,Date.parse('2026-11-23T09:40:00+09:00'));
  // 同じ日でも 6 時間を越える（7 時間前）→ 使わない
  r=rig({route:both('2026-11-23T06:40:00+09:00'),clock:Date.parse('2026-11-23T13:40:00+09:00')});got=await r.dock.town('東京');
  assert.equal(got,null,'7 時間前の予報では答えない');
  // 30 時間前 → 使わない
  r=rig({route:both('2026-11-21T21:40:00+09:00')});got=await r.dock.town('東京');assert.equal(got,null,'30 時間前の予報では答えない');
  // 前の日（2 時間前でも日付が変わった）→ 使わない
  r=rig({route:both('2026-11-23T01:30:00+09:00'),clock:Date.parse('2026-11-24T00:30:00+09:00')});got=await r.dock.town('東京');
  assert.equal(got,null,'日付をまたいだ予報では答えない');
  assert.equal(D.MAX_OLD_MS,6*3600e3);
});
test('時間切れでも json の読みでも止まらない：返事は来たが json() が返らない → 時間切れとして次へ',async()=>{
  const slowJson=async()=>({ok:true,status:200,json:()=>new Promise(()=>{})});
  const r=rig({route:route2(slowJson,ok())});assert.equal((await r.dock.town('東京')).via,'cloud');
});

// ---------------- 3：画面の流れ（index.html の天気の部分を取り出して動かす） ----------------
const FROM='  const WEATHER_KEEP=3*3600e3',TO='  // あいさつの天気の一言';
const part=(a,b)=>{const i=html.indexOf(a);assert.ok(i>=0,a);const j=html.indexOf(b,i);assert.ok(j>i,b);return html.slice(i,j)};
function screen({route,mac=MAC,cfg={url:CF,key:KEYVAL,enabled:true},flags={},noDock=false,omForecast=true,dataWeather,figPlace}={}){
  let now=NOW;const calls=[],figs=[],piyos=[],users=[];
  const st=mem({...(cfg?{'piyo-infobase':JSON.stringify(cfg)}:{}),...flags});
  const fetchFn=async(url,opt)=>{
    calls.push({url,opt});
    if(url.startsWith('https://api.open-meteo.com/')){
      if(!omForecast)return res(500,{});
      const lat=new URL(url).searchParams.get('latitude');
      return res(200,omBody(lat));
    }
    return route(url,opt,calls.length);
  };
  const c={PiyoExtras:X,PiyoDock:noDock?undefined:D,mac,localStorage:st,fetch:fetchFn,AbortController,clearTimeout,setTimeout,Math,
    data:{weather:dataWeather||D.normalize(body(),TODAY).map(({hours,...d})=>d)},weatherAt:null,
    todayStr:()=>TODAY,nextDay:s=>addDay(s),esc:s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])),
    Date:class extends Date{static now(){return now}},
    extrasCtx:()=>({now,today:TODAY,hour:4,events:[],basics:null,koyomi:null,weather:c.data.weather}),
    userMsg(t){users.push(t);return{remove(){}}},toBottom(){},
    piyoMsg:()=>{const ins=[];const m={ins,removed:false,said:[],el:{querySelector:s=>s==='.piyo-text'?{insertAdjacentHTML:(w,h)=>ins.push(h)}:(ins.length?{}:null)},say(t,done){m.said.push(t);done&&done()},remove(){m.removed=true}};piyos.push(m);return m}};
  c.globalThis=c;vm.createContext(c);
  const OM=html.match(/  const WEATHER='[^']+';[^\n]*\n  const WEATHER_HOURLY='[^']+';[^\n]*\n/)[0];
  vm.runInContext('const DATA_TTL=30*60*1000;'+OM+part(FROM,TO)+';this.placeAsk=placeAsk;this.placeDays=placeDays;this.weatherFig=weatherFig;this.cache=()=>placeWx;this.dockWx=dockWx;',c);
  return{c,calls,figs,piyos,users,st,advance:ms=>{now+=ms},
    dockCalls:()=>calls.filter(x=>!x.url.startsWith('https://api.open-meteo.com/')),omCalls:()=>calls.filter(x=>x.url.startsWith('https://api.open-meteo.com/')&&new URL(x.url).searchParams.get('daily'))};
}
// Open-Meteo の偽の返事（daily に sunrise など全部ある。名古屋以外は気温が少し違う）
function omBody(lat){
  const dates=[...Array(7)].map((_,i)=>addDay(TODAY,i)),time=[];for(const d of dates.slice(0,3))for(let h=0;h<24;h++)time.push(`${d}T${pad(h)}:00`);
  return{daily:{time:dates,weather_code:dates.map(()=>1),temperature_2m_max:dates.map((_,i)=>20+i),temperature_2m_min:dates.map((_,i)=>10+i),precipitation_probability_max:dates.map(()=>30),sunrise:dates.map(d=>d+'T06:30'),sunset:dates.map(d=>d+'T16:50'),uv_index_max:dates.map(()=>3),wind_speed_10m_max:dates.map(()=>4),precipitation_sum:dates.map(()=>0)},
    hourly:{time,precipitation_probability:time.map(()=>20),temperature_2m:time.map((_,i)=>10+(i%24)/2),weather_code:time.map(()=>1)}};
}
const TOKYO={label:'東京',lat:35.69,lon:139.69};
const dockOk=ok();
const nope=async()=>res(404,undefined);

test('画面：dock が通れば、答えは dock の予報。出典の行は dock の名前。Open-Meteo は呼ばない。町の名前で聞く',async()=>{
  const s=screen({route:route2(dockOk,nope)});
  const r=await s.c.placeAsk('東京の天気は？',TOKYO);
  assert.equal(r.local.kind,'weather');assert.equal(r.local.place,'東京');assert.match(r.local.text,/東京/);assert.match(r.local.text,/最高\*\*12℃\*\*|最高12℃|12℃/);
  assert.equal(r.local.srcHtml,'出典：天気 気象庁・tenki.jp（infobase）');
  assert.equal(s.omCalls().length,0);assert.equal(s.calls.length,1);assert.equal(s.calls[0].url,DIRECT_PREFIX+encodeURIComponent('東京'));
  assert.equal(r.local.figDays.length,7);assert.ok(r.local.figDays[0].hours.length>=2);
  assert.doesNotMatch(r.local.text,/undefined|null|NaN/);
  assert.equal(s.piyos[0].removed,true,'待ちの吹き出しは消える');
});
test('画面：出典の行の名前は HTML として安全に出す（sources は網から来る）',async()=>{
  const s=screen({route:route2(ok({sources:{daily:'<img src=x onerror=alert(1)>',hourly:'tenki.jp'}}),nope)});
  const r=await s.c.placeAsk('東京の天気は？',TOKYO);
  assert.ok(!r.local.srcHtml.includes('<img'));assert.ok(r.local.srcHtml.includes('&lt;img'));
});
test('画面：30 分は町ごとに覚える（同じ町は dock も Open-Meteo も呼ばない）。30 分たつと取り直す',async()=>{
  const s=screen({route:route2(dockOk,nope)});
  await s.c.placeAsk('東京の天気は？',TOKYO);await s.c.placeAsk('東京の明日の天気は？',TOKYO);assert.equal(s.calls.length,1);
  assert.equal(s.c.cache().get('東京').src,'dock');
  s.advance(31*60e3);await s.c.placeAsk('東京の天気は？',TOKYO);assert.equal(s.calls.length,2);
});
test('画面：直が失敗 → Cloudflare で答える。次の町は 60 秒のあいだ直を試さない（ふつうの時間の流れで）',async()=>{
  const s=screen({route:route2(async()=>{throw new TypeError('Load failed')},ok({sources:{daily:'気象庁',hourly:'気象庁'}}))});
  const a=await s.c.placeAsk('東京の天気は？',TOKYO);assert.equal(a.local.srcHtml,'出典：天気 気象庁（infobase）');
  await s.c.placeAsk('大阪の天気は？',{label:'大阪',lat:34.69,lon:135.5});
  const urls=s.dockCalls().map(x=>x.url);
  assert.equal(urls.filter(u=>u.startsWith(DIRECT_PREFIX)).length,1);assert.equal(urls.filter(u=>u.startsWith(CF)).length,2);
  assert.ok(urls[2].startsWith(CF)&&urls[2].endsWith(encodeURIComponent('大阪')),'2 つ目の町は Cloudflare から');
});
test('画面：直 401・Cloudflare 404 → Open-Meteo の今の道。出典の行は今のまま（srcHtml なし）。Open-Meteo の記録は src:open-meteo',async()=>{
  const s=screen({route:route2(async()=>res(401,{}),async()=>res(404,{error:'その町の天気はありません'}))});
  const r=await s.c.placeAsk('東京の天気は？',TOKYO);
  assert.equal(r.local.kind,'weather');assert.equal(r.local.srcHtml,undefined);assert.equal(s.omCalls().length,1);
  assert.equal(s.c.cache().get('東京').src,'open-meteo');assert.match(r.local.text,/最高\*\*20℃\*\*|20℃/);
  assert.deepEqual(s.dockCalls().map(x=>x.url.startsWith(DIRECT_PREFIX)?'direct':'cloud'),['direct','cloud']);
});
test('画面：CORS の失敗・形の違う返事でも Open-Meteo へ。dock の道が両方だめでも例外にならない',async()=>{
  for(const bad of [async()=>{throw new TypeError('Load failed')},async()=>res(200,{x:1})]){
    const s=screen({route:route2(bad,bad)});
    const r=await s.c.placeAsk('東京の天気は？',TOKYO);assert.equal(r.local.kind,'weather');assert.equal(s.omCalls().length,1);
  }
});
test('画面：古い dock の中身は、Open-Meteo が取れればそちらを使う。取れなければ「取った時刻」を添えて dock の中身で答える（覚えない）',async()=>{
  const old={stale:true,as_of:{daily:'2026-11-23T00:30:00+09:00',hourly:'2026-11-23T00:30:00+09:00'}};
  let s=screen({route:route2(ok(old),ok(old))});
  let r=await s.c.placeAsk('東京の天気は？',TOKYO);assert.equal(r.local.srcHtml,undefined);assert.equal(s.omCalls().length,1,'Open-Meteo を使う');assert.doesNotMatch(r.local.text,/取った予報/);
  s=screen({route:route2(ok(old),ok(old)),omForecast:false});
  r=await s.c.placeAsk('東京の天気は？',TOKYO);
  assert.equal(r.local.kind,'weather');assert.match(r.local.text,/（0時30分に取った予報だぴよ。新しい予報はいま取れなかったぴよ。）$/);
  assert.equal(r.local.srcHtml,'出典：天気 気象庁・tenki.jp（infobase）');assert.equal(s.c.cache().size,0,'古い中身は覚えない');
});
test('画面：dock と Open-Meteo の両方が取れなければ、今までの「取れなかった」の答え',async()=>{
  const s=screen({route:route2(nope,nope),omForecast:false});
  const r=await s.c.placeAsk('東京の天気は？',TOKYO);assert.match(r.local.text,/いま取れなかったぴよ/);assert.equal(r.local.mood,'sad');
});
test('画面：dock の中身では答えが作れない質問（日の出・風・紫外線）は、Open-Meteo で取り直して答える',async()=>{
  const s=screen({route:route2(dockOk,nope)});
  const r=await s.c.placeAsk('東京の日の出は？',TOKYO);
  assert.equal(r.local.kind,'weather');assert.match(r.local.text,/日の出は\*\*06:30\*\*/);assert.equal(r.local.srcHtml,undefined,'出典は Open-Meteo（今のまま）');
  assert.equal(s.omCalls().length,1);assert.equal(s.c.cache().get('東京').src,'open-meteo');
  const again=await s.c.placeAsk('東京の風は？',TOKYO);assert.match(again.local.text,/最大風速/);assert.equal(s.omCalls().length,1,'覚えた Open-Meteo の中身で答える');
});
test('画面：設定が切（piyo-dockwx=0）・部品が無い・鍵が無い → dock を呼ばず今までどおり Open-Meteo',async()=>{
  const route=async()=>{throw new Error('dock は呼ばない')};
  for(const o of [{flags:{'piyo-dockwx':'0'}},{noDock:true},{cfg:null}]){
    const s=screen({route,...o});const r=await s.c.placeAsk('東京の天気は？',TOKYO);
    assert.equal(r.local.kind,'weather');assert.equal(s.dockCalls().length,0,JSON.stringify(Object.keys(o)));assert.equal(s.omCalls().length,1);assert.equal(r.local.srcHtml,undefined);
  }
});
test('画面：piyo-dockwx が 1 や無し → 入り（既定）。Mac のつなぎ方が無くても Cloudflare で読む',async()=>{
  const s=screen({mac:null,flags:{'piyo-dockwx':'1'},route:route2(async()=>{throw new Error('直は呼ばない')},ok())});
  const r=await s.c.placeAsk('東京の天気は？',TOKYO);assert.equal(r.local.srcHtml,'出典：天気 気象庁・tenki.jp（infobase）');
  assert.equal(s.dockCalls().length,1);assert.ok(s.dockCalls()[0].url.startsWith(CF));
});
function figMsg(){const ins=[];return{ins,el:{querySelector:s=>s==='.piyo-text'?{insertAdjacentHTML:(w,h)=>ins.push(h)}:(ins.length?{}:null)}}}
const tick=()=>new Promise(r=>setTimeout(r,20));
test('名古屋の図：dock が取れたら今日・明日の 3 時間ごとの点を dock のものにする。週間の帯は今の予報のまま。取れなければ今のまま',async()=>{
  const s=screen({route:route2(dockOk,nope)});
  const m=figMsg();await s.c.weatherFig(m);await tick();
  assert.equal(m.ins.length,1);assert.ok(m.ins[0].includes('3時間ごと'));assert.doesNotMatch(m.ins[0],/undefined|null|NaN/);
  assert.equal(s.dockCalls().length,1);assert.ok(s.dockCalls()[0].url.endsWith(encodeURIComponent('名古屋')));
  await s.c.weatherFig(figMsg());await tick();assert.equal(s.dockCalls().length,1,'30 分は覚える');
  // 取れない：今の data.weather に 3 時間ごとの点が無ければ、週間だけの図
  const bad=screen({route:route2(async()=>{throw new TypeError('x')},nope)});
  const m2=figMsg();await bad.c.weatherFig(m2);await tick();assert.equal(m2.ins.length,1);assert.ok(!m2.ins[0].includes('3時間ごと'));
  // 設定が切：同期の流れ（待たずに出る）
  const off=screen({route:async()=>{throw new Error('呼ばない')},flags:{'piyo-dockwx':'0'}});
  const m3=figMsg();off.c.weatherFig(m3);assert.equal(m3.ins.length,1,'待たずにすぐ出る');assert.equal(off.dockCalls().length,0);
  // 町を渡すとき（ほかの町）は今のまま：同期で出て、dock は呼ばない
  const s2=screen({route:async()=>{throw new Error('呼ばない')}});
  const m4=figMsg();const days=D.normalize(body(),TODAY);s2.c.weatherFig(m4,days,'東京');assert.equal(m4.ins.length,1);assert.equal(s2.calls.length,0);
});
test('名古屋の図：dock の中身が古ければ使わない',async()=>{
  const old={stale:true,as_of:{daily:'2026-11-23T00:30:00+09:00',hourly:'2026-11-23T00:30:00+09:00'}};
  const s=screen({route:route2(ok(old),ok(old))});const m=figMsg();await s.c.weatherFig(m);await tick();
  assert.equal(m.ins.length,1);assert.ok(!m.ins[0].includes('3時間ごと'),'今の data.weather のまま（3 時間ごとの点なし）');
});
// ---------------- 今日の最高・最低が null の中身（作業書：今日は max/min/pop が null のことがある） ----------------
test('今日の min だけ null（11 時・hourly は 12 時から）：日の配列は作らない（誤った最低を答えない）→ town() は days なし・3 時間ごとの点だけ',async()=>{
  const b={hourly:hourly('2026-11-23',12,36),dailyOver:{0:{min:null}}};
  assert.equal(D.normalize(body(b),TODAY).some(d=>d.date===TODAY),false);
  const r=rig({route:route2(ok(b),ok(b))});const got=await r.dock.town('東京');
  assert.equal(got.days,null);assert.equal(got.stale,false);assert.deepEqual(Object.keys(got.hours).sort(),[TODAY,addDay(TODAY)]);
  assert.deepEqual(got.hours[TODAY].map(h=>h.h),[12,15,18,21],'今日の点は 12 時から');assert.equal(r.calls.length,2,'直も Cloudflare も聞く');
});
test('18 時・今日の max と min が null：同じ（days なし・hours あり）。hourly も無ければ null',async()=>{
  const b={hourly:hourly('2026-11-23',18,30),dailyOver:{0:{max:null,min:null,pop:null}}};
  const r=rig({route:route2(ok(b),ok(b))});const got=await r.dock.town('東京');assert.equal(got.days,null);assert.ok(got.hours[TODAY].length>=2);
  const none={hourly:[],dailyOver:{0:{max:null,min:null}}};
  const r2=rig({route:route2(ok(none),ok(none))});assert.equal(await r2.dock.town('東京'),null);
});
test('画面：今日の max/min が null の dock の中身 → 町の答えは Open-Meteo（誤った答えを作らない）。出典も Open-Meteo のまま',async()=>{
  const b={hourly:hourly('2026-11-23',12,36),dailyOver:{0:{min:null}}};
  const s=screen({route:route2(ok(b),ok(b))});const r=await s.c.placeAsk('東京の天気は？',TOKYO);
  assert.equal(r.local.kind,'weather');assert.equal(r.local.srcHtml,undefined);assert.equal(s.omCalls().length,1);assert.equal(s.c.cache().get('東京').src,'open-meteo');
  const e=screen({route:route2(ok(b),ok(b)),omForecast:false});const r2=await e.c.placeAsk('東京の天気は？',TOKYO);
  assert.match(r2.local.text,/いま取れなかったぴよ/,'dock の days なしの中身は、Open-Meteo が取れないときの代わりにもしない');
});
test('名古屋の図：今日の daily が欠けた dock の中身でも、3 時間ごとの点は使う。dock に無い時刻の点は今の点を残す',async()=>{
  const b={hourly:hourly('2026-11-23',12,36),dailyOver:{0:{min:null}}};
  const base=D.normalize(body(),TODAY).map(({hours,...d})=>d);
  base[0].hours=[{h:3,temp:1,word:'雪',rain:null},{h:6,temp:2,word:'雪',rain:null},{h:12,temp:99,word:'雪',rain:null}];
  const s=screen({route:route2(ok(b),ok(b)),dataWeather:base});
  const m=figMsg();await s.c.weatherFig(m);await tick();
  assert.equal(m.ins.length,1);const h=m.ins[0];
  assert.ok(h.includes('aria-label="3時 雪 1度"'),'dock に無い 3 時の点は今の点');assert.ok(h.includes('aria-label="6時 雪 2度"'));
  assert.ok(!h.includes('99度'),'12 時は dock の点に替わる');assert.match(h,/aria-label="12時 雨 \d+度/);assert.doesNotMatch(h,/undefined|null|NaN/);
  assert.deepEqual(plain(D.mergeHours([{h:6,temp:1},{h:3,temp:2}],[{h:6,temp:9},{h:9,temp:8}])),[{h:3,temp:2},{h:6,temp:9},{h:9,temp:8}]);
  assert.deepEqual(plain(D.mergeHours(undefined,null)),[]);
});
test('index.html：部品の読み込み・設定の行・版・合言葉を dock へ送らない',()=>{
  assert.match(html,/<script src="piyo-dock\.js\?v=1"><\/script>/);
  assert.ok(html.indexOf('piyo-dock.js')>html.indexOf('piyo-extras.js'));
  assert.match(html,/<label><input type="checkbox" id="set-dockwx" checked><span>天気を Mac の infobase から読む<small>/);
  assert.match(html,/localStorage\.getItem\('piyo-dockwx'\)!=='0'/);
  assert.match(html,/<meta name="piyo-ver" content="2026\.11\.23-1">/);assert.match(html,/const PN_VERSION='2026\.11\.23-1（[^）]+）'/);
  assert.ok(!html.includes('piyo-dock.js?v=0'));
  const dockSrc=read('docs/piyo-dock.js');assert.ok(!/token/.test(dockSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')),'合言葉（token）を部品は読まない');
  const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
  scripts.forEach((s,i)=>assert.doesNotThrow(()=>new vm.Script(s,{filename:'index.html#'+i})));
  assert.doesNotThrow(()=>new vm.Script(read('docs/piyo-dock.js'),{filename:'piyo-dock.js'}));
});
test('piyo-dock.js はブラウザでも動く（window に PiyoDock を置く）',()=>{
  const c={setTimeout,clearTimeout,AbortController,Date,URL,Promise,JSON,Math,Number,Object,Array,Map};c.globalThis=c;vm.createContext(c);
  vm.runInContext(read('docs/piyo-dock.js'),c);assert.equal(typeof c.PiyoDock.create,'function');assert.equal(typeof c.PiyoDock.normalize,'function');
});
test('Cloudflare の道も落ちたら 60 秒は試さない',async()=>{
  const D=require('../docs/piyo-dock.js');let t=1e12,calls=[];
  const store={'piyo-infobase':JSON.stringify({url:'https://ib.example',key:'k'})};
  const env={now:()=>t,today:()=>'2026-11-23',storage:{getItem:k=>store[k]??null},getMac:()=>null,
    fetch:async u=>{calls.push(u);throw new TypeError('Failed to fetch')},setTimeout,clearTimeout};
  const c=D.create(env);
  assert.equal(await c.town('東京'),null);assert.equal(calls.length,1);
  t+=59e3;assert.equal(await c.town('大阪'),null);assert.equal(calls.length,1,'59 秒後はまだ試さない');
  t+=1e3;await c.town('大阪');assert.equal(calls.length,2,'60 秒後に試し直す');
});
