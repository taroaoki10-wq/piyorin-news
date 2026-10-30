// Mac の Claude（Claude Pet の窓口）で話す：つなぎ方の読み取り・返事の読み取り・道の選び方・切り替え・合言葉を出さないこと
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
const TOKEN='abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEFG';
const URL0='https://mac-studio.tail8a9ae7.ts.net';

// 窓口の返事（text/event-stream）のまね。chunks は届く順の文字のかたまり
const ev=(event,data)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
function stream(chunks,{hang=false,fail=false}={}){
  let i=0,cancelled=0;const enc=new TextEncoder();
  return {cancelled:()=>cancelled,ok:true,status:200,headers:{get:()=>'text/event-stream; charset=utf-8'},body:{getReader(){return{
    read:async()=>{
      if(i<chunks.length)return{value:enc.encode(chunks[i++]),done:false};
      if(fail)throw new TypeError('network');
      if(hang)return new Promise(()=>{});
      return{value:undefined,done:true};
    },
    cancel(){cancelled++;return Promise.resolve()}}}}};
}

test('つなぎ方の 1 行を読む（Claude Pet と同じ決まり。https だけ・道なし・合言葉は 20 文字以上）',()=>{
  assert.deepEqual(plain(X.parseMacLink(`piyo-mac v1 ${URL0} ${TOKEN}`)),{url:URL0,token:TOKEN});
  assert.deepEqual(plain(X.parseMacLink(`\n  piyo-mac v1 ${URL0}/ ${TOKEN}\n`)),{url:URL0,token:TOKEN});
  assert.equal(X.parseMacLink(`piyo-mac v1 http://mac-studio.tail8a9ae7.ts.net ${TOKEN}`),null);
  assert.equal(X.parseMacLink(`piyo-mac v1 ${URL0}/piyo-news ${TOKEN}`),null);
  assert.equal(X.parseMacLink(`piyo-mac v1 ${URL0} short`),null);
  assert.equal(X.parseMacLink(`piyo-mac v2 ${URL0} ${TOKEN}`),null);
  assert.equal(X.parseMacLink('sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx'),null);
  assert.equal(X.parseMacLink(null),null);
});

test('窓口の返事を読む：文は「ここまでの全文」、書き直しは空から、調べている状態、終わり、空の行',async()=>{
  const texts=[],states=[];
  const r=stream([ev('status',{state:'thinking'})+ev('text',{text:'こんにち'}).slice(0,20),ev('text',{text:'こんにち'}).slice(20)+': ping\n\n',
    ev('text',{text:'こんにちはぴよ。'})+ev('status',{state:'searching'}),ev('text',{text:''})+ev('status',{state:'reading'}),
    ev('text',{text:'調べたぴよ。'})+ev('done',{text:'調べたぴよ。\n[[参照:m1]]',stop:'end',fiveHour:{used:.2,resetsAt:1793300000}})]);
  const res=await X.readRelay(r,t=>texts.push(t),s=>states.push(s));
  assert.deepEqual(texts,['こんにち','こんにちはぴよ。','','調べたぴよ。']);
  assert.deepEqual(states,['thinking','searching','reading']);
  assert.deepEqual(plain(res),{content:[{type:'text',text:'調べたぴよ。\n[[参照:m1]]'}],stop_reason:'end_turn'});
  const max=await X.readRelay(stream([ev('done',{text:'ここまで',stop:'max_turns'})]));
  assert.equal(max.stop_reason,'max_turns');
});

test('窓口の返事の途中のつまずき：エラーの種類・5時間枠の戻る時刻・切れた・何も届かない',async()=>{
  const e1=stream([ev('status',{state:'thinking'})+ev('error',{kind:'limit',resetsAt:1793300000})]);
  await assert.rejects(X.readRelay(e1),e=>e.kind==='limit'&&e.resetsAt===1793300000);
  assert.equal(e1.cancelled(),1);
  await assert.rejects(X.readRelay(stream([ev('error',{kind:'login'})])),e=>e.kind==='login'&&e.resetsAt===null);
  await assert.rejects(X.readRelay(stream([ev('text',{text:'途中'})])),e=>e.kind==='cut'); // 終わりが届かずに閉じた
  await assert.rejects(X.readRelay(stream([ev('text',{text:'途中'})],{fail:true})),e=>e.kind==='cut'); // 読む途中で切れた
  const hang=stream([ev('text',{text:'途中'})],{hang:true});
  await assert.rejects(X.readRelay(hang,null,null,30),e=>e.kind==='cut'); // 何も届かないまま（Mac が寝た）
  assert.equal(hang.cancelled(),1);
});

