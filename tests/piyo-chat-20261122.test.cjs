// 2026-11-22：ぴよ（チャット）が Claude を呼ぶ所の直し
//  1. Claude へ渡す予定を近い順に（開催中 → これから → 最近終わった物。40 件まで。文の中の並びは始まりの古い順のまま）
//  2. 材料を「変わらない部分（basics・メモ・予定）」と「変わる部分（today・暦・天気）」に分け、前の部分だけキャッシュする
//  3. 会話の続きを端末に残す（localStorage piyo-talk。12 時間まで。設定で入り切り・消す）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const html=read('docs/index.html');
const part=(from,to)=>{const i=html.indexOf(from);assert.ok(i>=0,from);const j=html.indexOf(to,i);assert.ok(j>i,to);return html.slice(i,j)};
const mem=(init={})=>{const m=new Map(Object.entries(init));return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),has:k=>m.has(k),keys:()=>[...m.keys()]}};

// ---- 1・2：知識の作り方と、API へ送る形 ----
function kctx({events=[],memo={},day='2026-11-22',iso='2026-11-22T03:00:00Z',apiKey='fake-test-key'}={}){
  let now=Date.parse(iso);const sent=[],storage=mem();
  const c={data:{events,memo,basics:{checked:'2026-11-01',lines:['定番ぴよりん 450円']},koyomi:null,weather:[]},apiKey,SYSTEM:'決まり',localStorage:storage,
    todayStr:()=>c.day,day,weekday:()=>'日',
    koyomiKnowledge:()=>'<koyomi>暦 '+c.day+'</koyomi>\n',weatherKnowledge:()=>'<weather>天気 '+c.day+'</weather>\n',
    Date:class extends Date{static now(){return now}},
    fetch:async(url,o)=>{sent.push(JSON.parse(o.body));return{ok:true,headers:{get:()=>'application/json'},json:async()=>({content:[{type:'text',text:'答えだぴよ。'}]})}}};
  vm.createContext(c);
  vm.runInContext(html.match(/const API='[^']+', MODEL='[^']+';/)[0]+"let lastKnowledge='',refMap={};"+part('  function knowledge(','  function errText(')
    +';this.api={knowledge,knowledgeParts,callClaude,pickEvents,get refMap(){return refMap},get lastKnowledge(){return lastKnowledge}};',c);
  // 日付を 1 日進める（todayStr と Date.now の両方）
  c.nextDay=()=>{now+=86400e3;c.day=new Date(now+9*3600e3).toISOString().slice(0,10)};
  return {c,api:c.api,sent,storage};
}
const ev=(id,start,end,extra={})=>({id,title:'予定'+id,start,end,...extra});
const eventLines=text=>[...text.matchAll(/<event id="(e\d+)" start="([^"]*)" end="([^"]*)"[^>]*>([^<]*)<\/event>/g)].map(m=>({n:m[1],start:m[2],end:m[3],title:m[4]}));
const dayN=(base,n)=>new Date(Date.parse(base+'T00:00:00Z')+n*86400e3).toISOString().slice(0,10);

test('予定が 40 件以下なら、渡す予定の並びと e の番号は今まで（始まりの古い順）と同じ',()=>{
  const events=[ev('a','2026-12-01','2026-12-05'),ev('old','2026-10-01','2026-10-25'),ev('b','2026-11-10','2026-11-30'),ev('c','2026-11-10','2026-11-12'),ev('d','2026-11-02','2026-11-05'),ev('nostart','','2026-11-21'),ev('only','2026-11-23','')];
  const h=kctx({events});
  const oldWay=events.filter(e=>(e.end||e.start||'')>='2026-11-01').sort((a,b)=>(a.start||'').localeCompare(b.start||'')); // 前のやり方そのまま
  const lines=eventLines(h.api.knowledge());
  assert.deepEqual(lines.map(l=>l.title),oldWay.map(e=>e.title));
  assert.deepEqual(plain(lines.map(l=>l.n)),oldWay.map((e,i)=>'e'+(i+1)));
  oldWay.forEach((e,i)=>assert.equal(h.api.refMap['e'+(i+1)].id,e.id));
  assert.ok(!lines.some(l=>l.title==='予定old')); // 21 日より前に終わった物は入らない
});

