const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const B=require('../docs/piyo-buy.js');
const events=JSON.parse(fs.readFileSync(path.join(__dirname,'..','docs/data/events.json'),'utf8'));
const memo=JSON.parse(fs.readFileSync(path.join(__dirname,'..','docs/data/piyo-memo.json'),'utf8'));
const plain=v=>JSON.parse(JSON.stringify(v));

test('予定の題名を商品名にする',()=>{
  assert.equal(B.itemName('ハロウィンぴよりん販売'),'ハロウィンぴよりん');
  assert.equal(B.itemName('ぴよりんカレンダー2027 先行販売'),'ぴよりんカレンダー2027');
  assert.equal(B.itemName('ひよりの手作りクッキー缶（ハロウィンver.）販売'),'ひよりの手作りクッキー缶（ハロウィンver.）');
  assert.equal(B.itemName('三島甘藷ぴよりん'),'三島甘藷ぴよりん');
});

test('予定の分類（ぴよりん・クッキー缶・その他・買えない）',()=>{
  const c=(title,kind='sale')=>B.eventCat({title,kind});
  assert.equal(c('ハロウィンぴよりん販売'),'piyorin');
  assert.equal(c('ぴよりんおでかけセット おのだサンパーク'),'piyorin');
  assert.equal(c('ひよりの手作りクッキー缶（ハロウィンver.）販売','release'),'cookie');
  assert.equal(c('秋限定クッキー缶 発売','release'),'cookie');
  assert.equal(c('ぴよりんカレンダー2027 販売開始','release'),'goods');
  assert.equal(c('ウルフィ×ぴよりん ぬいぐるみ 店頭販売'),'goods');
  assert.equal(c('ぴよりんゴジラ スタンプラリーキャンペーン','campaign'),null);
  assert.equal(c('ぴよりん新幹線ツアー（いいぴよの日）','event'),null);
  assert.equal(c('ぴよりんクリスマスケーキ 予約受付開始','release'),null);
});

test('ぴよメモから値段を拾う',()=>{
  assert.deepEqual(plain(B.memoPrices('三島甘藷ぴよりん。テイクアウト580円(税込)、店内飲食680円(税込)。')),
    [{label:'テイクアウト',price:580},{label:'店内飲食',price:680}]);
  assert.deepEqual(plain(B.memoPrices('おでかけセット（2ぴよ入り）1,200円（税込）')),[{label:'',price:1200}]);
  assert.deepEqual(plain(B.memoPrices('')),[]);
});

test('本物のデータ：11/5 に売っている限定はぴよりんゴジラ（580円）',()=>{
  const l=B.limitedFor(events,'2026-11-05',memo,'piyorin');
  const g=l.find(x=>x.name==='ぴよりんゴジラ');
  assert.ok(g&&g.onSale);
  assert.equal(g.price,580);
  assert.ok(l.every(x=>x.cat==='piyorin'));
  assert.ok(l.indexOf(g)<l.findIndex(x=>!x.onSale)||l.every(x=>x.onSale)); // 売っている物が先
});

test('本物のデータ：過去の日（10/25）はハロウィンぴよりん、クッキー缶はハロウィンver.',()=>{
  assert.ok(B.limitedFor(events,'2026-10-25',memo,'piyorin').some(x=>x.name==='ハロウィンぴよりん'&&x.onSale));
  assert.ok(B.limitedFor(events,'2026-10-25',memo,'cookie').some(x=>/クッキー缶（ハロウィンver.）/.test(x.name)));
});

test('過去の記録：これまでの限定ぜんぶから、ことばで探せる',()=>{
  const all=B.allLimited(events,'2026-11-04',memo,'piyorin','');
  assert.ok(all.length>10);
  assert.ok(all.some(x=>x.name==='ブルーベリーぴよりん'));         // 8月の物も出る
  for(let i=1;i<all.length;i++)assert.ok(all[i-1].start>=all[i].start); // 新しい順
  const q=B.allLimited(events,'2026-11-04',memo,'piyorin','栗');
  assert.deepEqual(q.map(x=>x.name),['栗きんとんぴよりん']);
});

