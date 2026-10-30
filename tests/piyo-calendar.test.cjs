// カレンダーと知らせ（2026-10-29）：「〇〇をカレンダーに入れて」・いつ知らせるかを聞く・入れた予定のあいさつ
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v)); // 別の VM で作った値を比べられる形に
const ctx0={window:{},TextEncoder,TextDecoder};
vm.runInNewContext(read('docs/piyo-extras.js'),ctx0);
const X=ctx0.window.PiyoExtras;
const html=read('docs/index.html');
const part=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));

const EVENTS=[
  {id:'g',title:'ぴよりんゴジラ販売',start:'2026-11-03',end:'2026-11-13',src:'official-p5633'},
  {id:'x',title:'ぴよりんクリスマスケーキ 予約受付開始',start:'2026-10-30',end:'2026-10-30',src:'n-xmas'},
  {id:'old',title:'ハロウィン限定グッズ発売',start:'2026-09-01',end:'2026-09-01'},
  {id:'cal',title:'ぴよりんカレンダー2027 先行販売',start:'2026-10-29',end:'2026-10-29'},
];
const CTX={today:'2026-10-29',hour:12,events:EVENTS,basics:null,koyomi:null,weather:[]};

test('「〇〇をカレンダーに入れて」「〇〇を知らせて」はその場で答える（予定の名前が無ければ、さっきの予定を使う）',()=>{
  const ids=q=>{const a=X.localAnswer(q,CTX);return a&&a.kind==='calendar'?a.events.map(e=>e.id):null};
  assert.deepEqual(plain(ids('ぴよりんゴジラをカレンダーに入れて')),['g']);
  assert.deepEqual(plain(ids('クリスマスケーキの予約を知らせて')),['x']);
  assert.deepEqual(plain(ids('クリスマスケーキをカレンダーに入れて')),['x']); // 「カレンダー」が「ぴよりんカレンダー2027」に当たらない
  assert.deepEqual(plain(ids('カレンダーにクリスマスケーキを入れて')),['x']);
  assert.deepEqual(plain(ids('ぴよりんカレンダーをカレンダーに入れて')),['cal']);
  assert.deepEqual(plain(ids('カレンダーに入れて')),[]); // 名前が無い → ページがさっき話した予定を使う
  assert.deepEqual(plain(ids('リマインダーに登録して')),[]);
  assert.equal(ids('天気を知らせて'),null); // 予定の名前が無い「知らせて」は、ふつうの質問
  assert.equal(ids('カレンダーの見方は？'),null);
  assert.deepEqual(plain(ids('ハロウィン限定グッズをカレンダーに入れて')),[]); // 終わった予定は入れない
});

test('カレンダーに入れた予定を、前の日と当日のあいさつで話す',()=>{
  const planned=[{id:'x',title:'ぴよりんクリスマスケーキ 予約受付開始',start:'2026-10-30',time:'12:00'},{id:'g',title:'ぴよりんゴジラ販売',start:'2026-11-03',time:''}];
  assert.deepEqual(plain(X.plannedLine(planned,'2026-10-29')),{id:'x',text:'明日は**ぴよりんクリスマスケーキ 予約受付開始**だぴよ（12時から）！カレンダーに入れてたぴよね。'});
  assert.deepEqual(plain(X.plannedLine(planned,'2026-10-30')),{id:'x',text:'今日は**ぴよりんクリスマスケーキ 予約受付開始**の日だぴよ（12時から）！カレンダーに入れてたぴよね。'});
  assert.equal(X.plannedLine(planned,'2026-11-03').text,'今日は**ぴよりんゴジラ販売**の日だぴよ！カレンダーに入れてたぴよね。');
  assert.equal(X.plannedLine(planned,'2026-10-31'),null);
  assert.equal(X.plannedLine([],'2026-10-29'),null);
});

