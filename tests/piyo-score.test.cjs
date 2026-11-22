// 採点の試験（2026-11-22）：決まった 30 問を、決まった材料で localAnswer に通し、1 問ずつ
//  「答えに入るべき言葉」「入ってはいけない言葉」または「その場では答えない（null ＝ Claude へ回す）」を確かめる。
// 材料：今日＝2026-11-22（日）12 時・予定は tests/piyo-cal.test.cjs の EVENTS と同じ（2026-11-22 の本物の予定の写し）・基本情報と天気と暦と購入記録の見本。
// 画面と同じく、カレンダーの部品（piyo-cal.js）も読み込む。index.html は読まない。
// 期待は、いまの正しい動きを本物で出して確かめてから書いた（答えを変える直しをしたら、ここが落ちる）。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ctx={window:{},TextEncoder,TextDecoder};
vm.runInNewContext(read('docs/piyo-cal.js'),ctx);
vm.runInNewContext(read('docs/piyo-extras.js'),ctx);
const X=ctx.window.PiyoExtras;

const EVENTS=[
  {id:'oshi',title:'推し旅×ぴよりん',start:'2026-10-02',end:'2026-11-30',kind:'campaign'},
  {id:'wolfy',title:'ウルフィ×ぴよりん ぬいぐるみ 店頭販売',start:'2026-10-19',end:'2026-12-31',kind:'sale'},
  {id:'stamp',title:'ぴよりんゴジラ スタンプラリーキャンペーン',start:'2026-10-22',end:'2026-11-30',kind:'campaign'},
  {id:'sq',title:'Squeezibo クラウドファンディング',start:'2026-10-29',end:'2026-12-31',kind:'campaign'},
  {id:'onoda',title:'ぴよりんおでかけセット おのだサンパーク',start:'2026-11-01',end:'2026-11-03',kind:'sale'},
  {id:'cal',title:'ぴよりんカレンダー2027 販売開始',start:'2026-11-02',end:'2026-11-02',kind:'release'},
  {id:'godzilla',title:'ぴよりんゴジラ販売',start:'2026-11-03',end:'2026-11-13',kind:'sale'},
  {id:'imo',title:'三島甘藷ぴよりん販売',start:'2026-11-15',end:'2026-11-23',kind:'sale'},
  {id:'xmas',title:'ぴよりんクリスマス装飾',start:'2026-11-20',end:'2026-12-25',kind:'event'},
  {id:'mikan',title:'静岡みかんぴよりんおでかけセット販売（アスティ静岡）',start:'2026-11-26',end:'2026-11-27',kind:'sale'},
  {id:'cake',title:'ぴよりんクリスマスケーキ 受取期間',start:'2026-12-19',end:'2026-12-25',kind:'sale'},
  {id:'dancyu',title:'dancyu祭2027 in 京都 ぴよりん出展',start:'2027-01-23',end:'2027-01-24',kind:'event'},
];
const basics={lines:[
  'ぴよりんは名古屋生まれのひよこ型のスイーツ。2011年発売。',
  '名前はひよこの鳴き声「ぴよぴよ」と「プリン」から。',
  '値段（税込）: 定番ぴよりん 450円、いちごぴよりん・紅茶ぴよりん 各480円、ぴよりんサブレ 750円。',
  '店1 ぴよりんshop: JR名古屋駅 名古屋うまいもん通り広小路口（中央改札から徒歩1分）。9:00〜20:00、無休。ぴよりんの販売は 9:00・12:00・15:00・18:00。',
  '店2 ぴよりんshop アトリエ店: 春日井市松新町、JR勝川駅から徒歩約2分。13:00〜19:00、無休。ぴよりんの販売は 13:00。',
  '買い方: 店では予約不可で来た順。数量に限りがあり、すぐ売り切れることが多い。',
  'スマートぴよ約: 名古屋駅構内の無人受け取り（ネットで予約）。受け取りは平日だけ。',
  '消費期限は当日中。全商品に卵・乳・小麦を含み、アレルギー対応の商品はない。',
]};
const weather=[0,1,2].map(i=>({date:'2026-11-'+(22+i),word:['晴れ','雨','くもり'][i],max:[17,14,15][i],min:[8,9,7][i],rain:[10,80,30][i],
  rainHours:[{from:9,to:12,rain:20},{from:12,to:15,rain:60}]}));
