// ぴよの会話力（2026-10-29）：API の道を Haiku 5.5 に・お手本の会話・話題に合う続きの札・答えの日付と値段の確かめ
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v)); // 別の VM で作った値を比べられる形に
const ctx={window:{},TextEncoder,TextDecoder};
vm.runInNewContext(read('docs/piyo-extras.js'),ctx);
const X=ctx.window.PiyoExtras;
const html=read('docs/index.html');
const part=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));

const KNOWLEDGE='<knowledge>\n<today>2026-10-29（木）</today>\n<basics>値段（税込）: 定番ぴよりん 450円</basics>\n'
  +'<memo id="m1" date="2026-10-23">紅茶ぴよりんおでかけセット1,300円(税込)を山陽百貨店で11月7日(土)・8日(日)に販売。</memo>\n'
  +'<memo id="m2" date="2026-10-22">ぴよりんゴジラ。11月3日~13日販売。</memo>\n'
  +'<event id="e1" start="2026-11-26" end="2026-11-27">静岡みかんぴよりんおでかけセット販売</event>\n</knowledge>';

test('答えの日付と値段を手元の知識と照らす（範囲・並び・予定の期間の間の日も知っている日にする）',()=>{
  assert.deepEqual(plain(X.checkFacts('紅茶のセットは**11月8日**に1,300円で売るぴよ。ゴジラは11月10日もあるぴよ。静岡は11月27日まで。定番は450円だぴよ。',KNOWLEDGE,'2026-10-29')),
    {dates:[],prices:[]});
  assert.deepEqual(plain(X.checkFacts('紅茶のセットは11月20日に1,500円で売るぴよ。ゴジラは**11月3日〜15日**だぴよ。',KNOWLEDGE,'2026-10-29')),
    {dates:['11月20日','11月14日','11月15日'],prices:['1500']});
  assert.deepEqual(plain(X.checkFacts('明日の10月30日は晴れだぴよ。',KNOWLEDGE,'2026-10-29')),{dates:[],prices:[]}); // 今日から1週間は <today> から数えられる
  assert.deepEqual(plain(X.checkFacts('年をまたいで1月2日までだぴよ。','受付は12月28日〜1月3日','2026-10-29')),{dates:[],prices:[]});
});

test('答えに使った記事や予定から、メモに答えがある続きの質問だけを作る（日にちの質問は作らない）',()=>{
  const c={memo:{'official-p5657':{memo:'静岡みかんぴよりんおでかけセット。1,300円（税込）。11月26日・27日にアスティ静岡西館特設会場で販売。整理券先着順。1人1点まで。'},
    n1:{memo:'ぴよりん15周年の記念グッズ。'}},
    news:[{id:'official-p5657',title:'アスティ静岡開業35周年を記念して「静岡みかんぴよりんおでかけセット」を期間限定販売！'},{id:'n1',title:'「ぴよりん」が「ドデ祭2026」に登場'}],
    events:[{id:'e1',title:'ぴよりんゴジラ スタンプラリーキャンペーン',src:'none',place:'ぴよりんvillage'}]};
  assert.deepEqual(plain(X.followUps([{type:'news',id:'official-p5657'}],c)),['静岡みかんぴよりんおでかけセットの値段は？','静岡みかんぴよりんおでかけセットの場所は？']);
  assert.deepEqual(plain(X.followUps([{type:'news',id:'n1'}],c)),[]); // メモに答えが無い質問は作らない
  assert.deepEqual(plain(X.followUps([{type:'event',id:'e1'}],c)),['ぴよりんゴジラ スタンプラリーの場所は？']);
  assert.equal(X.topicOf('「ぴよりん」が兵庫におでかけ!山陽百貨店「日本列島絶品うまいもの大会」にて『紅茶ぴよりんおでかけセット』を限定で'),'紅茶ぴよりんおでかけセット');
});

