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
  // 2026-11-22：「いま買える限定」は「今日買える」の答え（期間と、終わりまでの日数）。「定番は毎日」は、店の行に「無休」と「ぴよりんの販売」があるこの基本情報が根拠
  assert.match(ask('いま買える限定ぴよりんは？').text,/^今日買える限定は、\*\*ハロウィンぴよりん販売\*\*（10月23日〜31日・あと3日）だぴよ。定番のぴよりんは毎日あるぴよ。$/);
  assert.match(ask('今やってる限定は？').text,/ハロウィンぴよりん販売（10月31日（土）まで）/);
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

test('天気の図：7日分の天気・最高と最低・雨の確率を帯にする',()=>{
  const day=(i,word,max,min,rain)=>({date:'2026-11-'+(13+i),word,max,min,rain});
  const w=[day(0,'晴れ',20,9,0),day(1,'晴れときどきくもり',18,8,10),day(2,'雨',15,10,80),day(3,'くもり',16,7,30),day(4,'雪',5,-1,60),day(5,'雷雨',14,6,90),day(6,'霧',12,4,null),day(7,'晴れ',13,5,0)];
  const h=X.weatherFigure(w,'2026-11-13');
  assert.equal((h.match(/class="piyo-wx-day/g)||[]).length,7); // 7 日まで
  assert.match(h,/piyo-wx-day now"><span class="piyo-wx-d">今日<\/span>/);assert.match(h,/piyo-wx-day sat"><span class="piyo-wx-d">土/);assert.match(h,/piyo-wx-day sun"><span class="piyo-wx-d">日/);
  assert.match(h,/<span class="piyo-wx-hi">20°<\/span><span class="piyo-wx-bar"><i style="top:0%;bottom:47\.6%">/); // いちばん高い日は帯の上の端から
  assert.match(h,/<span class="piyo-wx-lo">-1°<\/span>/);assert.match(h,/piyo-wx-r wet">80%/);assert.match(h,/piyo-wx-r">–</);
  assert.match(h,/role="img" aria-label="名古屋の天気：今日 晴れ 最高20℃ 最低9℃ 雨0%、明日 /);
  assert.deepEqual(['晴れ','晴れときどきくもり','くもり','霧','小雨','にわか雨','冷たい雨','雪','にわか雪','雷雨','ひょうまじりの雷雨'].map(X.weatherKind),['sun','partly','cloud','cloud','rain','rain','rain','snow','snow','thunder','thunder']);
  assert.equal(X.weatherFigure(w,'2026-11-20'),''); // 残りが 1 日だけなら出さない
  assert.equal(X.weatherFigure(null,'2026-11-13'),'');assert.equal(X.weatherFigure(w.slice(3),'2026-11-13').includes('今日'),false);
  assert.equal(X.weatherAsk('今日の天気'),true);assert.equal(X.weatherAsk('雨の日でも買える？'),false);assert.equal(X.weatherAsk('ぴよりんの値段'),false);
});

// ---- 予定の答えをカレンダーと同じ並べ方にする／「今日買える」「次のおでかけ」（2026-11-22） ----
// tests/piyo-cal.test.cjs と同じ、2026-11-22 の本物の予定の写し。ゴジラ販売（〜11/13）は終わった予定。
const CAL_EVENTS=[
  {id:'oshi',title:'推し旅×ぴよりん',start:'2026-10-02',end:'2026-11-30',kind:'campaign',place:'東海道新幹線・ぴよりんvillage'},
  {id:'wolfy',title:'ウルフィ×ぴよりん ぬいぐるみ 店頭販売',start:'2026-10-19',end:'2026-12-31',kind:'sale',place:'ぴよりんvillage'},
  {id:'stamp',title:'ぴよりんゴジラ スタンプラリーキャンペーン',start:'2026-10-22',end:'2026-11-30',kind:'campaign'},
  {id:'sq',title:'Squeezibo クラウドファンディング',start:'2026-10-29',end:'2026-12-31',kind:'campaign',place:'JR東海MARKET'},
  {id:'onoda',title:'ぴよりんおでかけセット おのだサンパーク',start:'2026-11-01',end:'2026-11-03',kind:'sale',place:'おのだサンパーク'},
  {id:'cal',title:'ぴよりんカレンダー2027 販売開始',start:'2026-11-02',end:'2026-11-02',kind:'release',place:'各店舗'},
  {id:'godzilla',title:'ぴよりんゴジラ販売',start:'2026-11-03',end:'2026-11-13',kind:'sale'},
  {id:'imo',title:'三島甘藷ぴよりん販売',start:'2026-11-15',end:'2026-11-23',kind:'sale'},
  {id:'xmas',title:'ぴよりんクリスマス装飾',start:'2026-11-20',end:'2026-12-25',kind:'event'},
  {id:'mikan',title:'静岡みかんぴよりんおでかけセット販売（アスティ静岡）',start:'2026-11-26',end:'2026-11-27',kind:'sale',place:'アスティ静岡'},
  {id:'cake',title:'ぴよりんクリスマスケーキ 受取期間',start:'2026-12-19',end:'2026-12-25',kind:'sale'},
  {id:'dancyu',title:'dancyu祭2027 in 京都 ぴよりん出展',start:'2027-01-23',end:'2027-01-24',kind:'event',place:'京都市勧業館「みやこめっせ」'},
  {id:'dsale1',title:'dancyu祭2027 in 京都 ぴよりん おでかけセット販売（1月23日）',start:'2027-01-23',end:'2027-01-23',kind:'sale',place:'京都市勧業館「みやこめっせ」'},
  {id:'dsale2',title:'dancyu祭2027 in 京都 ぴよりん おでかけセット販売（1月24日）',start:'2027-01-24',end:'2027-01-24',kind:'sale',place:'京都市勧業館「みやこめっせ」'},
];
const REAL_EVENTS=JSON.parse(read('docs/data/events.json'));
const realBasics=JSON.parse(read('docs/data/piyo-basics.json'));
const ctxCal={window:{},TextEncoder,TextDecoder};
vm.runInNewContext(read('docs/piyo-cal.js'),ctxCal);
vm.runInNewContext(read('docs/piyo-extras.js'),ctxCal);
const XC=ctxCal.window.PiyoExtras; // カレンダーの部品（PiyoCal）がある画面と同じ
const askC=(q,today='2026-11-22',c={})=>XC.localAnswer(q,{...base,today,now:Date.parse(today+'T12:00:00+09:00'),events:CAL_EVENTS,basics:realBasics,...c});
const askN=(q,today='2026-11-22',c={})=>X.localAnswer(q,{...base,today,now:Date.parse(today+'T12:00:00+09:00'),events:CAL_EVENTS,basics:realBasics,...c}); // PiyoCal が無い
const at=(text,s)=>text.indexOf(s);
const ids2=a=>plain(a.refs.map(r=>r.id));

test('「今やってる」は、短い予定を先・長い企画をあとにして、入りきらない分は「ほか n 件」と添える',()=>{
  const a=askC('今やってる限定は？');
  assert.equal(a.kind,'event');
  assert.match(a.text,/いま販売中の限定はこれだぴよ！/);
  assert.ok(at(a.text,'三島甘藷ぴよりん販売')>0&&at(a.text,'三島甘藷ぴよりん販売')<at(a.text,'ウルフィ'),a.text);
  assert.doesNotMatch(a.text,/ゴジラ販売/);
  assert.equal(ids2(a)[0],'imo');
  const b=askC('いま開催中のイベントは？');
  assert.match(b.text,/・三島甘藷ぴよりん販売（11月23日（月）まで）/);
  const lines=b.text.split('\n').filter(l=>l.startsWith('・'));
  assert.equal(lines.length,5);
  assert.match(lines[0],/三島甘藷/);
  assert.match(b.text,/ほか1件あるぴよ。/);
  assert.doesNotMatch(b.text,/ゴジラ販売|おのだ/);
});
test('「これから」「今月」「次の限定」は、始まりの近い順で、開催中の長い企画が先頭を占めない',()=>{
  const a=askC('これからの予定は？');
  assert.match(a.text.split('\n')[1],/静岡みかんぴよりんおでかけセット販売/);
  assert.doesNotMatch(a.text,/推し旅|ゴジラ販売|三島/);
  const b=askC('次の限定は？');
  const l=b.text.split('\n').filter(x=>x.startsWith('・'));
  assert.match(l[0],/静岡みかん/);assert.ok(l.every(x=>!/出展/.test(x)),b.text); // 限定＝販売の予定だけ
  assert.equal(ids2(b)[0],'mikan');
  const m=askC('今月の予定は？');
  const ml=m.text.split('\n').filter(x=>x.startsWith('・'));
  assert.match(ml[0],/三島甘藷/);assert.match(ml[1],/静岡みかん/); // 推し旅（10/2〜）より先
  assert.doesNotMatch(m.text,/ゴジラ販売/);
  assert.match(askC('今月の予定は？','2026-11-22').text,/11月の予定はこれだぴよ！/);
});
test('「今日買える」は、今日が期間に入っている短い販売を、終わりまでの日数つきで答える',()=>{
  for(const q of ['今日買えるぴよりんは？','今日は何が買える？','いま買える限定']){
    const a=askC(q);
    assert.equal(a.kind,'event',q);
    assert.match(a.text,/今日買える限定は、\*\*三島甘藷ぴよりん販売\*\*（11月15日〜23日・あしたまで）だぴよ。定番のぴよりんは毎日あるぴよ。/,q);
    assert.doesNotMatch(a.text,/ゴジラ|ウルフィ/,q);
    assert.deepEqual(ids2(a),['imo'],q);
    assert.equal(tone.piyoTone(a.text),a.text,q);
  }
  assert.match(askC('今日買えるぴよりんは？','2026-11-26').text,/\*\*静岡みかんぴよりんおでかけセット販売（アスティ静岡）\*\*（11月26日〜27日・あしたまで）/);
  assert.match(askC('今日買えるぴよりんは？','2026-11-27').text,/・きょうまで/);
  assert.match(askC('今日買えるぴよりんは？','2026-11-20').text,/・あと3日/);
  const none=askC('今日買えるぴよりんは？','2026-11-24');
  assert.match(none.text,/^今日は限定は入ってないぴよ。次は\*\*静岡みかんぴよりんおでかけセット販売（アスティ静岡）\*\*（11月26日〜27日・あと2日）だぴよ。/);
  assert.deepEqual(ids2(none),['mikan']);
  assert.doesNotMatch(none.text,/毎日/); // 限定が無い日に「定番は毎日」とは言わない
  assert.equal(tone.piyoTone(none.text),none.text);
});
test('「定番は毎日ある」は、基本情報にその根拠の行があるときだけ書く',()=>{
  const weak={lines:['値段（税込）: 定番ぴよりん 450円。','店1 ぴよりんshop: JR名古屋駅。9:00〜20:00。']};
  const a=askC('今日買えるぴよりんは？','2026-11-22',{basics:weak});
  assert.match(a.text,/三島甘藷ぴよりん販売/);assert.doesNotMatch(a.text,/毎日/);
  assert.doesNotMatch(askC('今やってる限定は？','2026-11-22',{basics:weak}).text,/毎日/);
  assert.match(askC('今やってる限定は？').text,/定番のぴよりんは毎日売ってるぴよ。/);
});
test('「次のおでかけ」は、おでかけセットなど外へ出る販売を、これから近い順に 3 つまで期間と場所つきで答える',()=>{
  for(const q of ['次のおでかけは？','おでかけセットはいつ？','次はどこに来る？']){
    const a=askC(q);
    assert.equal(a.kind,'event',q);
    const l=a.text.split('\n').filter(x=>x.startsWith('・'));
    assert.equal(l.length,3,q);
    assert.match(l[0],/静岡みかんぴよりんおでかけセット販売.*11月26日〜27日、アスティ静岡/,q);
    assert.match(l[1],/1月23日.*京都市勧業館/,q);
    assert.deepEqual(ids2(a),['mikan','dsale1','dsale2'],q);
    assert.doesNotMatch(a.text,/おのだ|山陽|ゴジラ|ウルフィ/,q); // 終わった物・お店の中の販売は出ない
    assert.equal(tone.piyoTone(a.text),a.text,q);
  }
  assert.match(askC('次のおでかけは？','2027-02-01').text,/いまは予定に入ってないぴよ/);
  assert.deepEqual(plain(askC('次のおでかけは？','2027-02-01').refs||[]),[]);
  // 名前の入った質問は、前と同じ（その予定の答え）
  assert.match(askC('静岡みかんぴよりんおでかけセットはいつ？').text,/^\*\*静岡みかんぴよりんおでかけセット販売（アスティ静岡）\*\*は\*\*11月26日（木）〜11月27日（金）\*\*/);
});
test('値段・買い方・場所を聞く質問や、名前の入った質問は、前と同じく Claude に回す',()=>{
  assert.equal(askC('三島甘藷ぴよりんはいくら？'),null);
  assert.equal(askC('静岡みかんぴよりんはどこで買える？'),null);
  assert.equal(askC('ゴジラは今日買える？'),null);
  assert.equal(askC('おでかけセットの買い方は？'),null);
  assert.equal(askC('おでかけセットはいくら？',undefined,{events:REAL_EVENTS}),null); // 本物の予定では、おでかけは 6 件の題にだけあり、予定の名前に当たる
  const shop=askC('今日どこで買える？');
  assert.ok(!shop||!/今日買える限定/.test(shop.text));
});
test('PiyoCal が無い画面でも落ちず、今までの並べ方で答える',()=>{
  assert.equal(ctx.window.PiyoCal,undefined);
  for(const q of ['今やってる限定は？','いま開催中のイベントは？','これからの予定は？','次の限定は？','今月の予定は？','今日買えるぴよりんは？','次のおでかけは？']){
    const a=askN(q);assert.ok(a&&a.text&&a.kind==='event',q);assert.doesNotMatch(a.text,/ゴジラ販売/,q);
  }
  assert.match(askN('次のおでかけは？').text,/静岡みかん/);
  assert.match(askN('今日買えるぴよりんは？').text,/三島甘藷/);
});
test('本物の events.json（2026-11-22 の写し）で、おでかけの判定と答えが同じになる',()=>{
  const a=askC('次のおでかけは？','2026-11-22',{events:REAL_EVENTS});
  const l=a.text.split('\n').filter(x=>x.startsWith('・'));
  assert.equal(l.length,3);assert.match(l[0],/静岡みかん.*11月26日〜27日、アスティ静岡/);
  assert.ok(REAL_EVENTS.some(e=>e.id==='auto-officialp5657'));
  assert.match(askC('今日買えるぴよりんは？','2026-11-22',{events:REAL_EVENTS}).text,/三島甘藷ぴよりん販売\*\*（11月15日〜23日・あしたまで）/);
  assert.match(askC('今日買えるぴよりんは？','2026-11-24',{events:REAL_EVENTS}).text,/^今日は限定は入ってないぴよ。次は\*\*静岡みかん/);
  assert.match(askC('今やってる限定は？','2026-11-22',{events:REAL_EVENTS}).text.split('\n')[1],/三島甘藷/);
});
test('今月・今週・明日・おでかけセットとは、のような広い言い方は、今日の答えにしない',()=>{
  const q1=askC('今月買える限定は？'); // 今までの「今月の予定」の答え
  assert.ok(!q1||!/今日買える限定/.test(q1.text));
  assert.equal(askC('今週は何が買える？'),null);
  assert.equal(askC('明日買える限定は？'),null);
  assert.equal(askC('おでかけセットって何？'),null);
  assert.equal(askC('おでかけセットとは'),null);
  assert.equal(askC('おでかけセットを買えるのはいつまで？'),null);
});
test('PiyoCal の設定（localStorage の piyo-cal）で、長い・短いの境目が変わる',()=>{
  const set=v=>{ctxCal.localStorage={getItem:k=>k==='piyo-cal'?JSON.stringify(v):null}};
  try{
    set({longDays:5}); // 9 日の三島甘藷が「長い」側へ回る→今日の限定には入らない
    assert.match(askC('今日買えるぴよりんは？').text,/^今日は限定は入ってないぴよ。次は\*\*静岡みかん/);
    set({group:false}); // まとめない：ぬいぐるみの販売も短い扱い
    assert.match(askC('今日買えるぴよりんは？').text,/三島甘藷ぴよりん販売\*\*（11月15日〜23日・あしたまで）、\*\*ウルフィ×ぴよりん ぬいぐるみ 店頭販売\*\*/);
    set({longDays:20}); // 36 日の装飾・推し旅(60日)は長い
    assert.match(askC('いま開催中のイベントは？').text.split('\n')[1],/三島甘藷/);
  }finally{delete ctxCal.localStorage}
  assert.match(askC('今日買えるぴよりんは？').text,/^今日買える限定は、\*\*三島甘藷ぴよりん販売\*\*（11月15日〜23日・あしたまで）だぴよ。/); // 設定が無ければ既定
});
test('会話：「今日買える」「次のおでかけ」も、API キーが無くても Claude を呼ばずその場で答え、予定の札を返す',async()=>{
  const said=[],sent=[],linked=[];
  const c={PiyoExtras:XC,data:{events:CAL_EVENTS,basics:realBasics,koyomi,weather,news:[],greeting:null},apiKey:'',mac:null,routeMode:'mac-first',pendingQ:'',keyPrompts:0,openKey(){c.keyPrompts++},$:()=>({}),
    todayStr:()=>'2026-11-22',localStorage:{getItem:()=>null,setItem(){}},Math,OMIKUJI:'piyo-omikuji',refLinks:refs=>(refs||[]).map(r=>({id:r.id})),
    userMsg(){},piyoMsg:()=>({say(text,done){said.push(text);done?.()},choices(){},links(l){linked.push(l)}}),loop(){},idle(){},play(){},sync(){},fmt:s=>s,piyoTone:tone.piyoTone,
    consumeSuggest(){},NEED_MORE:{},textOf:r=>r.content[0].text,callClaude:async b=>{sent.push(b);return{content:[{type:'text',text:'答えだぴよ。'}]}}};
  vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));
  vm.runInContext('let history=[];'+html.slice(html.indexOf('  let busy=false,pendingChip=null;'),html.indexOf('  const sync=()=>'))
    +html.slice(html.indexOf('  function omikujiSeed('),html.indexOf('  // ---- API キー'))+';this.ask=ask;',c);
  await c.ask('今日買えるぴよりんは？');
  await c.ask('次のおでかけは？');
  assert.equal(sent.length,0);assert.equal(c.keyPrompts,0);
  assert.match(said[0],/今日買える限定は、\*\*三島甘藷ぴよりん販売\*\*（11月15日〜23日・あしたまで）/);
  assert.match(said[1],/次のおでかけは、これだぴよ！[\s\S]*静岡みかん/);
  assert.deepEqual(plain(linked[0].map(l=>l.id)),['imo']);assert.deepEqual(plain(linked[1].map(l=>l.id)),['mikan','dsale1','dsale2']);
});
