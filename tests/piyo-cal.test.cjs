// カレンダーの並べ方（2026-11-22）：期間の長い企画が段をふさいで、2 日だけの限定販売（静岡みかんぴよりん）が見えなかった
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const ctx={window:{}};
vm.runInNewContext(read('docs/piyo-cal.js'),ctx);
const C=ctx.window.PiyoCal;
const html=read('docs/index.html');

// 2026-11-22 の本物の予定（events.json）から、11 月にかかるものを写した
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
const TODAY='2026-11-22';
const ids=list=>plain(list.map(x=>(x.e||x).id));

test('みかんぴよりん（11/26〜27）は、PC の 3 段でもスマホの 4 段でも、その週のカレンダーに帯で出る',()=>{
  for(const maxLanes of [3,4]){
    const w=C.layoutWeek(EVENTS,'2026-11-22','2026-11-28',{maxLanes});
    const bar=w.bars.find(b=>b.e.id==='mikan');
    assert.ok(bar,'みかんの帯がある（'+maxLanes+' 段）');
    assert.deepEqual([bar.ci,bar.ce],[4,5]); // 木・金
    assert.deepEqual(plain(w.hidden),{},'隠れた予定は無い');
  }
});

test('前の並べ方（まとめない）では、同じ週でみかんが段に入りきらず隠れていた',()=>{
  const w=C.layoutWeek(EVENTS,'2026-11-22','2026-11-28',{maxLanes:3,group:false});
  assert.equal(w.bars.some(b=>b.e.id==='mikan'),false);
  assert.ok(w.hidden[4]>=1&&w.hidden[5]>=1);
});

test('期間の長い予定（既定は 14 日を越えるもの）は週の下の細い線にして、一覧では「期間の長い予定」にまとめる',()=>{
  const w=C.layoutWeek(EVENTS,'2026-11-22','2026-11-28',{maxLanes:3});
  assert.deepEqual(ids(w.bars).sort(),['imo','mikan']);
  assert.deepEqual(ids(w.thin).sort(),['oshi','sq','stamp','wolfy','xmas']); // 細い線は全部出す（数を絞らない）
  assert.equal(w.thinRows,5);
  assert.deepEqual(plain(w.thin.map(t=>t.lane)).sort(),[0,1,2,3,4]);
  const last=C.layoutWeek(EVENTS,'2026-11-29','2026-12-05',{maxLanes:3}); // 11/30 で終わる 2 本のあとの段を使い回す
  assert.deepEqual([last.thin.find(t=>t.e.id==='oshi').ci,last.thin.find(t=>t.e.id==='oshi').ce],[0,1]);
  assert.equal(C.layoutWeek(EVENTS,'2026-11-22','2026-11-28',{maxLanes:3,group:false}).thin.length,0); // まとめない設定なら細い線は無い
  const a=C.agenda(EVENTS,'2026-11-01','2026-11-30',TODAY);
  assert.deepEqual(ids(a.main),['imo','mikan']);
  assert.deepEqual(ids(a.long),['oshi','wolfy','stamp','sq','xmas']);
  assert.deepEqual(ids(a.done),['onoda','cal','godzilla']);
  assert.equal(a.all.length,10); // 何も落とさない
  assert.equal(a.main.length+a.long.length+a.done.length,a.all.length);
});

test('長い・短いの境目は設定で変えられる（3〜60 日。おかしな値は既定の 14 日）',()=>{
  assert.equal(C.isLong(EVENTS[6],{longDays:14}),false); // ゴジラ販売は 11 日間
  assert.equal(C.isLong(EVENTS[6],{longDays:10}),true);
  assert.equal(C.isLong(EVENTS[0],{group:false}),false);  // まとめない設定なら、どれも長い扱いにしない
  assert.deepEqual(plain(C.fix({longDays:'abc'})),{group:true,longDays:14});
  assert.deepEqual(plain(C.fix({longDays:1})),{group:true,longDays:3});
  assert.deepEqual(plain(C.fix({longDays:999,group:false})),{group:false,longDays:60});
  const store={v:null,getItem(){return this.v},setItem(k,v){this.v=v}};
  assert.deepEqual(plain(C.load(store)),{group:true,longDays:14});
  C.save(store,{group:false,longDays:20});
  assert.deepEqual(plain(C.load(store)),{group:false,longDays:20});
});

test('日付を押したときの「その日の予定」は、長い予定も含めて全部出る（短い予定が先）',()=>{
  const d=C.dayEvents(EVENTS,'2026-11-26');
  assert.equal(d[0].id,'mikan');
  assert.deepEqual(ids(d).sort(),['mikan','oshi','sq','stamp','wolfy','xmas']);
});

test('UPCOMING は、開催中の長い企画より、これから始まる予定と短い予定を先に出す',()=>{
  const up=C.upcoming(EVENTS,TODAY,5);
  assert.deepEqual(ids(up),['imo','mikan','cake','dancyu','oshi']);
  assert.equal(up[0].live,true);
  assert.equal(up[1].live,false);
  // 前の並べ方（始まりの早い順）では、5 件とも開催中の企画で、みかんが出なかった
  assert.equal(ids(C.upcoming(EVENTS,TODAY,5,{group:false})).includes('mikan'),false);
});

test('長い予定でも、終わりまで 7 日以内なら「もうすぐ終了」として前に出す',()=>{
  const up=C.upcoming(EVENTS,'2026-11-24',5);
  const oshi=up.find(x=>x.e.id==='oshi');
  assert.ok(oshi&&oshi.soon,'推し旅（11/30 まで）が出る');
  assert.equal(oshi.left,6);
  assert.ok(ids(up).indexOf('mikan')<ids(up).indexOf('oshi'),'みかん（11/26 から）のほうが先');
  assert.deepEqual(plain(C.status(EVENTS[0],'2026-11-24')),{text:'あと6日で終了',cls:'now'});
});

test('状態の言葉：終了・開催中・きょうまで・あした・あと何日',()=>{
  const m=EVENTS.find(e=>e.id==='mikan');
  assert.equal(C.status(m,TODAY).text,'あと4日');
  assert.equal(C.status(m,'2026-11-25').text,'あした');
  assert.equal(C.status(m,'2026-11-26').text,'開催中');
  assert.equal(C.status(m,'2026-11-27').text,'きょうまで');
  assert.equal(C.status(m,'2026-11-28').text,'終了');
});

test('段に入りきらない短い予定は「+数」で数える（落とさない）',()=>{
  const many=[1,2,3,4,5].map(i=>({id:'s'+i,title:'予定'+i,start:'2026-11-24',end:'2026-11-24',kind:'sale'}));
  const w=C.layoutWeek(many,'2026-11-22','2026-11-28',{maxLanes:3});
  assert.equal(w.bars.length,3);
  assert.deepEqual(plain(w.hidden),{2:2});
});

test('画面：部品を読み込み、帯・一覧・UPCOMING が同じ計算を使う。日付と「+数」は押せる',()=>{
  assert.match(html,/<script src="piyo-cal\.js\?v=\d+"><\/script>/);
  assert.match(html,/PiyoCal\.layoutWeek\(/);
  assert.match(html,/PiyoCal\.agenda\(/);
  assert.match(html,/PiyoCal\.upcoming\(/);
  assert.match(html,/PiyoCal\.dayEvents\(/);
  assert.match(html,/class="more" data-day=/);
  assert.match(html,/class="\$\{cl\}" [^>]*data-thin/);
  assert.match(html,/id="cal-day"/);
  assert.match(html,/id="set-cal-group"/);
});