test('記録の整え方：名前の無い物は外す・数と値段・混雑度は1〜5',()=>{
  const r=B.normalize({date:'2026-11-03',time:'09:00',shop:' ぴよりんshop（名古屋駅） ',crowd:7,wait:'20',
    items:[{cat:'piyorin',name:'ぴよりんゴジラ',qty:'2',price:'580'},{cat:'cookie',name:'  '},{cat:'x',name:'トートバッグ',price:''}]},1000);
  assert.equal(r.shop,'ぴよりんshop（名古屋駅）');
  assert.equal(r.crowd,null);
  assert.equal(r.wait,20);
  assert.equal(r.items.length,2);
  assert.equal(r.items[1].cat,'goods');
  assert.equal(r.items[1].price,null);
  assert.equal(B.total(r),1160);
  assert.equal(B.count(r),3);
  assert.equal(B.normalize({date:'2026/11/03',items:[{name:'a'}]}),null);
  assert.equal(B.normalize({date:'2026-11-03',items:[]}),null);
  assert.equal(B.normalize({date:'2026-11-03',crowd:3,items:[{name:'a'}]}).crowd,3);
  assert.equal(B.total(B.normalize({date:'2026-11-03',items:[{name:'a'}]})),null); // 値段が分からないときは合計を出さない
});

test('保存と読み直し・読み込みの合わせ方',()=>{
  const a=B.normalize({id:'aaaa1',date:'2026-10-25',items:[{name:'ハロウィンぴよりん'}],updatedAt:10});
  const b=B.normalize({id:'bbbb2',date:'2026-11-03',items:[{name:'ぴよりんゴジラ'}],updatedAt:10});
  const back=B.parseStore(B.dumpStore([a,b]));
  assert.deepEqual(plain(back),plain([a,b]));
  assert.deepEqual(plain(B.parseStore('こわれた')),[]);
  const m=B.merge([a],[Object.assign({},a,{memo:'新しい',updatedAt:20}),b,{id:'x',date:'bad'}]);
  assert.equal(m.added,1);assert.equal(m.updated,1);
  assert.deepEqual(m.list.map(r=>r.id),['bbbb2','aaaa1']); // 新しい日付が先
  assert.equal(m.list[1].memo,'新しい');
  const m2=B.merge(m.list,[Object.assign({},a,{memo:'古い',updatedAt:5})]);
  assert.equal(m2.updated,0);
});

test('絞り込み・集計・はじめて',()=>{
  const recs=B.sortRecs([
    B.normalize({id:'r0001',date:'2026-10-25',shop:'ぴよりんshop（名古屋駅）',crowd:4,items:[{cat:'piyorin',name:'ハロウィンぴよりん',qty:2,price:580,limited:'ハロウィンぴよりん'}],createdAt:1}),
    B.normalize({id:'r0002',date:'2026-10-30',shop:'ぴよりんshop アトリエ店（勝川）',crowd:2,fav:true,items:[{cat:'piyorin',name:'定番ぴよりん',price:450},{cat:'cookie',name:'ひよりの手作りクッキー缶',price:2800}],createdAt:2}),
    B.normalize({id:'r0003',date:'2026-10-31',items:[{cat:'piyorin',name:'ハロウィンぴよりん',price:580,limited:'ハロウィンぴよりん'}],createdAt:3}),
    B.normalize({id:'r0004',date:'2025-12-01',memo:'寒かった',items:[{cat:'goods',name:'ぴよりんトートバッグ',price:1500}],createdAt:4}),
  ]);
  assert.deepEqual(recs.map(r=>r.id),['r0003','r0002','r0001','r0004']);
  assert.equal(B.filter(recs,{period:'2026'}).length,3);
  assert.equal(B.filter(recs,{period:'2026-10',cat:'cookie'}).length,1);
  assert.equal(B.filter(recs,{cat:'fav'}).length,1);
  assert.deepEqual(B.filter(recs,{q:'アトリエ'}).map(r=>r.id),['r0002']);
  assert.deepEqual(B.filter(recs,{q:'寒かった'}).map(r=>r.id),['r0004']);
  const s=B.stats(B.filter(recs,{period:'2026'}));
  assert.equal(s.visits,3);assert.equal(s.piyorin,4);assert.equal(s.kinds.size,2);
  assert.equal(s.yen,580*2+450+2800+580);
  assert.equal(s.crowdAvg,3);
  assert.equal(s.top[0][0],'ハロウィンぴよりん');
  const r1=recs.find(r=>r.id==='r0001'),r3=recs.find(r=>r.id==='r0003');
  assert.equal(B.firstTime(recs,r1,r1.items[0]),true);
  assert.equal(B.firstTime(recs,r3,r3.items[0]),false);
});

test('ページに購入記録のタブ・画面・読み込みがある',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','docs/index.html'),'utf8');
  assert.match(html,/data-view="purchases"/);
  assert.match(html,/id="view-buy"/);
  assert.match(html,/id="buy-modal"/);
  assert.match(html,/id="set-buy"/);
  assert.match(html,/<script src="piyo-buy\.js\?v=6"><\/script>/);
  assert.match(html,/PiyoBuyUI\.mount\(/);
});

