// infobase の為替の質問の受け付け：いまの値を聞く短い質問だけ通し、予想・理由・他の通貨・換算は従来の答え方に任せる
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/infobase.js'),'utf8');
const fxAsk=new Function(src.match(/function fxAsk\(q\)\{[^\n]*\}/)[0]+';return fxAsk')();
test('いまの値を聞く質問は通す',()=>{for(const q of ['ドル円','ドル円は？','為替は？','今日のドル円は？','現在のドル円は？','ドル円の為替レート','1ドルは何円？','いまの為替を教えて','円相場を教えて'])assert.equal(fxAsk(q),true,q);});
test('予想・理由・他の通貨・換算・ニュースは通さない',()=>{for(const q of ['明日のドル円','ドル円の予想は','ユーロ円は？','ドル円のニュース','100ドルを円に換算','為替の仕組みを教えて','なぜ円安なの？ドル円','ドル円の推移を教えて'])assert.equal(fxAsk(q),false,q);});
test('答えは本文と出典の行に分けて返す（出典は別の小さな行で出すため）',async()=>{
  globalThis.document={readyState:'complete',getElementById:()=>null};
  globalThis.localStorage={_d:{'piyo-infobase':JSON.stringify({url:'https://pool.example',key:'k',enabled:true})},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=v}};
  const load=f=>(0,eval)(fs.readFileSync(path.join(__dirname,'../docs/'+f),'utf8'));load('infobase-client.js');load('infobase-guard.js');load('infobase.js');
  const card={id:'006-00000001-000',category:'006',type:'メイン',status:'確定',verdict:'確認済み',source:'ecb-rates',origin:'欧州中央銀行 参照レート',title:'ECB',url:'https://www.ecb.europa.eu/x',expires_at:new Date(Date.now()+3600e3).toISOString(),published_at:new Date().toISOString(),fetched_at:new Date().toISOString(),attribution:'欧州中央銀行（ECB）',structured:{base:'EUR',rates:{USD:1.1172,JPY:175.68},usd_jpy_derived:157.2503,as_of:'2026-10-30'}};
  const f=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({cards:[card]}));
  try{const r=await globalThis.PiyoInfobase.answer('今日のドル円は？');
    assert.ok(r&&r.body&&r.source);assert.ok(!r.body.includes('出典'));assert.ok(r.source.startsWith('出典：'));assert.equal(r.text,r.body+'\n'+r.source);}
  finally{globalThis.fetch=f;}
});
