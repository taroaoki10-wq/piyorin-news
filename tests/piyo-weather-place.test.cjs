// 2026-11-22：ぴよの天気を「名古屋以外の町」と「3時間ごと／週間の切り替え」に広げる、計算だけの部品（docs/piyo-extras.js）の試験
//  weatherPlace（質問から町を取り出す）・geoNames／pickGeo（地名検索の補助）・weather(ctx.place)・hoursOf・weatherWord・weatherFigure(…, opt)
// index.html は読まない（別の作業の途中で落ちないように）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const ctx0={window:{},TextEncoder,TextDecoder};
vm.runInNewContext(read('docs/piyo-extras.js'),ctx0);
const X=ctx0.window.PiyoExtras;

// ---------------------------------------------------------------- weatherPlace
const tbl=name=>{const p=X.PLACE_TABLE.find(x=>x.names.includes(name));return {label:p.label,lat:p.lat,lon:p.lon}};
const place=(q,label)=>{const p=X.weatherPlace(q);assert.ok(p,`${q} → null だった`);assert.equal(p.label,label,`${q} → ${p.label}`);return p};
test('weatherPlace：町が無い・名古屋と愛知は null',()=>{
  for(const q of ['今日の天気','天気は？','明日雨降る？','名古屋の天気','今日の名古屋の天気は？','名古屋市の天気','名古屋駅の天気','名駅の天気','愛知の天気','愛知県の天気','名古屋市中区の天気','名古屋市港区の明日の天気','あさっての雨の確率は？','今週の天気','週末は雨？','土日の気温は？','日の出は何時？'])
    assert.equal(X.weatherPlace(q),null,q);
  assert.equal(X.weatherPlace(''),null);assert.equal(X.weatherPlace(null),null);assert.equal(X.weatherPlace(undefined),null);
});
test('weatherPlace：天気の言葉の残りかすを町にしない',()=>{
  for(const q of ['傘持っていく？','風強い？','UVは？','紫外線は？','日焼け止めいる？','一週間の天気','来週の天気は？','3日後の天気','次の土曜日は雨？','今夜は何度？','この先の予報を教えて','今日は暑い？','明日の最高気温と最低気温は？','雨降ってる？','今は寒い？'])
    assert.equal(X.weatherPlace(q),null,q);
});
test('weatherPlace：表にある町（例の質問）',()=>{
  const t=place('東京の天気','東京');assert.deepEqual(plain(t),{label:'東京',lat:35.69,lon:139.69});
  place('東京は傘いる？','東京');
  place('明日の大阪の天気は？','大阪');
  place('京都の週間天気','京都');
  place('札幌って寒い？','札幌');
  place('浜松いま雨降ってる？','浜松');
  place('横浜は雨？','横浜');
  place('豊橋の天気','豊橋');
  place('今日の福岡の気温は？','福岡');
  place('あさっての広島の降水確率は','広島');
  place('今夜の仙台の天気','仙台');
  place('金沢の紫外線は？','金沢');
  place('岐阜の日の出は何時？','岐阜');
  assert.deepEqual(Object.keys(X.weatherPlace('東京の天気')).sort(),['label','lat','lon']);
});
test('weatherPlace：県名・市・都府県・駅つきの言い方',()=>{
  place('東京都の天気','東京');place('京都府の天気','京都');place('京都市の天気','京都');place('京都駅の天気','京都');place('東京駅の天気','東京');
  place('北海道の天気','札幌');place('札幌市の天気','札幌');place('埼玉の天気','さいたま');place('埼玉県の天気','さいたま');place('さいたま市の天気','さいたま');
  place('沖縄の天気','那覇');place('神奈川の天気','横浜');place('神奈川県の天気','横浜');place('兵庫の天気','神戸');place('石川の天気','金沢');
  place('静岡県浜松市の天気','浜松');place('愛知県豊田市の天気','豊田');place('愛知県豊橋市の明日の天気は？','豊橋');place('北海道旭川市の天気','旭川');
  place('神奈川県川崎市の天気','川崎');place('大阪府の天気','大阪');place('岐阜県高山市の天気','高山');
  place('つくばの天気','つくば');place('いわき市の天気','いわき');place('ひたちなかの天気','ひたちなか');
});
test('weatherPlace：津（1 文字）と大津',()=>{
  place('津の天気','津');place('津市の天気','津');place('三重の天気','津');place('三重県の天気','津');place('三重県津市の天気','津');place('津って雨？','津');place('津は寒い？','津');place('明日の津の天気','津');
  const o=place('大津の天気','大津');assert.deepEqual(plain(o),tbl('大津'));
  place('滋賀の天気','大津');
  for(const q of ['津波は？','津波の天気は？']) assert.equal(X.weatherPlace(q),null,q);
});
test('weatherPlace：表に無い町は lat・lon が null（市・区・町・村で終わる物か、の・は・って などが続く物だけ拾う）',()=>{
  assert.deepEqual(plain(X.weatherPlace('渋谷の天気')),{label:'渋谷',lat:null,lon:null});
  assert.deepEqual(plain(X.weatherPlace('豊川市の天気')),{label:'豊川市',lat:null,lon:null});
  assert.deepEqual(plain(X.weatherPlace('豊川の天気')),{label:'豊川',lat:null,lon:null});
  assert.deepEqual(plain(X.weatherPlace('ニセコは雪？')),{label:'ニセコ',lat:null,lon:null});
  assert.deepEqual(plain(X.weatherPlace('渋谷区の明日の天気')),{label:'渋谷区',lat:null,lon:null});
  assert.deepEqual(plain(X.weatherPlace('東京都渋谷区の天気')),{label:'東京',lat:35.69,lon:139.69}); // 表にある物を優先
  assert.equal(X.weatherPlace('渋谷って暑い？').label,'渋谷');
  assert.equal(X.weatherPlace('洗濯物は外に干せる？'),null);
});
test('weatherPlace：いくつも当たったら後ろの町。表にある町は表にない言葉より先',()=>{
  assert.equal(X.weatherPlace('東京と大阪の天気').label,'大阪');
  assert.equal(X.weatherPlace('名古屋と東京の天気').label,'東京');
  assert.equal(X.weatherPlace('渋谷から京都までの天気').label,'京都');
});
test('weatherPlace：大分は「だいぶ」の意味のときは町にしない',()=>{
  place('大分の天気','大分');place('大分県の天気','大分');place('明日の大分は雨？','大分');
  assert.equal(X.weatherPlace('大分寒くなった？'),null);assert.equal(X.weatherPlace('今日は大分暑いね'),null);
});
test('weatherPlace：全角・空白・記号まじりでも',()=>{
  place('　東京　の天気は？？','東京');place('ＴＯＫＹＯ東京の天気！','東京');place('大阪の　明日の天気を教えて。','大阪');place('明日の福岡って雨降る?','福岡');
});
test('weatherPlace：表の全部の名前で「○○の天気」「明日の○○は傘いる？」がその町に戻る（外し言葉が名前を壊していない）',()=>{
  assert.ok(X.PLACE_TABLE.length>=100);
  for(const p of X.PLACE_TABLE){
    assert.ok(Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>20&&p.lat<46&&p.lon>122&&p.lon<146,p.label);
    assert.equal(Math.round(p.lat*100)/100,p.lat,p.label);assert.equal(Math.round(p.lon*100)/100,p.lon,p.label);
    for(const n of p.names){
      for(const q of [`${n}の天気`,`明日の${n}は傘いる？`,`${n}って寒い？`,`今週の${n}の天気予報`]) assert.equal(X.weatherPlace(q)&&X.weatherPlace(q).label,p.label,q);
    }
  }
  assert.equal(new Set(X.PLACE_TABLE.map(p=>p.label)).size,X.PLACE_TABLE.length); // 同じ町を 2 回書いていない
  assert.equal(X.PLACE_TABLE.some(p=>/^(名古屋|豊川|渋谷)$/.test(p.label)),false);
});
test('weatherPlace：47 都道府県の県名はどれも表の町に当たる',()=>{
  const ken='北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄'.split(' ');
  assert.equal(ken.length,46); // 愛知を除く 46
  for(const k of ken){const sfx=k==='北海道'?'':k==='東京'?'都':k==='京都'||k==='大阪'?'府':'県';const p=X.weatherPlace(`${k}${sfx}の天気`);assert.ok(p&&Number.isFinite(p.lat),k);}
});