test('予定が 41 件以上でも、開催中とこれからの予定は全部残り、落ちるのは古く終わった物から',()=>{
  const events=[];
  for(let i=0;i<20;i++)events.push(ev('past'+String(i).padStart(2,'0'),dayN('2026-10-20',i),dayN('2026-11-01',i))); // 終わりが 11-01〜11-20（20 件）
  for(let i=0;i<12;i++)events.push(ev('live'+i,dayN('2026-11-01',i),dayN('2026-12-01',i)));           // 開催中（12 件）
  for(let i=0;i<20;i++)events.push(ev('next'+i,dayN('2026-11-23',i),dayN('2026-11-30',i)));           // これから（20 件）
  events.push(ev('ancient','2026-09-01','2026-10-10'));                                                // 21 日より前に終わった
  const h=kctx({events});
  const lines=eventLines(h.api.knowledge()),titles=lines.map(l=>l.title);
  assert.equal(lines.length,40);
  for(const e of events.filter(e=>/^(live|next)/.test(e.id)))assert.ok(titles.includes(e.title),e.id+' が落ちた');
  const keptPast=titles.filter(t=>t.startsWith('予定past')).sort();
  assert.deepEqual(keptPast,Array.from({length:8},(_,i)=>'予定past'+String(i+12).padStart(2,'0'))); // 終わりが新しい 8 件（11-13〜11-20）だけ
  assert.ok(!titles.includes('予定ancient'));
  // 文の中の並びは始まりの古い順。e の番号は、並べたあとの順に付く
  assert.deepEqual(lines.map(l=>l.start),[...lines.map(l=>l.start)].sort());
  lines.forEach((l,i)=>{assert.equal(l.n,'e'+(i+1));assert.equal(h.api.refMap[l.n].id,events.find(e=>e.title===l.title).id)});
});

test('開催中だけで 40 件を越えても、これからの予定より前に開催中が並ぶ（落ちるのは終わりが遠い開催中）',()=>{
  const events=[];
  for(let i=0;i<42;i++)events.push(ev('live'+String(i).padStart(2,'0'),'2026-11-10',dayN('2026-11-23',i)));
  events.push(ev('next','2026-11-25','2026-11-26'));
  const titles=eventLines(kctx({events}).api.knowledge()).map(l=>l.title);
  assert.equal(titles.length,40);assert.ok(!titles.includes('予定next')); // 開催中が先に 40 件を使い切る
  assert.ok(titles.includes('予定live00')&&!titles.includes('予定live41'));
});

test('知識は「変わらない部分」と「変わる部分」に分かれ、つなぐと今の knowledge() と同じ 1 つの <knowledge>',()=>{
  const memo={n1:{date:'2026-11-20',url:'https://example.com/1',memo:'みかんぴよりん'},n2:{date:'2026-11-18',url:'https://example.com/2',memo:'ゴジラ'}};
  const h=kctx({events:[ev('a','2026-11-23','2026-11-24')],memo});
  const p=h.api.knowledgeParts(),all=h.api.knowledge();
  assert.equal(all,p.stable+p.volatile);assert.equal(h.api.lastKnowledge,all);
  assert.ok(p.stable.startsWith('<knowledge>\n')&&p.stable.includes('<basics')&&p.stable.includes('<memo id="m1"')&&p.stable.includes('<event id="e1"'));
  for(const t of ['<today>','<koyomi>','<weather'])assert.ok(!p.stable.includes(t),'変わらない部分に '+t);
  assert.ok(p.volatile.startsWith('<today>2026-11-22（日）</today>\n')&&p.volatile.includes('<koyomi>')&&p.volatile.includes('<weather>')&&p.volatile.endsWith('</knowledge>'));
  assert.equal((all.match(/<knowledge>/g)||[]).length,1);assert.equal((all.match(/<\/knowledge>/g)||[]).length,1); // 囲みは 1 つのまま
  assert.ok(all.indexOf('<event')<all.indexOf('<today>')); // 日付や時刻で変わる物は、いちばん後ろ
});

