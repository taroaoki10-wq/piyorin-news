// 2026-11-22（版 -4）：ぴよのチャットに「写真で聞く」「マイクで聞く」「答えを読み上げる」を足す（docs/index.html の画面側）
//  A. 写真：縮める・見出し絵・API だけで答える（Mac の Claude は写真を受け取れない）・送る前の確かめ・履歴と記録に写真の中身を入れない
//  B. マイク：聞き取りを入力欄へ（自動では送らない）  C. 読み上げ（既定は切）  D. 設定の 3 行  E. 見た目の決まり
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const html=read('docs/index.html');
const part=(from,to)=>{const i=html.indexOf(from);assert.ok(i>=0,from);const j=html.indexOf(to,i);assert.ok(j>i,to);return html.slice(i,j)};
const mem=(init={})=>{const m=new Map(Object.entries(init));return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),has:k=>m.has(k)}};
const xctx={window:{},TextEncoder,TextDecoder,setTimeout,clearTimeout};
vm.runInNewContext(read('docs/piyo-extras.js'),xctx);
const X=xctx.window.PiyoExtras;

const B64='QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0MjQyNDI0Mg=='; // 写真の中身の代わり（これが履歴や記録に出てはいけない）
const THUMB='data:image/jpeg;base64,'+B64;
const PHOTO={data:B64,thumb:THUMB};
const LINK={url:'https://mac-studio.tail8a9ae7.ts.net',token:'abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEFG',name:''};

// ---- 画面の代わり（要素の入れ物）----
function fakeDom(){
  const els={};
  const mk=id=>{
    const e={id,hidden:false,value:'',disabled:false,checked:false,files:null,src:'',textContent:'',attrs:{},handlers:{},classes:new Set(),style:{},
      addEventListener(t,f){(e.handlers[t]=e.handlers[t]||[]).push(f)},
      setAttribute(k,v){e.attrs[k]=String(v)},getAttribute(k){return e.attrs[k]},removeAttribute(k){delete e.attrs[k]},
      classList:{toggle(c,on){const want=on===undefined?!e.classes.has(c):!!on;want?e.classes.add(c):e.classes.delete(c);return want},add(c){e.classes.add(c)},remove(c){e.classes.delete(c)},contains:c=>e.classes.has(c)},
      async fire(type,ev={}){for(const f of e.handlers[type]||[])await f({preventDefault(){},target:e,...ev})}};
    return e;
  };
  const $=id=>els[id]||(els[id]=mk(id));
  return{$,els};
}

