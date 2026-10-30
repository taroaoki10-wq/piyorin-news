const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v)); // 別の VM で作った値を比べられる形に
const ctx={window:{},TextEncoder,TextDecoder};
vm.runInNewContext(read('docs/piyo-extras.js'),ctx);
const X=ctx.window.PiyoExtras;
const html=read('docs/index.html');
const tone={};vm.createContext(Object.assign(tone,{freshWeather:tone.freshWeather||(()=>null)}));
vm.runInContext(html.slice(html.indexOf('  function piyoTone('),html.indexOf('  // 返事の文を表示用にする'))+';this.piyoTone=piyoTone;',tone);

const basics={lines:[
  'ぴよりんは名古屋生まれのひよこ型のスイーツ。2011年発売。',
  '名前はひよこの鳴き声「ぴよぴよ」と「プリン」から。',
  '中から、名古屋コーチンの卵を使ったプリン、なめらかなババロア、スポンジクラムの3層。1つずつ手作りで、表情や色に個体差がある。',
  '値段（税込）: 定番ぴよりん 450円、いちごぴよりん・紅茶ぴよりん 各480円、ぴよりんサブレ 750円。',
  '店1 ぴよりんshop: JR名古屋駅 名古屋うまいもん通り広小路口（中央改札から徒歩1分）。9:00〜20:00、無休。ぴよりんの販売は 9:00・12:00・15:00・18:00。',
  '店2 ぴよりんshop アトリエ店: 春日井市松新町、JR勝川駅から徒歩約2分。13:00〜19:00、無休。ぴよりんの販売は 13:00。',
  '買い方: 店では予約不可で来た順。数量に限りがあり、すぐ売り切れることが多い。',
  'スマートぴよ約: 名古屋駅構内の無人受け取り（ネットで予約）。受け取りは平日だけ。',
  '持ち帰り: 持ち歩きは1時間以内が目安（6〜9月はもっと短く）。保冷剤（約1時間）は無料、保冷バッグを使うと約2時間。箱は水平に持つ。',
  '消費期限は当日中。全商品に卵・乳・小麦を含み、アレルギー対応の商品はない。',
]};
const events=[
  {id:'godzilla',title:'ぴよりんゴジラ販売',start:'2026-11-03',end:'2026-11-13',kind:'sale'},
  {id:'stamp',title:'ぴよりんゴジラ スタンプラリーキャンペーン',start:'2026-10-22',end:'2026-11-30',kind:'campaign'},
  {id:'halloween',title:'ハロウィンぴよりん販売',start:'2026-10-23',end:'2026-10-31',kind:'sale'},
  {id:'xmas',title:'ぴよりんクリスマスケーキ 予約受付開始',start:'2026-10-30',end:'2026-10-30',kind:'release'},
  {id:'tour',title:'ぴよりん新幹線ツアー',start:'2026-11-14',end:'2026-11-14',kind:'event',place:'のぞみ399号'},
];
const weather=['2026-10-28','2026-10-29','2026-10-30'].map((date,i)=>({date,word:['晴れ','くもり','雨'][i],max:20+i,min:10+i,rain:[10,40,80][i],sunrise:'06:05',sunset:'17:10',uv:4,wind:5,
  rainHours:[{from:9,to:12,rain:20},{from:12,to:15,rain:60},{from:15,to:18,rain:35}]}));
const koyomi={holidays_from:'2026-01-01',holidays_until:'2027-12-31',holidays:[{date:'2026-11-03',name:'文化の日'}],long_weekends:[{start:'2026-11-21',end:'2026-11-23',days:3}],
  sekki:[{date:'2026-10-23',name:'霜降'},{date:'2026-11-07',name:'立冬'}],moon:[{time:'2026-10-11T00:50',phase:'新月'},{time:'2026-11-24T23:10',phase:'満月'},{time:'2026-11-09T16:02',phase:'新月'}]};
const base={today:'2026-10-28',hour:12,now:Date.parse('2026-10-28T12:00:00+09:00'),events,basics,koyomi,weather,omikuji:{seed:'s1',drawn:false}};
const ask=(q,c={})=>X.localAnswer(q,{...base,...c});

