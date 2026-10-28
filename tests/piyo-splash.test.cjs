const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
const start=html.indexOf('window.PiyoSplash=');
const source=html.slice(start,html.indexOf('</script>',start));
const MIN=60000,START=Date.parse('2026-10-29T03:00:00Z');
function target(object={}){
  const listeners=new Map();
  return Object.assign(object,{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},
    emit(type){for(const fn of listeners.get(type)||[])fn()}});
}
// 読み込み画面のスクリプトを、時計・保存・画面の大きさを差し替えて動かす
function setup({last,mobile=true,reduced=false,broken=false}={}){
  let now=START,nextId=0;
  const timers=new Map(),store=new Map(),log=[];
  if(last!==undefined)store.set('piyo-last-open',String(last));
  const classes=new Set();
  const el={removed:false,classList:{add(c){classes.add(c);log.push([c,now-START])},contains:c=>classes.has(c)},remove(){this.removed=true;log.push(['remove',now-START])}};
  const document=target({visibilityState:'visible',getElementById:id=>{assert.equal(id,'splash');return el}});
  const window=target({});
  const fail=()=>{throw Error('storage blocked')};
  const localStorage={getItem:k=>broken?fail():store.has(k)?store.get(k):null,setItem:(k,v)=>broken?fail():store.set(k,String(v))};
  const ctx={window,document,localStorage,addEventListener:window.addEventListener,
    Date:class extends Date{static now(){return now}},
    getComputedStyle:()=>({display:mobile?'flex':'none'}),
    matchMedia:q=>({matches:reduced&&q.includes('reduce')}),
    setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{at:now+ms,fn});return id}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {el,log,store,document,window,splash:ctx.window.PiyoSplash,
    advance(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);now=next[1].at;next[1].fn()}now=end},
    at:name=>(log.find(([c])=>c===name)||[])[1]};
}
test('はじめて開いたときは、すぐ読めても消え始めるまで3秒見せる',()=>{
  const h=setup();assert.equal(h.el.removed,false);
  h.advance(500);h.splash.done();
  h.advance(1859);assert.equal(h.el.classList.contains('wave'),false);
  h.advance(1);assert.equal(h.at('wave'),2360); // 手を振る（0.64秒）
  h.advance(639);assert.equal(h.el.classList.contains('bye'),false);
  h.advance(1);assert.equal(h.at('bye'),3000); // ここから0.35秒でふわっと消える
  h.advance(400);assert.equal(h.at('remove'),3400);
});
test('読むのに3秒より長くかかったら、読み終えてから手を振る',()=>{
  const h=setup();h.advance(4000);h.splash.done();h.advance(0);
  assert.equal(h.at('wave'),4000);h.advance(640);assert.equal(h.at('bye'),4640);
});
test('読めなくても5秒で消え始め、あとから読み終えても二重に動かない',()=>{
  const h=setup();h.advance(5000);assert.equal(h.at('wave'),5000);
  h.splash.done();h.advance(2000);
  assert.deepEqual(h.log.map(([c])=>c),['wave','bye','remove']);assert.equal(h.at('bye'),5640);
});
test('動きを減らす設定でも、消え始めるまで3秒',()=>{
  const h=setup({reduced:true});h.advance(100);h.splash.done();
  h.advance(2900);assert.equal(h.at('wave'),2850);assert.equal(h.at('bye'),3000);
});
test('前に開いていた時から10分以内なら出さない。10分ちょうどからは出す',()=>{
  const recent=setup({last:START-9*MIN});assert.equal(recent.el.removed,true);
  recent.splash.done();recent.advance(6000);assert.deepEqual(recent.log.map(([c])=>c),['remove']);
  const justTen=setup({last:START-10*MIN});assert.equal(justTen.el.removed,false);
  const old=setup({last:START-3*60*MIN});assert.equal(old.el.removed,false);
});
test('記録が未来の時刻（時計の巻き戻り）や壊れた値なら、いつもどおり出す',()=>{
  assert.equal(setup({last:START+5*MIN}).el.removed,false);
  assert.equal(setup({last:'abc'}).el.removed,false);
});
test('開いた時と、閉じた・ほかのアプリへ移った時の時刻を記録する',()=>{
  const h=setup();assert.equal(h.store.get('piyo-last-open'),String(START));
  h.advance(7*MIN);h.document.visibilityState='hidden';h.document.emit('visibilitychange');
  assert.equal(h.store.get('piyo-last-open'),String(START+7*MIN));
  h.advance(MIN);h.document.visibilityState='visible';h.document.emit('visibilitychange');
  assert.equal(h.store.get('piyo-last-open'),String(START+7*MIN)); // 戻ってきた時は書かない
  h.advance(MIN);h.window.emit('pagehide');assert.equal(h.store.get('piyo-last-open'),String(START+9*MIN));
});
test('保存が使えない端末でもエラーにならず、いつもどおり出す',()=>{
  const h=setup({broken:true});assert.equal(h.el.removed,false);
  h.advance(200);h.splash.done();h.advance(3400);assert.equal(h.el.removed,true);
  h.document.visibilityState='hidden';h.document.emit('visibilitychange');
});
test('PC の幅では出さないが、開いた時刻は記録する',()=>{
  const h=setup({mobile:false});assert.equal(h.el.removed,true);assert.equal(h.store.get('piyo-last-open'),String(START));
});