// ---------------------------------------------------------------- geoNames・pickGeo（本物の地名検索の答えを小さく写した物）
test('geoNames：地名検索で試す名前の並び',()=>{
  assert.deepEqual(plain(X.geoNames('豊川')),['豊川市','豊川町','豊川']);
  assert.deepEqual(plain(X.geoNames('豊川市')),['豊川市','豊川']);
  assert.deepEqual(plain(X.geoNames('渋谷区')),['渋谷区','渋谷']);
  assert.deepEqual(plain(X.geoNames('ニセコ町')),['ニセコ町','ニセコ']);
  assert.deepEqual(plain(X.geoNames('中区')),['中区']);
  assert.deepEqual(plain(X.geoNames('')),[]);
});
const toyokawa=[{id:1849845,name:'豊川市',latitude:34.81667,longitude:137.4,elevation:4.0,feature_code:'PPLA2',country_code:'JP',admin1_id:1865694,admin2_id:1849840,timezone:'Asia/Tokyo',population:184661,country_id:1861060,country:'日本',admin1:'愛知県',admin2:'豊川市'}];
const haneda=[ // 2026-11-22 の地名検索「羽田」の答え（人口が無い物が先に来る）
  {name:'羽田',latitude:37.68417,longitude:140.56647,feature_code:'PPL',country_code:'JP',admin1:'福島県'},
  {name:'羽田',latitude:35.54913,longitude:139.7456,feature_code:'PPLX',country_code:'JP',admin1:'東京都',population:14885},
  {name:'羽田',latitude:32.23242,longitude:130.73085,feature_code:'PPLL',country_code:'JP',admin1:'熊本県'}];