// ---- 答えの流れ全体（ask〜finish〜submit〜写真・マイク・読み上げの部品）を、画面なしで動かす ----
const REGION=()=>'let history=[];'+part('  let busy=false,pendingChip=null;','  // ---- ちがうよ')+part('  function omikujiSeed(','  // ---- API キー');
function chat({apiKey='sk-ant-test',mac=null,routeMode='mac-first',flags={},speakOn=false,synth,SR,data,reply='写真の答えだぴよ。'}={}){
  const dom=fakeDom(),said=[],choices=[],sent=[],users=[],keeps=[],turns=[],ends=[],spoken=[],stops=[],fetched=[];
  const store=mem(speakOn?{'piyo-speak':'1'}:{});
  const piyos=[];
  const c={PiyoExtras:X,data:data||{events:[],basics:null,koyomi:null,weather:[],news:[],memo:{},greeting:null},apiKey,mac,routeMode,pendingQ:'',refMap:{},
    $:dom.$,input:dom.$('piyo-input'),localStorage:store,Math,OMIKUJI:'piyo-omikuji',AbortController,setTimeout,clearTimeout,
    todayStr:()=>'2026-11-22',nextDay:s=>s,esc:s=>String(s),fmt:s=>s,piyoTone:s=>s,
    userMsg(t,thumb){users.push({t,thumb});return{remove(){}}},
    loop(){},idle(){},play(){},consumeSuggest(){},
    piyoMsg:()=>{const m={said:[],say(text,done){said.push(text);m.said.push(text);done?.()},choices(list){choices.push(list);m.list=list},links(){},remove(){}};piyos.push(m);return m},
    openKey(msg){c.keyPrompt=msg||''},saveKey(k){c.apiKey=k},saveMac(v){c.mac=v||null},
    NEED_MORE:{name:'need_more'},SYSTEM_MAC:'MAC 用の指示',knowledge:()=>'<knowledge>知識</knowledge>',textOf:r=>(r.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim(),
    errText:e=>e.status===401?null:'API のエラーだぴよ。',
    callClaude:async b=>{sent.push(JSON.parse(JSON.stringify(b)));if(c.failWith)throw c.failWith;return{content:[{type:'text',text:reply}]}},
    fetch:async u=>{fetched.push(u);throw new TypeError('Mac は使わない')},freshWeather:()=>null,
    featOn:n=>flags[n]!==false,buyRecords:()=>[],
    keepTalk:items=>keeps.push(JSON.parse(JSON.stringify(items))),
    PiyoLog:{turn(q,meta,refs){turns.push({q,meta});return 'lt'+turns.length},end(lt,r){ends.push({lt,...JSON.parse(JSON.stringify(r))})},isOpen:()=>true,newConv(){}},
    SpeechRecognition:SR,
    submitFix(){},
    keys:{}};
  if(synth!==null){
    c.speechSynthesis=synth||{cancel(){stops.push('cancel')},speak(u){spoken.push({text:u.text,lang:u.lang,volume:u.volume,voice:u.voice})},getVoices:()=>[{lang:'en-US',name:'en'},{lang:'ja_JP',name:'ja'}]};
    c.SpeechSynthesisUtterance=class{constructor(t){this.text=t}};
  }
  vm.createContext(c);
  vm.runInContext(REGION()+';this.api={ask,askWithPhoto,get history(){return history},get busy(){return busy},get photoSel(){return photoSel},set photoSel(v){photoSel=v},get pendingQ(){return pendingQ},set busy(v){busy=v},get fixPending(){return fixPending},set fixPending(v){fixPending=v},finish,answerLocal};',c);
  return{c,dom,api:c.api,said,choices,sent,users,keeps,turns,ends,spoken,stops,fetched,piyos,store};
}
const dump=v=>JSON.stringify(v);

// ---- 1：道の判断（小さな純粋な関数）----
function pure(src){const c={};vm.createContext(c);vm.runInContext(src,c);return c}
test('photoPlan：キーが無ければ断る・Mac を使う設定なら送る前に聞く・「API だけ」と Mac なしは聞かずに送る',()=>{
  const c=pure(part('  function photoPlan(','  function askWithPhoto(')+';this.photoPlan=photoPlan;');
  const p=o=>c.photoPlan(o).act;
  // キーなし：Mac があっても断る（Mac の Claude は写真を受け取れない）
  assert.equal(p({apiKey:'',mac:LINK,routeMode:'mac-first'}),'needKey');
  assert.equal(p({apiKey:'',mac:LINK,routeMode:'mac'}),'needKey');
  assert.equal(p({apiKey:'',mac:null,routeMode:'mac-first'}),'needKey');
  assert.equal(p({apiKey:null,mac:null,routeMode:'api'}),'needKey');
  // キーあり：Mac を使う設定（Mac のつなぎ方があって、「API だけ」ではない）なら聞く
  assert.equal(p({apiKey:'k',mac:LINK,routeMode:'mac-first'}),'confirm');
  assert.equal(p({apiKey:'k',mac:LINK,routeMode:'mac'}),'confirm');
  // 「API だけ」・Mac のつなぎ方が無い：追加の料金の話はもう決まっているので聞かずに送る
  assert.equal(p({apiKey:'k',mac:LINK,routeMode:'api'}),'send');
  assert.equal(p({apiKey:'k',mac:null,routeMode:'mac-first'}),'send');
  assert.equal(p({apiKey:'k',mac:null,routeMode:'api'}),'send');
});

test('photoContent：画像（base64・image/jpeg）と質問の 2 つの塊。写真の中身は data にだけ入る',()=>{
  const c=pure(part('  function photoContent(','  function photoPlan(')+';this.f=photoContent;');
  assert.deepEqual(plain(c.f(PHOTO,'これは何？')),[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:B64}},{type:'text',text:'これは何？'}]);
});

// ---- 2：写真つきで送る ----
const Q='これは何のぴよりん？';
test('写真つき（Mac なし・キーあり）：聞かずに API へ。画像つきの 1 通・need_more なし・Mac は呼ばない。履歴・続き・記録に写真の中身は入らない',async()=>{
  const h=chat();let sentCalls=0;
  await h.api.askWithPhoto(Q,PHOTO,()=>sentCalls++);
  assert.equal(sentCalls,1);
  assert.equal(h.sent.length,1);
  const body=h.sent[0];
  assert.equal('tools' in body,false,'写真のときは need_more を付けない');
  const last=body.messages.at(-1);
  assert.equal(last.role,'user');
  assert.deepEqual(last.content,[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:B64}},{type:'text',text:Q}]);
  assert.equal(h.fetched.length,0);
  // 利用者の吹き出しは、見出し絵と文
  assert.deepEqual(h.users,[{t:Q,thumb:THUMB}]);
  // 履歴：文の後ろに「（写真つき）」を付けた文だけ
  assert.deepEqual(plain(h.api.history),[{role:'user',content:Q+'（写真つき）'},{role:'assistant',content:'写真の答えだぴよ。'}]);
  assert.deepEqual(h.keeps,[[{r:'u',t:Q+'（写真つき）'},{r:'p',t:'写真の答えだぴよ。'}]]);
  assert.equal(h.turns.length,1);assert.equal(h.turns[0].q,Q+'（写真つき）');
  for(const [name,v] of [['履歴',h.api.history],['続き',h.keeps],['記録の始まり',h.turns],['記録の終わり',h.ends]])assert.ok(!dump(v).includes(B64)&&!dump(v).includes('base64'),name+'に写真の中身が入った');
  assert.equal(h.api.busy,false);
});

test('写真つき：次の質問では、前の写真の中身を API へ送り直さない（履歴は文だけ）。写真なしの質問は今までと同じ形（tools と messages）',async()=>{
  const h=chat();
  await h.api.askWithPhoto(Q,PHOTO,()=>{});
  await h.api.ask('値段は？');
  const b=h.sent[1];
  assert.deepEqual(Object.keys(b),['tools','messages']);
  assert.ok(!dump(b).includes(B64));
  assert.deepEqual(b.messages.map(m=>typeof m.content),['string','string','string']);
  assert.equal(b.messages.at(-1).content,'値段は？');
  assert.deepEqual(b.tools,[{name:'need_more'}]);
});

