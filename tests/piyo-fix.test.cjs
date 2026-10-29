// 「ちがうよ」：答えのまちがいを知らせる → どこがちがうか聞く → 記録・まちがいの札を出さない・記憶に印 → 確かめ直す（Mac はそのまま、API は料金の前に聞く）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const html=read('docs/index.html');
const part=(from,to)=>{const i=html.indexOf(from);assert.ok(i>=0,from);const j=html.indexOf(to,i);assert.ok(j>i,to);return html.slice(i,j)};
const xctx={window:{},TextEncoder,TextDecoder,setTimeout,clearTimeout};
vm.runInNewContext(read('docs/piyo-extras.js'),xctx);
const X=xctx.window.PiyoExtras;
const TOKEN='abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEFG',URL0='https://mac-studio.tail8a9ae7.ts.net';
const ev=(event,data)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
function stream(chunks){
  let i=0;const enc=new TextEncoder();
  return {ok:true,status:200,headers:{get:()=>'text/event-stream; charset=utf-8'},body:{getReader(){return{
    read:async()=>i<chunks.length?{value:enc.encode(chunks[i++]),done:false}:{value:undefined,done:true},cancel(){return Promise.resolve()}}}}};
}
const health=()=>({ok:true,status:200,json:async()=>({ok:true,v:1,name:'Mac-Studio',login:true,busy:false})});

