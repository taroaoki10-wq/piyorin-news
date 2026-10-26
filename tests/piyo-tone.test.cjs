const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const source=html.slice(html.indexOf('  function piyoTone('),html.indexOf('  // 返事の文を表示用にする'));
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'piyo-tone-cases.json'),'utf8'));
const ctx={};vm.createContext(ctx);vm.runInContext(source+';this.tone=piyoTone;',ctx);

test('口調の共通例：変換結果と二度通しても変わらないこと',()=>{
  for(const [input,expected] of cases){
    assert.equal(ctx.tone(input),expected,JSON.stringify(input));
    assert.equal(ctx.tone(expected),expected,'二度目: '+JSON.stringify(input));
  }
});
test('チャットの返事は表示と次回へ送る履歴の両方を補正する',()=>{
  const shown=[];
  const c={piyoTone:ctx.tone,play(){},fmt:s=>s,sync(){}};vm.createContext(c);
  const finish=html.slice(html.indexOf('  function finish('),html.indexOf('  function fail('));
  vm.runInContext('let history=[],busy=true;'+finish+';this.finish=finish;this.state=()=>({history,busy});',c);
  c.finish({say:s=>shown.push(s)},'質問は変えますか？','運行します。https://example.com/');
  assert.equal(shown[0],'運行するぴよ。https://example.com/');
  assert.equal(c.state().history[0].content,'質問は変えますか？');
  assert.equal(c.state().history[1].content,shown[0]);assert.equal(c.state().busy,false);
});
test('チャットとまとめの口調の指示は同一で、全部の文を対象にする',()=>{
  const py=fs.readFileSync(path.join(__dirname,'../scripts/build_piyo.py'),'utf8');
  const instruction=html.match(/^- です・ます[^\n]+/m)[0];
  assert.equal(py.match(/^- です・ます[^\n]+/m)[0],instruction);
  assert.ok(instruction.includes('すべての文'));assert.ok(instruction.includes('丁寧語は使わない'));
  assert.ok(!html.includes('語尾にときどき「ぴよ」'));
});
