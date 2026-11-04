// 会話の記録（docs/piyo-log.js）。架空のやり取りだけで、保存・送る・つながらない・合言葉の違い・全部消す・記録しない を確かめる
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const TOKEN='abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEFG',URL0='https://mac-studio.tail8a9ae7.ts.net:8443';
const tick=()=>new Promise(r=>setTimeout(r,5));

function setup({on=true,link=true,online=true,status=200,store:init=null}={}){
  const store=init||{},sent=[];
  if(on)store['piyo-log-on']='1';
  if(link)store['piyo-log-link']=JSON.stringify({url:URL0,token:TOKEN});
  const net={online,status};
  const ctx={crypto:globalThis.crypto,URL,Intl,console,JSON,Date,Math,Promise,AbortController,setTimeout,clearTimeout,setInterval:()=>0,
    localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
    document:{readyState:'complete',querySelector:()=>null,getElementById:()=>null,addEventListener(){},visibilityState:'visible'},
    confirm:()=>true,
    fetch:async(url,o)=>{if(!net.online)throw new TypeError('Load failed');const b=JSON.parse(o.body);sent.push({url,auth:o.headers.authorization,events:b.events});
      return{ok:net.status===200,status:net.status,json:async()=>({accepted:b.events.map(e=>e.eventId),duplicate:[],rejected:[]})}}};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  for(const f of ['docs/piyo-log/schema.js','docs/piyo-log/recorder.js','docs/piyo-log.js'])vm.runInContext(read(f),ctx);
  return{L:ctx.PiyoLog,S:ctx.PiyoLogSchema,store,sent,net};
}

test('記録しない（既定）ときは何も残さない', async()=>{
  const {L}=setup({on:false});
  assert.equal(L.turn('架空の質問'),null);
  L.end(null,{status:'ok',answer:'x'});
  await tick();assert.equal((await L.status()).pending,0);
});

test('質問と答え・「ちがうよ」を同じ会話に残し、Mac へ送る（合言葉は記録に入らない）', async()=>{
  const {L,S,sent}=setup();
  await L.flush(true);sent.length=0;
  const id=L.turn('ぴよりんゴジラはいつから？（架空）',{chip:'ゴジラ'});
  L.end(id,{status:'ok',answer:'11月3日からだぴよ。',route:'local',ms:12});
  L.feedback(id,{rating:'bad',reason:'old',comment:'もう終わってる'});
  await tick();
  const r=await L.flush(true);
  assert.equal(r.pending,0);
  const evs=sent.flatMap(s=>s.events);
  assert.deepEqual(evs.map(e=>e.kind),['turn.start','turn.end','feedback']);
  assert.ok(evs.every(e=>S.validate(e).ok));
  assert.ok(evs.every(e=>e.app==='piyorin-news'&&e.convId===evs[0].convId&&e.turnId===id));
  assert.equal(sent[0].url,URL0+'/piyo-log/ingest');
  assert.equal(sent[0].auth,'Bearer '+TOKEN);
  assert.ok(!JSON.stringify(evs).includes(TOKEN));
  assert.equal(evs[2].reason,'old');
});

test('つながらないとき・合言葉が違うときは端末に残し、つながったら送る', async()=>{
  const {L,net,sent}=setup({online:false});
  const id=L.turn('オフラインの質問（架空）');L.end(id,{status:'error',answer:'うまく答えられなかったぴよ…',errorKind:'api-500'});
  await tick();
  assert.equal((await L.flush(true)).offline,true);
  let st=await L.status();assert.equal(st.pending,2);assert.equal(st.lastError.kind,'unreachable');
  net.online=true;net.status=401;
  await L.flush(true);st=await L.status();assert.equal(st.lastError.kind,'http-401');assert.equal(st.pending,2);
  net.status=200;
  assert.equal((await L.flush(true)).pending,0);
  assert.equal(sent.at(-1).events[1].status,'error');
});

test('つなぎ方は「piyo-log v1 <https の住所> <合言葉>」だけを受け付ける', ()=>{
  const {L}=setup();
  assert.deepEqual(JSON.parse(JSON.stringify(L.parseLink('piyo-log v1 '+URL0+' '+TOKEN))),{url:URL0,token:TOKEN});
  for(const bad of ['piyo-log v1 http://x.ts.net '+TOKEN,'piyo-mac v1 '+URL0+' '+TOKEN,'piyo-log v1 '+URL0+' short','piyo-log v1 '+URL0+'/path '+TOKEN])assert.equal(L.parseLink(bad),null,bad);
});

test('答えの途中で閉じた分は、次に開いたとき「途中で終わった」として送る', async()=>{
  const a=setup({online:false});
  a.L.turn('閉じる前の質問（架空）');await tick();
  const {L,sent}=setup({store:{...a.store}}); // 同じ端末の保存で、ページを開き直した
  await tick();await tick();
  await L.flush(true);
  const evs=sent.flatMap(s=>s.events);
  assert.deepEqual(evs.map(e=>e.kind+':'+(e.status||'')),['turn.start:','turn.end:interrupted']);
});

test('全部消すと、まだ送っていない分も消え、Mac には消す記録を送る', async()=>{
  const {L,sent,net}=setup({online:false});
  const id=L.turn('消す質問（架空）');L.end(id,{status:'ok',answer:'消す答え'});await tick();
  await L._rec.remove('all');net.online=true;
  await L.flush(true);
  const evs=sent.flatMap(s=>s.events);
  assert.deepEqual(evs.map(e=>e.kind),['delete']);
  assert.ok(!JSON.stringify(evs).includes('消す質問'));
});

test('index.html のどの答えの道も記録につながっている', ()=>{
  const h=read('docs/index.html');
  for(const s of ["logStart(q,asked.chip?{chip:asked.chip}:undefined);logEnd({status:'ok',answer:pooled.text})", // infobase
    "logEnd({status:'ok',answer:text});", // その場の答え
    "errorKind:'calendar'", "errorKind:'need-more'", "{deeper:web?'web':'article'}", "{retry:'api'}", "{recheck:kind||'answer'}",
    "logEnd({status:failed?'error':partial?'cut':'ok'", "errorKind:'api-'", "errorKind:'mac-'+e.kind",
    "L.turn('',{kind:'greeting'})", "PiyoLog?.feedback(info.lt", "PiyoLog?.newConv()",
    '<script src="piyo-log/schema.js?v=1"></script>','<script src="piyo-log/recorder.js?v=1"></script>','<script src="piyo-log.js?v=1"></script>','id="set-piyolog"'])
    assert.ok(h.includes(s),s);
});