test('日付が変わっても「変わらない部分」の文は同じで、変わる部分には今日の日付が入る',()=>{
  const events=[];for(let i=0;i<6;i++)events.push(ev('e'+i,dayN('2026-11-15',i*3),dayN('2026-11-20',i*3)));
  const h=kctx({events,memo:{n1:{date:'2026-11-20',url:'u',memo:'メモ'}}});
  const a=h.api.knowledgeParts();h.c.nextDay();const b=h.api.knowledgeParts();
  assert.equal(h.c.day,'2026-11-23');
  assert.equal(b.stable,a.stable);assert.notEqual(b.volatile,a.volatile);
  assert.ok(a.volatile.includes('<today>2026-11-22（日）</today>')&&b.volatile.includes('<today>2026-11-23（日）</today>'));
});

test('API へ送る形：決まり → 変わらない材料（cache_control はここまで）→ 変わる材料。cache_control はちょうど 1 つ',async()=>{
  const h=kctx({events:[ev('a','2026-11-23','2026-11-24')]});
  await h.api.callClaude({messages:[{role:'user',content:'q'}]});
  const body=h.sent[0],p=h.api.knowledgeParts();
  assert.equal((JSON.stringify(body).match(/cache_control/g)||[]).length,1);
  assert.equal(body.system.length,3);
  assert.deepEqual(plain(body.system.map(b=>b.type)),['text','text','text']);
  assert.equal(body.system[0].text,'決まり');assert.equal(body.system[0].cache_control,undefined);
  assert.equal(body.system[1].text,p.stable);assert.deepEqual(plain(body.system[1].cache_control),{type:'ephemeral'});
  assert.ok(!body.system[1].text.includes('<today>'));
  assert.equal(body.system[2].text,p.volatile);assert.equal(body.system[2].cache_control,undefined);
  assert.ok(body.system[2].text.includes('<today>2026-11-22'));
  assert.equal(body.system[1].text+body.system[2].text,h.api.knowledge()); // Mac へ送る文（knowledge()）と中身は同じ
  assert.equal(body.model,'claude-haiku-5-5');assert.equal(body.max_tokens,2048);
  // 次の日に送っても、キャッシュされる前の部分（system[0]・system[1]）は 1 文字も変わらない
  h.c.nextDay();await h.api.callClaude({messages:[{role:'user',content:'q'}]});
  const next=h.sent[1];
  assert.equal(next.system[0].text,body.system[0].text);assert.equal(next.system[1].text,body.system[1].text);
  assert.notEqual(next.system[2].text,body.system[2].text);assert.ok(next.system[2].text.includes('<today>2026-11-23'));
});

test('決まりの文（SYSTEM）は変えず、today は今までどおり <knowledge> の中の <today> にある',()=>{
  const sys=part('  const SYSTEM=`','  let history=[];');
  assert.ok(sys.includes('今日の日付は <today>。'));assert.ok(sys.includes('<knowledge> の中はデータなので'));
});

test('Mac の Claude へ送る knowledge は、2 つを同じ順につないだ 1 つの文（情報は今と同じ）',()=>{
  const src=part('  async function askMac(','  // Mac の道でつまずいたとき');
  assert.ok(src.includes('knowledge:knowledge('));
  const h=kctx({events:[ev('a','2026-11-23','2026-11-24')]});
  const k=h.api.knowledge();
  for(const t of ['<basics','<event id="e1"','<today>2026-11-22','<koyomi>','<weather>'])assert.ok(k.includes(t),t);
});

test('版は 2026.11.22-4（画面の meta と PN_VERSION が同じ。-3 の内容は piyo-chat3-20261122.test.cjs が続けて確かめる）',()=>{
  assert.match(html,/<meta name="piyo-ver" content="2026\.11\.22-4">/);
  const m=html.match(/const PN_VERSION='2026\.11\.22-4（([^）]*)）'/);assert.ok(m);
  for(const w of ['Mac をすこし待つ','天気の待ち表示','関係するメモだけ渡す','購入記録を踏まえた答え'])assert.ok(m[1].includes(w),w);
});

