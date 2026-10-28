const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const part=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));
const esc="const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));";

test('返事のリンクはURLだけ。日本語の句読点・かっこ・文末の記号を含めない',()=>{
  const ctx={};vm.createContext(ctx);vm.runInContext(esc+part('  // 返事の文を表示用にする','  function userMsg(')+';this.fmt=fmt;',ctx);
  const a=u=>`<a href="${u}" target="_blank" rel="noopener">${u}</a>`;
  assert.equal(ctx.fmt('最新は https://piyorin.com/ で確かめてね'),`最新は ${a('https://piyorin.com/')} で確かめてね`);
  assert.equal(ctx.fmt('公式（https://piyorin.com/）だぴよ'),`公式（${a('https://piyorin.com/')}）だぴよ`);
  assert.equal(ctx.fmt('詳しくは https://piyorin.com/news/。'),`詳しくは ${a('https://piyorin.com/news/')}。`);
  assert.equal(ctx.fmt('See https://example.com/a.'),`See ${a('https://example.com/a')}.`);
  assert.equal(ctx.fmt('URL：https://example.com/?a=1&b=2、だぴよ'),`URL：<a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener">https://example.com/?a=1&amp;b=2</a>、だぴよ`);
  assert.equal(ctx.fmt('[公式サイト](https://piyorin.com/)で見てぴよ'),'<a href="https://piyorin.com/" target="_blank" rel="noopener">公式サイト</a>で見てぴよ');
  assert.equal(ctx.fmt('**10月29日**から。<b>'),'<b>10月29日</b>から。&lt;b&gt;');
  assert.equal(ctx.fmt('**https://piyorin.com/**'),`<b>${a('https://piyorin.com/')}</b>`);
});
test('Web検索が終わりきらない・長さで切れた答えには一言添える',()=>{
  const shown=[],c={piyoTone:s=>s,play(){},fmt:s=>s,sync(){}};vm.createContext(c);
  vm.runInContext('let history=[],busy=true;'+part('  // Web 検索が終わりきらなかった','  function fail(')+';this.finish=finish;this.cut=cut;',c);
  assert.equal(c.cut({stop_reason:'pause_turn'}),true);assert.equal(c.cut({stop_reason:'max_tokens'}),true);assert.equal(c.cut({stop_reason:'end_turn'}),false);
  c.finish({say:s=>shown.push(s)},'質問','途中までの答えだぴよ。',true);
  assert.equal(shown[0],'途中までの答えだぴよ。\n（調べきれなかったので、ここまでの答えだぴよ）');
  c.finish({say:s=>shown.push(s)},'質問','',true);assert.match(shown[1],/調べきれなかったぴよ/);
});
test('APIキーが使えない(401)ときだけキーを入れ直し、権限の不足(403)では消さない',()=>{
  const c={};vm.createContext(c);vm.runInContext(part('  function errText(','  // 記事の本文を読むとき')+';this.errText=errText;',c);
  assert.equal(c.errText({status:401}),null);
  assert.match(c.errText({status:403}),/403/);
});
test('「調べる」で読む記事：共通の言葉で選ばず、新しい記事を優先し、同じ見出しは1つ、PR TIMES の本文も読む',async()=>{
  const day=n=>new Date(Date.now()-n*86400e3).toISOString().slice(0,10);
  const filler=Array.from({length:30},(_,i)=>({id:'f'+i,cat:'press',date:day(5),title:'ぴよりんの新商品のお知らせ'+i,url:'https://example.com/f'+i}));
  const news=[
    {id:'hyogo',cat:'press',date:day(6),title:'ぴよりんが兵庫におでかけ！紅茶ぴよりんを販売',url:'https://example.com/hyogo'},
    {id:'xmas2025',cat:'press',date:day(370),title:'ぴよりん2025年のクリスマスケーキの予約',url:'https://example.com/old'},
    {id:'xmas',cat:'official',date:day(7),title:'ぴよりんのクリスマスケーキの予約',url:'https://piyorin.com/news/p1/',
      related:[{source:'PR TIMES',url:'https://prtimes.jp/main/html/rd/p/000000001.000124425.html'},{source:'媒体',url:'https://example.com/m'}]},
    {id:'xmas-copy',cat:'media',date:day(7),title:'ぴよりんのクリスマスケーキの予約',url:'https://example.com/copy'},
    ...filler];
  const read=[];
  const c={data:{news,memo:{}},crypto:globalThis.crypto,TextEncoder,
    fetch:async url=>{read.push(url);return{ok:true,json:async()=>({blocks:[{t:'p',x:'本文'+read.length}]})}}};
  vm.createContext(c);vm.runInContext(part('  // 記事の本文を読むとき','  let busy=false')+';this.pickArticles=pickArticles;',c);
  const out=await c.pickArticles('クリスマスケーキの予約方法は？');
  assert.equal(out.length,2);
  assert.match(out[0],/url="https:\/\/piyorin.com\/news\/p1\/"/);assert.match(out[1],/url="https:\/\/example.com\/old"/);
  assert.equal(read.length,3); // 公式＋PR TIMES、去年の記事
  assert.match(out[0],/本文1\n本文2/);
  assert.ok(!out.join('').includes('hyogo'));
});