const tomiyama=[ // 「富山」の答え：山（MT）は外す
  {name:'富山',latitude:35.0958,longitude:139.8821,feature_code:'MT',country_code:'JP',admin1:'千葉県'},
  {name:'富山',latitude:37.27707,longitude:139.52374,feature_code:'PPL',country_code:'JP',admin1:'福島県'}];
test('pickGeo：日本の町（PPL・ADM）だけ、人口の多い順に 1 つ',()=>{
  assert.deepEqual(plain(X.pickGeo(toyokawa)),{label:'豊川市',lat:34.81667,lon:137.4,pref:'愛知県'});
  assert.deepEqual(plain(X.pickGeo(haneda)),{label:'羽田',lat:35.54913,lon:139.7456,pref:'東京都'});
  assert.deepEqual(plain(X.pickGeo(tomiyama)),{label:'富山',lat:37.27707,lon:139.52374,pref:'福島県'});
  assert.deepEqual(plain(X.pickGeo([{name:'東京都',latitude:35.6895,longitude:139.69171,feature_code:'PPLC',country_code:'JP',admin1:'東京都',population:9733276}])),{label:'東京都',lat:35.6895,lon:139.69171,pref:'東京都'});
  assert.equal(X.pickGeo([{name:'岩手県',latitude:39.7,longitude:141.1,feature_code:'ADM1',country_code:'JP',admin1:'岩手県',population:1}]).label,'岩手県');
});
test('pickGeo：公園・山・空港・島・日本以外・壊れた答えは外す',()=>{
  const base={name:'x',latitude:35,longitude:139,country_code:'JP',admin1:'東京都',population:999};
  for(const code of ['PRK','MT','AIRP','ISL','HLL','LK','STM']) assert.equal(X.pickGeo([{...base,feature_code:code}]),null,code);
  assert.equal(X.pickGeo([{...base,feature_code:'PPL',country_code:'US'}]),null);
  assert.equal(X.pickGeo([{...base,feature_code:'PPL',latitude:'x'}]),null);
  assert.equal(X.pickGeo([]),null);assert.equal(X.pickGeo(undefined),null);assert.equal(X.pickGeo(null),null);assert.equal(X.pickGeo({}),null);assert.equal(X.pickGeo([null,{}]),null);
  assert.equal(X.pickGeo([{...base,feature_code:'AIRP',population:9e6},{...base,name:'町',feature_code:'PPL',population:5}]).label,'町');
});