function setup({mac=null,apiKey='',answers=['ゴジラとのコラボの紅茶セットだぴよ。'],chips=['ゴジラコラボセットについて','山口へのおでかけについて']}={}){
  const msgs=[],users=[],sent=[],relayed=[],store={};
  const chipEls=chips.map(t=>({textContent:t,remove(){const i=suggest.children.indexOf(this);if(i>=0)suggest.children.splice(i,1)}}));
  const suggest={children:chipEls,hidden:false};
  const reportsEl={hidden:true,innerHTML:'',addEventListener(){},querySelector:()=>null};
  let n=0;
  const c={PiyoExtras:X,data:{events:[],basics:null,koyomi:null,weather:[],news:[],memo:{},greeting:null},apiKey,mac,routeMode:'mac-first',pendingQ:'',refMap:{},
    $:id=>id==='piyo-reports'?reportsEl:{},todayStr:()=>'2026-10-29',nextDay:s=>s,Math,OMIKUJI:'piyo-omikuji',AbortController,setTimeout,clearTimeout,Date,
    localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
    esc:s=>String(s),fmt:s=>s,piyoTone:s=>s,userMsg:t=>users.push(t),loop(){},idle(){},play(){},sync(){},chatting:false,BAD_SUGGEST:'piyo-bad-suggest',
    input:{placeholder:'ぴよに聞く'},suggest,
    badSuggest(){try{return new Set(JSON.parse(store['piyo-bad-suggest']||'[]'))}catch(_){return new Set()}},
    consumeSuggest(q){const el=suggest.children.find(b=>b.textContent===q);if(!el)return;el.remove();return q},
    piyoMsg:()=>{const m={id:n++,said:[],choices:null,fixInfo:null,el:{isConnected:true},
      say(t,done){this.said.push(t);done?.(m)},choices(list){this.choices=list;return{remove(){m.choices=null}}},links(){},fix(info){this.fixInfo=info}};msgs.push(m);return m},
    openKey(){},saveMac(){},NEED_MORE:{},SYSTEM_MAC:'MAC 用の指示',knowledge:()=>'<knowledge/>',
    textOf:r=>(r.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim(),errText:()=>'エラーだぴよ。',
    callClaude:async b=>{sent.push(b);return{content:[{type:'text',text:'API で確かめたぴよ。'}]}},pickArticles:async()=>[],pickedNews:[],
    fetch:async(url,opts={})=>{if(url.endsWith('/health'))return health();relayed.push(JSON.parse(opts.body));const t=answers[Math.min(relayed.length-1,answers.length-1)];
      return stream([ev('text',{text:t}),ev('done',{text:t,stop:'end'})])}};
  vm.createContext(c);
  vm.runInContext('let history=[];'+part('  let busy=false,pendingChip=null;','  const sync=()=>')+part('  function omikujiSeed(','  // ---- API キー')
    +part('  // ---- ちがうよ','  // ---- キーボードが出たら')
    +';this.api={ask,startFix,submitFix,get history(){return history},get busy(){return busy},get fixPending(){return fixPending},loadReports,reportsText,paintReports};',c);
  return {c,api:c.api,msgs,users,sent,relayed,store,suggest,reportsEl,last:()=>msgs.at(-1)};
}
const LINK={url:URL0,token:TOKEN,name:''};
const settle=()=>new Promise(r=>setTimeout(r,0));

test('答えの吹き出しに「ちがうよ」を付ける（質問・答え・候補から聞いたか・どちらで答えたかを覚える）',async()=>{
  const h=setup({mac:LINK});
  await h.api.ask('ゴジラコラボセットについて');
  const answer=h.msgs.find(m=>m.fixInfo);
  assert.deepEqual(plain(answer.fixInfo),{src:'mac',q:'ゴジラコラボセットについて',a:'ゴジラとのコラボの紅茶セットだぴよ。',chip:'ゴジラコラボセットについて'});
  assert.ok(h.msgs.filter(m=>m.fixInfo).length===1); // 「考え中だぴよ…」には付けない
});

test('「質問がまちがい」：記録し、その札は出さず、記憶に印を付けて Mac で確かめ直す',async()=>{
  const h=setup({mac:LINK,answers:['ゴジラとのコラボの紅茶セットだぴよ。','ごめんぴよ。紅茶ぴよりんのセットはゴジラとのコラボじゃなかったぴよ。']});
  await h.api.ask('ゴジラコラボセットについて');
  const answer=h.msgs.find(m=>m.fixInfo),btn={disabled:false,textContent:'ちがうよ'};
  h.api.startFix(answer.fixInfo,btn);
  assert.equal(btn.disabled,true);assert.ok(h.api.fixPending);
  assert.equal(h.c.input.placeholder,'どこがちがうか書いてもいいぴよ（なくてもOK）');
  const ask=h.last();
  assert.deepEqual(plain(ask.choices.map(c=>c[0])),['答えがまちがい','質問がまちがい','情報が古い']);
  ask.choices[1][1]();await settle();await settle();
  assert.equal(h.api.fixPending,null);assert.equal(h.c.input.placeholder,'ぴよに聞く');
  // 記録
  const [r]=h.api.loadReports();
  assert.equal(r.kind,'質問がまちがい');assert.equal(r.src,'Mac の Claude');assert.equal(r.q,'ゴジラコラボセットについて');
  assert.equal(r.a,'ゴジラとのコラボの紅茶セットだぴよ。');assert.match(r.at,/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.ok(!h.reportsEl.hidden);assert.match(h.reportsEl.innerHTML,/ぴよへの指摘：1件/);
  // 札はこの端末では出さない
  assert.deepEqual(JSON.parse(h.store['piyo-bad-suggest']),['ゴジラコラボセットについて']);
  assert.ok(!h.suggest.children.some(b=>b.textContent==='ゴジラコラボセットについて'));
  // Mac で確かめ直す（料金がかからないので聞かずに）。指摘・もとの質問・さっきの答えを渡す
  assert.equal(h.relayed.length,2);
  const q=h.relayed[1].question;
  for(const w of ['【ぴよへの指摘】','質問の前提','もとの質問：「ゴジラコラボセットについて」','さっきの答え：「ゴジラとのコラボの紅茶セットだぴよ。」','元の記事'])assert.ok(q.includes(w),w);
  assert.equal(h.relayed[1].history[1].content,'（この答えは「質問がまちがい」と言われた）\nゴジラとのコラボの紅茶セットだぴよ。');
  assert.ok(h.msgs.some(m=>m.said.includes('ごめんぴよ。確かめ直すぴよ。')));
  // 確かめ直した答えにも「ちがうよ」（もとの質問で記録する）
  const again=h.msgs.filter(m=>m.fixInfo).at(-1);
  assert.equal(again.fixInfo.a,'ごめんぴよ。紅茶ぴよりんのセットはゴジラとのコラボじゃなかったぴよ。');assert.equal(again.fixInfo.q,'ゴジラコラボセットについて');
  assert.equal(h.api.busy,false);
});

test('書いて送ったら、ひとことつきの「答えがまちがい」として記録する（札は消す）',async()=>{
  const h=setup({mac:LINK});
  await h.api.ask('山口へのおでかけについて');
  const answer=h.msgs.find(m=>m.fixInfo);
  h.api.startFix(answer.fixInfo,{});const ask=h.last();
  h.api.submitFix('','11時じゃなくて10時だよ',false);await settle();await settle();
  assert.equal(ask.choices,null);
  assert.deepEqual(h.users.slice(-1),['11時じゃなくて10時だよ']);
  const [r]=h.api.loadReports();
  assert.equal(r.kind,'答えがまちがい');assert.equal(r.comment,'11時じゃなくて10時だよ');
  assert.equal(h.store['piyo-bad-suggest'],undefined); // 札を出さなくするのは「質問がまちがい」のときだけ
  assert.ok(h.relayed.at(-1).question.includes('ひとこと：「11時じゃなくて10時だよ」'));
  assert.match(h.api.reportsText(),/ぴよへの指摘（ぴよりんニュース）1件\n\n1\. .*・答えがまちがい（Mac の Claude）\n質問：山口へのおでかけについて\n答え：.*\nひとこと：11時じゃなくて10時だよ/);
});

test('API で答えたときは、料金がかかる前に聞いてから Web で確かめ直す。準備がなければ記録だけ',async()=>{
  const h=setup({apiKey:'sk-ant-test'});
  await h.api.ask('ゴジラコラボセットについて');
  const answer=h.msgs.find(m=>m.fixInfo);assert.equal(answer.fixInfo.src,'api');
  h.api.startFix(answer.fixInfo,{});h.last().choices[0][1]();await settle();
  assert.equal(h.sent.length,1); // まだ送らない
  const confirm=h.last();assert.deepEqual(plain(confirm.choices.map(c=>c[0])),['確かめ直す','やめておく']);
  confirm.choices[0][1]();await settle();await settle();
  assert.equal(h.sent.length,2);
  assert.equal(h.sent[1].tools[0].type,'web_search_20250305');
  assert.ok(h.sent[1].messages.at(-1).content.startsWith('【ぴよへの指摘】さっきの答えは「答えがまちがっている」と言われた。'));
  // 準備がない（その場の答えだけ）ときは記録だけ
  const h2=setup();
  h2.api.startFix({src:'greeting',q:'',a:'・**ゴジラコラボ紅茶セット**11月7日・8日に山陽百貨店で発売だぴよ'},{});
  assert.deepEqual(plain(h2.last().choices.map(c=>c[0])),['まとめがまちがい','情報が古い']); // あいさつには「質問がまちがい」は出さない
  h2.last().choices[0][1]();
  assert.match(h2.last().said[0],/記録しておいたぴよ/);
  const [r]=h2.api.loadReports();assert.equal(r.src,'あいさつ');assert.equal(r.a,'・ゴジラコラボ紅茶セット11月7日・8日に山陽百貨店で発売だぴよ');
});

test('候補を押したら「どこがちがう？」をやめて普通の質問にする。答えている間は「ちがうよ」を受け付けない',async()=>{
  const h=setup({mac:LINK});
  await h.api.ask('ゴジラコラボセットについて');
  const info=h.msgs.find(m=>m.fixInfo).fixInfo;
  h.api.startFix(info,{});assert.ok(h.api.fixPending);
  await h.api.ask('山口へのおでかけについて');
  assert.equal(h.api.fixPending,null);assert.equal(h.c.input.placeholder,'ぴよに聞く');assert.equal(h.api.loadReports().length,0);
  vm.runInContext('busy=true',h.c);const btn={disabled:false};h.api.startFix(info,btn);assert.equal(btn.disabled,false);
});

test('候補：「質問がまちがい」の札は、あいさつの候補にも補充にも出さない',()=>{
  const store={'piyo-bad-suggest':JSON.stringify(['ゴジラコラボセットについて'])},buttons=[];
  const suggest={children:buttons,set innerHTML(v){buttons.length=0},appendChild:b=>buttons.push(b),hidden:false,style:{}};
  const ctx={suggest,localStorage:{getItem:k=>store[k]??null},data:null,busy:false,ask(){},
    document:{createElement(){return {remove(){const i=buttons.indexOf(this);if(i>=0)buttons.splice(i,1)},addEventListener(){}}}}};
  vm.createContext(ctx);
  vm.runInContext('let pendingChip=null;'+part('  function suggestLabel(','  async function open(){')+';this.api={fillSuggest,consumeSuggest};',ctx);
  ctx.api.fillSuggest(['ぴよりんゴジラについて','ゴジラコラボセットについて','紅茶ぴよりんセットについて']);
  assert.deepEqual(buttons.map(b=>b.textContent),['ぴよりんゴジラについて','紅茶ぴよりんセットについて']);
  assert.equal(ctx.api.consumeSuggest('ぴよりんゴジラについて'),'ぴよりんゴジラについて');
  assert.equal(ctx.api.consumeSuggest('自分で書いた質問'),undefined);
});

test('あいさつにも「ちがうよ」を付ける（出典と同じく、言い終わってから）',()=>{
  assert.match(html,/piyoMsg\(true\)\.say\(lines\.map\(line=>fmt\(piyoTone\(line\)\)\)\.join\('\\n'\),m=>\{if\(m&&m\.fix\)m\.fix\(\{src:'greeting'/);
  assert.match(html,/<div class="run-meta piyo-reports" id="piyo-reports" hidden><\/div>/);
});