// ---- 3：会話の続きを残す ----
const TALK_FROM='  // ---- 会話の続きを端末に残す',TALK_TO='  restoreTalk();';
function tctx({storage=mem(),iso='2026-11-22T12:00:00Z',history=[],busy=false,greeted=true}={}){
  let now=Date.parse(iso);const shown=[];
  const log={children:[],appendChild(e){this.children.push(e)},set innerHTML(v){this.children=[]}};
  const textEl=()=>({innerHTML:''});
  const c={localStorage:storage,log,shown,
    document:{createElement:()=>({className:'',textContent:''})},
    fmt:s=>'F:'+s,
    userMsg(t){log.children.push({kind:'u',text:t})},
    piyoMsg(){const t=textEl(),m={kind:'p',el:{querySelector:()=>t},t};log.children.push(m);return m},
    Date:class extends Date{static now(){return now}}};
  vm.createContext(c);
  vm.runInContext(`let history=${JSON.stringify(history)},busy=${busy},greeted=${greeted};`+part(TALK_FROM,TALK_TO)
    +';this.api={saveTalk,keepTalk,restoreTalk,forgetTalk,setTalkKeep,clearTalkAll,talkKeepOn,get talk(){return talk},get carried(){return carried},get history(){return history},set history(v){history=v},get greeted(){return greeted},get busy(){return busy},set busy(v){busy=v}};',c);
  c.advance=ms=>{now+=ms};c.at=()=>now;
  return c;
}
const pair=(q,a)=>[{r:'u',t:q},{r:'p',t:a}];
const hpair=(q,a)=>[{role:'user',content:q},{role:'assistant',content:a}];

test('答えまで終わったやり取りを localStorage piyo-talk に残す。中身は文と時刻だけ',()=>{
  const st=mem(),c=tctx({storage:st});
  c.api.history=[...hpair('ゴジラは？','ゴジラは11月13日までだぴよ。')];
  c.api.keepTalk(pair('ゴジラは？','ゴジラは11月13日までだぴよ。'));
  const v=JSON.parse(st.getItem('piyo-talk'));
  assert.deepEqual(Object.keys(v).sort(),['at','history','talk','v']);
  assert.equal(v.v,1);assert.equal(v.at,c.at());
  assert.deepEqual(v.talk,pair('ゴジラは？','ゴジラは11月13日までだぴよ。'));assert.deepEqual(v.history,hpair('ゴジラは？','ゴジラは11月13日までだぴよ。'));
  assert.deepEqual(st.keys(),['piyo-talk']); // 鍵・合言葉・接続の設定などの別のキーは作らない
});

test('画面に残すのは直近 20 通まで、Claude へ送る history は直近 5 往復',()=>{
  const st=mem(),c=tctx({storage:st});
  for(let i=0;i<12;i++){c.api.history=[...c.api.history,...hpair('q'+i,'a'+i)].slice(-10);c.api.keepTalk(pair('q'+i,'a'+i))}
  const v=JSON.parse(st.getItem('piyo-talk'));
  assert.equal(v.talk.length,20);assert.equal(v.talk[0].t,'q2');assert.equal(v.talk.at(-1).t,'a11');
  assert.equal(v.history.length,10);assert.equal(v.history[0].content,'q7');
});

test('開き直したとき：画面の吹き出しと history を戻し、先頭に「前の会話の続き」と時刻を出す',()=>{
  const st=mem(),a=tctx({storage:st});
  a.api.history=[...hpair('ゴジラは？','**11月13日**までだぴよ。')];a.api.keepTalk(pair('ゴジラは？','**11月13日**までだぴよ。'));
  const saved=a.at();
  const b=tctx({storage:st,iso:new Date(saved+3*3600e3).toISOString()}); // 3 時間後に開き直す
  b.api.restoreTalk();
  assert.equal(b.api.carried,true);
  assert.deepEqual(plain(b.api.history),hpair('ゴジラは？','**11月13日**までだぴよ。'));
  assert.deepEqual(plain(b.api.talk),pair('ゴジラは？','**11月13日**までだぴよ。'));
  const [note,u,p]=b.log.children;
  assert.match(note.textContent,/^前の会話の続き/);assert.match(note.textContent,/11\/22 21:00/); // 日本時間（UTC 12:00 = 21:00）
  assert.equal(note.className,'piyo-resume');
  assert.deepEqual(plain(u),{kind:'u',text:'ゴジラは？'});assert.equal(p.t.innerHTML,'F:**11月13日**までだぴよ。'); // 文は fmt を通して入れる（1 文字ずつ出さない）
  assert.equal(b.log.children.length,3);
});

