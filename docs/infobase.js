/* 一般情報だけをinfobaseから読む。キーはこの端末だけ。問い・会話は送らない。 */
(function(root){
 const KEY='piyo-infobase';let usedCards=[],weatherCards=[];const usedAnswers=[];
 function config(){try{return JSON.parse(localStorage.getItem(KEY)||'{}');}catch{return{};}}
 const client=()=>root.InfobaseClient.create(config());
 async function weather(){const cards=await client().cards({category:'002',tag:'名古屋市',limit:'20'});let data=root.InfobaseClient.toOpenMeteo(cards);if(data&&!data.daily.weather_code.some(Number.isFinite))data=null;weatherCards=data?cards:[];if(data)usedCards=cards;return data;}
 // ドル円の「いまの値」を聞く短い質問だけ。予想・理由・他の通貨・計算は従来の答え方に任せる
 function fxAsk(q){return q.length<=30&&/ドル円|為替|円相場|(?:1|１|一)ドル|ドルは.*円/.test(q)&&!/予想|予測|見通し|今後|なぜ|何故|理由|ニュース|株|日経|ユーロ|ポンド|ウォン|人民元|ビットコイン|仮想通貨|換算|計算|変換|推移|グラフ|過去|昨日|明日|明後日|あした|来週|来月|先週|先月|去年|円安|円高|買い|売り|おすすめ|仕組み|とは|って何/.test(q);}
 // ぴよ札（infobase が組んだ答えの下ごしらえ。2026-11-04）。札の辞書でこの端末の中で札を選び、札の名前だけを読む。問いの文は送らない。
 // 天気（東海の 5 つの町・週間・いまの気温）・警報・地震・ドル円・祝日を、AI を使わずに答える。合わなければ前の答え方へ。
 let briefClient=null,briefKey='';
 function brief(){const c=config(),k=JSON.stringify([c.url,c.key,c.enabled]);if(!root.InfobaseBrief)return null;if(!briefClient||k!==briefKey){briefKey=k;briefClient=root.InfobaseBrief.create({...c,maxAgeMs:300000});}return briefClient;}
 const BRIEF_TOPICS=['weather','now','warning','quake','fx','holiday','stock','train','road','outage','gold','bond','econ'];
 // 2026-11-22 に足した話題（電車・道路・停電・金・金利・経済指標）は、言葉がはっきり合うときだけ札で答える。
 // 「JR 高島屋で買える？」「料金は？」のような、ぴよりんの質問を取り違えないため。中身が届かない鍵では、前と同じくほかの答え方へ回る。
 const STRICT={train:/遅れ|遅延|運休|運転見合わせ|見合わせ|運行|止まって|動いて/,road:/渋滞|通行止め|規制|高速/,outage:/停電/,gold:/金(?:価格|相場|地金)|金の(?:値段|価格|相場|買取)|プラチナ|銀(?:相場|の値段|の価格)/,bond:/国債|金利|利回り/,econ:/経済指標|雇用統計|消費者物価|CPI|GDP/};
 const topicOk=(topic,q)=>!STRICT[topic]||STRICT[topic].test(q);
 const hm=v=>{const t=new Date(+new Date(v)+9*3600000).toISOString();return t.slice(0,10)+' '+t.slice(11,16);};
 // 札の部品は東海の 5 つの町しか知らず、「東京の天気」にも名古屋の札を返す。天気・いまの話題で、名古屋以外の町を聞いているときは答えず、ほかの答え方（その町の予報）へ回す。
 // PiyoExtras.weatherPlace があればそれで決める。無いとき（読めていない・古い）は、札の町が質問に入っておらず、ほかの町の言葉があるときだけ断る。
 const OTHER_PLACE=/東京|大阪|京都|横浜|札幌|福岡|神戸|仙台|広島|沖縄|北海道|海外|岐阜|三重|静岡|浜松|豊橋|岡崎|豊田|一宮|春日井|金沢|長野|[一-龯]{1,3}[都道府県]|[一-龯]{1,3}市|[一-龯]{1,3}区/;
 // 警報の札は県ごと。東海の主な町は、その県の札で答える。ほかの県の町を聞いたら、愛知県などの札では答えない（2026-11-22「東京の警報」に愛知県の札で答えていた）
 const PREF_TOWNS={愛知:'名古屋 名駅 豊橋 岡崎 豊田 一宮 春日井 安城 刈谷 瀬戸 半田 小牧 稲沢 西尾 豊川 蒲郡 犬山 常滑 知多 長久手 日進 東海 江南 津島 北名古屋 清須 尾張旭 豊明 大府 知立 碧南 田原 新城 勝川',岐阜:'岐阜 大垣 高山 多治見 各務原 可児 中津川 美濃加茂 土岐 羽島 下呂 郡上 美濃 恵那 瑞浪 関',三重:'三重 津 四日市 鈴鹿 伊勢 桑名 松阪 名張 亀山 鳥羽 志摩 伊賀 尾鷲 熊野',静岡:'静岡 浜松 沼津 富士 熱海 三島 磐田 掛川 藤枝 焼津 富士宮 伊東 島田 御殿場 下田 湖西 袋井 裾野 伊豆'};
 const WARN_WORDS=/特別警報|警報|注意報|大雨|大雪|暴風|波浪|洪水|高潮|雷|土砂災害|発表|出てる|出て|出た|ある|中/g;
 function otherPref(one,q){
  const area=String(one.id||'').split(':')[1]||'',stem=area.replace(/[都道府県]$/,'');
  if(!stem||q.includes(stem))return false;
  const X=root.PiyoExtras,rest=q.replace(WARN_WORDS,'');
  let p=null;if(X&&typeof X.weatherPlace==='function'){try{p=X.weatherPlace(rest+'の天気');}catch{p=null;}}
  if(!p)return OTHER_PLACE.test(rest.replace(/名古屋|愛知/g,''))&&!Object.values(PREF_TOWNS).join(' ').split(' ').some(t=>rest.includes(t)&&(PREF_TOWNS[stem]||'').split(' ').includes(t));
  const label=String(p.label||''),names=[label,label.replace(/[市町村区]$/,'')]; // 「四日市」は市を外さずに引く
  for(const[pref,towns]of Object.entries(PREF_TOWNS))if(names.some(n=>towns.split(' ').includes(n)))return pref!==stem;
  return true; // 東海の外の町
 }
 function otherTown(one,q){
  if(one.topic==='warning')return otherPref(one,q);
  if(one.topic!=='weather'&&one.topic!=='now')return false;
  const X=root.PiyoExtras;
  if(X&&typeof X.weatherPlace==='function'){try{return !!X.weatherPlace(q);}catch{return false;}}
  const town=String(one.id||'').split(':')[1]||'';
  if(town&&q.includes(town.replace(/[市県都府区町村]$/,'')))return false;
  return OTHER_PLACE.test(q.replace(/名古屋|愛知/g,''));
 }
 async function briefAnswer(q){
  const b=brief();if(!b||!b.enabled||q.length>40||/ニュース|予想|予測|見通し|なぜ|理由|仕組み|とは|って何|ぴよりん/.test(q))return null;
  const r=await b.answer(q).catch(()=>null);let one=r&&r.briefs&&r.briefs[0];
  // 「株価は」とだけ聞かれたら、指数のまとめではなく日経平均の札で答える（2026-11-13 ユーザー「株価はって聞いたら基本的に日経平均株価を答えてほしい」）
  if(one&&one.id==='index:all'&&root.PiyoExtras&&root.PiyoExtras.bareStock&&root.PiyoExtras.bareStock(q))one=await b.get('index:日経平均').catch(()=>null)||one;
  if(one&&one.topic==='stock'&&one.id==='index:all')return null; // どの株か分からないまとめでは答えない
  if(!one||!BRIEF_TOPICS.includes(one.topic)||!one.say||one.status==='まだ無い')return null;
  if(one.topic==='fx'&&!fxAsk(q))return null;
  if(!topicOk(one.topic,q))return null;
  if(otherTown(one,q))return null; // 名古屋以外の町の天気に、名古屋の予報を答えない（2026-11-22）
  const src=(one.sources||[]).find(x=>x.id)||(one.sources||[])[0]||{};
  const card={id:src.id,category:{weather:'002',now:'002',warning:'005',quake:'005',fx:'006',stock:'006',gold:'006',bond:'006',econ:'006',train:'022',road:'022',outage:'026',holiday:'011'}[one.topic],type:'メイン',status:'確定',verdict:'確認済み',title:one.title||one.id,summary:one.say,structured:one.facts||null,url:src.url||'',origin:src.origin||'',attribution:src.attribution||'',published_at:one.as_of,expires_at:one.fresh_until||new Date(Date.now()+3600000).toISOString()};
  // 数字・日付の照らし合わせは本文だけ（出典の行の「CC BY 4.0」や取得の時刻は、答えの数字ではない）
  const body=root.InfobaseBrief.voice(one.say,'piyo'),checked=root.InfobaseGuard.guard(body,[card]);if(!checked.ok)return null;
  const text=checked.text+`\n出典：${src.attribution||src.origin||'infobase'}（${one.as_of?hm(one.as_of)+'、日本時間':'infobase'}）`;
  const picked=card.id?[card]:[];for(const c of picked)client().feedback(c.id,'使った').catch(()=>{});
  usedCards=picked;usedAnswers.push({text,cards:picked});while(usedAnswers.length>30)usedAnswers.shift();
  const cut=text.indexOf('\n出典：');return{text,body:cut<0?text:text.slice(0,cut),source:cut<0?'':text.slice(cut+1),cards:picked,ids:picked.map(c=>c.id),brief:one.id};
 }
 async function answer(question){
  let category=null;const q=String(question||'').trim();
  const fromBrief=await briefAnswer(q);if(fromBrief)return fromBrief;
  const localWeather=/^(?:名古屋(?:市)?の)?(?:今日|明日)?の?天気(?:は|を教えて|どう|？|\?)?[？?。]*$/.test(q)||/^今日の名古屋(?:市)?の天気[は？?。]*$/.test(q);
  if(localWeather)category='002';else if(fxAsk(q))category='006';else if(/ニュース/.test(q)&&!q.includes('ぴよりん'))category=/AI|生成/.test(q)?'007':/神社|寺/.test(q)?'008':'003';
  if(!category)return null;
  const cards=await client().cards({category,...(category==='002'?{tag:'名古屋市'}:{}),limit:'20'});if(!cards?.length)return null;
  let picked=[],text='';
  if(category==='002'){
   const date=new Date(Date.now()+9*3600000+(q.includes('明日')?86400000:0)).toISOString().slice(0,10);const c=cards.find(c=>c.structured?.forecast_date===date);if(!c)return null;picked=[c];text=`${date}の名古屋市の予報は、${c.summary}ぴよ。\n出典：${c.attribution||c.source}（取得 ${c.fetched_at.slice(0,16).replace('T',' ')}、日本時間）`;
  }else if(category==='006'){
   const c=cards.find(c=>c.source==='ecb-rates'&&Number.isFinite(c.structured?.usd_jpy_derived));if(!c)return null;picked=[c];text=`${c.structured.as_of}のECB参照レートから計算した参考値は、1米ドル＝${c.structured.usd_jpy_derived}円だぴよ。現在の取引の値ではないぴよ。\n出典：欧州中央銀行（ECB） ${c.url}`;
  }else{picked=cards.slice(0,3);text='取得できた記事の見出しだぴよ。\n'+picked.map(c=>`「${c.title}」\n${c.url}`).join('\n');}
  const checked=root.InfobaseGuard.guard(text,picked);text=checked.text;
  for(const c of picked)client().feedback(c.id,'使った').catch(()=>{});
  usedCards=picked;usedAnswers.push({text,cards:picked});while(usedAnswers.length>30)usedAnswers.shift();const cut=text.indexOf('\n出典：');return{text,body:cut<0?text:text.slice(0,cut),source:cut<0?'':text.slice(cut+1),cards:picked,ids:picked.map(c=>c.id)};
 }
 async function report(text,kind){const record=usedAnswers.findLast(r=>r.text===text);if(!record)return;for(const c of record.cards)await client().feedback(c.id,kind==='old'?'古い':'ちがうよ');}
 async function corrections(){const result=await client().request('/v1/corrections');return(result?.cards||[]).filter(c=>usedCards.some(x=>x.id===c.id));}
 function hasWeatherProof(q){return client().enabled&&/天気|気温|降水|雨|傘/.test(q||'')&&weatherCards.length>0;}
 function guard(text,q){return hasWeatherProof(q)?root.InfobaseGuard.guard(text,weatherCards):{ok:true,text};}
 function settings(){const form=document.getElementById('piyo-key-modal'),place=document.getElementById('set-infobase');if(!form&&!place)return;const section=document.createElement('section');section.style.marginTop='14px';const title=document.createElement('strong');title.textContent='infobase の一般情報';const hint=document.createElement('p');hint.textContent='接続の設定を貼ると、天気・為替・ニュースにも使えます。取れないときは今までの方法で答えます。';hint.style.fontSize='12px';const input=document.createElement('textarea');input.rows=2;input.setAttribute('aria-label','infobase のつなぎ方');input.placeholder=config().key?'保存済み（入れ直すときだけ貼り付け）':'接続の設定（JSON）を貼り付け';input.autocomplete='off';input.spellcheck=false;Object.assign(input.style,{width:'100%',fontSize:'16px',boxSizing:'border-box'});const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';Object.assign(toggle.style,{width:'auto',margin:'0',padding:'0'});toggle.checked=config().enabled!==false;label.append(toggle,document.createTextNode(' infobase を使う'));const button=document.createElement('button');button.type='button';button.textContent='接続を保存';const message=document.createElement('p');message.setAttribute('role','status');button.onclick=()=>{try{const c=input.value.trim()?JSON.parse(input.value):config();if(!c.url||!c.key||!/^https:\/\//.test(c.url))throw new Error();localStorage.setItem(KEY,JSON.stringify({...c,enabled:toggle.checked}));input.value='';input.placeholder='保存済み';message.textContent='保存しました。';}catch{message.textContent='つなぎ方の設定をそのまま貼り付けてください。';}};toggle.onchange=()=>{const c=config();localStorage.setItem(KEY,JSON.stringify({...c,enabled:toggle.checked}));};if(place){section.append(hint,label,input,button,message);place.append(section);return;}section.append(title,hint,label,input,button,message);(form.querySelector('.piyo-prep')||form).append(section);}
 root.PiyoInfobase={topicOk,BRIEF_TOPICS,answer,weather,report,corrections,guard,hasWeatherProof,get cards(){return usedCards;}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',settings,{once:true});else settings();
})(globalThis);