function setup(how=true){
  const msgs=[],added=[],timers=[],listeners=[];
  const doc={visibilityState:'visible',addEventListener:(t,f)=>listeners.push(f),removeEventListener:(t,f)=>{const i=listeners.indexOf(f);if(i>=0)listeners.splice(i,1)}};
  const c={setTimeout:(f,ms)=>{timers.push(f);return timers.length},clearTimeout:id=>{timers[id-1]=null},document:doc,PiyoExtras:X,data:{events:EVENTS,memo:{},news:[],basics:null,koyomi:null,weather:[]},mac:null,apiKey:'',routeMode:'mac-first',refMap:{e1:{type:'event',id:'x'},m1:{type:'news',id:'official-p5633'}},
    PiyoPage:{icsInfo:id=>id==='x'?{f:'x',time:'12:00',timed:true,alarms:['eve','morning','hour','none']}:{f:id,time:'',timed:false,alarms:['eve','morning','none']},
      addToCalendar:(id,alarm)=>{added.push([id,alarm]);return how},planned:()=>[]},
    $:()=>({}),todayStr:()=>'2026-10-29',extrasCtx:()=>({...CTX}),omikujiSeed:()=>'s',omikujiDrawn:()=>false,markOmikuji(){},
    fmt:s=>s,piyoTone:s=>s,play(){},loop(){},sync(){},userMsg(){},consumeSuggest:q=>q,badSuggest:()=>new Set(),
    piyoMsg:()=>{const m={said:[],list:null,say(t,done){this.said.push(t);done?.(m)},choices(list){this.list=list;return{remove(){},classList:{add(){}}}},links(){},fix(){}};msgs.push(m);return m}};
  vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));
  vm.runInContext('let history=[];'+part('  let busy=false,pendingChip=null;','  const sync=()=>')+';this.api={ask,finish,get busy(){return busy}};',c);
  const turn=v=>{doc.visibilityState=v;[...listeners].forEach(f=>f())};
  return {c,msgs,added,last:()=>msgs.at(-1),turn,timers,listeners};
}

test('ぴよに頼むと、いつ知らせるかを聞いて、選んだ知らせ方でカレンダーに入れる',async()=>{
  const h=setup();
  await h.c.api.ask('クリスマスケーキの予約をカレンダーに入れて');
  assert.equal(h.c.api.busy,false);
  assert.equal(h.last().said[0],'**ぴよりんクリスマスケーキ 予約受付開始**をカレンダーに入れるぴよ！いつ知らせるぴよ？');
  assert.deepEqual(plain(h.last().list.map(([label])=>label)),['前の日の夜（20時）','当日の朝（9時）','始まる1時間前（11時）','知らせなくていい']);
  h.last().list[2][1]();
  assert.deepEqual(plain(h.added),[['x','hour']]);
  assert.equal(h.last().said[0],'カレンダーに入れる画面を開いたぴよ！「カレンダーに追加」を押せば、10月30日の11時に知らせるぴよ。');
  await h.c.api.ask('ゴジラをカレンダーに入れて');
  h.last().list[0][1]();
  assert.equal(h.last().said[0],'カレンダーに入れる画面を開いたぴよ！「カレンダーに追加」を押せば、11月2日の夜20時に知らせるぴよ。');
});

test('答えに出たこれからの予定には「カレンダーに入れる」を出し、名前の無い「カレンダーに入れて」はその予定を使う',async()=>{
  const h=setup();
  const answer=h.c.piyoMsg();
  h.c.api.finish(answer,'クリスマスケーキの予約はいつ？','10月30日12時からだぴよ。\n[[参照:e1]]');
  assert.deepEqual(plain(answer.list.map(([label])=>label)),['カレンダーに入れる']);
  await h.c.api.ask('カレンダーに入れて');
  assert.match(h.last().said[0],/ぴよりんクリスマスケーキ 予約受付開始/);
  // 記事の答え（メモ）から、その記事の予定を見つける
  const h2=setup(),a2=h2.c.piyoMsg();
  h2.c.api.finish(a2,'ゴジラについて','ぴよりんゴジラは11月3日からだぴよ。\n[[参照:m1]]');
  assert.ok(a2.list);
  a2.list[0][1]();
  assert.match(h2.last().said[0],/ぴよりんゴジラ販売/);
  // 予定の名前も、さっきの予定も無いとき
  const h3=setup();
  await h3.c.api.ask('カレンダーに入れて');
  assert.match(h3.last().said[0],/分からなかったぴよ/);
});