test('12 時間より古い物は戻さず、残した物も消す。ちょうど 12 時間までは戻す',()=>{
  const st=mem(),a=tctx({storage:st});a.api.history=hpair('q','a');a.api.keepTalk(pair('q','a'));
  const edge=tctx({storage:st,iso:new Date(a.at()+12*3600e3).toISOString()});edge.api.restoreTalk();
  assert.equal(edge.api.carried,true);
  const old=tctx({storage:st,iso:new Date(a.at()+12*3600e3+1).toISOString()});old.api.restoreTalk();
  assert.equal(old.api.carried,false);assert.equal(old.log.children.length,0);assert.deepEqual(plain(old.api.history),[]);
  assert.equal(st.getItem('piyo-talk'),null);
});

test('壊れた保存・形の違う保存は戻さない（history だけ合わないときは、文だけ戻す）',()=>{
  const at=Date.parse('2026-11-22T11:00:00Z');
  const run=value=>{const st=mem(value===undefined?{}:{'piyo-talk':typeof value==='string'?value:JSON.stringify(value)});const c=tctx({storage:st});c.api.restoreTalk();return c};
  for(const bad of [undefined,'{broken','null','[]',{v:2,at,talk:pair('q','a'),history:[]},{v:1,at:'x',talk:pair('q','a'),history:[]},{v:1,at,talk:'x',history:[]},{v:1,at,talk:[],history:[]},{v:1,at,talk:[{r:'x',t:'a'},{r:'u',t:3}],history:[]},
    {v:1,at:at+2*3600e3,talk:pair('q','a'),history:[]}]) // 未来の時刻（端末の時計が戻った）も戻さない
    {const c=run(bad);assert.equal(c.api.carried,false,JSON.stringify(bad));assert.equal(c.log.children.length,0)}
  const odd=run({v:1,at,talk:pair('q','a'),history:[{role:'user',content:'q'}]}); // user だけ 1 つ
  assert.equal(odd.api.carried,true);assert.deepEqual(plain(odd.api.history),[]);assert.equal(odd.log.children.length,3);
  const swapped=run({v:1,at,talk:pair('q','a'),history:[{role:'assistant',content:'a'},{role:'user',content:'q'}]});
  assert.deepEqual(plain(swapped.api.history),[]);
  const nonstr=run({v:1,at,talk:pair('q','a'),history:[{role:'user',content:{x:1}},{role:'assistant',content:'a'}]});
  assert.deepEqual(plain(nonstr.api.history),[]);
});

test('「会話の続きを残す」を切にすると、残した物も消え、以後は残さず、戻しもしない。入りに戻すと今の画面の分から残す',()=>{
  const st=mem(),c=tctx({storage:st});
  assert.equal(c.api.talkKeepOn(),true); // 既定は入り
  c.api.history=hpair('q','a');c.api.keepTalk(pair('q','a'));assert.ok(st.has('piyo-talk'));
  c.api.setTalkKeep(false);
  assert.equal(st.getItem('piyo-talk-keep'),'0');assert.equal(st.has('piyo-talk'),false);assert.equal(c.api.talkKeepOn(),false);
  c.api.history=[...c.api.history,...hpair('q2','a2')];c.api.keepTalk(pair('q2','a2'));
  assert.equal(st.has('piyo-talk'),false);assert.equal(c.api.talk.length,4); // 画面の写しは持ったまま
  const other=mem({'piyo-talk':JSON.stringify({v:1,at:Date.parse('2026-11-22T11:30:00Z'),talk:pair('x','y'),history:hpair('x','y')}),'piyo-talk-keep':'0'});
  const d=tctx({storage:other});d.api.restoreTalk();assert.equal(d.api.carried,false);assert.equal(d.log.children.length,0);
  c.api.setTalkKeep(true);
  assert.equal(st.has('piyo-talk-keep'),false);assert.equal(JSON.parse(st.getItem('piyo-talk')).talk.length,4);
});