test('参照の印が空でも外す（Mac の Claude は使ったメモが無いと [[参照:]] を書くことがある）',()=>{
  assert.deepEqual(plain(X.refs('本社は名古屋だぴよ。\n参考ページ: https://example.com/a\n[[参照:]]')),{text:'本社は名古屋だぴよ。\n参考ページ: https://example.com/a',ids:[]});
});

test('Mac 用の指示：need_more の代わりに聞き返さず調べる。ほかの行は API と同じ',()=>{
  const c={};vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));
  vm.runInContext(part('  const SYSTEM=`','  let history=[];')+';this.SYSTEM=SYSTEM;this.SYSTEM_MAC=SYSTEM_MAC;',c);
  const api=c.SYSTEM.split('\n'),mac=c.SYSTEM_MAC.split('\n');
  assert.equal(mac.length,api.length);
  assert.ok(api.some(l=>l.includes('need_more')));
  assert.ok(!c.SYSTEM_MAC.includes('need_more'));
  for(const w of ['聞き返さずに調べてから答える','WebFetch','WebSearch','PR TIMES','合わせて3回まで','参考ページ: ','[[参照:]] の印そのものを書かない','記事を読んだり Web で調べたりしない。'])assert.ok(c.SYSTEM_MAC.includes(w),w);
  assert.equal(mac.filter((l,i)=>l!==api[i]).length,3); // 変えたのは 3 行だけ
});

// ---- 会話（ask）を、偽の窓口・偽の API で動かす ----
function chat({mac=null,apiKey='',routeMode='mac-first',relay}={}){
  const said=[],choices=[],fetched=[],saved=[],keyPrompts=[],sent=[];
  let now=Date.parse('2026-10-29T03:00:00Z');
  const c={PiyoExtras:X,data:{events:[],basics:null,koyomi:null,weather:[],news:[],memo:{},greeting:null},apiKey,mac,routeMode,pendingQ:'',refMap:{},
    $:()=>({}),todayStr:()=>'2026-10-29',nextDay:s=>new Date(Date.parse(s+'T00:00:00Z')+86400e3).toISOString().slice(0,10),
    localStorage:{getItem:()=>null,setItem(){}},Math,OMIKUJI:'piyo-omikuji',AbortController,setTimeout,clearTimeout,
    Date:class extends Date{static now(){return now}},
    esc:s=>String(s),fmt:s=>s,piyoTone:s=>s,userMsg(){},loop(){},idle(){},play(){},sync(){},consumeSuggest(){},
    piyoMsg:()=>{const m={id:said.length,say(text,done,resume){said.push({text,resume:!!resume});done?.()},choices(list){choices.push(list)},links(){}};return m},
    openKey(msg){keyPrompts.push(msg||'')},saveMac(v){saved.push(v);c.mac=v||null},
    NEED_MORE:{},SYSTEM_MAC:'MAC 用の指示',knowledge:()=>'<knowledge>知識</knowledge>',textOf:r=>(r.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim(),
    errText:()=>'API のエラーだぴよ。',
    callClaude:async b=>{sent.push(b);return{content:[{type:'text',text:'API の答えだぴよ。'}]}},
    fetch:async(url,opts={})=>{fetched.push({url,opts});return relay(url,opts)}};
  vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));
  vm.runInContext('let history=[];'+part('  let busy=false,pendingChip=null;','  const sync=()=>')+part('  function omikujiSeed(','  // ---- API キー')
    +';this.ask=ask;this.route=route;this.history=()=>history;this.isBusy=()=>busy;this.resetAt=resetAt;',c);
  return {c,said,choices,fetched,saved,keyPrompts,sent,advance:ms=>{now+=ms}};
}
const healthOk=()=>({ok:true,status:200,json:async()=>({ok:true,v:1,name:'Mac-Studio',model:'haiku',login:true,busy:false})});
const refuse=(status,error)=>({ok:false,status,headers:{get:()=>'application/json; charset=utf-8'},json:async()=>({error})});
const Q='名古屋駅から店までの道順は？';
const LINK={url:URL0,token:TOKEN,name:''};

