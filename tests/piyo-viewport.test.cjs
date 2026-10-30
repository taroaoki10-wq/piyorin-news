const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
// iPhone のシミュレーター（iOS 27・iPhone 17・ホーム画面のアプリ）で測った形をまねる。
// 座標は getBoundingClientRect と同じもの。全画面の覆い（piyo-guard）＝固定の部品の基準の箱。
// 画面 874・状態バー 62。キーボードを出すと見える高さは 470 になり、iOS は箱を
//   ずらさない（箱 0〜874・見える範囲 0〜470）／上へずらす（箱 -342〜470・見える範囲は offsetTop 342）／812 に縮める（箱 0〜812）
// のどれかで止まる。会話欄の下端から層の下端までは、下の余白＋ぴよ・候補・入力欄・間隔（実測で約 222px）。
function target(object={}){
  const listeners=new Map();
  return Object.assign(object,{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},
    emit(type){for(const fn of listeners.get(type)||[])fn()}});
}
function setup({viewport=true,screen=874,safeTop='62px',padding='46px'}={}){
  let now=0,nextId=0,scrollCalls=0,drift=0;
  const box={top:0,height:screen};
  const frames=new Map(),timers=new Map();
  const vv=viewport?target({height:screen,offsetTop:0,scale:1}):null;
  const window=target({visualViewport:vv,innerHeight:screen,scrollX:0,scrollY:260,
    scrollTo(x,y){scrollCalls++;this.scrollX=x;this.scrollY=y}});
  const input=target({blur(){document.activeElement=null;this.emit('blur')}}),layer={hidden:true,style:{}},log={style:{}};
  const document={activeElement:null,documentElement:{clientWidth:402,clientHeight:812,classList:{add(){},remove(){}}},body:{style:{},getBoundingClientRect:()=>({width:378})}};
  const pad=()=>parseFloat(layer.style.paddingBottom||padding)||0;
  // drift：持ち上げの動き（CSS の transition）の途中で、層が style.bottom の位置からずれて見える分
  layer.getBoundingClientRect=()=>({bottom:box.top+box.height-(parseFloat(layer.style.bottom)||0)+drift});
  log.getBoundingClientRect=()=>({bottom:layer.getBoundingClientRect().bottom-pad()-222});
  const ctx={window,document,input,layer,log,pull:0,toBottom(){},stop(){},guardOn(){},flyIdleFrom(){},
    $:id=>{assert.equal(id,'piyo-guard');return {getBoundingClientRect:()=>({top:box.top,bottom:box.top+box.height,height:box.height})}},
    requestAnimationFrame:fn=>{const id=++nextId;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{at:now+ms,fn});return id},clearTimeout:id=>timers.delete(id),
    getComputedStyle:()=>({getPropertyValue:name=>name==='--piyo-safe-top'?safeTop:''})};
  vm.createContext(ctx);
  const locking=html.slice(html.indexOf('  let lockY=0;'),html.indexOf("  $('piyo-guard').addEventListener"));
  const closing=html.slice(html.indexOf('  function close(o)'),html.indexOf("  idleEl.addEventListener('click',open)"));
  const viewport_=html.slice(html.indexOf('  // ---- キーボードが出たら'),html.indexOf("  document.addEventListener('keydown',e=>{if(e.key!=='Escape')"));
  vm.runInContext(locking+closing+viewport_+';this.api={fit,lockPage,close};',ctx);
  const h={window,vv,input,layer,log,document,ctx,api:ctx.api,
    open(){layer.hidden=false;ctx.api.lockPage();window.scrollY=0;ctx.api.fit()},
    focus(){document.activeElement=input;input.emit('focus')},
    box(top,height){box.top=top;box.height=height},
    view(height,offsetTop=0){vv.height=height;vv.offsetTop=offsetTop;window.innerHeight=height},
    drift(v){drift=v},
    frame(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now))},
    advance(ms){now+=ms;for(const [id,t] of [...timers].sort((a,b)=>a[1].at-b[1].at))if(t.at<=now){timers.delete(id);t.fn()}},
    settle(){h.frame();h.advance(500);h.frame()},
    get frameCount(){return frames.size},get timerCount(){return timers.size},get scrollCalls(){return scrollCalls},
    // 見た目：入力欄の下の余白を除いた会話の部品の下端（＝層の下端）と、会話欄の上端（高さを確保したときはその上端）
    get layerBottom(){return layer.getBoundingClientRect().bottom},
    get logTop(){return log.getBoundingClientRect().bottom-parseFloat(log.style.height||log.style.maxHeight)}};
  return h;
}
// キーボードを出す：見える高さ 470。form はその上に 12px あけて置かれる
const keyboardForms={
  '箱をずらさない':h=>{h.box(0,874);h.view(470,0)},
  '箱を上へずらす':h=>{h.box(-342,812);h.view(470,342)},
  '箱を812に縮める':h=>{h.box(0,812);h.view(470,0)},
};