// ---------------------------------------------------------------- weather(ctx.place)
const weather=['2026-10-28','2026-10-29','2026-10-30'].map((date,i)=>({date,word:['晴れ','くもり','雨'][i],max:20+i,min:10+i,rain:[10,40,80][i],sunrise:'06:05',sunset:'17:10',uv:4,wind:5,
  rainHours:[{from:9,to:12,rain:20},{from:12,to:15,rain:60},{from:15,to:18,rain:35}]}));
const base={today:'2026-10-28',hour:12,now:Date.parse('2026-10-28T12:00:00+09:00'),events:[],basics:{lines:[]},koyomi:null,weather,omikuji:{seed:'s1',drawn:false}};
const ask=(q,c={})=>X.localAnswer(q,{...base,...c});
test('weather：place があれば答えの「名古屋」をその町の名前にする',()=>{
  const a=ask('今日の東京の天気は？',{place:'東京'});
  assert.match(a.text,/今日の東京は\*\*晴れ\*\*、最高20℃・最低10℃、雨の確率は10%/);assert.equal(a.place,'東京');assert.equal(a.sources,'weather');assert.equal(/名古屋/.test(a.text),false);
  assert.match(ask('明日の東京の雨の確率は？',{place:'東京'}).text,/^明日の東京の雨の確率は\*\*40%\*\*/);
  assert.match(ask('東京の気温は？',{place:'東京'}).text,/^今日の東京は、最高\*\*20℃\*\*/);
  assert.match(ask('東京の風は？',{place:'東京'}).text,/^今日の東京の最大風速/);
  assert.match(ask('東京の紫外線は？',{place:'東京'}).text,/^今日の東京の紫外線/);
  assert.match(ask('東京の日の入りは？',{place:'東京'}).text,/^今日の東京の日の出は\*\*06:05\*\*/);
  const w=ask('東京の週間天気',{place:'東京'});assert.match(w.text,/^東京の天気だぴよ！\n・10月28日（水） 晴れ 20℃／10℃ 雨10%/);assert.equal(/名古屋/.test(w.text),false);assert.equal(w.place,'東京');
  assert.match(ask('明日の浜松の天気',{place:'浜松'}).text,/^明日の浜松は\*\*くもり\*\*/);
  assert.match(ask('豊川市の天気',{place:'豊川市'}).text,/^今日の豊川市は\*\*晴れ\*\*/);
  assert.equal(ask('東京の天気は？',{place:'東京',weather:null}).place,'東京');assert.match(ask('東京の天気は？',{place:'東京',weather:null}).text,/取れてない/);
  assert.match(ask('東京のあさっての天気',{place:'東京',today:'2026-10-28'}).text,/^あさっての東京は\*\*雨\*\*/);
  assert.equal(ask('東京の天気は？',{place:'東京',weather:[{...weather[0],date:'2026-10-20'}]}).place,'東京'); // その日の予報が無い答えにも place
});
test('weather：place が無いときは今までどおり（名古屋の答え・ほかの町は null・place の鍵なし）',()=>{
  const a=ask('今日の名古屋の天気は？');assert.match(a.text,/今日の名古屋は\*\*晴れ\*\*/);assert.equal('place' in a,false);
  assert.equal(ask('東京の天気は？'),null);assert.equal(ask('豊橋の天気は？'),null);assert.equal(ask('京都の天気'),null);assert.equal(ask('横浜は雨？'),null);
  assert.equal('place' in ask('今日の天気'),false);
  assert.equal(ask('今日の天気',{place:''}).text.includes('名古屋'),true);
  assert.equal(ask('雨の日でも買える？',{place:'東京'}),null); // 予報でない聞き方は place があっても答えない
});