test('写真つきは、その場の答え（天気・おみくじ・暦など）や infobase の札を使わず、必ず Claude へ',async()=>{
  const h=chat();
  h.c.PiyoInfobase={answer:async()=>{throw new Error('infobase を呼んだ')},guard:()=>null,hasWeatherProof:()=>false};
  h.c.localReply=()=>{throw new Error('その場の答えを使った')};
  await h.api.askWithPhoto('今日の天気は？',PHOTO,()=>{});
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].messages.at(-1).content[1].text,'今日の天気は？');
});

test('Mac を使う設定（mac-first）：送る前に「追加の料金がかかるけど、送る？」と聞く（金額は出さない）。［送る］で送る・［やめる］では何も送らず写真も残る',async()=>{
  const h=chat({mac:LINK,routeMode:'mac-first'});let sentCalls=0;
  await h.api.askWithPhoto(Q,PHOTO,()=>sentCalls++);
  assert.equal(h.sent.length,0);assert.equal(sentCalls,0);assert.equal(h.users.length,0);
  assert.deepEqual(h.said,['写真は Mac では見られないから、API で見るぴよ。追加の料金がかかるけど、送る？']);
  assert.ok(!/[0-9０-９円$]/.test(h.said[0]),'金額は出さない');
  assert.deepEqual(plain(h.choices[0].map(c=>c[0])),['送る','やめる']);
  assert.equal(h.api.busy,false);
  // やめる
  await h.choices[0][1][1]();
  assert.equal(h.sent.length,0);assert.equal(sentCalls,0);assert.equal(h.users.length,0);assert.equal(h.fetched.length,0);
  // 送る
  await h.choices[0][0][1]();
  assert.equal(sentCalls,1);assert.equal(h.sent.length,1);assert.deepEqual(h.users,[{t:Q,thumb:THUMB}]);
  assert.equal(h.sent[0].messages.at(-1).content[0].type,'image');
  assert.equal(h.fetched.length,0,'Mac へは送らない');
});

test('「API だけ」の設定なら、聞かずに送る',async()=>{
  const h=chat({mac:LINK,routeMode:'api'});let n=0;
  await h.api.askWithPhoto(Q,PHOTO,()=>n++);
  assert.equal(h.choices.length,0);assert.equal(n,1);assert.equal(h.sent.length,1);
});

test('API キーが無いとき：「写真を見るには API キーが要るぴよ。」と言うだけ。送らず、写真も入力も（送ったと知らせる関数を呼ばないので）残る',async()=>{
  for(const mac of [null,LINK]){
    const h=chat({apiKey:'',mac});let n=0;
    await h.api.askWithPhoto(Q,PHOTO,()=>n++);
    assert.deepEqual(h.said,['写真を見るには API キーが要るぴよ。']);
    assert.equal(n,0);assert.equal(h.sent.length,0);assert.equal(h.users.length,0);assert.equal(h.fetched.length,0);assert.equal(h.turns.length,0);
    assert.equal(h.api.busy,false);assert.equal(h.api.pendingQ,'','キーの窓を出して続きを写真なしで送り直さない');
  }
});

test('［送る］を押したとき別の質問に答え中なら、送らずにそう言う（二重に送らない）',async()=>{
  const h=chat({mac:LINK});let n=0;
  await h.api.askWithPhoto(Q,PHOTO,()=>n++);
  h.api.busy=true;
  await h.choices[0][0][1]();
  assert.equal(h.sent.length,0);assert.equal(n,0);assert.equal(h.said.at(-1),'いま答えてるぴよ。少し待ってね。');
});

test('API が 401（キーが使えない）：写真つきの文を写真なしで送り直さず、入力欄と写真を戻す',async()=>{
  const h=chat();const restored=[];
  h.c.restorePhoto=(text,photo)=>restored.push({text,photo});
  h.c.failWith=Object.assign(new Error('http'),{status:401});
  await h.api.askWithPhoto(Q,PHOTO,()=>{});
  assert.equal(h.api.pendingQ,'');
  assert.deepEqual(restored,[{text:Q,photo:PHOTO}]);
  assert.equal(h.apiKey??h.c.apiKey,'');
  assert.ok(typeof h.c.keyPrompt==='string');
  // 写真なしの 401 は今までどおり、続きから送り直す
  const g=chat();g.c.failWith=Object.assign(new Error('http'),{status:401});
  await g.api.ask('写真なしの質問');
  assert.equal(g.api.pendingQ,'写真なしの質問');
});

test('写真つきのとき、聞き返しの道具（need_more）の返事が来ても答えを出す（付けていないので来ない。来ても落ちない）',async()=>{
  const h=chat();h.c.callClaude=async b=>{h.sent.push(b);return{content:[{type:'tool_use',name:'need_more',input:{kind:'web',query:'x'}}],stop_reason:'tool_use'}};
  await assert.doesNotReject(()=>h.api.askWithPhoto(Q,PHOTO,()=>{}));
  assert.equal(h.api.busy,false);
});