test('道の選び方：準備した方・話し方・Mac につながらないとき API で答えるか',()=>{
  const r=o=>plain(chat(o).c.route());
  assert.equal(r({}),null);
  assert.deepEqual(r({apiKey:'k'}),{way:'api',fallback:false});
  assert.deepEqual(r({mac:LINK}),{way:'mac',fallback:false});
  assert.deepEqual(r({mac:LINK,apiKey:'k'}),{way:'mac',fallback:true});
  assert.deepEqual(r({mac:LINK,apiKey:'k',routeMode:'mac'}),{way:'mac',fallback:false});
  assert.deepEqual(r({mac:LINK,apiKey:'k',routeMode:'api'}),{way:'api',fallback:false});
  assert.deepEqual(r({mac:LINK,routeMode:'api'}),{way:'mac',fallback:false}); // API キーを解除したら Mac で
});

test('Mac の Claude で答える：確かめてから送り、文を流して出す。合言葉は見出しだけで、URL・画面に出さない',async()=>{
  assert.equal(X.localAnswer(Q,{today:'2026-10-29',hour:12,now:Date.now(),events:[],basics:null,koyomi:null,weather:[],omikuji:{seed:'s',drawn:false}}),null);
  const h=chat({mac:LINK,relay:(url,opts)=>url.endsWith('/health')?healthOk()
    :stream([ev('status',{state:'thinking'}),ev('text',{text:'名古屋駅の'}),ev('text',{text:'名古屋駅の中央改札から歩いて1分だぴよ。'}),
      ev('done',{text:'名古屋駅の中央改札から歩いて1分だぴよ。\n[[参照:]]',stop:'end'})])});
  await h.c.ask(Q);
  assert.deepEqual(h.fetched.map(f=>f.url),[URL0+'/piyo-news/health',URL0+'/piyo-news/chat']);
  for(const f of h.fetched){assert.ok(!f.url.includes(TOKEN));assert.equal(f.opts.headers.authorization,'Bearer '+TOKEN)}
  const body=JSON.parse(h.fetched[1].opts.body);
  assert.deepEqual(body,{system:'MAC 用の指示',knowledge:'<knowledge>知識</knowledge>',history:[],question:Q});
  assert.equal(h.fetched[1].opts.method,'POST');assert.equal(h.fetched[1].opts.headers['content-type'],'application/json');
  assert.deepEqual(h.said.map(s=>s.text),['考え中だぴよ…','名古屋駅の中央改札から歩いて1分だぴよ。','名古屋駅の中央改札から歩いて1分だぴよ。']);
  assert.equal(h.said[2].resume,true); // 最後は続きから（流して出した文を出し直さない）
  assert.ok(h.said.every(s=>!s.text.includes(TOKEN)&&!s.text.includes('[[')));
  assert.equal(h.sent.length,0);assert.equal(h.c.isBusy(),false);
  assert.deepEqual(plain(h.c.history()),[{role:'user',content:Q},{role:'assistant',content:'名古屋駅の中央改札から歩いて1分だぴよ。'}]);
  // 60 秒以内なら確かめずに送り、前の会話も渡す。60 秒をこえたら確かめ直す
  await h.c.ask('次の質問だぴよ？');
  assert.deepEqual(h.fetched.slice(2).map(f=>f.url),[URL0+'/piyo-news/chat']);
  assert.equal(JSON.parse(h.fetched[2].opts.body).history.length,2);
  h.advance(60001);await h.c.ask('三つ目の質問？');
  assert.deepEqual(h.fetched.slice(3).map(f=>f.url),[URL0+'/piyo-news/health',URL0+'/piyo-news/chat']);
});