const images=JSON.parse(fs.readFileSync(path.join(__dirname,'..','docs/data/piyo-images.json'),'utf8'));
test('画像：定番は図鑑、クッキー缶は公式リリース',()=>{
  const im=n=>B.imageFor({cat:'piyorin',name:n},'2026-11-04',images);
  assert.equal(im('定番ぴよりん').from,'zukan');
  assert.match(im('定番ぴよりん').full,/^https:\/\/piyorin\.com\/wp\/wp-content\/uploads\//);
  assert.equal(im('いちごぴよりん').from,'zukan');                    // 図鑑は「イチゴぴよりん」
  assert.equal(im('星空ぴよりん').from,'zukan');                      // かっこの中は無くても当たる
  assert.equal(B.imageFor({cat:'piyorin',name:'ハロウィンぴよりん'},'2024-10-20',images).full,
    images.zukan.find(z=>z.name==='ハロウィン ぴよりん2024').img);   // 買った年の物
  const c=B.imageFor({cat:'cookie',name:'ひよりの手作りクッキー缶（ハロウィンver.）',lid:'auto-officialp5599'},'2026-10-25',images);
  assert.equal(c.from,'release');
  assert.match(c.src,/^https:\/\/prcdn\.freetls\.fastly\.net\/release_image\/.+\?width=360/);
  assert.equal(B.imageFor({cat:'cookie',name:'ひよりの手作りクッキー缶（お正月限定）'},'2026-01-02',images).from,'release'); // 名前で当たる
  assert.equal(B.imageFor({cat:'goods',name:'ぴよりんトートバッグ'},'2026-11-04',images),null);
  assert.equal(B.imageFor({cat:'piyorin',name:'定番ぴよりん'},'2026-11-04',null),null);
});

test('画像：公式リリースがあればリリースの絵、無い物だけ図鑑の絵（記録には画像を入れない）',()=>{
  const rec=B.normalize({date:'2026-11-05',items:[{cat:'piyorin',name:'ぴよりんゴジラ',lid:'auto-officialp5633',limited:'ぴよりんゴジラ'}]});
  const before={zukanSource:'https://piyorin.com/detail/',zukan:images.zukan.filter(z=>!/ゴジラ/.test(z.name)),releases:images.releases};
  assert.equal(B.imageFor(rec.items[0],rec.date,before).from,'release');
  const after=Object.assign({},before,{zukan:[{id:'z9999',name:'ぴよりんゴジラ',date:'2026年11月',img:'https://piyorin.com/wp/wp-content/uploads/2026/11/godzilla.png',thumb:'https://piyorin.com/wp/wp-content/uploads/2026/11/godzilla-300x300.png',tags:[]},...before.zukan]});
  assert.equal(B.imageFor(rec.items[0],rec.date,after).from,'release'); // 図鑑に載っても、リリースの絵のまま
  const noRel=Object.assign({},after,{releases:{}});
  assert.equal(B.imageFor(rec.items[0],rec.date,noRel).src,'https://piyorin.com/wp/wp-content/uploads/2026/11/godzilla-300x300.png'); // リリースが無ければ図鑑
  assert.ok(!('img' in rec.items[0]));
  assert.equal(rec.items[0].lid,'auto-officialp5633');
  assert.equal(B.imageFor({cat:'piyorin',name:'x'},'2026-11-05',{zukan:[{name:'x',img:'https://evil.example/x.png'}]}),null); // 公式以外の住所は使わない
});

test('過去の記録の候補：図鑑の限定とクッキー缶のリリース',()=>{
  const z=B.archiveItems(images,'piyorin','2024');
  assert.ok(z.length>5&&z.every(x=>/2024/.test(x.name)));
  assert.ok(!B.archiveItems(images,'piyorin','').some(x=>x.name==='ぴよりん')); // 通年商品は出さない
  const c=B.archiveItems(images,'cookie','');
  assert.ok(c.some(x=>x.name==='ひよりの手作りクッキー缶（お正月限定）'));
});

test('商品ごとの評価（5 段階）とメモ',()=>{
  const r=B.normalize({date:'2026-11-03',memo:'この日のメモ',items:[
    {cat:'piyorin',name:'ぴよりんゴジラ',rating:5,note:'  顔がかっこいい  '},
    {cat:'piyorin',name:'定番ぴよりん',rating:'4'},
    {cat:'cookie',name:'ひよりの手作りクッキー缶',rating:9,note:'x'.repeat(600)}]});
  assert.equal(r.items[0].rating,5);assert.equal(r.items[0].note,'顔がかっこいい');
  assert.equal(r.items[1].rating,4);assert.equal(r.items[1].note,'');
  assert.equal(r.items[2].rating,null);assert.equal(r.items[2].note.length,500);
  assert.equal(r.memo,'この日のメモ');
  const r2=B.normalize({date:'2026-11-05',items:[{cat:'piyorin',name:'ぴよりんゴジラ',rating:3}]});
  const s=B.stats([r,r2]);
  assert.equal(s.rateAvg,4);                       // (5+4+3)/3
  assert.deepEqual(plain(s.best[0]),['ぴよりんゴジラ',4,2]);
  assert.deepEqual(plain(s.best[1]),['定番ぴよりん',4,1]);
  assert.deepEqual(B.filter([r,r2],{q:'かっこいい'}).map(x=>x.date),['2026-11-03']); // 品のメモでも探せる
  assert.equal(B.RATE[5],'最高！');
  assert.deepEqual(plain(B.parseStore(B.dumpStore([r]))[0].items[0]),plain(r.items[0]));
});

test('記録の画面：開いている間は裏のページを止め、閉じる前に入力を終わらせる（スクロールでぴよがずれない）',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','docs/piyo-buy.js'),'utf8');
  const open=src.slice(src.indexOf('function openForm'),src.indexOf('function closeForm'));
  const close=src.slice(src.indexOf('function closeForm'),src.indexOf('const chip='));
  assert.match(open,/lockPage\(\)/);
  assert.match(src,/position:'fixed',top:-lockY\+'px'/);
  assert.ok(close.indexOf('.blur()')>=0&&close.indexOf('.blur()')<close.indexOf("$('buy-modal').hidden=true"),'隠す前に blur する');
  assert.match(close,/unlockPage\(\)/);
});