// ---------------------------------------------------------------- weatherWord・hoursOf
test('weatherWord：天気の番号を言葉に（index.html と同じ対応。無い値は空）',()=>{
  const got=[0,1,2,3,45,53,61,63,65,66,73,80,82,85,95,99].map(X.weatherWord);
  assert.deepEqual(got,['晴れ','晴れ','晴れときどきくもり','くもり','霧','霧雨','小雨','雨','強い雨','冷たい雨','雪','にわか雨','激しいにわか雨','にわか雪','雷雨','ひょうまじりの雷雨']);
  assert.equal(X.weatherWord(null),'');assert.equal(X.weatherWord(undefined),'');assert.equal(X.weatherWord(NaN),'');assert.equal(X.weatherWord(1234),'');assert.equal(X.weatherWord('x'),'');
});
const hourly=(date,next)=>{
  const time=[],temperature_2m=[],weather_code=[],precipitation_probability=[];
  for(const d of [date,next]) for(let h=0;h<24;h++){time.push(`${d}T${String(h).padStart(2,'0')}:00`);temperature_2m.push(10+h/2);weather_code.push(h<12?0:h<18?3:63);precipitation_probability.push(d===date?(h===13?70:h===14?40:h<12?0:10):90)}
  return {time,temperature_2m,weather_code,precipitation_probability};
};
test('hoursOf：その日の 3 時間ごとの点（0・3・…・21 時）',()=>{
  const h=hourly('2026-11-22','2026-11-23');
  const p=plain(X.hoursOf(h,'2026-11-22'));
  assert.deepEqual(p.map(x=>x.h),[0,3,6,9,12,15,18,21]);
  assert.deepEqual(p[0],{h:0,temp:10,word:'晴れ',rain:0});
  assert.deepEqual(p[4],{h:12,temp:16,word:'くもり',rain:70}); // 12〜15 時の区間＝13・14・15 時の値の最大
  assert.deepEqual(p[5],{h:15,temp:18,word:'くもり',rain:10}); // 15〜18 時の区間＝16・17・18 時の値
  assert.deepEqual(p[7],{h:21,temp:21,word:'雨',rain:90}); // 21〜24 時＝22・23 時と次の日の 0 時(90) の最大（Open-Meteo の値は直前 1 時間。答えの文の rainHours と同じ数え方）
  assert.equal(plain(X.hoursOf(h,'2026-11-23'))[0].rain,90);
  assert.equal(X.hoursOf(h,'2026-11-24').length,0);
});
test('hoursOf：四捨五入・値が無い点・壊れた入力',()=>{
  const time=['2026-11-22T00:00','2026-11-22T01:00','2026-11-22T02:00','2026-11-22T03:00','2026-11-22T06:00','2026-11-22T09:00'];
  const p=plain(X.hoursOf({time,temperature_2m:[12.4,12.5,13,null,9.6,-0.4],weather_code:[0,0,0,0,null,3],precipitation_probability:[null,20,null,null,10,null]},'2026-11-22'));
  assert.deepEqual(p,[{h:0,temp:12,word:'晴れ',rain:20},{h:9,temp:0,word:'くもり',rain:null}]); // 3 時（気温なし）と 6 時（天気なし）は外す。-0.4 は 0
  assert.deepEqual(plain(X.hoursOf({time:['2026-11-22T00:00','2026-11-22T03:00'],temperature_2m:[12.5,13.5],weather_code:[0,0]},'2026-11-22')).map(x=>[x.temp,x.rain]),[[13,null],[14,null]]);
  for(const bad of [null,undefined,{},{time:'x'},{time:[]},{time:['2026-11-22T00:00']},[]]) assert.deepEqual(plain(X.hoursOf(bad,'2026-11-22')),[]);
  assert.deepEqual(plain(X.hoursOf({time:['2026-11-22T00:00'],temperature_2m:[5],weather_code:[0]},'2026-11-22')),[{h:0,temp:5,word:'晴れ',rain:null}]);
});