test('ホーム画面のアプリで開いたとき：会話の部品は画面の下端、会話欄は状態バー＋16pxまで',()=>{
  const h=setup();h.open();
  assert.equal(h.layer.style.bottom,'0px');assert.equal(h.layer.style.paddingBottom,'');assert.equal(h.layerBottom,874);
  assert.equal(h.log.style.maxHeight,'528px');assert.equal(h.log.style.height,'');assert.equal(h.logTop,78); // 874-46-222-78
});
for(const [name,form] of Object.entries(keyboardForms)){
  test(`キーボード中（${name}）：入力欄はキーボードのすぐ上、会話欄は見えている上端＋78pxまで確保する`,()=>{
    const h=setup();h.open();h.focus();form(h);h.vv.emit('resize');h.frame();
    const visibleTop=h.ctx.$('piyo-guard').getBoundingClientRect().top+h.vv.offsetTop;
    assert.equal(h.layerBottom,visibleTop+470); // 見えている範囲の下端
    assert.equal(h.layer.style.paddingBottom,'12px');
    assert.equal(h.log.style.height,'158px');assert.equal(h.log.style.maxHeight,'158px'); // 470-12-222-78
    assert.equal(h.logTop,visibleTop+78);
  });
}
test('iOS がキーボードの途中で箱の形を入れ替えても、最後の形で同じ見た目に落ち着く',()=>{
  const h=setup();h.open();h.focus();
  for(const form of ['箱をずらさない','箱を上へずらす','箱を812に縮める','箱をずらさない','箱を上へずらす']){keyboardForms[form](h);h.vv.emit('scroll');h.frame()}
  h.settle();
  assert.equal(h.log.style.height,'158px');assert.equal(h.layer.style.paddingBottom,'12px');assert.equal(h.layerBottom,470);
});
test('持ち上げの動きの途中に測っても、会話欄の高さを小さく見積もらない',()=>{
  const h=setup();h.open();h.focus();keyboardForms['箱をずらさない'](h);h.drift(300);h.vv.emit('resize');h.frame();
  assert.equal(h.log.style.height,'158px');
  h.drift(0);h.input.blur();h.drift(-380);h.view(874);h.vv.emit('resize');h.frame(); // 閉じる動きの途中
  assert.equal(h.log.style.maxHeight,'528px');
});
test('キーボードを閉じると、何度くり返しても最初の下端と会話欄の高さへ戻る（前に覚えた位置を使わない）',()=>{
  const h=setup();h.open();const first={bottom:h.layerBottom,max:h.log.style.maxHeight};
  for(const form of ['箱を上へずらす','箱をずらさない','箱を812に縮める']){
    h.focus();keyboardForms[form](h);h.vv.emit('resize');h.frame();assert.equal(h.log.style.height,'158px');
    h.input.blur();h.box(0,874);h.view(874);h.vv.emit('resize');h.settle();
    assert.equal(h.layerBottom,first.bottom);assert.equal(h.log.style.maxHeight,first.max);assert.equal(h.log.style.height,'');
    assert.equal(h.layer.style.paddingBottom,'');assert.equal(h.layer.style.translate,'');
  }
});
test('完了でフォーカスが外れたら、見える高さがキーボードのままでも下へ戻す',()=>{
  const h=setup();h.open();h.focus();keyboardForms['箱をずらさない'](h);h.vv.emit('resize');h.frame();
  h.input.blur();h.settle();
  assert.equal(h.layer.style.bottom,'0px');assert.equal(h.layerBottom,874);assert.equal(h.log.style.height,'');
});
test('フォーカスが残っても、小さな残り（120px以下）では持ち上げない',()=>{
  const h=setup();h.open();h.focus();h.view(806);h.vv.emit('resize');h.settle();
  assert.equal(h.document.activeElement,h.input);assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.height,'');
});
test('Safari のタブ（状態バーの余白なし）でも、キーボードのすぐ上に置き、上16pxまで会話欄を確保する',()=>{
  const h=setup({screen:714,safeTop:'0px'});h.open();assert.equal(h.logTop,16);
  h.focus();h.box(-338,714);h.view(376,338);h.vv.emit('resize');h.frame();
  assert.equal(h.layerBottom,376);assert.equal(h.log.style.height,'126px');assert.equal(h.logTop,16); // 376-12-222-16
});
test('余裕がある縦長画面では、通常時の会話欄を 62% ＋96px までにする',()=>{
  const h=setup({screen:1366,safeTop:'24px'});h.open();
  assert.equal(h.log.style.maxHeight,(Math.min(1366*.62,1366-274)+96)+'px');
});
test('拡大表示（ピンチ）では見えている範囲に合わせ、ページのスクロールを巻き戻さない',()=>{
  const h=setup();h.open();h.vv.scale=2;h.view(437,200);h.window.scrollY=70;h.vv.emit('scroll');h.frame();
  assert.equal(h.window.scrollY,70);assert.equal(h.layer.style.bottom,'237px');assert.equal(h.layer.style.paddingBottom,'');
});
test('キーボードを閉じた後に残ったページのスクロールを戻し、しまうと元の記事の位置へ戻る',()=>{
  const h=setup();h.open();assert.equal(h.document.body.style.top,'-260px');assert.equal(h.document.body.style.width,'378px');
  h.focus();keyboardForms['箱をずらさない'](h);h.vv.emit('resize');h.frame();h.window.scrollY=90;
  h.input.blur();h.view(874);h.vv.emit('resize');h.frame();assert.equal(h.window.scrollY,0);
  h.api.close({flown:true});assert.equal(h.window.scrollY,260);assert.equal(h.document.body.style.position,'');
});
test('キーボード中の見える範囲の移動ではスクロールを戻さない',()=>{
  const h=setup();h.open();h.focus();keyboardForms['箱を上へずらす'](h);h.window.scrollY=404;h.vv.emit('scroll');h.frame();
  assert.equal(h.window.scrollY,404);assert.equal(h.scrollCalls,0);
});
test('しまった後は予約した調整を取り消し、記事の位置を動かさない',()=>{
  const h=setup();h.open();h.input.emit('blur');h.api.close({flown:true});
  h.window.scrollY=410;h.advance(1000);h.frame();assert.equal(h.window.scrollY,410);
  assert.equal(h.frameCount,0);assert.equal(h.timerCount,0);
});
test('表示していないときの resize と scroll では何もしない',()=>{
  const h=setup();h.window.emit('resize');h.window.emit('scroll');h.vv.emit('resize');h.input.emit('blur');h.advance(1000);h.frame();
  assert.equal(h.window.scrollY,260);assert.equal(h.scrollCalls,0);assert.equal(h.frameCount,0);assert.equal(h.timerCount,0);
});
test('下へ引いている間は位置を合わせ直さない',()=>{
  const h=setup();h.open();h.layer.style.bottom='5px';h.ctx.pull=40;h.ctx.api.fit();assert.equal(h.layer.style.bottom,'5px');
  h.ctx.pull=0;h.layer.style.transform='translateY(30px)';h.ctx.api.fit();assert.equal(h.layer.style.bottom,'5px');
});
test('visualViewport がない環境でも、画面の大きさが変わると会話欄を合わせる',()=>{
  const h=setup({viewport:false});h.open();h.box(0,500);h.window.emit('resize');h.frame();
  assert.equal(h.layer.style.bottom,'0px');assert.equal(h.log.style.maxHeight,'154px'); // 500-46-222-78
});
test('ホーム画面のアプリでは、会話を開いている間もページの長さを画面の高さに保つ（下に帯を出さない）',()=>{
  assert.match(html,/@media \(display-mode:standalone\)\{html\.piyo-open\{min-height:100lvh\}\}/);
});
