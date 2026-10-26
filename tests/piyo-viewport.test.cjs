const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
function target(object={}){
  const listeners=new Map();
  return Object.assign(object,{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},
    emit(type){for(const fn of listeners.get(type)||[])fn()}});
}
function setup(withViewport=true){
  let now=0,nextId=0,scrollCalls=0;
  const frames=new Map(),timers=new Map();
  const vv=withViewport?target({height:844,offsetTop:0,scale:1}):null;
  const window=target({visualViewport:vv,innerHeight:844,scrollX:0,scrollY:260,
    scrollTo(x,y){scrollCalls++;this.scrollX=x;this.scrollY=y}});
  const input=target({blur(){this.emit('blur')}}),layer={hidden:true,style:{}},log={style:{}};
  const document={documentElement:{clientHeight:844},body:{style:{},getBoundingClientRect:()=>({width:366})}};
  const ctx={window,document,input,layer,log,toBottom(){},stop(){},guardOn(){},flyIdleFrom(){},
    requestAnimationFrame:fn=>{const id=++nextId;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{at:now+ms,fn});return id},clearTimeout:id=>timers.delete(id)};
  vm.createContext(ctx);
  const locking=html.slice(html.indexOf('  let lockY=0;'),html.indexOf("  $('piyo-guard').addEventListener"));
  const closing=html.slice(html.indexOf('  function close(o)'),html.indexOf("  idleEl.addEventListener('click',open)"));
  const viewport=html.slice(html.indexOf('  // ---- キーボードが出たら'),html.indexOf("  document.addEventListener('keydown',e=>{if(e.key!=='Escape')"));
  vm.runInContext(locking+closing+viewport+';this.api={fit,lockPage,close};',ctx);
  return {window,vv,input,layer,log,document,api:ctx.api,
    open(){layer.hidden=false;ctx.api.lockPage();window.scrollY=0;ctx.api.fit()},
    frame(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now))},
    advance(ms){now+=ms;for(const [id,t] of [...timers].sort((a,b)=>a[1].at-b[1].at))if(t.at<=now){timers.delete(id);t.fn()}},
    get frameCount(){return frames.size},get timerCount(){return timers.size},get scrollCalls(){return scrollCalls}};
}
test('閉じる通知より後に高さが戻っても、次の描画で元の位置と会話欄の高さへ戻る',()=>{
  const h=setup();h.open();const normalHeight=h.log.style.maxHeight;
  h.vv.height=500;h.vv.emit('resize');h.frame();assert.equal(h.layer.style.bottom,'344px');
  h.vv.emit('resize');h.vv.height=844;h.frame();
  assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.maxHeight,normalHeight);
});
test('入力欄のblur後に高さの通知がなくても、開閉後の再確認で上へのずれを解消',()=>{
  const h=setup();h.open();h.vv.height=500;h.vv.emit('resize');h.frame();
  h.input.emit('blur');h.frame();h.vv.height=844;h.advance(500);h.frame();
  assert.equal(h.layer.style.bottom,'0px');
});
test('キーボードを閉じた後の余分なページスクロールを戻し、チャットをしまうと元の記事位置へ戻る',()=>{
  const h=setup();h.open();assert.equal(h.document.body.style.top,'-260px');assert.equal(h.document.body.style.width,'366px');
  h.vv.height=500;h.vv.emit('resize');h.frame();h.window.scrollY=90;
  h.vv.height=844;h.vv.emit('resize');h.frame();assert.equal(h.window.scrollY,0);
  h.api.close({flown:true});assert.equal(h.window.scrollY,260);assert.equal(h.document.body.style.position,'');
});
test('キーボード表示中のviewport移動は保ち、入力欄を見える範囲の下端に置く',()=>{
  const h=setup();h.open();h.vv.height=500;h.vv.offsetTop=90;h.window.scrollY=20;h.vv.emit('scroll');h.frame();
  assert.equal(h.layer.style.bottom,'254px');assert.equal(h.window.scrollY,20);assert.equal(h.scrollCalls,0);
});
test('innerHeightが遅れて戻る場合もレイアウトの高さに基づき余分に持ち上げない',()=>{
  const h=setup();h.open();h.window.innerHeight=900;h.vv.height=844;h.vv.emit('resize');h.frame();
  assert.equal(h.layer.style.bottom,'0px');
});
test('チャットをしまった後は予約した調整で記事位置を動かさない',()=>{
  const h=setup();h.open();h.input.emit('blur');h.api.close({flown:true});
  h.window.scrollY=410;h.advance(1000);h.frame();assert.equal(h.window.scrollY,410);
  assert.equal(h.frameCount,0);assert.equal(h.timerCount,0);
});
test('表示していないときのresizeとscrollではページスクロールを変えない',()=>{
  const h=setup();h.window.emit('resize');h.window.emit('scroll');h.vv.emit('resize');h.input.emit('blur');h.advance(1000);h.frame();
  assert.equal(h.window.scrollY,260);assert.equal(h.scrollCalls,0);assert.equal(h.frameCount,0);assert.equal(h.timerCount,0);
});
test('拡大表示でのviewport移動をキーボード閉鎖と誤認して巻き戻さない',()=>{
  const h=setup();h.open();h.vv.scale=2;h.window.scrollY=70;h.vv.emit('scroll');h.frame();assert.equal(h.window.scrollY,70);
});
test('VisualViewportがない環境でも画面サイズ変更で会話欄を調整する',()=>{
  const h=setup(false);h.open();h.window.innerHeight=500;h.document.documentElement.clientHeight=500;h.window.emit('resize');h.frame();
  assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.maxHeight,'226px');
});
