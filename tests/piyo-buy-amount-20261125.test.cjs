// 金額（合計）の自由入力と、前に入れた値段を覚える（2026-11-25 ユーザー「ミルクティーぴよりんの値段が入っていない。金額の自由入力も。1個の値段を入れたら個数に応じて自動計算」）
const test=require('node:test');const assert=require('node:assert/strict');
const B=require('../docs/piyo-buy.js');

test('1つの値段 × 数 で金額になる・金額だけの物はその金額',()=>{
  assert.equal(B.lineYen({qty:3,price:480}),1440);
  assert.equal(B.lineYen({qty:'2',price:'550'}),1100);
  assert.equal(B.lineYen({qty:3,price:'',amount:1000}),1000);
  assert.equal(B.lineYen({qty:1,price:''}),null);
  assert.equal(B.lineYen({qty:2,price:null,amount:null}),null);
});

test('金額を入れたら、割り切れれば 1 つの値段に直す（数を変えると自動で計算）',()=>{
  assert.deepEqual(B.fromAmount('1100',2),{price:550,amount:null});
  assert.deepEqual(B.fromAmount('1000',3),{price:'',amount:1000});
  assert.deepEqual(B.fromAmount('',3),{price:'',amount:null});
  assert.deepEqual(B.fromAmount('-5',1),{price:'',amount:null});
});

test('合計とかごは金額だけの物も数える',()=>{
  const items=[{name:'ミルクティーぴよりん',qty:3,price:'',amount:1000},{name:'定番ぴよりん',qty:2,price:450}];
  assert.equal(B.cartSum(items).yen,1900);
  assert.equal(B.cartSum(items).unknown,0);
  const r=B.normalize({date:'2026-11-24',items});
  assert.equal(r.items[0].amount,1000);assert.equal(r.items[0].price,null);
  assert.equal(r.items[1].amount,undefined); // 値段から出せる物には金額を持たせない
  assert.equal(B.total(r),1900);
});

test('前に入れた値段を覚えて、同じ物にまた入れる',()=>{
  const recs=[
    {date:'2026-11-20',updatedAt:1,items:[{name:'ミルクティーぴよりん（アトリエ店限定）',qty:1,price:520}]},
    {date:'2026-11-22',updatedAt:2,items:[{name:'ミルクティーぴよりん（アトリエ店限定）',qty:2,price:null}]},
    {date:'2026-11-23',updatedAt:3,items:[{name:'定番ぴよりん',qty:1,price:450}]},
    {date:'2026-11-23',updatedAt:4,items:[{name:'ナゾぴよりん',qty:3,price:null,amount:1500}]}];
  assert.deepEqual(B.lastPrice(recs,'ミルクティーぴよりん（アトリエ店限定）'),{price:520,date:'2026-11-20'});
  assert.deepEqual(B.lastPrice(recs,'ミルクティーぴよりん（アトリエ店限定）',{exceptId:'x'}),{price:520,date:'2026-11-20'});
  assert.deepEqual(B.lastPrice(recs,'ナゾぴよりん'),{price:500,date:'2026-11-23'}); // 金額 ÷ 数
  assert.equal(B.lastPrice(recs,'ないぴよりん'),null);
  assert.equal(B.lastPrice(recs,''),null);
});
