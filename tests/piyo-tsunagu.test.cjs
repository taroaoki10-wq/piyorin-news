// 記憶と性格を Claude Pet のぴよとつなぐ（受け渡しの約束 2026-11-13）：前の指示が変わっていないこと・性格と記憶の足し方・購入記録の差分・設定の既定
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const html=read('docs/index.html');
const plain=v=>JSON.parse(JSON.stringify(v));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const xctx={window:{},TextEncoder,TextDecoder,setTimeout,clearTimeout,AbortController};
vm.runInNewContext(read('docs/piyo-extras.js'),xctx);
const X=xctx.window.PiyoExtras;
const B=require('../docs/piyo-buy.js');
const PERSONA=require('../docs/piyo-persona.js');
const mem=(init={})=>{const m=new Map(Object.entries(init));return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
function systems(){
  const i=html.indexOf('  const SYSTEM=`'),j=html.indexOf('  let history=[];',i);
  const c={};vm.createContext(c);vm.runInContext(html.slice(i,j)+';this.S=SYSTEM;this.M=SYSTEM_MAC;',c);
  return {SYSTEM:c.S,SYSTEM_MAC:c.M};
}

// 2026-11-13：ユーザーの頼みで「株価は → 日経平均・古い値は書かない」の 1 行を足したので、指紋を取り直した
test('SYSTEM と SYSTEM_MAC の文は 1 文字も変わっていない',()=>{
  const {SYSTEM,SYSTEM_MAC}=systems();
  assert.equal(sha(SYSTEM),'037750be4b29e64137af2f00a5bde916b5bb4c576fa61c9439525bbf1729a1fe');
  assert.equal(sha(SYSTEM_MAC),'7b478a3204e42fa985a86d9a5ec7193ea77781af1b3c4ac5c4421c1976a03c56');
});

test('性格は入りのときだけ、指示の末尾に約束どおりの 1 ブロックで足される',()=>{
  const {SYSTEM,SYSTEM_MAC}=systems();
  for(const base of [SYSTEM,SYSTEM_MAC]){
    const on=X.composeSystem(base,{storage:mem(),persona:PERSONA});
    assert.equal(on,base+'\n\n<persona>（ぴよの人柄。あいさつ・雑談・ありがとう・まちがいを言われたときだけ出す。ぴよりん情報の答え方・語尾・長さは上の決まりが先で、人柄で変えない）\n'+PERSONA.text+'\n</persona>');
    assert.ok(on.startsWith(base));
    assert.equal(X.composeSystem(base,{storage:mem({'piyo-persona-off':'1'}),persona:PERSONA}),base);
    assert.equal(X.composeSystem(base,{storage:mem({'piyo-persona-off':'0'}),persona:PERSONA}).startsWith(base+'\n\n<persona>'),true);
    assert.equal(X.composeSystem(base,{storage:mem(),persona:undefined}),base); // 性格の写しが読めなくても今までどおり
  }
});

test('記憶の札：7 日以内だけ API の道の指示に入り、persona の後に付く。Mac の道（memory なし）には付かない',()=>{
  const {SYSTEM}=systems(),now=Date.parse('2026-11-13T00:00:00Z');
  const st=mem();
  assert.equal(X.saveMemoryCard(st,{text:'ぴよりんが好き',at:now-6*86400e3}),true);
  const withMem=X.composeSystem(SYSTEM,{storage:st,persona:PERSONA,memory:true,now});
  assert.ok(withMem.endsWith('\n\n<memory>（ユーザーについて覚えていること。関係があるときだけ使い、無理に出さない。ぴよりん情報の答えは knowledge が先）\nぴよりんが好き\n</memory>'));
  assert.ok(withMem.indexOf('<persona>')<withMem.indexOf('<memory>'));
  assert.equal(X.composeSystem(SYSTEM,{storage:st,persona:PERSONA,memory:false,now}).includes('<memory>'),false);
  assert.equal(X.composeSystem(SYSTEM,{storage:st,persona:PERSONA,memory:true,now:now+2*86400e3}).includes('<memory>'),false); // 8 日たつと捨てる
  assert.equal(X.readMemoryCard(st,now-6*86400e3+7*86400e3),'ぴよりんが好き'); // ちょうど 7 日はまだ有効
  assert.equal(X.composeSystem(SYSTEM,{storage:mem({'piyo-memory-off':'1','piyo-memory-card':st.getItem('piyo-memory-card')}),persona:PERSONA,memory:true,now}).includes('<memory>'),false);
  assert.equal(X.readMemoryCard(mem({'piyo-memory-card':'こわれた'}),now),'');
  assert.equal(X.saveMemoryCard(mem(),{text:''},now),false);
  const s2=mem();X.saveMemoryCard(s2,{text:'あ'.repeat(700),at:now},now);
  assert.equal(JSON.parse(s2.getItem('piyo-memory-card')).text.length,600);
});

test('readRelay：event: memory を受け取り、ほかの種類の扱いは変わらない',async()=>{
  const enc=new TextEncoder();
  const ev=(e,d)=>`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  const mk=chunks=>{let i=0;return{body:{getReader:()=>({read:async()=>i<chunks.length?{value:enc.encode(chunks[i++]),done:false}:{value:undefined,done:true},cancel:()=>Promise.resolve()})}}};
  const got=[],texts=[];
  const r=await X.readRelay(mk([ev('memory',{text:'札',at:5}),ev('text',{text:'こんにちは'}),ev('done',{text:'こんにちはだぴよ'})]),t=>texts.push(t),null,undefined,d=>got.push(d));
  assert.deepEqual(plain(got),[{text:'札',at:5}]);assert.deepEqual(plain(texts),['こんにちは']);
  assert.equal(r.content[0].text,'こんにちはだぴよ');
  const r2=await X.readRelay(mk([ev('memory',{text:'札',at:5}),ev('done',{text:'x'})]),null,null); // 受け取り先が無くても止まらない
  assert.equal(r2.content[0].text,'x');
});

test('購入記録の差分：新しい・直した記録と、消えた id だけ',()=>{
  const rec=(id,u)=>({id,updatedAt:u});
  let d=B.syncDiff([rec('a',1),rec('b',2)],{sent:{},removed:[]});
  assert.deepEqual(d.records.map(r=>r.id),['a','b']);assert.deepEqual(d.removed,[]);
  d=B.syncDiff([rec('a',1),rec('b',3)],{sent:{a:1,b:2},removed:[]});
  assert.deepEqual(d.records.map(r=>r.id),['b']); // 直した物だけ
  d=B.syncDiff([rec('a',1)],{sent:{a:1,b:2},removed:[]});
  assert.deepEqual(d.records,[]);assert.deepEqual(d.removed,['b']); // 消えた物
  d=B.syncDiff([rec('a',1)],{sent:{a:1},removed:['z','a']}); // 残っている id は消えた扱いにしない
  assert.deepEqual(d.removed,['z']);
  assert.deepEqual(B.syncDiff([rec('a',1)],{sent:{a:1},removed:[]}),{records:[],removed:[]});
  assert.deepEqual(B.syncDiff([],null),{records:[],removed:[]});
  const many=Array.from({length:120},(_,i)=>rec('r'+i,1));
  assert.equal(B.syncDiff(many,{}).records.length,50);
  const gone=Object.fromEntries(Array.from({length:300},(_,i)=>['g'+i,1]));
  assert.equal(B.syncDiff([],{sent:gone}).removed.length,200);
});

test('購入記録：送れた分だけ印を更新し、失敗した id は残す',()=>{
  const st={sent:{b:2,c:1},removed:['c'],asked:true};
  const n=B.syncApply(st,[{id:'a',updatedAt:1},{id:'x',updatedAt:9}],['c'],['x']);
  assert.deepEqual(n,{sent:{a:1,b:2},removed:[],asked:true});
  assert.deepEqual(st.sent,{b:2,c:1}); // 元は変えない
});

test('購入記録：消した記録の削除が失敗したら、消した印を残して次に送り直す',()=>{
  const st={sent:{c:1,d:1},removed:['c','d'],asked:false};
  const n=B.syncApply(st,[],['c','d'],['c']);
  assert.deepEqual(n,{sent:{c:1},removed:['c'],asked:false});
  // 次の差分で、まだ消えていない c が removed として出る
  assert.deepEqual(B.syncDiff([],n).removed,['c']);
  // 全部成功なら消える
  assert.deepEqual(B.syncApply(n,[],['c'],[]),{sent:{},removed:[],asked:false});
});

test('つなぎ方・送る形',()=>{
  const link={url:'https://mac.tail1.ts.net',token:'a'.repeat(24)};
  assert.deepEqual(plain(X.readMacLink(mem({'piyo-mac':JSON.stringify(link)}))),link);
  assert.equal(X.readMacLink(mem()),null);
  assert.equal(X.readMacLink(mem({'piyo-mac':JSON.stringify({url:'http://x',token:link.token})})),null);
  const b=X.syncBody([{url:'https://a/1',title:'t',date:'2026-11-01',extra:1},{url:'javascript:x',title:'bad'}],['n1','n2']);
  assert.deepEqual(plain(b),{bookmarks:[{url:'https://a/1',title:'t',date:'2026-11-01'}],seen:['n1','n2']});
  assert.equal(X.syncBody(Array(300).fill({url:'https://a'}),Array(400).fill('i')).bookmarks.length,200);
  assert.equal(X.syncBody([],Array(400).fill('i')).seen.length,300);
});

test('macJson：Bearer で送り、つながらないときは unreachable',async()=>{
  const link={url:'https://mac.tail1.ts.net',token:'a'.repeat(24)};
  let seen;
  const ok=await X.macJson(link,'/piyo-news/buy',{records:[]},async(u,o)=>{seen={u,o};return{ok:true,status:200,json:async()=>({ok:true})}});
  assert.equal(seen.u,link.url+'/piyo-news/buy');assert.equal(seen.o.headers.authorization,'Bearer '+link.token);
  assert.equal(ok.status,200);assert.equal(ok.body.ok,true);
  const bad=await X.macJson(link,'/x',{},async()=>{throw new TypeError('network')});
  assert.deepEqual(plain(bad),{ok:false,kind:'unreachable'});
  const r503=await X.macJson(link,'/x',{},async()=>({ok:false,status:503,json:async()=>({error:'selfbase'})}));
  assert.equal(r503.ok,false);assert.equal(r503.status,503);
});

test('設定の既定はどれも入り（鍵が無いとき入り・\'1\' で切）',()=>{
  for(const n of ['persona','memory','convo','buysync']){
    assert.equal(X.flagOn(mem(),n),true);
    assert.equal(X.flagOn(mem({[X.FLAG_KEYS[n]]:'1'}),n),false);
    assert.equal(X.flagOn(mem({[X.FLAG_KEYS[n]]:'0'}),n),true);
    assert.match(html,new RegExp(`<input type="checkbox" data-flag="${n}" checked>`));
  }
  assert.deepEqual(plain(X.FLAG_KEYS),{persona:'piyo-persona-off',memory:'piyo-memory-off',convo:'piyo-convo-off',buysync:'piyo-buysync-off',wxfig:'piyo-wxfig-off'});
  assert.match(html,/要約だけを送ります（全文は送りません）/);
});

test('版・読み込み・Mac への送り',()=>{
  assert.match(html,/<meta name="piyo-ver" content="2026\.11\.13-3">/);
  assert.match(html,/PN_VERSION='2026\.11\.13-3（天気の図・株価は日経平均）'/);
  assert.match(html,/<script src="piyo-persona\.js\?v=\d+"><\/script>/);
  assert.match(html,/memory:flag\('memory'\),remember:flag\('convo'\)/);
});