test('天気は名古屋の予報だけをその場で答え、ほかの場所や予報でない聞き方は Claude に任せる',()=>{
  assert.match(ask('今日の名古屋の天気は？').text,/今日の名古屋は\*\*晴れ\*\*、最高20℃・最低10℃、雨の確率は10%/);
  assert.equal(ask('今日の天気は？').sources,'weather');
  assert.match(ask('明日の雨の確率は？').text,/明日の名古屋の雨の確率は\*\*40%\*\*.*12〜15時（60%）と15〜18時（35%）/);
  assert.match(ask('あさっての天気').text,/あさって.*雨.*傘を忘れずに/);
  assert.match(ask('日の入りは何時？').text,/17:10/);
  assert.match(ask('天気は？',{hour:18}).text,/^明日の名古屋/); // 17時を過ぎたら明日
  assert.equal(ask('東京の天気は？'),null);
  assert.equal(ask('雨の日でも買える？'),null);
  assert.match(ask('今日の天気',{weather:null}).text,/取れてない/);
  assert.match(ask('土曜の天気',{weather:weather.slice(0,1)}).text,/まだ分からない/);
});
test('暦（祝日・連休・節気・月）は収録範囲だけ答える',()=>{
  assert.match(ask('次の祝日は？').text,/11月3日（火）の文化の日\*\*で、あと6日/);
  assert.match(ask('次の連休は？').text,/11月21日（土）〜11月23日（月）\*\*の3連休/);
  assert.match(ask('今の二十四節気は？').text,/霜降.*立冬/);
  assert.match(ask('次の満月は？').text,/11月24日（火） 23時ごろ/);
  assert.equal(ask('次の祝日は？',{koyomi:null}),null);
  assert.equal(ask('お店の休みは？').kind==='koyomi',false);
});
test('予定は名前と「いつ」がそろったときだけ答え、札にする予定も返す',()=>{
  const a=ask('ゴジラはいつから？');
  assert.match(a.text,/スタンプラリー.*いま開催中/);assert.match(a.text,/ぴよりんゴジラ販売：11月3日（火）〜11月13日（金）（あと6日）/);
  assert.deepEqual(plain(a.refs.map(r=>r.id)),['stamp','godzilla']);
  assert.match(ask('新幹線ツアーはいつ？').text,/\*\*ぴよりん新幹線ツアー\*\*は\*\*11月14日（土）\*\*、のぞみ399号だぴよ。あと17日/);
  assert.equal(ask('ぴよりんゴジラについて'),null); // 概要は Claude
  assert.equal(ask('クリスマスケーキの予約はいつまで？'),null); // 1日だけの「受付開始」からは締め切りが分からない
  assert.equal(ask('ゴジラはどこで買える？'),null);
  assert.match(ask('いま買える限定ぴよりんは？').text,/ハロウィンぴよりん販売（10月31日（土）まで）[\s\S]*定番のぴよりんは毎日/);
  assert.match(ask('これからのイベントは？').text,/10月30日（金） ぴよりんクリスマスケーキ 予約受付開始（あと2日）/);
  assert.match(ask('来月の予定は？').text,/11月の予定/);
});
test('基本情報は書いてある形のときだけ答え、限定品や知らない商品は Claude に任せる',()=>{
  assert.match(ask('定番ぴよりんはいくら？').text,/\*\*定番ぴよりん\*\*は\*\*450円\*\*（税込）.*公式サイト/);
  assert.match(ask('紅茶ぴよりんの値段は？').text,/480円/);
  assert.equal(ask('ハロウィンぴよりんはいくら？'),null);
  assert.equal(ask('ゴジラぴよりんはいくら？'),null);
  assert.match(ask('ぴよりんってどこで買える？').text,/この2つのお店[\s\S]*ぴよりんshop：JR名古屋駅 名古屋うまいもん通り広小路口（9:00〜20:00）/);
  assert.match(ask('アトリエ店の営業時間は？').text,/アトリエ店：13:00〜19:00（ぴよりんの販売は13:00）\nお休みの日はないぴよ/);
  assert.match(ask('消費期限は？').text,/\*\*当日中\*\*/);
  assert.match(ask('持ち帰り方は？').text,/\*\*1時間以内\*\*.*約2時間.*水平/);
  assert.match(ask('ぴよりんは予約できる？').text,/来た順.*スマートぴよ約.*平日だけ/);
  assert.match(ask('名前の由来は？').text,/ぴよぴよ.*プリン/);
  assert.equal(ask('ぴよりんはなぜ人気？'),null);
  assert.equal(ask('ぴよりんの値段は？',{basics:{lines:['値段は店で確かめる。']}}),null);
});
test('おみくじは同じ日・同じ端末なら同じ結果で、引いた後はそう伝える',()=>{
  const a=ask('おみくじ'),b=ask('今日のおみくじ'),c=ask('おみくじ',{omikuji:{seed:'s1',drawn:true}});
  assert.equal(a.text,b.text);assert.equal(a.kind,'omikuji');
  assert.match(a.text,/^今日のぴよりんおみくじは……\*\*(大吉|中吉|小吉|吉|末吉)\*\*だぴよ！\n・ラッキーぴよりん：(定番|いちご|紅茶|ハロウィン)ぴよりん\n・ラッキータイム：(9|12|15|18):00\n・ラッキーカラー：/);
  assert.match(c.text,/^今日はもう引いたぴよ/);
  const days=new Set(Array.from({length:30},(_,i)=>X.omikuji({...base,today:'2026-11-'+String(i+1).padStart(2,'0')}).fortune));
  assert.ok(days.size>=3); // 日によって変わる
});
test('その場の答えは、ぴよの口調の仕上げをかけても変わらない',()=>{
  for(const q of ['今日の天気は？','明日の雨の確率は？','次の祝日は？','ゴジラはいつから？','いま買える限定ぴよりんは？','定番ぴよりんはいくら？','ぴよりんってどこで買える？','持ち帰り方は？','ぴよりんは予約できる？','おみくじ'])
    {const a=ask(q);assert.equal(tone.piyoTone(a.text),a.text,q)}
});
test('あいさつは時間帯で変わり、近い予定の「あと◯日」を一言だけ足す',()=>{
  assert.equal(X.greeting({...base,hour:7}).hello,'おはようぴよ！');
  assert.equal(X.greeting({...base,hour:21}).hello,'こんばんはぴよ！');
  assert.match(X.greeting({...base,hour:2}).hello,/夜ふかし/);
  assert.equal(X.greeting({...base,today:'2026-10-31'}).countdown.text,'**ハロウィンぴよりん販売**は今日までだぴよ！');
  assert.equal(X.greeting({...base,today:'2026-11-03'}).countdown.text,'今日から**ぴよりんゴジラ販売**だぴよ！');
  assert.equal(X.greeting({...base,today:'2026-10-29'}).countdown.text,'明日は**ぴよりんクリスマスケーキ 予約受付開始**の日だぴよ！');
  assert.equal(X.greeting({...base,today:'2026-11-05'}).countdown.text,'**ぴよりん新幹線ツアー**まで、あと9日だぴよ！');
  assert.equal(X.greeting({...base,events:[]}).countdown,null);
});
test('ぴよを押したときのひとことは、使い切るまで同じ話を続けない',()=>{
  const used=new Set(),seen=[],all=X.tidbits(base).length;
  for(let i=0;i<all;i++)seen.push(X.tidbit(base,used,()=>0.5).key);
  assert.equal(new Set(seen).size,all);
  assert.ok(X.tidbit(base,used,()=>0)); // 使い切ったら最初から
  for(const t of X.tidbits(base))assert.equal(tone.piyoTone(t.text),t.text,t.key);
});
test('返事の参照の印を外し、流して出すときは言い終わった文まで・印の手前までにする',()=>{
  assert.deepEqual(plain(X.refs('答えだぴよ。\n[[参照:m3, e2]]')),{text:'答えだぴよ。',ids:['m3','e2']});
  assert.deepEqual(plain(X.refs('印なしだぴよ。')),{text:'印なしだぴよ。',ids:[]});
  assert.equal(X.streamView('こんにちはぴよ。ゴジラは**11月3日'),'こんにちはぴよ。');
  assert.equal(X.streamView('答えだぴよ。\n[[参照:e1'),'答えだぴよ。');
  assert.equal(X.streamView('URL https://a.jp/?q=1 の途中'),'');
});
test('ストリームの返事を組み立てる（文字・道具の呼び出し・途中のエラー）',async()=>{
  const sse=chunks=>({body:{getReader(){let i=0;const enc=new TextEncoder();return{read:async()=>i<chunks.length?{value:enc.encode(chunks[i++]),done:false}:{value:undefined,done:true}}}}});
  const ev=o=>`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const seen=[];
  const msg=await X.readMessage(sse([ev({type:'message_start',message:{}})+ev({type:'content_block_start',index:0,content_block:{type:'text',text:''}}),
    ev({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'こんにち'}}).slice(0,30),ev({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'こんにち'}}).slice(30)+ev({type:'ping'}),
    ev({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'はぴよ。'}})+ev({type:'content_block_stop',index:0}),
    ev({type:'content_block_start',index:1,content_block:{type:'tool_use',id:'t',name:'need_more',input:{}}})+ev({type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"kind":"art'}}),
    ev({type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'icle","query":"値段"}'}})+ev({type:'content_block_stop',index:1})+ev({type:'message_delta',delta:{stop_reason:'tool_use'}})+ev({type:'message_stop'})]),t=>seen.push(t));
  assert.deepEqual(seen,['こんにち','こんにちはぴよ。']);
  assert.equal(msg.stop_reason,'tool_use');assert.equal(msg.content[0].text,'こんにちはぴよ。');
  assert.deepEqual(plain(msg.content[1].input),{kind:'article',query:'値段'});
  await assert.rejects(X.readMessage(sse([ev({type:'error',error:{type:'overloaded_error',message:'Overloaded'}})])),e=>e.status===529);
});
test('予定のカレンダーのファイル（.ics）は終日の予定で、1行75バイトまでに折り返す',()=>{
  const text=X.ics({id:'godzilla',title:'ぴよりんゴジラ販売,とても長い名前の予定を書いておくとどうなるかを確かめるための予定',start:'2026-11-03',end:'2026-11-13',place:'名古屋駅',url:'https://piyorin.com/news/p5633/'},Date.parse('2026-10-28T12:00:00Z'));
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n')&&text.endsWith('END:VCALENDAR\r\n'));
  assert.match(text,/DTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261114\r\n/);
  assert.match(text,/UID:godzilla@piyorin-news/);assert.match(text,/DTSTAMP:20261028T120000Z/);
  assert.match(text,/SUMMARY:ぴよりんゴジラ販売\\,/);
  for(const line of text.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75,line);
  assert.match(text.replace(/\r\n /g,''),/SUMMARY:ぴよりんゴジラ販売\\,とても長い名前の予定を書いておくとどうなるかを確かめるための予定\r\n/);
});
test('会話：その場で答えられる質問は、API キーが無くても Claude を呼ばずに答える',async()=>{
  const said=[],sent=[],linked=[],played=[];
  const c={PiyoExtras:X,data:{events,basics,koyomi,weather,news:[],greeting:null},apiKey:'',mac:null,routeMode:'mac-first',pendingQ:'',keyPrompts:0,openKey(){c.keyPrompts++},$:()=>({}),
    todayStr:()=>'2026-10-28',localStorage:{getItem:()=>null,setItem(){}},Math,OMIKUJI:'piyo-omikuji',refLinks:refs=>(refs||[]).map(r=>({id:r.id})),
    userMsg(){},piyoMsg:()=>({say(text,done){said.push(text);done?.()},choices(){},links(l){linked.push(l)}}),loop(){},idle(){},play(n){played.push(n)},sync(){},fmt:s=>s,piyoTone:tone.piyoTone,
    consumeSuggest(){},NEED_MORE:{},textOf:r=>r.content[0].text,callClaude:async b=>{sent.push(b);return{content:[{type:'text',text:'答えだぴよ。'}]}}};
  vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));
  vm.runInContext('let history=[];'+html.slice(html.indexOf('  let busy=false,pendingChip=null;'),html.indexOf('  const sync=()=>'))
    +html.slice(html.indexOf('  function omikujiSeed('),html.indexOf('  // ---- API キー'))+';this.ask=ask;this.history=()=>history;',c);
  await c.ask('ゴジラはいつから？');
  assert.equal(sent.length,0);assert.equal(c.keyPrompts,0);
  assert.match(said[0],/ぴよりんゴジラ販売/);assert.deepEqual(plain(linked[0].map(l=>l.id)),['stamp','godzilla']);
  assert.equal(c.history().length,2);
  await c.ask('ぴよりんゴジラについて'); // その場で答えられない質問は、今までどおりキーを聞く
  assert.equal(c.keyPrompts,1);assert.equal(sent.length,0);
});