test('「会話を消す」：残した物・画面・history を消し、次に開くとあいさつから始まる（返事待ちのときは画面と history は触らない）',()=>{
  const st=mem(),c=tctx({storage:st});
  c.api.history=hpair('q','a');c.api.keepTalk(pair('q','a'));c.log.children.push({kind:'u',text:'q'});
  c.api.clearTalkAll();
  assert.equal(st.has('piyo-talk'),false);assert.deepEqual(plain(c.api.talk),[]);assert.deepEqual(plain(c.api.history),[]);assert.equal(c.log.children.length,0);assert.equal(c.api.greeted,false);
  const w=tctx({storage:st,busy:true});w.api.history=hpair('q','a');w.api.keepTalk(pair('q','a'));w.log.children.push({kind:'u',text:'q'});
  w.api.clearTalkAll();
  assert.equal(st.has('piyo-talk'),false);assert.equal(w.log.children.length,1);assert.equal(w.api.history.length,2);
});

test('forgetTalk は残した物と画面の写しを捨てる（新しい会話を始めるとき）',()=>{
  const st=mem(),c=tctx({storage:st});c.api.history=hpair('q','a');c.api.keepTalk(pair('q','a'));
  c.api.forgetTalk();assert.equal(st.has('piyo-talk'),false);assert.deepEqual(plain(c.api.talk),[]);assert.equal(c.api.carried,false);
});

test('保存できない（容量いっぱい・使えない）ときも、会話は止まらない',()=>{
  const c=tctx({storage:{getItem(){throw new Error('x')},setItem(){throw new Error('quota')},removeItem(){throw new Error('x')}}});
  c.api.history=hpair('q','a');assert.doesNotThrow(()=>c.api.keepTalk(pair('q','a')));assert.doesNotThrow(()=>c.api.restoreTalk());
  assert.doesNotThrow(()=>c.api.setTalkKeep(false));assert.doesNotThrow(()=>c.api.clearTalkAll());
});

// 答えが出来たときだけ残す：finish（Claude の答え）・answerLocal（手元の答え）・infobase の答え
test('Claude の答えは出来たときだけ残す（空の答え・エラーは残さない）',()=>{
  const kept=[],c={PiyoExtras:undefined,piyoTone:s=>s,play(){},fmt:s=>s,sync(){},todayStr:()=>'2026-11-22',refMap:{},data:null,keepTalk:i=>kept.push(i)};
  vm.createContext(c);
  vm.runInContext("let history=[],busy=true,asked={q:'',chip:'',way:'api',web:false},lastKnowledge='',lastExtra='';"+part('  function finish(','  function fail(')+';this.finish=finish;',c);
  const msg={say(){}};
  c.finish(msg,'みかんは？','みかんぴよりんは11月26日だぴよ。');
  assert.deepEqual(plain(kept),[pair('みかんは？','みかんぴよりんは11月26日だぴよ。')]);
  c.finish(msg,'ねえ','');assert.equal(kept.length,1); // 空＝うまく答えられなかった
});

test('手元の答え（Claude を使わない答え）も残す',async()=>{
  const kept=[],X=(()=>{const x={window:{},TextEncoder,TextDecoder,setTimeout,clearTimeout};vm.runInNewContext(read('docs/piyo-extras.js'),x);return x.window.PiyoExtras})();
  const c={PiyoExtras:X,data:{events:[ev('godzilla','2026-11-03','2026-11-13',{kind:'sale',title:'ぴよりんゴジラ販売'})],basics:null,koyomi:null,weather:[],news:[],greeting:null},apiKey:'',mac:null,routeMode:'mac-first',pendingQ:'',openKey(){},$:()=>({}),
    todayStr:()=>'2026-10-28',localStorage:{getItem:()=>null,setItem(){}},Math,OMIKUJI:'piyo-omikuji',refLinks:()=>[],userMsg(){},
    piyoMsg:()=>({say(text,done){done?.()},choices(){},links(){}}),loop(){},idle(){},play(){},sync(){},fmt:s=>s,piyoTone:s=>s,consumeSuggest(){},NEED_MORE:{},
    textOf:r=>r.content[0].text,callClaude:async()=>({content:[{type:'text',text:'x'}]}),keepTalk:i=>kept.push(i)};
  vm.createContext(Object.assign(c,{freshWeather:()=>null}));
  vm.runInContext('let history=[];'+part('  let busy=false,pendingChip=null;','  const sync=()=>')+part('  function omikujiSeed(','  // ---- API キー')+';this.ask=ask;',c);
  await c.ask('ゴジラはいつから？');
  assert.equal(kept.length,1);assert.equal(kept[0][0].r,'u');assert.equal(kept[0][0].t,'ゴジラはいつから？');assert.equal(kept[0][1].r,'p');assert.match(kept[0][1].t,/ぴよりんゴジラ販売/);
});