const koyomi={holidays_from:'2026-01-01',holidays_until:'2027-12-31',holidays:[{date:'2026-11-23',name:'勤労感謝の日'},{date:'2027-01-01',name:'元日'}],
  long_weekends:[{start:'2026-11-21',end:'2026-11-23',days:3}],sekki:[{date:'2026-11-22',name:'小雪'},{date:'2026-12-07',name:'大雪'}],
  moon:[{time:'2026-11-09T14:02',phase:'新月'},{time:'2026-11-24T22:53',phase:'満月'},{time:'2026-12-09T08:51',phase:'新月'}]};
const buy={records:[
  {date:'2026-11-20',time:'12:10',shop:'ぴよりんshop（名古屋駅）',crowd:3,wait:20,items:[{name:'定番ぴよりん',cat:'piyorin',qty:2,price:450},{name:'いちごぴよりん',cat:'piyorin',qty:1,price:480}]},
  {date:'2026-11-03',time:'09:00',shop:'ぴよりんshop アトリエ店（勝川）',crowd:5,wait:60,items:[{name:'ぴよりんゴジラ',cat:'piyorin',qty:1,price:600},{name:'ぴよりんサブレ',cat:'goods',qty:1,price:750}]},
  {date:'2026-08-15',shop:'ぴよりんvillage（名古屋駅）',crowd:1,wait:0,items:[{name:'ぴよりんパフェ',cat:'village',qty:1,price:1680}]},
  {date:'2025-12-24',shop:'ぴよりんshop（名古屋駅）',crowd:2,wait:10,items:[{name:'定番ぴよりん',cat:'piyorin',qty:3,price:450}]},
]};
const CTX={today:'2026-11-22',hour:12,now:Date.parse('2026-11-22T12:00:00+09:00'),events:EVENTS,basics,weather,koyomi,buy,omikuji:{seed:'s',drawn:false}};

// [問い, 答えの種類（null ＝ Claude へ回す）, 入るべき言葉, 入ってはいけない言葉]
const CASES=[
  // 予定 8
  ['静岡みかんぴよりんはいつ？','event',[/静岡みかんぴよりん/,/11月26日（木）〜11月27日（金）/,/あと4日/],[/ウルフィ|推し旅/]],
  ['三島甘藷ぴよりんはいつまで？','event',[/11月23日（月）/,/いま開催中/],[/もう終わった/]],
  ['クリスマスケーキの受取はいつ？','event',[/12月19日（土）〜12月25日（金）/,/あと27日/],[]],
  ['dancyu祭はいつ？','event',[/1月23日（土）〜1月24日（日）/,/あと62日/],[]],
  ['ぴよりんカレンダー2027はいつ発売？','event',[/11月2日（月）/,/もう終わった/],[/あと\d+日/]],
  ['これからの予定は？','event',[/これからの予定はこれだぴよ！/,/静岡みかん[\s\S]*クリスマスケーキ[\s\S]*dancyu/],[/推し旅|ウルフィ|三島/]],
  ['今月の予定は？','event',[/11月の予定はこれだぴよ！/,/三島甘藷[\s\S]*静岡みかん[\s\S]*推し旅/],[/ゴジラ販売|おのだ/]],
  ['次の限定は？','event',[/これからの限定はこれだぴよ！/,/静岡みかん[\s\S]*クリスマスケーキ/],[/dancyu|出展|推し旅/]],
  // 今日買える・おでかけ 4
  ['今日買えるぴよりんは？','event',[/今日買える限定は、\*\*三島甘藷ぴよりん販売\*\*/,/あしたまで/,/定番のぴよりんは毎日あるぴよ/],[/ウルフィ|ゴジラ|静岡みかん/]],
  ['今日は何が買える？','event',[/三島甘藷ぴよりん販売/],[/ウルフィ|ゴジラ|静岡みかん/]],
  ['次のおでかけは？','event',[/次のおでかけは、これだぴよ！/,/静岡みかんぴよりんおでかけセット販売/,/あと4日/],[/ウルフィ|おのだ/]],
  ['いま開催中のイベントは？','event',[/いま開催中はこれだぴよ！/,/三島甘藷ぴよりん販売（11月23日（月）まで）/,/ほか1件あるぴよ/],[/おのだ|ゴジラ販売|静岡みかん/]],
  // 基本情報 5
  ['定番ぴよりんはいくら？','basics',[/定番ぴよりん\*\*は\*\*450円\*\*（税込）/,/公式サイト/],[/480円/]],
  ['営業時間を教えて','basics',[/9:00〜20:00/,/13:00〜19:00/,/お休みの日はない/],[]],
  ['予約できる？','basics',[/予約できなくて/,/スマートぴよ約/,/平日だけ/],[]],
  ['消費期限は？','basics',[/\*\*当日中\*\*/,/買った日のうちに/],[]],
  ['どこで買えるの？','basics',[/この2つのお店/,/名古屋うまいもん通り/,/アトリエ店/,/すぐ売り切れる/],[]],
  // 天気と暦 4
  ['今日の天気は？','weather',[/今日の名古屋は\*\*晴れ\*\*/,/最高17℃・最低8℃/,/雨の確率は10%/],[/傘を忘れず/]],
  ['明日は傘いる？','weather',[/明日の名古屋の雨の確率は\*\*80%\*\*/,/12〜15時（60%）/,/傘を持っていってぴよ/],[]],
  ['次の祝日はいつ？','koyomi',[/11月23日（月）の勤労感謝の日/,/あと1日/],[]],
  ['次の満月はいつ？','koyomi',[/11月24日（火） 22時ごろ/,/月齢はだいたい12\.9/],[]],
  // 購入記録 4
  ['最後に買ったのはいつ？','buy',[/11月20日（金）\*\*（2日前）/,/ぴよりんshop（名古屋駅）/,/定番ぴよりん×2・いちごぴよりん/],[/円/]],
  ['今年は何個買った？','buy',[/今年の購入記録は\*\*3回\*\*/,/\*\*6個\*\*/,/ぴよりんは\*\*4個\*\*（3種類）/],[/円/]],
  ['いちばん買ったのは？','buy',[/1位 定番ぴよりん（5個）/,/2位 いちごぴよりん（1個）/,/3位 ぴよりんゴジラ（1個）/],[/4位|円/]],
  ['ゴジラは買ったことある？','buy',[/「ゴジラ」は買ったことあるぴよ/,/\*\*1回\*\*/,/11月3日（火）/],[]],
  // 行く前 1
  ['名古屋駅へ行く前に','go',[/行く前のまとめだぴよ！/,/今日買える限定：\*\*三島甘藷ぴよりん販売\*\*/,/営業時間：ぴよりんshop 9:00〜20:00（ぴよりんの販売は9:00・12:00・15:00・18:00）/,/すぐ売り切れる/,
    /今日の天気：晴れ、最高17℃・最低8℃、雨の確率10%/,/待ち23分くらい・混み具合は5段階で平均2\.8/],[/ウルフィ|アトリエ/]],
  // Claude へ回す 4（理由・おすすめ・調べもの・くらべる）
  ['なぜぴよりんは人気なの？',null,[],[]],
  ['おすすめの買い方は？',null,[],[]],
  ['ゴジラの記事を調べて',null,[],[]],
  ['ぴよりんとプリンの違いは？',null,[],[]],
];