test('調べたあとの書き直し：途中の文を消して「調べてるぴよ…」、新しい答えは初めから出す',async()=>{
  const h=chat({mac:LINK,relay:(url)=>url.endsWith('/health')?healthOk()
    :stream([ev('text',{text:'記事を見てみるぴよ。'}),ev('status',{state:'reading'}),ev('text',{text:''}),ev('status',{state:'thinking'}),
      ev('text',{text:'大きさは縦15cmだぴよ。'}),ev('done',{text:'大きさは縦15cmだぴよ。\n[[参照:m1]]',stop:'end'})])});
  await h.c.ask(Q);
  assert.deepEqual(h.said,[{text:'考え中だぴよ…',resume:false},{text:'記事を見てみるぴよ。',resume:false},{text:'記事を読んでるぴよ…',resume:false},
    {text:'考え中だぴよ…',resume:false},{text:'大きさは縦15cmだぴよ。',resume:false},{text:'大きさは縦15cmだぴよ。',resume:true}]);
  // 文が届かないまま終わったら、最後の答えは初めから出す
  const h2=chat({mac:LINK,relay:(url)=>url.endsWith('/health')?healthOk()
    :stream([ev('status',{state:'searching'}),ev('done',{text:'短い答え',stop:'end'})])});
  await h2.c.ask(Q);
  assert.deepEqual(h2.said.map(s=>[s.text,s.resume]),[['考え中だぴよ…',false],['調べてるぴよ…',false],['短い答え',false]]);
});

test('調べる回数の上限で止まったら、ここまでの答えに一言添える',async()=>{
  const h=chat({mac:LINK,relay:(url)=>url.endsWith('/health')?healthOk():stream([ev('done',{text:'途中までの答えだぴよ。',stop:'max_turns'})])});
  await h.c.ask(Q);
  assert.equal(h.said.at(-1).text,'途中までの答えだぴよ。\n（調べきれなかったので、ここまでの答えだぴよ）');
});

test('「Mac を優先」：Mac につながらなければ一言そえて API で答える',async()=>{
  const h=chat({mac:LINK,apiKey:'sk-ant-test',relay:()=>{throw new TypeError('Load failed')}});
  await h.c.ask(Q);
  assert.deepEqual(h.fetched.map(f=>f.url),[URL0+'/piyo-news/health']);
  assert.deepEqual(h.said.map(s=>s.text),['考え中だぴよ…','Mac につながらないから API で答えるぴよ。','考え中だぴよ…','API の答えだぴよ。']);
  assert.equal(h.sent.length,1);assert.equal(h.c.isBusy(),false);
  // 送る段階でつながらなくても（確かめたあとに Mac が寝た）API で答える
  const h2=chat({mac:LINK,apiKey:'sk-ant-test',relay:url=>{if(url.endsWith('/health'))return healthOk();throw new TypeError('Load failed')}});
  await h2.c.ask(Q);assert.equal(h2.sent.length,1);assert.equal(h2.said[1].text,'Mac につながらないから API で答えるぴよ。');
});

test('「Mac だけ」：つながらなくても API に切り替えず、API キーがあれば「API で聞く」ボタンを出す',async()=>{
  const h=chat({mac:LINK,apiKey:'sk-ant-test',routeMode:'mac',relay:()=>{throw new TypeError('Load failed')}});
  await h.c.ask(Q);
  assert.equal(h.sent.length,0);
  assert.equal(h.said.at(-1).text,'Mac につながらないぴよ。Mac が起きているか、iPhone の Tailscale がオンか確かめてね。');
  assert.equal(h.choices.length,1);assert.equal(h.choices[0][0][0],'API で聞く');
  await h.choices[0][0][1]();
  assert.equal(h.sent.length,1);assert.equal(h.said.at(-1).text,'API の答えだぴよ。');
  // API キーが無ければボタンは出さない
  const h2=chat({mac:LINK,relay:()=>{throw new TypeError('Load failed')}});
  await h2.c.ask(Q);assert.equal(h2.choices.length,0);assert.match(h2.said.at(-1).text,/Mac につながらないぴよ/);
});