test('画像：2026 年のハロウィンぴよりんに、図鑑の去年（2025）の絵を出さない',()=>{
  const z25=images.zukan.find(z=>z.name==='ハロウィンぴよりん').img;
  const a=B.imageFor({cat:'piyorin',name:'ハロウィンぴよりん'},'2026-10-25',images);
  assert.notEqual(a.full,z25);
  assert.equal(a.from,'release');                                    // 公式リリースの 2026 年の絵
  assert.equal(a.full,images.releases['auto-officialp5620'].img);
  const b=B.imageFor({cat:'piyorin',name:'ハロウィンぴよりん',lid:'auto-officialp5620'},'2026-10-25',images);
  assert.equal(b.full,images.releases['auto-officialp5620'].img);   // 限定の選択肢から選んだときも同じ
  assert.equal(B.imageFor({cat:'piyorin',name:'ハロウィンぴよりん'},'2025-10-25',images).full,z25); // 2025 年に買った物は 2025 年の絵
  // 図鑑に 2026 年の物が載っても、2026 年はリリースの絵。2025 年に買った物は 2025 年の図鑑の絵のまま（2026 年のリリースは使わない）
  const after=Object.assign({},images,{zukan:[{id:'z9998',name:'ハロウィンぴよりん',date:'2026年10月',img:'https://piyorin.com/wp/wp-content/uploads/2026/10/h26.png',tags:['ハロウィン']},...images.zukan]});
  assert.equal(B.imageFor({cat:'piyorin',name:'ハロウィンぴよりん'},'2026-10-25',after).full,images.releases['auto-officialp5620'].img);
  assert.equal(B.imageFor({cat:'piyorin',name:'ハロウィンぴよりん'},'2025-10-25',after).full,z25);
  assert.equal(B.imageFor({cat:'piyorin',name:'定番ぴよりん'},'2030-01-01',images).from,'zukan'); // 通年商品はいつでも
});

test('店から販売の回を出す：選んだ店・自由に書いた店名から探し、時刻は 09:00 の形',()=>{
  assert.deepEqual(plain(B.shopOf('ぴよりんshop（名古屋駅）').slots),['9:00','12:00','15:00','18:00']);
  assert.deepEqual(plain(B.shopOf('ぴよりんshop アトリエ店（勝川）').slots),['13:00']);
  assert.equal(B.shopOf('アトリエ店').short,'アトリエ店');          // 「ぴよりんshop」より長い名前を先に見る
  assert.equal(B.shopOf('名古屋駅のぴよりんshop').short,'ぴよりんshop');
  assert.equal(B.shopOf('アスティ静岡'),null);
  assert.equal(B.shopOf(''),null);
  assert.equal(B.slotTime('9:00'),'09:00');
  assert.equal(B.slotTime('13:00'),'13:00');
});
