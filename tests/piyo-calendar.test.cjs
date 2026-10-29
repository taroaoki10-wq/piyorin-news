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
  const msgs=[],added=[];
  const c={PiyoExtras:X,data:{events:EVENTS,memo:{},news:[],basics:null,koyomi:null,weather:[]},mac:null,apiKey:'',routeMode:'mac-first',refMap:{e1:{type:'event',id:'x'},m1:{type:'news',id:'official-p5633'}},
    PiyoPage:{icsInfo:id=>id==='x'?{f:'x',time:'12:00',timed:true,alarms:['eve','morning','hour','none']}:{f:id,time:'',timed:false,alarms:['eve','morning','none']},
      addToCalendar:(id,alarm)=>{added.push([id,alarm]);return how},planned:()=>[]},
    $:()=>({}),todayStr:()=>'2026-10-29',extrasCtx:()=>({...CTX}),omikujiSeed:()=>'s',omikujiDrawn:()=>false,markOmikuji(){},
    fmt:s=>s,piyoTone:s=>s,play(){},loop(){},sync(){},userMsg(){},consumeSuggest:q=>q,badSuggest:()=>new Set(),
    piyoMsg:()=>{const m={said:[],list:null,say(t,done){this.said.push(t);done?.(m)},choices(list){this.list=list;return{remove(){},classList:{add(){}}}},links(){},fix(){}};msgs.push(m);return m}};
  vm.createContext(c);
  vm.runInContext('let history=[];'+part('  let busy=false,pendingChip=null;','  const sync=()=>')+';this.api={ask,finish,get busy(){return busy}};',c);
  return {c,msgs,added,last:()=>msgs.at(-1)};
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

test('ホーム画面のアプリから入れたときは、Safari からの戻り方も言う',async()=>{
  const h=setup('safari');
  await h.c.api.ask('クリスマスケーキの予約をカレンダーに入れて');
  h.last().list[2][1]();
  assert.equal(h.last().said[0],'Safari でカレンダーに入れる画面を開いたぴよ！「カレンダーに追加」を押せば、10月30日の11時に知らせるぴよ。左上の「◀」で戻ってこられるぴよ。');
  const h2=setup(false);
  await h2.c.api.ask('クリスマスケーキの予約をカレンダーに入れて');
  h2.last().list[2][1]();
  assert.equal(h2.last().said[0],'ごめんぴよ…カレンダーの画面を開けなかったぴよ。');
});

// ページの addToCalendar：ホーム画面のアプリ（navigator.standalone）は x-safari-https: で Safari に渡す（アプリの中ではファイルが白いページになる）
function page({standalone,href='https://taroaoki10-wq.github.io/piyorin-news/',ics={x:{f:'auto-x',time:'12:00',timed:true,alarms:['eve','morning','hour','none']}}}){
  const clicked=[],store={};
  const c={navigator:{standalone},location:{href},URL,state:{events:EVENTS,ics},todayStr:()=>'2026-10-29',window:{PiyoExtras:X},PiyoExtras:X,Blob,
    localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}},setTimeout(){},
    document:{body:{appendChild(){}},createElement:()=>({click(){clicked.push({href:this.href,target:this.target,download:this.download})},remove(){}})}};
  c.URL={createObjectURL:()=>'blob:x',revokeObjectURL(){}};
  c.URL=Object.assign(function(u,b){return new URL(u,b)},c.URL);
  vm.createContext(c);
  vm.runInContext(part('  const PLANNED=',"  document.addEventListener('click',e=>{const b=e.target.closest('[data-ics]')")+';this.add=addToCalendar;',c);
  return {c,clicked,planned:()=>JSON.parse(store['piyo-planned']||'[]')};
}

test('ホーム画面のアプリでは Safari に渡し、Safari のタブでは新しいタブで開く',()=>{
  const a=page({standalone:true});
  assert.equal(a.c.add('x','hour'),'safari');
  assert.equal(a.c.location.href,'x-safari-https://taroaoki10-wq.github.io/piyorin-news/data/ics/auto-x-hour.ics');
  assert.equal(a.clicked.length,0);
  assert.deepEqual(plain(a.planned().map(p=>[p.id,p.time,p.alarm])),[['x','12:00','hour']]);
  const b=page({standalone:undefined});
  assert.equal(b.c.add('x','morning'),true);
  assert.deepEqual(plain(b.clicked),[{href:'data/ics/auto-x-morning.ics',target:'_blank'}]);
  assert.equal(b.c.location.href,'https://taroaoki10-wq.github.io/piyorin-news/');
  // ファイルの無い予定は、ホーム画面のアプリでは開けないので false（Safari のタブでは前と同じくページの中で作る）
  assert.equal(page({standalone:true,ics:{}}).c.add('x','hour'),false);
  const d=page({standalone:false,ics:{}});
  assert.equal(d.c.add('x','hour'),true);
  assert.equal(d.clicked[0].href,'blob:x');
  // https でない所（手元の確かめ）では Safari に渡せない
  assert.equal(page({standalone:true,href:'http://localhost:18791/'}).c.add('x','hour'),false);
});