test('窓口に断られたとき・答えの途中のつまずきは、自動では API に切り替えない（ぴよのことば）',async()=>{
  const cases=[
    [()=>refuse(409,'busy'),'いまほかの質問に答えてるぴよ。少し待ってね。'],
    [()=>refuse(429,'hourly'),'1 時間に聞ける回数をこえたぴよ。少し待ってね。'],
    [()=>refuse(403,'auth'),'Tailscale のアカウントが Mac と違うみたいぴよ。iPhone の Tailscale を Mac と同じアカウントにしてね。'],
    [()=>stream([ev('error',{kind:'login'})]),'Mac の Claude にログインしていないみたいぴよ。Mac の Claude Pet でログインしてね。'],
    [()=>stream([ev('error',{kind:'timeout'})]),'時間がかかりすぎたぴよ…別の聞き方で聞いてみてね。'],
    [()=>stream([ev('text',{text:'途中'})]),'途中で切れちゃったぴよ。'],
    [()=>stream([ev('error',{kind:'failed'})]),'Mac の Claude で答えを作れなかったぴよ…'],
  ];
  for(const [reply,text] of cases){
    const h=chat({mac:LINK,apiKey:'sk-ant-test',relay:url=>url.endsWith('/health')?healthOk():reply()});
    await h.c.ask(Q);
    assert.equal(h.said.at(-1).text,text);assert.equal(h.sent.length,0);assert.equal(h.c.isBusy(),false);
    assert.equal(h.choices[0][0][0],text.startsWith('途中で切れ')?'API で聞き直す':'API で聞く');
  }
  // 確かめた時点でログインしていない・答え中なら、送らない
  for(const [body,text] of [[{login:false},'Mac の Claude にログインしていないみたいぴよ。'],[{busy:true},'いまほかの質問に答えてるぴよ。']]){
    const h=chat({mac:LINK,relay:()=>({ok:true,status:200,json:async()=>({ok:true,v:1,name:'Mac-Studio',login:true,busy:false,...body})})});
    await h.c.ask(Q);assert.equal(h.fetched.length,1);assert.ok(h.said.at(-1).text.startsWith(text));
  }
});

test('5時間枠がいっぱい：戻る時刻を日本時間で言う',async()=>{
  const at=Date.parse('2026-10-29T06:20:00Z')/1000; // 日本時間 15:20
  const h=chat({mac:LINK,relay:url=>url.endsWith('/health')?healthOk():stream([ev('error',{kind:'limit',resetsAt:at})])});
  await h.c.ask(Q);
  assert.equal(h.said.at(-1).text,'5時間枠がいっぱいだぴよ。15時20分に戻るぴよ。');
  assert.equal(h.c.resetAt(Date.parse('2026-10-29T16:00:00Z')/1000),'明日の1時');
  assert.equal(h.c.resetAt(Date.parse('2026-10-31T01:05:00Z')/1000),'10月31日の10時5分');
});

test('合言葉が違う（つなぎ方が古い）ときは、つなぎ方を消して準備の画面で貼り直してもらう',async()=>{
  const h=chat({mac:LINK,apiKey:'sk-ant-test',relay:()=>refuse(401,'auth')});
  await h.c.ask(Q);
  assert.deepEqual(h.saved,[null]);assert.equal(h.keyPrompts.length,1);assert.match(h.keyPrompts[0],/つなぎ方をコピー/);
  assert.equal(h.c.pendingQ,Q);assert.equal(h.sent.length,0);
  assert.equal(h.said.at(-1).text,'つなぎ方が古いみたいぴよ。Claude Pet でコピーし直してね。');
});

test('どちらも準備していなければ、通信せずに準備の画面を出す',async()=>{
  const h=chat({relay:()=>{throw Error('通信してはいけない')}});
  await h.c.ask(Q);
  assert.equal(h.keyPrompts.length,1);assert.equal(h.fetched.length,0);assert.equal(h.c.pendingQ,Q);
});

// ---- 話す準備の画面・ブックマークの下の表示・会話の札 ----
function prep({mac=null,apiKey='',routeMode=null,health}={}){
  const store=new Map();
  if(apiKey)store.set('piyo-key',apiKey);if(mac)store.set('piyo-mac',JSON.stringify(mac));if(routeMode)store.set('piyo-route',routeMode);
  const els={},asked=[];
  const radios=['mac-first','mac','api'].map(value=>({value,checked:false}));
  const wayButtons=['mac','api'].map(way=>({dataset:{way},on:false,pressed:'false',classList:{toggle(name,on){if(name==='on')wayButtons.find(b=>b.dataset.way===way).on=on}},setAttribute(n,v){if(n==='aria-pressed')this.pressed=v},closest(){return this}}));
  const $=id=>els[id]||(els[id]={id,hidden:false,value:'',placeholder:'',textContent:'',className:'',innerHTML:'',listeners:{},focus(){},
    addEventListener(type,fn){(this.listeners[type]=this.listeners[type]||[]).push(fn)},
    querySelector(sel){if(sel.includes(':checked'))return radios.find(r=>r.checked)||null;const m=/value="([^"]+)"/.exec(sel);return m?radios.find(r=>r.value===m[1]):null},
    querySelectorAll(){return id==='piyo-way'?wayButtons:[]}});
  const c={$,KEY:'piyo-key',PiyoExtras:X,localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    esc:s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
    setTimeout:fn=>fn(),pendingChip:null,ask:q=>asked.push(q),macHealth:async()=>health,
    macErrText:e=>e.kind==='account'?'アカウントが違うぴよ。':'?'};
  vm.createContext(Object.assign(c,{freshWeather:c.freshWeather||(()=>null)}));
  vm.runInContext(part('  // ---- API キー','  // ---- Claude に聞く')+';this.api={openKey,saveMac,saveKey,get mac(){return mac},get routeMode(){return routeMode},get apiKey(){return apiKey},set pendingQ(v){pendingQ=v}};',c);
  const fire=(id,type,e={})=>Promise.all(($(id).listeners[type]||[]).map(fn=>fn({preventDefault(){},...e})));
  return {c,api:c.api,store,$,radios,wayButtons,asked,fire,
    submit:async({key='',link='',route})=>{$('piyo-key').value=key;$('piyo-mac').value=link;if(route)radios.forEach(r=>r.checked=r.value===route);await fire('piyo-key-modal','submit')}};
}