// ---- 3：送るボタン（submit）と、写真・設定の出し入れ ----
test('送る：文が空で写真があれば「この写真について教えて」。送ったら入力欄と写真を外す。写真も文も無ければ何もしない',async()=>{
  const h=chat();const form=h.dom.$('piyo-form');
  h.dom.$('piyo-photo-prev');
  // 写真だけ
  h.api.photoSel=PHOTO;h.dom.$('piyo-input').value='';
  await form.fire('submit');
  await new Promise(r=>setTimeout(r,5));
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].messages.at(-1).content[1].text,'この写真について教えて');
  assert.equal(h.api.photoSel,null);assert.equal(h.dom.$('piyo-input').value,'');
  assert.equal(h.dom.$('piyo-photo-prev').hidden,true);
  // 何も無い
  await form.fire('submit');await new Promise(r=>setTimeout(r,5));
  assert.equal(h.sent.length,1);
});

test('送る：文と写真。キーが無ければ、入力欄の文も写真も残す',async()=>{
  const h=chat({apiKey:''});const form=h.dom.$('piyo-form');
  h.api.photoSel=PHOTO;h.dom.$('piyo-input').value=Q;
  await form.fire('submit');
  assert.equal(h.sent.length,0);assert.equal(h.dom.$('piyo-input').value,Q);assert.equal(h.api.photoSel,PHOTO);
  assert.deepEqual(h.said,['写真を見るには API キーが要るぴよ。']);
});

test('送る：確かめ［やめる］なら、入力欄の文も写真も残る。［送る］で外れる',async()=>{
  const h=chat({mac:LINK});const form=h.dom.$('piyo-form');
  h.api.photoSel=PHOTO;h.dom.$('piyo-input').value=Q;
  await form.fire('submit');
  assert.equal(h.dom.$('piyo-input').value,Q);assert.equal(h.api.photoSel,PHOTO);
  await h.choices[0][1][1]();
  assert.equal(h.dom.$('piyo-input').value,Q);assert.equal(h.api.photoSel,PHOTO);assert.equal(h.sent.length,0);
  await h.choices[0][0][1]();
  assert.equal(h.dom.$('piyo-input').value,'');assert.equal(h.api.photoSel,null);assert.equal(h.sent.length,1);
});

test('送る：確かめの間に入力欄を書き換えていたら、書き換えた文は消さない',async()=>{
  const h=chat({mac:LINK});const form=h.dom.$('piyo-form');
  h.api.photoSel=PHOTO;h.dom.$('piyo-input').value=Q;
  await form.fire('submit');
  h.dom.$('piyo-input').value='別の文';
  await h.choices[0][0][1]();
  assert.equal(h.dom.$('piyo-input').value,'別の文');assert.equal(h.api.photoSel,null);
});

test('写真なしの送るは今までどおり（ask に文だけ渡す）。設定「写真で聞く」が切なら、写真が残っていても写真なしで送る',async()=>{
  const h=chat({flags:{photo:false}});const form=h.dom.$('piyo-form'),calls=[];
  h.api.photoSel=PHOTO;h.dom.$('piyo-input').value='ふつうの質問';
  await form.fire('submit');await new Promise(r=>setTimeout(r,5));
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].messages.at(-1).content,'ふつうの質問');
  assert.equal(h.dom.$('piyo-input').value,'');
});

test('「どこがちがう？」の途中で文を書いて送ったときは、文を指摘のひとことにする（写真は送らない）',async()=>{
  const h=chat();const form=h.dom.$('piyo-form'),fixes=[];
  h.c.submitFix=(k,t,c)=>fixes.push([k,t,c]);
  h.api.fixPending={msg:{el:{isConnected:true}}};h.api.photoSel=PHOTO;h.dom.$('piyo-input').value='値段がちがう';
  await form.fire('submit');
  assert.deepEqual(fixes,[['','値段がちがう',false]]);assert.equal(h.sent.length,0);assert.equal(h.api.photoSel,PHOTO);
});

test('同じ写真を選び直せる：選んだあと file の value を空に戻す。読めない写真は、ぴよが「この写真は読めなかったぴよ…」と言う',async()=>{
  const h=chat();
  h.c.Image=class{set src(v){setTimeout(()=>this.onerror(),0)}};
  h.c.URL={createObjectURL:()=>'blob:x',revokeObjectURL(){}};
  const inp=h.dom.$('piyo-photo');inp.files=[{name:'a.jpg'}];
  await inp.fire('change');
  assert.equal(inp.value,'');
  assert.deepEqual(h.said,['この写真は読めなかったぴよ…']);
  assert.equal(h.api.photoSel,null);
});