test('知識に無い日付や値段には「確かめてね」を添える。記憶には入れず、Web で調べた答えと聞かれた日付には付けない',()=>{
  const shown=[];
  const c={PiyoExtras:X,piyoTone:s=>s,play(){},fmt:s=>s,sync(){},todayStr:()=>'2026-10-29',refMap:{},data:null};vm.createContext(c);
  vm.runInContext(`let history=[],busy=true,asked={q:'',chip:'',way:'api',web:false},lastKnowledge=${JSON.stringify(KNOWLEDGE)},lastExtra='';`
    +part('  function finish(','  function fail(')+';this.finish=finish;this.state=()=>({history});this.setWeb=v=>{asked.web=v};',c);
  const msg={say:s=>shown.push(s)};
  c.finish(msg,'ゴジラはいつまで？','ゴジラは**11月13日**まで売るぴよ。');
  assert.equal(shown.at(-1),'ゴジラは**11月13日**まで売るぴよ。');
  c.finish(msg,'ゴジラはいつまで？','ゴジラは**11月20日**まで、500円で売るぴよ。');
  assert.equal(shown.at(-1),'ゴジラは**11月20日**まで、500円で売るぴよ。\n（この日付と値段は手元の情報で確かめられなかったぴよ。最新は公式で確かめてね）');
  assert.equal(c.state().history.at(-1).content,'ゴジラは**11月20日**まで、500円で売るぴよ。'); // 記憶には一言を入れない
  c.finish(msg,'11月21日は売ってる？','11月21日は売ってないぴよ。');assert.equal(shown.at(-1),'11月21日は売ってないぴよ。'); // 聞かれた日付
  c.finish(msg,'q','11月22日だぴよ。\n参考ページ: https://example.com/');assert.ok(!shown.at(-1).includes('確かめられなかった'));
  c.setWeb(true);c.finish(msg,'q','11月23日だぴよ。');assert.equal(shown.at(-1),'11月23日だぴよ。'); // Web で調べた答え
});

test('API の道は Haiku 5.5・考える量は少なめ・答えの上限は 2048（考える分も数えるため）。考えた部分は文字に入れない',async()=>{
  const sent=[];
  const c={fetch:async(url,o)=>{sent.push(JSON.parse(o.body));return{ok:true,headers:{get:()=>'application/json'},
    json:async()=>({content:[{type:'thinking',thinking:'',signature:'s'},{type:'text',text:'答えだぴよ。'}],stop_reason:'end_turn'})}},
    apiKey:'fake-test-key',SYSTEM:'指示',knowledge:()=>'<knowledge/>'};
  vm.createContext(c);
  vm.runInContext(html.match(/const API='[^']+', MODEL='[^']+';/)[0]+part('  async function callClaude(','  function errText(')+';this.callClaude=callClaude;this.textOf=textOf;',c);
  const res=await c.callClaude({messages:[{role:'user',content:'q'}]});
  assert.equal(sent[0].model,'claude-haiku-5-5');
  assert.deepEqual(plain(sent[0].output_config),{effort:'low'});
  assert.equal(sent[0].max_tokens,2048);
  assert.equal(sent[0].system[1].cache_control.type,'ephemeral');
  assert.equal(c.textOf(res),'答えだぴよ。');
});

test('返事を流して読むとき、考える部分（thinking）は文字に入れない',async()=>{
  const ev=(t,d)=>`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`;
  const body=[ev('message_start',{message:{}}),
    ev('content_block_start',{index:0,content_block:{type:'thinking',thinking:'',signature:''}}),
    ev('content_block_delta',{index:0,delta:{type:'thinking_delta',thinking:'考え中'}}),
    ev('content_block_delta',{index:0,delta:{type:'signature_delta',signature:'abc'}}),
    ev('content_block_stop',{index:0}),
    ev('content_block_start',{index:1,content_block:{type:'text',text:''}}),
    ev('content_block_delta',{index:1,delta:{type:'text_delta',text:'こんにちは'}}),
    ev('content_block_delta',{index:1,delta:{type:'text_delta',text:'ぴよ。'}}),
    ev('content_block_stop',{index:1}),ev('message_delta',{delta:{stop_reason:'end_turn'}}),ev('message_stop',{})].join('');
  let done=false;const bytes=new TextEncoder().encode(body);
  const response={body:{getReader:()=>({read:async()=>done?{done:true}:(done=true,{value:bytes,done:false})})}};
  const seen=[];
  const res=await X.readMessage(response,t=>seen.push(t));
  assert.deepEqual(plain(seen),['こんにちは','こんにちはぴよ。']);
  assert.equal(res.stop_reason,'end_turn');
  assert.equal(plain(res.content).filter(b=>b.type==='text')[0].text,'こんにちはぴよ。');
});

test('お手本の会話は指示の終わりにあり、Mac 用の指示にもそのまま入る（例の言葉だけで、本物の日付を書かない）',()=>{
  const c={};vm.createContext(c);
  vm.runInContext(part('  const SYSTEM=`','  let history=[];')+';this.SYSTEM=SYSTEM;this.SYSTEM_MAC=SYSTEM_MAC;',c);
  const sample=c.SYSTEM.slice(c.SYSTEM.indexOf('- 話し方の手本'));
  assert.ok(sample.length>100);
  assert.ok(c.SYSTEM_MAC.includes(sample));
  assert.ok(!/\d{1,2}月\d{1,2}日/.test(sample));
  assert.ok(sample.includes('[[参照:m〇,e〇]]')); // 手本の番号をそのまま書き写しても、まちがった札にならない
});