test('準備の画面：片方だけでも保存でき、話し方とつなぎ方を保存する。合言葉は画面に出さない',async()=>{
  const h=prep({health:{ok:true,name:'Mac-Studio',login:true}});
  assert.equal(h.$('piyo-meta').hidden,true);assert.equal(h.$('piyo-way').hidden,true);
  h.api.openKey();
  assert.equal(h.radios.find(r=>r.checked).value,'mac-first'); // 既定は Mac を優先
  assert.equal(h.$('piyo-mac').placeholder,'piyo-mac v1 https://…');
  // 「つながるか試す」で Mac の名前が分かる
  h.$('piyo-mac').value=`piyo-mac v1 ${URL0} ${TOKEN}`;await h.fire('piyo-mac-test','click');
  assert.equal(h.$('piyo-mac-result').textContent,'✓ Mac-Studio につながったぴよ。');assert.equal(h.$('piyo-mac-result').className,'piyo-mac-result ok');
  await h.submit({link:`piyo-mac v1 ${URL0} ${TOKEN}`,route:'mac-first'});
  assert.equal(h.$('piyo-key-modal').hidden,true);
  assert.deepEqual(plain(h.api.mac),{url:URL0,token:TOKEN,name:'Mac-Studio'});
  assert.deepEqual(JSON.parse(h.store.get('piyo-mac')),{url:URL0,token:TOKEN,name:'Mac-Studio'});
  assert.equal(h.store.get('piyo-route'),'mac-first');assert.equal(h.store.has('piyo-key'),false);
  const meta=h.$('piyo-meta');
  assert.equal(meta.hidden,false);assert.ok(!meta.innerHTML.includes(TOKEN));assert.match(meta.innerHTML,/つなぎ方（Mac-Studio）をこの端末に保存中/);
  assert.match(meta.innerHTML,/ぴよの話し方：Mac の Claude<button type="button" data-piyo="setup">変える<\/button>/);
  assert.equal(h.$('piyo-way').hidden,true); // 片方だけなら札は出さない
  // 開き直すと欄は空で、保存済みと分かる（合言葉は出さない）
  h.api.openKey();
  assert.equal(h.$('piyo-mac').value,'');assert.equal(h.$('piyo-mac').placeholder,'保存済み（Mac-Studio）');assert.equal(h.$('piyo-key').placeholder,'sk-ant-…');
  assert.ok(!h.$('piyo-mac').placeholder.includes(TOKEN));
});

test('準備の画面：形の違い・話し方と準備の食い違いを知らせる',async()=>{
  const h=prep();h.api.openKey();
  await h.submit({});assert.equal(h.$('piyo-key-err').textContent,'Mac の Claude のつなぎ方か API キーの、どちらかを入れてください。');
  await h.submit({link:'piyo-mac v1 http://x y'});assert.match(h.$('piyo-key-err').textContent,/つなぎ方の形が違うようです/);
  await h.submit({key:'sk-ant-short'});assert.match(h.$('piyo-key-err').textContent,/API キーの形が違うようです/);
  await h.submit({key:'sk-ant-'+'a'.repeat(30),route:'mac'});assert.equal(h.$('piyo-key-err').textContent,'「Mac の Claude だけ」にするには、つなぎ方を貼り付けてください。');
  await h.submit({link:`piyo-mac v1 ${URL0} ${TOKEN}`,route:'api'});assert.equal(h.$('piyo-key-err').textContent,'「API だけ」にするには、API キーを入れてください。');
  assert.equal(h.api.mac,null);assert.equal(h.api.apiKey,'');assert.equal(h.store.size,0); // どれも保存していない
  // 正しく入れたら保存して、待っていた質問を送る
  h.api.pendingQ='待っていた質問';
  await h.submit({key:'sk-ant-'+'a'.repeat(30),route:'api'});
  assert.equal(h.api.apiKey,'sk-ant-'+'a'.repeat(30));assert.equal(h.api.routeMode,'api');assert.deepEqual(h.asked,['待っていた質問']);
});

