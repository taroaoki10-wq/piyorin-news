// infobase の為替の質問の受け付け：いまの値を聞く短い質問だけ通し、予想・理由・他の通貨・換算は従来の答え方に任せる
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/infobase.js'),'utf8');
const fxAsk=new Function(src.match(/function fxAsk\(q\)\{[^\n]*\}/)[0]+';return fxAsk')();
test('いまの値を聞く質問は通す',()=>{for(const q of ['ドル円','ドル円は？','為替は？','今日のドル円は？','現在のドル円は？','ドル円の為替レート','1ドルは何円？','いまの為替を教えて','円相場を教えて'])assert.equal(fxAsk(q),true,q);});
test('予想・理由・他の通貨・換算・ニュースは通さない',()=>{for(const q of ['明日のドル円','ドル円の予想は','ユーロ円は？','ドル円のニュース','100ドルを円に換算','為替の仕組みを教えて','なぜ円安なの？ドル円','ドル円の推移を教えて'])assert.equal(fxAsk(q),false,q);});
