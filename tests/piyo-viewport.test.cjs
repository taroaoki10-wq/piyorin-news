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
  let now=0,nextId=0,scrollCalls=0,safePadding='46px',formShift=0;
  const frames=new Map(),timers=new Map();
  const vv=withViewport?target({height:844,offsetTop:0,scale:1}):null;
  const window=target({visualViewport:vv,innerHeight:844,scrollX:0,scrollY:260,
    scrollTo(x,y){scrollCalls++;this.scrollX=x;this.scrollY=y}});
  const input=target({blur(){document.activeElement=null;this.emit('blur')}}),layer={hidden:true,style:{}},log={style:{}};
  const document={activeElement:null,documentElement:{clientWidth:390,clientHeight:844},body:{style:{},getBoundingClientRect:()=>({width:366})}};
  const form={getBoundingClientRect(){const translate=parseFloat((layer.style.translate||'0 0').split(' ')[1])||0;
    return {bottom:document.documentElement.clientHeight-(parseFloat(layer.style.bottom)||0)-(parseFloat(layer.style.paddingBottom||safePadding)||0)-formShift+translate}}};
  const ctx={window,document,input,layer,log,pull:0,$:id=>{assert.equal(id,'piyo-form');return form},toBottom(){},stop(){},guardOn(){},flyIdleFrom(){},
    requestAnimationFrame:fn=>{const id=++nextId;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{at:now+ms,fn});return id},clearTimeout:id=>timers.delete(id),
    getComputedStyle:el=>({paddingBottom:el.style.paddingBottom||safePadding})};
  vm.createContext(ctx);
  const locking=html.slice(html.indexOf('  let lockY=0;'),html.indexOf("  $('piyo-guard').addEventListener"));
  const closing=html.slice(html.indexOf('  function close(o)'),html.indexOf("  idleEl.addEventListener('click',open)"));
  const viewport=html.slice(html.indexOf('  // ---- キーボードが出たら'),html.indexOf("  document.addEventListener('keydown',e=>{if(e.key!=='Escape')"));
  vm.runInContext(locking+closing+viewport+';this.api={fit,lockPage,close};',ctx);
  return {window,vv,input,layer,log,document,form,api:ctx.api,
    open(){layer.hidden=false;ctx.api.lockPage();window.scrollY=0;ctx.api.fit()},
    focus(){document.activeElement=input;input.emit('focus')},
    safePadding:value=>{safePadding=value},
    formShift:value=>{formShift=value},
    frame(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now))},
    advance(ms){now+=ms;for(const [id,t] of [...timers].sort((a,b)=>a[1].at-b[1].at))if(t.at<=now){timers.delete(id);t.fn()}},
    get frameCount(){return frames.size},get timerCount(){return timers.size},get scrollCalls(){return scrollCalls}};
}
test('閉じる通知より後に高さが戻っても、次の描画で元の位置と会話欄の高さへ戻る',()=>{
  const h=setup();h.open();const normalHeight=h.log.style.maxHeight;
  h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();assert.equal(h.layer.style.bottom,'344px');
  h.vv.emit('resize');h.vv.height=844;h.frame();
  assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.maxHeight,normalHeight);
});
test('入力欄のblur後に高さの通知がなくても、開閉後の再確認で上へのずれを解消',()=>{
  const h=setup();h.open();h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();
  h.input.blur();h.frame();h.vv.height=844;h.advance(500);h.frame();
  assert.equal(h.layer.style.bottom,'0px');
});
test('キーボードを閉じた後の余分なページスクロールを戻し、チャットをしまうと元の記事位置へ戻る',()=>{
  const h=setup();h.open();assert.equal(h.document.body.style.top,'-260px');assert.equal(h.document.body.style.width,'366px');
  h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();h.window.scrollY=90;
  h.vv.height=844;h.vv.emit('resize');h.frame();assert.equal(h.window.scrollY,0);
  h.api.close({flown:true});assert.equal(h.window.scrollY,260);assert.equal(h.document.body.style.position,'');
});
test('キーボード表示中のviewport移動は保ち、入力欄を見える範囲の下端に置く',()=>{
  const h=setup();h.open();h.focus();h.vv.height=500;h.vv.offsetTop=90;h.window.scrollY=20;h.vv.emit('scroll');h.frame();
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
test('完了で閉じてもviewportが34px小さいままなら初回の位置・会話欄の高さへ戻す',()=>{
  const h=setup();h.open();const initial={bottom:h.layer.style.bottom,height:h.log.style.maxHeight};
  h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();assert.equal(h.layer.style.bottom,'344px');
  h.input.blur();h.vv.height=810;h.vv.emit('resize');h.advance(500);h.frame();
  assert.equal(h.layer.style.bottom,initial.bottom);assert.equal(h.log.style.maxHeight,initial.height);
});
test('完了後にviewportがキーボード表示時の高さのままでもフォーカス解除で初回へ戻す',()=>{
  const h=setup();h.open();const initialHeight=h.log.style.maxHeight;
  h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();h.input.blur();h.advance(500);h.frame();
  assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.maxHeight,initialHeight);
});
test('格納ボタンでフォーカスが残っても小さな残り余白をキーボードとして扱わない',()=>{
  const h=setup();h.open();const initialHeight=h.log.style.maxHeight;
  h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();
  h.vv.height=766;h.vv.emit('resize');h.advance(500);h.frame();
  assert.equal(h.document.activeElement,h.input);assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.maxHeight,initialHeight);
});
test('閉じた後のsafe-area由来の余白変化を重ねず、最初の下余白へ戻す',()=>{
  const h=setup();h.open();h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();
  h.safePadding('80px');h.input.blur();h.vv.height=810;h.vv.emit('resize');h.advance(500);h.frame();
  assert.equal(h.layer.style.paddingBottom,'46px');
});
test('キーボードの再展開では再び持ち上げ、閉じるたび初回の高さへ戻す',()=>{
  const h=setup();h.open();const initialHeight=h.log.style.maxHeight;
  for(let i=0;i<3;i++){
    h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();assert.equal(h.layer.style.bottom,'344px');
    h.input.blur();h.vv.height=810;h.vv.emit('resize');h.advance(500);h.frame();assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.maxHeight,initialHeight);
  }
});
test('画面の幅が変わったときは新しい向きの高さと余白を基準にする',()=>{
  const h=setup();h.open();h.document.documentElement.clientWidth=844;h.document.documentElement.clientHeight=390;
  h.window.innerHeight=390;h.vv.height=390;h.safePadding('33px');h.window.emit('resize');h.advance(500);h.frame();
  assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.maxHeight,'120px');assert.equal(h.layer.style.paddingBottom,'33px');
});
test('fixed要素の基準もずれた場合は初回の入力欄の下端と同じ座標へ戻す',()=>{
  const h=setup();h.open();const bottom=h.form.getBoundingClientRect().bottom;
  h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();
  h.formShift(34);h.input.blur();h.vv.height=810;h.vv.emit('resize');h.advance(500);h.frame();
  assert.equal(h.form.getBoundingClientRect().bottom,bottom);
  h.vv.emit('resize');h.advance(500);h.frame();assert.equal(h.form.getBoundingClientRect().bottom,bottom);
});
test('OSの位置ずれが解けたら補正を外し、次のキーボード展開にも補正を残さない',()=>{
  const h=setup();h.open();h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();
  h.formShift(34);h.input.blur();h.vv.height=810;h.vv.emit('resize');h.advance(500);h.frame();assert.equal(h.layer.style.translate,'0 34px');
  h.formShift(0);h.vv.height=844;h.vv.emit('resize');h.advance(500);h.frame();assert.equal(h.layer.style.translate,'');
  h.focus();h.vv.height=500;h.vv.emit('resize');h.frame();assert.equal(h.layer.style.translate,'');assert.equal(h.layer.style.bottom,'344px');
});
test('下へ引いている間は初回位置への補正でドラッグを打ち消さない',()=>{
  const h=setup();h.open();h.layer.style.transform='translateY(40px)';h.window.scrollY=25;
  h.vv.emit('resize');h.advance(500);h.frame();assert.equal(h.layer.style.transform,'translateY(40px)');assert.equal(h.window.scrollY,25);
});