test('「つながるか試す」のつまずき：つながらない・つなぎ方が古い・形が違う（合言葉は出さない）',async()=>{
  for(const [health,text] of [
    [{ok:false,kind:'unreachable'},/Mac につながらないぴよ。.*Claude Pet の「つなぐ」/],
    [{ok:false,kind:'token',status:401},/つなぎ方が古いみたいぴよ/],
    [{ok:false,kind:'account',status:403},/アカウントが違うぴよ/],
    [{ok:true,name:'Mac-Studio',login:false},/✓ Mac-Studio につながったぴよ。でも Mac の Claude にログインしていない/],
  ]){
    const h=prep({health});h.api.openKey();
    h.$('piyo-mac').value=`piyo-mac v1 ${URL0} ${TOKEN}`;await h.fire('piyo-mac-test','click');
    assert.match(h.$('piyo-mac-result').textContent,text);assert.ok(!h.$('piyo-mac-result').textContent.includes(TOKEN));
  }
  const h=prep();h.api.openKey();h.$('piyo-mac').value='まちがい';await h.fire('piyo-mac-test','click');
  assert.match(h.$('piyo-mac-result').textContent,/形が違うぴよ/);
  h.$('piyo-mac').value='';await h.fire('piyo-mac-test','click');assert.equal(h.$('piyo-mac-result').textContent,'× つなぎ方を貼り付けてね。');
});

test('両方準備したら会話の札を出し、押すと話し方が切り替わる。解除は別々にできる',async()=>{
  const h=prep({mac:LINK,apiKey:'sk-ant-'+'a'.repeat(30),routeMode:'mac'});
  assert.equal(h.$('piyo-way').hidden,false);
  assert.deepEqual(h.wayButtons.map(b=>[b.dataset.way,b.on,b.pressed]),[['mac',true,'true'],['api',false,'false']]);
  assert.match(h.$('piyo-meta').innerHTML,/ぴよの話し方：Mac の Claude だけ/);
  const click=way=>h.fire('piyo-way','click',{target:{closest:()=>h.wayButtons.find(b=>b.dataset.way===way)}});
  await click('api');assert.equal(h.api.routeMode,'api');assert.equal(h.store.get('piyo-route'),'api');
  assert.deepEqual(h.wayButtons.map(b=>b.on),[false,true]);
  await click('mac');assert.equal(h.api.routeMode,'mac'); // API にする前の話し方へ戻す
  // ブックマークの下から、つなぎ方だけ解除
  await h.fire('piyo-meta','click',{target:{closest:()=>({dataset:{piyo:'mac-off'}})}});
  assert.equal(h.api.mac,null);assert.equal(h.store.has('piyo-mac'),false);assert.equal(h.api.apiKey,'sk-ant-'+'a'.repeat(30));
  assert.equal(h.$('piyo-way').hidden,true);assert.match(h.$('piyo-meta').innerHTML,/ぴよの話し方：API/);
  // 「変える」で準備の画面を開く
  await h.fire('piyo-meta','click',{target:{closest:()=>({dataset:{piyo:'setup'}})}});assert.equal(h.$('piyo-key-modal').hidden,false);
});

test('保存したつなぎ方がおかしければ使わない（https でない・合言葉が短い）',()=>{
  assert.equal(prep({mac:{url:'http://x.ts.net',token:TOKEN}}).api.mac,null);
  assert.equal(prep({mac:{url:URL0,token:'short'}}).api.mac,null);
  assert.deepEqual(plain(prep({mac:{url:URL0,token:TOKEN}}).api.mac),{url:URL0,token:TOKEN,name:''});
});
