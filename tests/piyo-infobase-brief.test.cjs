// infobase のぴよ札で、天気・警報・地震・ドル円にすぐ答える所（2026-11-04）。本物の infobase にはつながない。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const later=new Date(Date.now()+3600000).toISOString(),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const bundle={built_day:today,etag:'e1',aliases:{'weather:岐阜市:明日':'weather:岐阜市:X'},
 index:{weather:{words:['天気','雨'],areas:[{area:'岐阜市',words:['岐阜']},{area:'名古屋市',words:['名古屋']}],default_area:'名古屋市',days:{今日:['今日'],明日:['明日','あした']},now_words:[]},warning:{words:['警報','注意報'],prefs:[{pref:'愛知県',words:['愛知']}],default_pref:'愛知県'},quake:{words:['地震']},fx:{usd_words:['ドル円','為替'],eur_words:['ユーロ']},holiday:{words:['祝日']},date:{words:[]},piyorin:{words:['ぴよりん']},calendar:{words:[]},news:{generic_words:['ニュース'],default:'news:003',categories:[]}},
 briefs:[
  {id:'weather:岐阜市:X',topic:'weather',title:'岐阜市の天気',status:'あり',say:'明日（11月5日・木）の岐阜市は晴れのち雨。最高21.1℃、最低13℃、雨の確率は最大100%。',facts:{date:'2026-11-05',high:21.1,low:13,pop_max:100},as_of:'2026-11-04T10:00:00+09:00',fresh_until:later,sources:[{id:'002-00000010-000',origin:'Open-Meteo 岐阜',attribution:'Weather data by Open-Meteo.com (CC BY 4.0)',url:'https://open-meteo.com/'}]},
  {id:'warning:愛知県',topic:'warning',title:'愛知県の警報・注意報',status:'古い',say:'気象庁の愛知県の警報・注意報は5月28日の発表から新しくなっていないため、今の様子は確かめられません。',facts:{warnings:[]},as_of:'2026-05-28T09:41:00+09:00',fresh_until:later,sources:[{id:'005-00000001-000',origin:'気象庁',url:'https://www.jma.go.jp/'}]},
  {id:'quake:latest',topic:'quake',title:'最近の地震',status:'まだ無い',say:null,sources:[]},
  {id:'fx:usd_jpy',topic:'fx',title:'米ドル円',status:'あり',say:'欧州中央銀行の参照値（11月2日・月）で、1米ドルはおよそ157.90円です。今の取引の値ではありません。',facts:{rate:157.9},as_of:'2026-11-02T23:59:00+09:00',fresh_until:later,sources:[{id:'006-00000196-000',origin:'欧州中央銀行 参照レート',url:'https://www.ecb.europa.eu/'}]},
 ]};
function setup(){
 globalThis.document={readyState:'complete',getElementById:()=>null};
 globalThis.localStorage={_d:{'piyo-infobase':JSON.stringify({url:'https://pool.example',key:'k',enabled:true})},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=v}};
 const load=f=>(0,eval)(fs.readFileSync(path.join(__dirname,'../docs/'+f),'utf8'));load('infobase-client.js');load('infobase-guard.js');load('infobase-brief.js');load('infobase.js');
}
test('岐阜の天気・ドル円・古い警報を、札から語尾ぴよで答え、出典は別の行',async()=>{
 setup();const urls=[];const f=globalThis.fetch;globalThis.fetch=async url=>{urls.push(String(url));return new Response(JSON.stringify(String(url).includes('/v1/brief')?bundle:{cards:[]}));};
 try{
  const w=await globalThis.PiyoInfobase.answer('岐阜の明日の天気は？');
  assert.equal(w.body,'明日（11月5日・木）の岐阜市は晴れのち雨。最高21.1℃、最低13℃、雨の確率は最大100%ぴよ。');assert.ok(w.source.startsWith('出典：Weather data by Open-Meteo.com'));assert.equal(w.brief,'weather:岐阜市:X');
  const fx=await globalThis.PiyoInfobase.answer('ドル円は？');assert.match(fx.body,/157\.90円だぴよ。今の取引の値ではないぴよ。$/);
  const warn=await globalThis.PiyoInfobase.answer('愛知に警報出てる？');assert.match(warn.body,/確かめられないぴよ。$/);
  // 問いの文は送らない（札をまとめて読むだけ）。
  assert.ok(urls.every(u=>!u.includes(encodeURIComponent('岐阜'))&&!u.includes('岐阜')));
  // 札が「まだ無い」・予想・ニュースは、前の答え方（または Claude）に任せる。
  assert.equal(await globalThis.PiyoInfobase.answer('地震あった？'),null);
  assert.equal(await globalThis.PiyoInfobase.answer('ドル円の予想は'),null);
 }finally{globalThis.fetch=f;}
});