test('写真を選ぶ：1280px・JPEG 品質 0.8 に縮め、見出し絵と「×」を出す。「×」で外す',async()=>{
  const h=chat();const made=[];
  h.c.Image=class{constructor(){this.naturalWidth=4000;this.naturalHeight=3000}set src(v){setTimeout(()=>this.onload(),0)}};
  h.c.URL={createObjectURL:()=>'blob:x',revokeObjectURL(){}};
  h.c.document={createElement:t=>{assert.equal(t,'canvas');const cv={width:0,height:0,getContext:()=>({fillRect(){},drawImage(img,x,y,w,hh){made.push({w,hh})}}),toDataURL:(t,q)=>{made.push({t,q});return THUMB}};return cv}};
  const inp=h.dom.$('piyo-photo');inp.files=[{name:'a.jpg'}];
  await inp.fire('change');
  assert.deepEqual(made[0],{w:1280,hh:960});assert.deepEqual(made[1],{t:'image/jpeg',q:0.8});
  assert.deepEqual(plain(h.api.photoSel),{data:B64,thumb:THUMB});
  assert.equal(h.dom.$('piyo-photo-img').src,THUMB);assert.equal(h.dom.$('piyo-photo-prev').hidden,false);
  assert.equal(h.dom.$('piyo-send').disabled,false,'写真があれば、文が空でも送れる');
  await h.dom.$('piyo-photo-x').fire('click');
  assert.equal(h.api.photoSel,null);assert.equal(h.dom.$('piyo-photo-prev').hidden,true);assert.equal(h.dom.$('piyo-send').disabled,true);
  // 小さい写真は拡大しない
  made.length=0;h.c.Image=class{constructor(){this.naturalWidth=640;this.naturalHeight=480}set src(v){setTimeout(()=>this.onload(),0)}};
  inp.files=[{name:'b.jpg'}];await inp.fire('change');
  assert.deepEqual(made[0],{w:640,hh:480});
});

test('設定が変わったら、開き直さなくてもボタンが出入りする（写真・マイク）。写真を切ると選んだ写真も外す',async()=>{
  const flags={};
  const h=chat({flags,SR:class{}});
  assert.equal(h.dom.$('piyo-photo-btn').hidden,false);assert.equal(h.dom.$('piyo-mic').hidden,false);
  h.api.photoSel=PHOTO;
  flags.photo=false;flags.mic=false;
  await h.dom.$('set-toggles').fire('change');
  assert.equal(h.dom.$('piyo-photo-btn').hidden,true);assert.equal(h.dom.$('piyo-mic').hidden,true);assert.equal(h.api.photoSel,null);
  flags.photo=true;flags.mic=true;
  await h.dom.$('set-toggles').fire('change');
  assert.equal(h.dom.$('piyo-photo-btn').hidden,false);assert.equal(h.dom.$('piyo-mic').hidden,false);
  // 聞き取りが使えない端末では、設定が入りでもマイクを出さない
  const g=chat({SR:undefined});
  assert.equal(g.dom.$('piyo-mic').hidden,true);assert.equal(g.dom.$('piyo-photo-btn').hidden,false);
});

// ---- 4：マイク ----
class FakeSR{
  constructor(){FakeSR.last=this;this.started=0;this.stopped=0;this.aborted=0}
  start(){this.started++}stop(){this.stopped++;setTimeout(()=>this.onend&&this.onend(),0)}abort(){this.aborted++}
  say(...texts){this.onresult({results:texts.map(t=>[{transcript:t}])})}
}
test('マイク：ja-JP・途中の結果つきで聞き取り、入力欄に入れていく。自動では送らない。押している間は aria-pressed',async()=>{
  const h=chat({SR:FakeSR});const mic=h.dom.$('piyo-mic'),inp=h.dom.$('piyo-input');
  inp.value='ゴジラ';
  await mic.fire('click');
  const r=FakeSR.last;
  assert.equal(r.lang,'ja-JP');assert.equal(r.interimResults,true);assert.equal(r.started,1);
  assert.equal(mic.attrs['aria-pressed'],'true');
  r.say('ぴよりんの');assert.equal(inp.value,'ゴジラぴよりんの');
  r.say('ぴよりんの','値段は');assert.equal(inp.value,'ゴジラぴよりんの値段は');
  assert.equal(h.dom.$('piyo-send').disabled,false);
  assert.equal(h.sent.length,0,'自動では送らない');
  r.onend();
  assert.equal(mic.attrs['aria-pressed'],'false');assert.equal(inp.value,'ゴジラぴよりんの値段は');assert.equal(h.sent.length,0);
  assert.deepEqual(h.said,[]);
});

test('マイク：もう一度押すと止まる。送るときも止め、遅れて届いた結果は欄に戻さない',async()=>{
  const h=chat({SR:FakeSR});const mic=h.dom.$('piyo-mic'),inp=h.dom.$('piyo-input');
  await mic.fire('click');const r=FakeSR.last;
  await mic.fire('click');
  assert.equal(r.stopped,1);
  await new Promise(x=>setTimeout(x,5));
  assert.equal(mic.attrs['aria-pressed'],'false');
  // 送るとき
  await mic.fire('click');const r2=FakeSR.last;assert.notEqual(r2,r);
  r2.say('ぴよりんは？');await h.dom.$('piyo-form').fire('submit');await new Promise(x=>setTimeout(x,5));
  assert.equal(r2.aborted,1);assert.equal(inp.value,'');
  r2.say('遅れて届いた');assert.equal(inp.value,'','送ったあとの結果を欄へ戻さない');
});