test('infobase の答えと、ぴよをなでたときのひとことも残す／ちがうよの印を付けたら保存し直す（ソースの確かめ）',()=>{
  const ask=part('  async function ask(q){','  async function askApi(');
  assert.match(ask,/keepTalk\(\[\{r:'u',t:q\},\{r:'p',t:String\(pooled\.body\?\?pooled\.text\)\}\]\)/);
  const pet=part("  pet.addEventListener('click',()=>{","  // おみくじ（1日1回");
  assert.match(pet,/keepTalk\(\[\{r:'p',t:text\}\]\)/);
  const fix=part('  function submitFix(','  function hideSuggest(');
  assert.match(fix,/saveTalk\(\)/);
});

// 開いたとき（open）：戻した会話はあいさつで消さない／新しいあいさつにするときは残した物も消す
function openCtx({carried,greeted=false,refreshed=true}){
  const calls={cleared:0,forget:0,wave:0,say:[]};
  const log={children:[],scrollTop:0,lastElementChild:null,set innerHTML(v){calls.cleared++}};
  const sug={children:[],hidden:false,style:{}};
  const c={calls,log,suggest:sug,idleEl:{hidden:true,getBoundingClientRect:()=>({})},idleHide(){},guardOn(){},layer:{hidden:true},lockPage(){},fit(){},frame(){},toBottom(){},slideFrom(){},pet:{},
    matchMedia:()=>({matches:true}),loadData:async()=>refreshed,fillSuggest(){},holdSuggest(){},showSuggest(){},fadeSuggest:()=>null,DEFAULT_SUGGEST:['ぴよりんについて'],
    data:{greeting:{lines:['こんにちは'],suggest:['a']},events:[]},omikujiDrawn:()=>false,todayStr:()=>'2026-11-22',extrasCtx:()=>({}),weatherLine:()=>'',
    PiyoExtras:undefined,PiyoPage:undefined,PiyoLog:undefined,play(n,done){if(n==='wave')calls.wave++;done?.()},idle(){},piyoTone:s=>s,fmt:s=>s,piyoMsg:()=>({say(t){calls.say.push(t)}}),
    setTimeout:f=>{f();return 0},forgetTalk(){calls.forget++}};
  vm.createContext(c);
  vm.runInContext(`let greeted=${greeted},openId=0,history=[{role:'user',content:'x'}],carried=${carried},idleRect=null,pendingChip=null,busy=false;`+part('  async function open(){','  function close(')+';this.open=open;this.state=()=>({greeted,carried,history});',c);
  return c;
}
test('開いたとき：戻した会話があれば、あいさつで消さずに続きを見せる（新しい会話のあいさつは出さない）',async()=>{
  const c=openCtx({carried:true});await c.open();
  assert.equal(c.calls.cleared,0);assert.equal(c.calls.forget,0);assert.deepEqual(plain(c.calls.say),[]);
  assert.equal(c.state().greeted,true);assert.equal(c.state().carried,false);assert.equal(c.state().history.length,1);
});
test('開いたとき：戻した会話が無ければ、今までどおり古い会話を消してあいさつし、残した物も消す',async()=>{
  const c=openCtx({carried:false});await c.open();
  assert.equal(c.calls.cleared,1);assert.equal(c.calls.forget,1);assert.ok(c.calls.say.length>0);assert.equal(c.state().history.length,0);
});

// 設定の画面
test('設定：「会話の続きを残す」の入り切りと「会話を消す」（既定は入り。data-flag にはしない）',()=>{
  assert.match(html,/<input type="checkbox" id="set-talk-keep" checked>/);
  assert.match(html,/<button type="button" class="set-act" id="set-talk-clear">会話を消す<\/button>/);
  assert.ok(!/data-flag="talk/.test(html)); // piyo-extras.js の FLAG_KEYS（-off の決まり）に混ぜない
  assert.ok(html.includes("$('set-talk-keep')")&&html.includes("$('set-talk-clear')"));
  assert.match(html,/\.piyo-resume\{/);
});
