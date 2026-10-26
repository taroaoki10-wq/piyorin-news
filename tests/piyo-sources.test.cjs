const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/index.html'),'utf8');
const source=html.slice(html.indexOf('  function piyoMsg('),html.indexOf('  // ---- データ'));
function setup(withSources=true){
  const nodes=[],timers=[];
  const document={createElement(){return {text:{innerHTML:''},sources:null,
    get isConnected(){return nodes.includes(this)},
    insertAdjacentHTML(where,markup){
      const opening=markup.slice(0,markup.indexOf('>')+1);
      const attrs=Object.fromEntries([...opening.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
      this.sources={markup,attrs,setAttribute(name,value){this.attrs[name]=value}};
    },querySelector(selector){return selector==='.piyo-text'?this.text:this.sources}}}};
  const ctx={document,log:{appendChild:node=>nodes.push(node)},markLast(){},toBottom(){},setTimeout:fn=>timers.push(fn)};
  vm.createContext(ctx);vm.runInContext(source+';this.piyoMsg=piyoMsg;',ctx);
  const msg=ctx.piyoMsg(withSources),node=nodes[0];
  return {msg,node,timers,remove:()=>nodes.pop(),flush(){while(timers.length)timers.shift()()}};
}
test('あいさつが最後まで出るまでは出典を隠し、完了後に出典全文を一度に表示する',()=>{
  const h=setup(),text='こんにちは、最近のぴよりんのことを話すぴよ。',markup=h.node.sources.markup;
  let done=0;h.msg.say(text,()=>{done++;assert.equal(h.node.text.innerHTML,text);assert.equal(h.node.sources.attrs['aria-hidden'],'false')});
  assert.equal(h.node.sources.attrs['aria-hidden'],'true');assert.notEqual(h.node.text.innerHTML,text);
  while(h.timers.length){
    assert.equal(h.node.sources.markup,markup);assert.equal(h.node.sources.attrs['aria-hidden'],'true');h.timers.shift()();
  }
  assert.equal(done,1);assert.equal(h.node.sources.attrs['aria-hidden'],'false');assert.equal(h.node.sources.markup,markup);
  assert.ok(markup.includes('Open-Meteo.com'));assert.ok(markup.includes('CC BY 4.0'));
});
test('同じ吹き出しを書き直すと出典を隠し直し、古い文字送りで早く表示しない',()=>{
  const h=setup();h.msg.say('前の長いあいさつを表示しているぴよ。');
  h.msg.say('新しい長いあいさつを表示するぴよ。');h.timers.shift()();
  assert.equal(h.node.sources.attrs['aria-hidden'],'true');h.flush();assert.equal(h.node.sources.attrs['aria-hidden'],'false');
  h.msg.say('もう一度、あいさつをするぴよ。');assert.equal(h.node.sources.attrs['aria-hidden'],'true');h.flush();assert.equal(h.node.sources.attrs['aria-hidden'],'false');
});
test('会話消去で取り外した吹き出しでは出典の表示と完了通知を行わない',()=>{
  const h=setup();let done=0;h.msg.say('途中で消す長いあいさつだぴよ。',()=>done++);h.remove();h.flush();
  assert.equal(done,0);assert.equal(h.node.sources.attrs['aria-hidden'],'true');
});
test('普通の返答には出典要素を足さず、従来どおり文字送りを完了する',()=>{
  const h=setup(false);let done=0;h.msg.say('普通の返答だぴよ。',()=>done++);h.flush();
  assert.equal(h.node.sources,null);assert.equal(h.node.text.innerHTML,'普通の返答だぴよ。');assert.equal(done,1);
});
