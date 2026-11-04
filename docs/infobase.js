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
 const BRIEF_TOPICS=['weather','now','warning','quake','fx','holiday'];
 const hm=v=>{const t=new Date(+new Date(v)+9*3600000).toISOString();return t.slice(0,10)+' '+t.slice(11,16);};
 async function briefAnswer(q){
  const b=brief();if(!b||!b.enabled||q.length>40||/ニュース|予想|予測|見通し|なぜ|理由|仕組み|とは|って何|ぴよりん/.test(q))return null;
  const r=await b.answer(q).catch(()=>null);const one=r&&r.briefs&&r.briefs[0];
  if(!one||!BRIEF_TOPICS.includes(one.topic)||!one.say||one.status==='まだ無い')return null;
  if(one.topic==='fx'&&!fxAsk(q))return null;
  const src=(one.sources||[]).find(x=>x.id)||(one.sources||[])[0]||{};
  const card={id:src.id,category:{weather:'002',now:'002',warning:'005',quake:'005',fx:'006',holiday:'011'}[one.topic],type:'メイン',status:'確定',verdict:'確認済み',title:one.title||one.id,summary:one.say,structured:one.facts||null,url:src.url||'',origin:src.origin||'',attribution:src.attribution||'',published_at:one.as_of,expires_at:one.fresh_until||new Date(Date.now()+3600000).toISOString()};
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
 root.PiyoInfobase={answer,weather,report,corrections,guard,hasWeatherProof,get cards(){return usedCards;}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',settings,{once:true});else settings();
})(globalThis);