test('ホーム画面のアプリから入れたときは、カレンダーの画面から戻ってきてから話す',async()=>{
  const h=setup('window');
  await h.c.api.ask('クリスマスケーキの予約をカレンダーに入れて');
  const n=h.msgs.length;
  h.last().list[2][1]();
  assert.equal(h.msgs.length,n); // 開いている間は話さない
  h.turn('hidden');h.turn('visible');
  assert.equal(h.last().said[0],'おかえりぴよ！「カレンダーに追加」を押していれば、10月30日の11時に知らせるぴよ。');
  assert.equal(h.listeners.length,0);
  // 画面が開かなかった（隠れなかった）ときは、少し待って話す
  const h2=setup('window');
  await h2.c.api.ask('クリスマスケーキの予約をカレンダーに入れて');
  h2.last().list[3][1]();
  h2.timers.filter(Boolean).at(-1)();
  assert.equal(h2.last().said[0],'「カレンダーに追加」を押していれば、入ったぴよ。');
  const h3=setup(false);
  await h3.c.api.ask('クリスマスケーキの予約をカレンダーに入れて');
  h3.last().list[2][1]();
  assert.equal(h3.last().said[0],'ごめんぴよ…カレンダーの画面を開けなかったぴよ。');
});

// ページの addToCalendar：ホーム画面のアプリ（navigator.standalone）は cal.html をアプリの中に開く（アプリの中で .ics を直接開くと白いページになる）
function page({standalone,href='https://taroaoki10-wq.github.io/piyorin-news/',ics={x:{f:'auto-x',time:'12:00',timed:true,alarms:['eve','morning','hour','none']}}}){
  const clicked=[],store={};
  const c={navigator:{standalone},location:{href},URLSearchParams,state:{events:EVENTS,ics},todayStr:()=>'2026-10-29',window:{PiyoExtras:X},PiyoExtras:X,Blob,
    localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}},setTimeout(){},
    document:{body:{appendChild(){}},createElement:()=>({click(){clicked.push({href:this.href,target:this.target,download:this.download})},remove(){}})}};
  c.URL={createObjectURL:()=>'blob:x',revokeObjectURL(){}};
  c.URL=Object.assign(function(u,b){return new URL(u,b)},c.URL);
  vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));
  vm.runInContext(part('  const PLANNED=',"  document.addEventListener('click',e=>{const b=e.target.closest('[data-ics]')")+';this.add=addToCalendar;',c);
  return {c,clicked,planned:()=>JSON.parse(store['piyo-planned']||'[]')};
}

test('ホーム画面のアプリでは cal.html を開き、Safari のタブでは .ics を新しいタブで開く',()=>{
  const a=page({standalone:true});
  assert.equal(a.c.add('x','hour'),'window');
  assert.equal(a.clicked.length,1);
  assert.equal(a.clicked[0].target,'_blank');
  const u=new URL(a.clicked[0].href,'https://example.com/');
  assert.equal(u.pathname,'/cal.html');
  assert.deepEqual(Object.fromEntries(u.searchParams),{f:'auto-x-hour.ics',t:'ぴよりんクリスマスケーキ 予約受付開始',s:'2026-10-30',e:'2026-10-30',h:'12:00'});
  assert.deepEqual(plain(a.planned().map(p=>[p.id,p.time,p.alarm])),[['x','12:00','hour']]);
  const b=page({standalone:undefined});
  assert.equal(b.c.add('x','morning'),true);
  assert.deepEqual(plain(b.clicked),[{href:'data/ics/auto-x-morning.ics',target:'_blank'}]);
  // ファイルの無い予定は、ホーム画面のアプリでは開けないので false（Safari のタブでは前と同じくページの中で作る）
  assert.equal(page({standalone:true,ics:{}}).c.add('x','hour'),false);
  const d=page({standalone:false,ics:{}});
  assert.equal(d.c.add('x','hour'),true);
  assert.equal(d.clicked[0].href,'blob:x');
});

