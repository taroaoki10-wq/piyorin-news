// 公式 X だけで知らされた新作（ミルクティーぴよりん）の名前と絵（2026-11-24）
const test=require('node:test');const assert=require('node:assert/strict');
const B=require('../docs/piyo-buy.js');
test('かっこが後ろに付いた題からも「販売」を外す',()=>{
  assert.equal(B.itemName('ミルクティーぴよりん 販売（アトリエ店限定）'),'ミルクティーぴよりん（アトリエ店限定）');
  assert.equal(B.itemName('ひよりの手作りクッキー缶（ハロウィンver.）販売'),'ひよりの手作りクッキー缶（ハロウィンver.）');
  assert.equal(B.itemName('Winter Break新商品 発売（village限定）'),'Winter Break新商品（village限定）');
  assert.equal(B.itemName('ぴよりんの日（11月）'),'ぴよりんの日（11月）');
  assert.equal(B.eventCat({title:'ミルクティーぴよりん 販売（アトリエ店限定）',kind:'release'}),'piyorin');
});
test('公式 X の写真を絵に使う（予定の id でも名前でも）',()=>{
  const img='https://pbs.twimg.com/media/HXX4e66bkAAkPYj.jpg';
  const images={zukan:[],releases:{
    e1:{cat:'piyorin',title:'ミルクティーぴよりん 販売（アトリエ店限定）',date:'2026-11-20',url:'https://x.com/piyorin_nagoya/status/2122887519435960587',img,from:'event'},
    n1:{cat:'piyorin',title:'限定「ミルクティーぴよりん」を販売♪',name:'ミルクティーぴよりん',date:'2026-11-18',url:'https://x.com/piyorin_nagoya/status/2122887519435960587',img,from:'x'},
    bad:{cat:'piyorin',title:'あやしいぴよりん',name:'あやしいぴよりん',date:'2026-11-18',img:'https://evil.example/a.jpg'}}};
  const byId=B.imageFor({name:'ミルクティーぴよりん（アトリエ店限定）',cat:'piyorin',lid:'e1'},'2026-11-24',images);
  assert.equal(byId.full,img);assert.equal(byId.src,img+'?name=small');
  const byName=B.imageFor({name:'ミルクティーぴよりん',cat:'piyorin'},'2026-11-24',images);
  assert.equal(byName.full,img);
  assert.equal(B.imageFor({name:'あやしいぴよりん',cat:'piyorin'},'2026-11-24',images),null);
});