test('採点：30 問を localAnswer に通し、答えに入るべき言葉・入ってはいけない言葉・Claude へ回す問いを確かめる',()=>{
  assert.equal(CASES.length,30);
  const bad=[];
  for(const [q,kind,must,not] of CASES){
    const a=X.localAnswer(q,CTX);
    if(kind===null){ if(a!==null)bad.push(`${q}：Claude へ回すはずが、その場で答えた → ${a.text}`); continue; }
    if(!a){bad.push(`${q}：その場で答えるはずが null`);continue}
    if(a.kind!==kind)bad.push(`${q}：種類が ${a.kind}（期待 ${kind}）`);
    for(const re of must)if(!re.test(a.text))bad.push(`${q}：入るはずの ${re} が無い → ${a.text}`);
    for(const re of not)if(re.test(a.text))bad.push(`${q}：入ってはいけない ${re} がある → ${a.text}`);
  }
  const ok=CASES.length-new Set(bad.map(b=>b.split('：')[0])).size;
  console.log(`${CASES.length} 問中 ${ok} 問`);
  assert.deepEqual(bad,[]);
  assert.equal(ok,30);
});

test('採点：購入記録を渡さない（設定が切）ときは、購入記録の問いも行く前のまとめの「前の待ち時間」も出ない',()=>{
  const noBuy={...CTX,buy:null};
  for(const q of ['最後に買ったのはいつ？','今年は何個買った？','いちばん買ったのは？','ゴジラは買ったことある？'])assert.equal(X.localAnswer(q,noBuy),null,q);
  const go=X.localAnswer('名古屋駅へ行く前に',noBuy);
  assert.equal(go.kind,'go');assert.doesNotMatch(go.text,/待ち|混み/);
});