test('マイク：許可が無い・失敗（not-allowed・service-not-allowed・audio-capture）は、ぴよが 1 回だけ言う。no-speech・aborted は黙る',async()=>{
  for(const err of ['not-allowed','service-not-allowed','audio-capture']){
    const h=chat({SR:FakeSR});
    await h.dom.$('piyo-mic').fire('click');const r=FakeSR.last;
    r.onerror({error:err});r.onend();
    assert.deepEqual(h.said,['マイクが使えなかったぴよ。設定でマイクを許可してね。'],err);
    assert.equal(h.dom.$('piyo-mic').attrs['aria-pressed'],'false');
  }
  for(const err of ['no-speech','aborted']){
    const h=chat({SR:FakeSR});
    await h.dom.$('piyo-mic').fire('click');const r=FakeSR.last;
    r.onerror({error:err});r.onend();
    assert.deepEqual(h.said,[],err);assert.equal(h.dom.$('piyo-mic').attrs['aria-pressed'],'false');
  }
});

test('マイク：webkitSpeechRecognition だけの端末でも使える。文は 300 字までに収める',async()=>{
  const h=chat({SR:undefined});h.c.webkitSpeechRecognition=FakeSR;
  vm.runInContext('paintTools()',h.c);
  assert.equal(h.dom.$('piyo-mic').hidden,false);
  await h.dom.$('piyo-mic').fire('click');FakeSR.last.say('あ'.repeat(500));
  assert.equal(h.dom.$('piyo-input').value.length,300);
});

// ---- 5：読み上げ ----
test('読み上げ：設定が切（既定）なら何も言わない。入りなら、答えの飾りを外した文を ja-JP の声で読む（読む前に前の読み上げを止める）',()=>{
  const off=chat();off.c.speakAnswer('**今日**は[[参照:m1]]晴れ😀だぴよ。https://example.com');
  assert.deepEqual(off.spoken,[]);
  const h=chat({speakOn:true});
  h.c.speakAnswer('**今日**は晴れ😀だぴよ。 https://example.com');
  assert.deepEqual(h.stops,['cancel']);
  assert.equal(h.spoken.length,1);
  assert.equal(h.spoken[0].text,X.speakText('**今日**は晴れ😀だぴよ。 https://example.com'));
  assert.ok(!/\*\*|https?:|😀/.test(h.spoken[0].text));
  assert.equal(h.spoken[0].lang,'ja-JP');assert.equal(h.spoken[0].voice.name,'ja','日本語の声があれば選ぶ');
  h.c.speakAnswer('');h.c.speakAnswer(' ');assert.equal(h.spoken.length,1,'空の文は読まない');
});

test('読み上げ：X.speakText が無いときは、タグと ** を外すだけの代わりを使う。声が見つからなくても読む',()=>{
  const h=chat({speakOn:true,synth:{cancel(){},speak(u){h.spoken.push({text:u.text,lang:u.lang,voice:u.voice})},getVoices:()=>[]}});
  h.c.PiyoExtras={...X,speakText:undefined};
  h.c.speakAnswer('<b>今日</b>は**晴れ**だぴよ。');
  assert.equal(h.spoken[0].text,'今日は晴れだぴよ。');assert.equal(h.spoken[0].lang,'ja-JP');assert.equal(h.spoken[0].voice,undefined);
});

test('読み上げ：X.optOn が無くても、鍵 piyo-speak を直に見る',()=>{
  const h=chat({speakOn:true});h.c.PiyoExtras={...X,optOn:undefined};
  h.c.speakAnswer('こんにちはだぴよ。');assert.equal(h.spoken.length,1);
  const g=chat();g.c.PiyoExtras={...X,optOn:undefined};g.c.speakAnswer('こんにちはだぴよ。');assert.equal(g.spoken.length,0);
});

test('読み上げ：止める（stopSpeak）は cancel。speechSynthesis が無い端末でも落ちない',()=>{
  const h=chat({speakOn:true});h.c.stopSpeak();assert.deepEqual(h.stops,['cancel']);
  const n=chat({speakOn:true,synth:null});
  assert.doesNotThrow(()=>{n.c.stopSpeak();n.c.primeSpeech();n.c.speakAnswer('だぴよ')});
});

test('読み上げ：iPhone 向けに、送る・チップを押した流れの中で、前の読み上げを止めてから空の読み上げを 1 回出す。設定が切なら出さない',async()=>{
  const h=chat({speakOn:true});
  h.dom.$('piyo-input').value='ぴよりんは？';
  await h.dom.$('piyo-form').fire('submit');await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(h.stops.slice(0,1),['cancel']);
  assert.equal(h.spoken[0].text,'');assert.equal(h.spoken[0].volume,0); // 空の読み上げ（声は出さない）
  assert.equal(h.sent.length,1);
  const off=chat();off.dom.$('piyo-input').value='ぴよりんは？';
  await off.dom.$('piyo-form').fire('submit');await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(off.spoken,[]);
  // 順番：cancel → 空の発話（逆だと準備ごと消える）
  const order=[];const o=chat({speakOn:true,synth:{cancel(){order.push('cancel')},speak(u){order.push('speak:'+JSON.stringify(u.text))},getVoices:()=>[]}});
  o.c.primeSpeech();assert.deepEqual(order,['cancel','speak:""']);
  // チップ
  const src=part('  function chipFor(','  function appendSuggest(');
  assert.match(src,/primeSpeech/);
});

