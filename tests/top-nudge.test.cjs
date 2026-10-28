const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
const start=html.indexOf('// iPhone のホーム画面版で、開いた直後だけ上の端');
const code=html.slice(start,html.indexOf('</script>',start));
function setup({standalone=true,scrollY=0,fixed=false,reader=false}={}){
  const scrolls=[],listeners={},docListeners={};
  const win={scrollY,scrollTo(x,y){scrolls.push(y);win.scrollY=y}};
  const ctx={navigator:{standalone},window:win,
    document:{body:{style:{position:fixed?'fixed':''}},documentElement:{classList:{contains:c=>reader&&c==='reader-open'}},visibilityState:'visible',
      addEventListener(t,f){docListeners[t]=f}},
    addEventListener(t,f){listeners[t]=f},setTimeout:f=>f(),requestAnimationFrame:f=>f()};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  return {scrolls,listeners,docListeners,win};
}
test('ホーム画面版で開いたとき、少しだけ下げてすぐ一番上へ戻す',()=>{
  const h=setup();h.listeners.pageshow();assert.deepEqual(h.scrolls,[2,0]);assert.equal(h.win.scrollY,0);
  h.docListeners.visibilitychange();assert.deepEqual(h.scrolls,[2,0,2,0]);
});
test('Safari・途中まで読んだ位置・ぴよや記事を開いている間は動かさない',()=>{
  for(const o of [{standalone:false},{scrollY:300},{fixed:true},{reader:true}]){
    const h=setup(o);h.listeners.pageshow?.();h.docListeners.visibilitychange?.();assert.deepEqual(h.scrolls,[],JSON.stringify(o));
  }
});