// cal.html（カレンダーに入れるだけの画面）：data/ics/ の中のファイルだけ開く
test('cal.html は予定の中身を読み、ほかの場所のファイルは開かない',()=>{
  const cal=read('docs/cal.html'),code=cal.slice(cal.indexOf('window.PiyoCal='),cal.indexOf('(function(){\n  const $='));
  const c={window:{},URLSearchParams};vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));vm.runInContext(code,c);
  const r=q=>{const v=c.window.PiyoCal.read(q);return v&&plain(v)};
  assert.deepEqual(r('?f=auto-x-hour.ics&t=クリスマスケーキ&s=2026-10-30&e=2026-10-30&h=12:00'),
    {file:'data/ics/auto-x-hour.ics',title:'クリスマスケーキ',when:'10月30日（金） 12:00から',alarm:'始まる1時間前に知らせる'});
  assert.equal(r('?f=g-morning.ics&t=ゴジラ&s=2026-11-03&e=2026-11-13&h=10:00').when,'11月3日（火） 〜 11月13日（金）'); // 何日も続く予定に時刻は出さない
  assert.equal(r('?f=g-eve.ics&s=2026-11-03').alarm,'前の日の夜20時に知らせる');
  assert.equal(r('?f=g-eve.ics&s=2026-11-03').title,'ぴよりんの予定');
  assert.equal(r('?f=../x-hour.ics&s=2026-10-30'),null);
  assert.equal(r('?f=https://evil.example/x-hour.ics&s=2026-10-30'),null);
  assert.equal(r('?f=x-soon.ics&s=2026-10-30'),null);
  assert.equal(r('?f=x-hour.ics&s=10/30'),null);
  assert.equal(r(''),null);
});

// cal.html のボタン：先にファイルを読み、押したらその中身を開く（通信が遅くても、閉じる前にカレンダーの画面が出る）
async function calPage(ok){
  const cal=read('docs/cal.html'),code=cal.slice(cal.indexOf('window.PiyoCal='),cal.lastIndexOf('</script>'));
  const els={},timers=[],el=id=>els[id]||(els[id]={id,hidden:true,textContent:'',href:'',classList:{s:new Set(),add(c){this.s.add(c)},remove(c){this.s.delete(c)}},firstChild:{},on:{},addEventListener(t,f){this.on[t]=f}});
  let resolve;const loaded=new Promise(r=>{resolve=r});
  const c={URLSearchParams,location:{search:'?f=auto-x-hour.ics&t=予定&s=2026-10-30&e=2026-10-30&h=12:00'},
    document:{getElementById:el},setTimeout:(f,ms)=>timers.push([f,ms]),Blob:class{constructor(p,o){this.p=p;this.o=o}},
    URL:{createObjectURL:b=>'blob:'+b.o.type},
    fetch:u=>{c.fetched=u;const p=ok?Promise.resolve({ok:true,text:()=>Promise.resolve('BEGIN:VCALENDAR')}):Promise.reject(new Error('net'));p.finally(()=>setImmediate(resolve)).catch(()=>{});return p}};
  c.window=c;c.close=()=>{c.closed=true}; // ブラウザでは window が全体の入れ物
  vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));vm.runInContext(code,c);
  const click=()=>{const e={prevented:false,preventDefault(){this.prevented=true}};els.go.on.click(e);return e};
  return {c,els,timers,click,loaded};
}
test('cal.html は読み終わるまで押せず、読んだら中身を開き、少しして閉じる',async()=>{
  const a=await calPage(true);
  assert.equal(a.c.fetched,'data/ics/auto-x-hour.ics');
  assert.equal(a.els.go.textContent,'準備しているぴよ…');
  assert.equal(a.click().prevented,true); // まだ読んでいない
  assert.equal(a.timers.length,0);
  await a.loaded;
  assert.equal(a.els.go.href,'blob:text/calendar');
  assert.equal(a.els.go.textContent,'カレンダーに追加する');
  assert.equal(a.click().prevented,false);
  assert.equal(a.timers.at(-1)[1],1500);
  a.timers.at(-1)[0]();
  assert.equal(a.c.closed,true);
  // 読めなかったときは、サイトのファイルを直接開き、閉じるのを遅らせる
  const b=await calPage(false);await b.loaded;
  assert.equal(b.els.go.href,'data/ics/auto-x-hour.ics');
  b.click();
  assert.equal(b.timers.at(-1)[1],4000);
});