// ---------------------------------------------------------------- weatherFigure
const wday=(date,over={})=>({date,word:'晴れ',max:18,min:9,rain:10,...over});
const pts=(hs)=>hs.map(([h,temp,word,rain])=>({h,temp,word,rain}));
const week=['2026-11-22','2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-28'].map((d,i)=>wday(d,{max:18-i,min:9-i,word:['晴れ','くもり','雨','雪','雷雨','霧','晴れときどきくもり'][i]}));
const withHours=(w,a,b)=>w.map((d,i)=>i===0?{...d,hours:a}:i===1?{...d,hours:b}:d);
const allHours=pts([[0,8,'晴れ',0],[3,7,'晴れ',0],[6,7,'晴れ',5],[9,12,'晴れ',10],[12,16,'くもり',30],[15,15,'雨',60],[18,12,'雨',80],[21,10,'くもり',20]]);
const tmr=pts([[0,9,'くもり',10],[3,8,'くもり',10],[6,8,'雨',50],[9,11,'雨',60],[12,14,'晴れ',0],[15,14,'晴れ',0],[18,11,'晴れ',0],[21,9,'晴れ',0]]);
test('weatherFigure：3時間ごと／週間の 2 枚の切り替え',()=>{
  const w=withHours(week,allHours,tmr);
  const h=X.weatherFigure(w,'2026-11-22',{nowHour:14,place:'東京'});
  assert.match(h,/^<div class="piyo-wx2" role="group" aria-label="東京の天気">/);
  assert.match(h,/<div class="piyo-wx-tabs" role="tablist"><button type="button" class="piyo-wx-tab on" role="tab" aria-selected="true" data-page="0">3時間ごと<\/button><button type="button" class="piyo-wx-tab" role="tab" aria-selected="false" data-page="1">週間<\/button><\/div>/);
  assert.match(h,/<div class="piyo-wx-pages"><div class="piyo-wx-page" data-page="0"><div class="piyo-wx-hr"/);
  assert.match(h,/<\/div><div class="piyo-wx-page" data-page="1"><div class="piyo-wx" role="img" aria-label="東京の天気：今日 晴れ 最高18℃/);
  assert.equal((h.match(/class="piyo-wx-page"/g)||[]).length,2);
  assert.equal((h.match(/class="piyo-wx-day/g)||[]).length,7);
  // 14 時 → 12 時から 8 点（今日 12・15・18・21、明日 0・3・6・9）
  assert.equal((h.match(/class="piyo-wx-hr( newday)?"/g)||[]).length,8);
  const labels=[...h.matchAll(/class="piyo-wx-hr(?: newday)?" role="img" aria-label="([^"]*)"/g)].map(m=>m[1]);
  assert.deepEqual(labels,['12時 くもり 16度 雨30%','15時 雨 15度 雨60%','18時 雨 12度 雨80%','21時 くもり 10度 雨20%','明日 0時 くもり 9度 雨10%','3時 くもり 8度 雨10%','6時 雨 8度 雨50%','9時 雨 11度 雨60%']);
  assert.match(h,/<span class="piyo-wx-dd">今日<\/span><span class="piyo-wx-hh">12時<\/span><svg class="piyo-wx-i" viewBox="0 0 24 24" aria-hidden="true">.*?<\/svg><span class="piyo-wx-t">16°<\/span><span class="piyo-wx-r">30%<\/span>/);
  assert.match(h,/<div class="piyo-wx-hr newday" role="img" aria-label="明日 0時[^"]*"><span class="piyo-wx-dd">明日<\/span><span class="piyo-wx-hh">0時<\/span>/); // 日付は上の細い行に分ける
  assert.equal((h.match(/<span class="piyo-wx-dd"><\/span>/g)||[]).length,6); // ほかの点は空の行で高さをそろえる
  assert.match(h,/<span class="piyo-wx-r wet">60%<\/span>/);assert.equal(/<span class="piyo-wx-r wet">30%/.test(h),false);
  assert.equal((h.match(/<button /g)||[]).length,2);
});
test('weatherFigure：今の時を 3 で切り捨てた時刻から。夜の晴れは月。place が無ければ名古屋',()=>{
  const w=withHours(week,allHours,tmr);
  const l=nowHour=>[...X.weatherFigure(w,'2026-11-22',{nowHour}).matchAll(/<span class="piyo-wx-hh">([^<]*)<\/span>/g)].map(m=>m[1]);
  assert.deepEqual(l(0),['0時','3時','6時','9時','12時','15時','18時','21時']);
  assert.deepEqual(l(2),['0時','3時','6時','9時','12時','15時','18時','21時']);
  assert.deepEqual(l(3),['3時','6時','9時','12時','15時','18時','21時','0時']);
  assert.deepEqual(l(23),['21時','0時','3時','6時','9時','12時','15時','18時']);
  assert.deepEqual(l(undefined),l(0));
  const h=X.weatherFigure(w,'2026-11-22',{nowHour:0});
  assert.match(h,/aria-label="名古屋の天気"/);
  assert.match(h,/aria-label="0時 晴れ 8度 雨0%"><span class="piyo-wx-dd">今日<\/span><span class="piyo-wx-hh">0時<\/span><svg class="piyo-wx-i" viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M21 12\.79A9 9 0 1 1 11\.21 3/); // 夜の晴れ → 月
  assert.match(h,/aria-label="9時 晴れ 12度 雨10%"><span class="piyo-wx-dd"><\/span><span class="piyo-wx-hh">9時<\/span><svg class="piyo-wx-i" viewBox="0 0 24 24" aria-hidden="true"><circle/); // 昼の晴れ → 太陽
  assert.match(X.weatherFigure(withHours(week,pts([[21,10,'晴れ',0]]),pts([[3,9,'晴れときどきくもり',0]])),'2026-11-22',{nowHour:21}),/aria-label="明日 3時 晴れときどきくもり 9度 雨0%"><span class="piyo-wx-dd">明日<\/span><span class="piyo-wx-hh">3時<\/span><svg class="piyo-wx-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8\.6"/); // ときどきくもりは月にしない
});
test('weatherFigure：点が 2 つ未満なら切り替えなしで、今までの週間の図だけ',()=>{
  const old=X.weatherFigure(week,'2026-11-22');
  assert.match(old,/^<div class="piyo-wx" role="img" aria-label="名古屋の天気：今日 晴れ 最高18℃ 最低9℃ 雨10%、明日 /);
  assert.equal(X.weatherFigure(week,'2026-11-22',{nowHour:10,place:'名古屋'}),old);
  assert.equal(X.weatherFigure(withHours(week,[],[]),'2026-11-22',{nowHour:10}),old);
  assert.equal(X.weatherFigure(withHours(week,pts([[3,1,'晴れ',0]]),[]),'2026-11-22',{nowHour:0}),old); // 1 点だけ
  assert.equal(X.weatherFigure(withHours(week,pts([[0,1,'晴れ',0],[3,1,'晴れ',0]]),[]),'2026-11-22',{nowHour:6}),old); // 6 時以降は 0 点
  assert.equal(/piyo-wx2|piyo-wx-tab/.test(X.weatherFigure(withHours(week,pts([[21,1,'晴れ',0]]),[]),'2026-11-22',{nowHour:21})),false);
  assert.match(X.weatherFigure(week,'2026-11-22',{place:'東京'}),/aria-label="東京の天気：今日 /); // 切り替えが無くても町の名前は変わる
  assert.equal(X.weatherFigure(withHours(week,pts([[0,1,'晴れ',0],[3,1,'晴れ',0]]),[]),'2026-11-22',{nowHour:0}).includes('piyo-wx2'),true); // ちょうど 2 点なら出す
  // 2 つの引数で呼ぶ今の使い方は 1 字も変わらない（試験 tests/piyo-extras.test.cjs が見ている）
  assert.equal(X.weatherFigure(week,'2026-11-22',undefined),old);assert.equal(X.weatherFigure(week,'2026-11-22',null),old);
});
test('weatherFigure：週間も作れなければ空。入力の記号は esc。点の値の壊れ方に強い',()=>{
  assert.equal(X.weatherFigure(null,'2026-11-22',{nowHour:3}),'');
  assert.equal(X.weatherFigure([wday('2026-11-22')],'2026-11-22',{nowHour:3}),'');
  assert.equal(X.weatherFigure(withHours([wday('2026-11-22'),wday('2026-11-23')].slice(0,1),allHours,tmr),'2026-11-22',{nowHour:3}),'');
  const evil='<img src=x onerror=alert(1)>"&\'東京';
  const h=X.weatherFigure(withHours(week,allHours,tmr),'2026-11-22',{nowHour:0,place:evil});
  assert.equal(h.includes('<img'),false);assert.equal(h.includes('onerror=alert(1)>'),false);
  assert.match(h,/aria-label="&lt;img src=x onerror=alert\(1\)&gt;&quot;&amp;&#39;東京の天気"/);
  assert.match(h,/aria-label="&lt;img src=x onerror=alert\(1\)&gt;&quot;&amp;&#39;東京の天気：今日 /);
  const evilDay=week.map((d,i)=>i===0?{...d,word:'晴れ"><b>x</b>',hours:[{h:0,temp:5,word:'晴れ"><i>y</i>',rain:null},{h:3,temp:6,word:'くもり',rain:5}]}:d);
  const g=X.weatherFigure(evilDay,'2026-11-22',{nowHour:0});
  assert.equal(/<b>|<i>/.test(g),false);
  const bad=week.map((d,i)=>i===0?{...d,hours:[{h:0,temp:'x',word:'晴れ',rain:0},{h:3,temp:6,word:'',rain:0},{h:6,temp:7,word:'晴れ',rain:0},{h:9,temp:8,word:'晴れ',rain:0},null,{h:'a',temp:1,word:'晴れ'}]}:d);
  assert.equal((X.weatherFigure(bad,'2026-11-22',{nowHour:0}).match(/class="piyo-wx-hr"/g)||[]).length,2);
  assert.equal(X.weatherFigure(week.map(d=>({...d,hours:'x'})),'2026-11-22',{nowHour:0}),X.weatherFigure(week,'2026-11-22'));
});
test('公開の一覧に、足した部品が入っていて、前からある部品も残っている',()=>{
  for(const k of ['weatherPlace','geoNames','pickGeo','hoursOf','weatherWord','weatherFigure','weatherKind','weatherAsk','PLACE_TABLE','localAnswer','greeting','tidbits']) assert.ok(k in X,k);
  assert.deepEqual(['晴れ','晴れときどきくもり','くもり','霧','小雨','にわか雨','冷たい雨','雪','にわか雪','雷雨','ひょうまじりの雷雨'].map(X.weatherKind),['sun','partly','cloud','cloud','rain','rain','rain','snow','snow','thunder','thunder']);
});
test('weatherPlace：長い言い方は先頭の町の名前で引く（名古屋の札で答えないため）',()=>{
  const lab=q=>(X.weatherPlace(q)||{}).label||null;
  assert.equal(lab('東京ディズニーランドの天気'),'東京');
  assert.equal(lab('大阪万博記念公園の天気は？'),'大阪');
  assert.equal(lab('札幌ドームの天気'),'札幌');
  assert.equal(lab('大阪狭山市の天気'),'大阪狭山市'); // 市町村で終わる名前はそのまま
  assert.equal(lab('ナガシマスパーランドの天気'),'ナガシマスパーランド'); // 表に無ければ地名検索へ（見つからなければ「どこか分からなかった」）
  assert.equal(X.weatherPlace('名古屋城の天気'),null);
});