test('答えが出そろったとき（API・その場の答え・infobase の札）に読む。失敗の文と、考え中の途中の文は読まない',async()=>{
  const h=chat();const spoken=[];h.c.speakAnswer=t=>spoken.push(t);h.c.stopSpeak=()=>spoken.push('STOP');
  await h.api.askWithPhoto(Q,PHOTO,()=>{});
  assert.deepEqual(spoken,['STOP','写真の答えだぴよ。']); // 新しい質問で止め、答えが出そろったら 1 回だけ
  spoken.length=0;
  h.c.callClaude=async()=>({content:[{type:'text',text:''}]});
  await h.api.ask('もう一度');
  assert.deepEqual(spoken,['STOP'],'うまく答えられなかった文は読まない');
  spoken.length=0;
  h.api.busy=true;h.api.answerLocal('今日は？',{kind:'weather',text:'今日は晴れだぴよ。'});
  assert.deepEqual(spoken,['今日は晴れだぴよ。']);
  // infobase の札の答え
  spoken.length=0;h.api.busy=false;
  h.c.PiyoInfobase={answer:async()=>({text:'ドル円は 150 円だぴよ。',body:'ドル円は **150 円**だぴよ。'}),guard:()=>null,hasWeatherProof:()=>false,report:async()=>{}};
  await h.api.ask('ドル円は？');
  assert.deepEqual(spoken,['STOP','ドル円は **150 円**だぴよ。']);
  const ask=part('  async function ask(','  async function askApi(');
  assert.ok(ask.includes('stopSpeak'));
});

test('チャットを閉じたとき・設定を切にしたときは読み上げを止める。speechSynthesis が無い端末では設定の行を出さない',async()=>{
  const close=part('  function close(o)','  idleEl.addEventListener(\'click\',open)');
  assert.match(close,/stopSpeak/);assert.match(close,/stopListen/);
  const h=chat({speakOn:true});
  const cb=h.dom.$('set-speak');
  assert.equal(cb.checked,true);
  cb.checked=false;await cb.fire('change');
  assert.equal(h.store.getItem('piyo-speak'),null);assert.deepEqual(h.stops,['cancel']);
  cb.checked=true;await cb.fire('change');
  assert.equal(h.store.getItem('piyo-speak'),'1');
  const off=chat();assert.equal(off.dom.$('set-speak').checked,false);
  const n=chat({synth:null});
  assert.equal(n.dom.$('set-speak-row').hidden,true);
  assert.equal(h.dom.$('set-speak-row').hidden,false);
});

// ---- 6：決まりの文・画面の部品・設定・見た目 ----
test('決まりの文（SYSTEM）に写真の 1 文（Mac 用は SYSTEM から作るので同じ行が入る。ほかの行は変えない）',()=>{
  const sys=part('  const SYSTEM=`','  let history=[];');
  const c={};vm.createContext(c);vm.runInContext(sys+';this.S=SYSTEM;this.M=SYSTEM_MAC;',c);
  const line='- 写真が付いていたら、写っているぴよりんや商品について、<knowledge> と照らして答える。写真から分からないことは分からないと言う。';
  assert.equal(c.S.split('\n').filter(l=>l===line).length,1);
  assert.equal(c.M.split('\n').filter(l=>l===line).length,1);
  assert.ok(c.S.indexOf(line)>c.S.indexOf('- <purchases>')&&c.S.indexOf(line)<c.S.indexOf('- 答えに <memo> や <event>'));
});

test('入力欄：写真のボタン（label と隠した file。capture なし）・マイク・送る の順。ボタンは type="button"、aria-label・aria-pressed 付き',()=>{
  const form=part('<form class="piyo-bar" id="piyo-form"','</form>');
  assert.match(form,/<label class="piyo-tool piyo-photo-btn" id="piyo-photo-btn"[^>]*aria-label="写真で聞く"[^>]*>[\s\S]*<svg[\s\S]*<input type="file" accept="image\/\*" id="piyo-photo"[^>]*>[\s\S]*<\/label>/);
  assert.ok(!/\bcapture\b/.test(form),'capture を付けると撮るだけになる');
  assert.match(form,/<button type="button" class="piyo-tool piyo-mic" id="piyo-mic"[^>]*aria-pressed="false"[^>]*aria-label="マイクで聞く"|<button type="button" class="piyo-tool piyo-mic" id="piyo-mic"[^>]*aria-label="マイクで聞く"[^>]*aria-pressed="false"/);
  assert.ok(form.indexOf('id="piyo-photo-btn"')<form.indexOf('id="piyo-input"')&&form.indexOf('id="piyo-input"')<form.indexOf('id="piyo-mic"')&&form.indexOf('id="piyo-mic"')<form.indexOf('id="piyo-send"'));
  assert.ok(!/<svg[^>]*>[^<]*[\u{1F300}-\u{1FAFF}]/u.test(form),'絵文字ではなく SVG');
  assert.match(html,/<div class="piyo-photo-prev" id="piyo-photo-prev" hidden><img id="piyo-photo-img" alt="[^"]*"><button type="button" id="piyo-photo-x" aria-label="写真を外す">×<\/button><\/div>\s*\n\s*<form class="piyo-bar"/);
});

test('見た目：ボタンは 34px の丸・当たりは 44px 相当・見出し絵は高さ 56px の角丸。明るい・暗い画面の色は変数だけ',()=>{
  const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  const rules=css.split('\n').filter(l=>/piyo-tool|piyo-photo-prev|piyo-ph\b|piyo-thumb/.test(l)).join('\n');
  assert.match(rules,/\.piyo-tool\{[^}]*width:34px;height:34px[^}]*border-radius:50%/);
  assert.match(rules,/\.piyo-tool::after\{[^}]*inset:-5px/);
  assert.match(rules,/\.piyo-photo-prev img\{[^}]*height:56px;[^}]*border-radius:12px/);
  assert.match(rules,/\.piyo-photo-prev button::after\{[^}]*inset:-11px/);
  assert.match(rules,/\.piyo-tool\[aria-pressed="true"\]\{[^}]*var\(--yolk\)/);
  assert.match(rules,/\.piyo-tool\[hidden\]\{display:none\}/);
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(rules),'色は変数（--surface・--line・--muted・--yolk など）だけ');
  assert.match(css,/\.set-toggles label\[hidden\]\{display:none\}/);
  // 幅 375px の入力欄：外の余白 24・入力欄の中の余白 10・ボタン 34+34+38+38・すきま 4×6 を引いても、文字の欄は 160px 以上
  const left=375-24-10-(34+34+38+38)-4*6;assert.ok(left>=160,'入力欄の幅 '+left);
});

test('設定：写真・マイク（data-flag。既定は入り）と読み上げ（set-speak。既定は切）の 3 行を、Mac 用の注意書きより上に置く',()=>{
  const box=html.slice(html.indexOf('<div class="set-toggles" id="set-toggles">'),html.indexOf('<div class="set-toggles">',html.indexOf('id="set-toggles"')+10));
  assert.match(box,/<label><input type="checkbox" data-flag="photo" checked><span>写真で聞く<small>写真を付けて聞けます。写真は Mac の Claude では見られないので、API で答えます（送る前に確かめます）。<\/small><\/span><\/label>/);
  assert.match(box,/<label><input type="checkbox" data-flag="mic" checked><span>マイクで聞く<small>話した言葉を入力欄に入れます（使える端末だけ）。<\/small><\/span><\/label>/);
  assert.match(box,/<label id="set-speak-row"><input type="checkbox" id="set-speak"><span>答えを読み上げる<small>ぴよの答えを声で読み上げます。<\/small><\/span><\/label>/);
  assert.ok(!/id="set-speak"[^>]*data-flag|data-flag="speak"|id="set-speak"[^>]*checked/.test(box),'読み上げは data-flag にせず、既定は切');
  const note=box.indexOf('Mac のつなぎ方を入れているときだけ働きます。');
  for(const k of ['data-flag="photo"','data-flag="mic"','id="set-speak"'])assert.ok(box.indexOf(k)>box.indexOf('data-flag="buyctx"')&&box.indexOf(k)<note,k);
});

test('鍵：photo・mic は piyo-photo-off・piyo-mic-off（'+"'1' で切）、読み上げは piyo-speak（'1' で入り）。extras が知らなくても index.html が見る",()=>{
  assert.match(html,/FEAT_FALLBACK=\{photo:'piyo-photo-off',mic:'piyo-mic-off'\}/);
  assert.match(html,/localStorage\.getItem\('piyo-speak'\)==='1'/);
  assert.equal(X.FLAG_KEYS.photo,'piyo-photo-off');assert.equal(X.FLAG_KEYS.mic,'piyo-mic-off');assert.equal(X.OPT_KEYS.speak,'piyo-speak');
  // featOn は、extras が鍵を知らなくても、切の鍵を見る
  const c={localStorage:mem({'piyo-photo-off':'1'}),PiyoExtras:{flagOn:()=>true}};vm.createContext(c);
  vm.runInContext(part('  const FEAT_FALLBACK=','  // 質問に関係するメモの番号')+';this.f=featOn;',c);
  assert.equal(c.f('photo'),false);assert.equal(c.f('mic'),true);assert.equal(c.f('buyctx'),true);
});

test('利用者の吹き出し：写真つきのときだけ見出し絵（img）を付ける。文は textContent のまま',()=>{
  const made=[];
  const el=()=>{const e={children:[],className:'',alt:'',src:'',textContent:'',appendChild(x){e.children.push(x);return x}};return e};
  const c={document:{createElement:t=>{const e=el();e.tag=t;made.push(e);return e,e},createTextNode:t=>({text:t})},log:{appendChild(){}},markLast(){},toBottom(){}};
  vm.createContext(c);vm.runInContext(part('  function userMsg(','  function piyoMsg(')+';this.userMsg=userMsg;',c);
  const plainMsg=c.userMsg('こんにちは');assert.equal(plainMsg.textContent,'こんにちは');assert.equal(plainMsg.children.length,0);
  const withImg=c.userMsg('これは？',THUMB);
  assert.equal(withImg.children.length,2);assert.equal(withImg.children[0].tag,'img');assert.equal(withImg.children[0].src,THUMB);assert.match(withImg.children[0].className,/piyo-ph/);
  assert.deepEqual(withImg.children[1],{text:'これは？'});
});

test('画面の <script>（中身があるもの）に構文の誤りが無い',()=>{
  const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
  assert.ok(scripts.length>=1);
  scripts.forEach((s,i)=>assert.doesNotThrow(()=>new vm.Script(s,{filename:'index.html#'+i})));
});
