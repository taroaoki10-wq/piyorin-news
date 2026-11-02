/* 答える直前の共通の照合。元の情報がない数値・名前・日付は、答えとして出さない。 */
(function(root){
 const FALLBACK='この情報は手元の資料で確かめられないぴよ。';
 const normalize=s=>String(s||'').normalize('NFKC').replace(/,/g,'');
 const day=value=>{const n=+new Date(value);return Number.isFinite(n)?new Date(n+9*3600000).toISOString().slice(0,10):null;};
 function dateValue(y,m,d){const value=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;try{return day(value+'T00:00:00+09:00')===value?value:null;}catch{return null;}}
 function dates(text,year){const out=[];const s=normalize(text);for(const m of s.matchAll(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/g)){const d=dateValue(+m[1],+m[2],+m[3]);if(d)out.push(d);}for(const m of s.replace(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/g,' ').matchAll(/(?<!\d[-/])(?<!\d)(\d{1,2})[月/](\d{1,2})日?/g)){const d=dateValue(year,+m[1],+m[2]);if(d)out.push(d);}return [...new Set(out)];}
 const factDates=c=>[...new Set([...(c.event_dates||[]),c.structured?.forecast_date,c.structured?.as_of,...dates(`${c.title} ${c.summary}`,Number(String(c.published_at).slice(0,4)))].filter(Boolean))];
 const dataText=c=>[c.title,c.summary,c.attribution,c.origin,c.publisher_name,JSON.stringify(c.structured||{}),JSON.stringify(c.timeline||[]),(c.timeline||[]).map(h=>`${h.temperature??''}℃ ${h.precipitation_probability??''}%`).join(' '),c.structured?.usd_jpy_derived?`1米ドル ${c.structured.usd_jpy_derived}円`:''].filter(Boolean).join('\n');
 function grams(s){const t=normalize(s).replace(/https?:\/\/\S+|\d+(?:[.:-]\d+)*|今日|明日|昨日|今年|来年|去年|ぴよ|です|ます|だよ|の天気|天気の/g,'').replace(/[\s\p{P}]/gu,'');return new Set([...t].slice(0,-2).map((_,i)=>t.slice(i,i+3)));}
 function relevance(sentence,card){const a=grams(sentence),b=grams((card.title||'')+' '+(card.summary||''));return [...a].filter(x=>b.has(x)).length/Math.max(1,Math.min(a.size,b.size));}
 function numericTokens(s){return [...normalize(s).matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>String(+m[0]));}
 function namesIn(text,known){const general=['ニュース','データ','カード','リンク','ドル','ユーロ','マグニチュード','レート','Open','Weather'];const found=[...normalize(text).matchAll(/[A-Z][A-Za-z0-9-]{2,}|[ァ-ヶー]{3,}|[一-龥々]{2,}(?:市|区|県|府|都|神社|神宮|大学)/g)].map(m=>m[0].replace(/^(?:今日|明日|昨日|今年|来年|去年)/,''));for(const name of known)if(text.includes(name))found.push(name);return [...new Set(found)].filter(n=>!general.includes(n));}
 function guard(answer,cards,options={}){
  const now=options.now||Date.now(),today=day(now),year=+(today||'0000').slice(0,4),issues=[];
  if(!today)return {ok:false,text:options.fallback||FALLBACK,issues:[{kind:'時刻',reason:'現在の日時を確認できません'}],used_ids:[]};
  const current=(cards||[]).filter(c=>c&&c.status==='確定'&&['確認済み','裏付けあり'].includes(c.verdict)&&+new Date(c.expires_at)>+new Date(now));
  if(!current.length)return {ok:false,text:options.fallback||FALLBACK,issues:[{kind:'根拠',reason:'期限内の確定したカードがありません'}],used_ids:[]};
  const bare=normalize(answer).replace(/https?:\/\/[^\s）)]+/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1');
  const sentences=bare.split(/[。！？?!\n]/).map(s=>s.trim()).filter(Boolean);
  const known=options.names||['ぴよりんゴジラ','ぴよりん','OpenAI','Claude','名古屋市','石清水八幡宮'];
  for(const sentence of sentences){
   const scores=current.map(c=>({c,n:relevance(sentence,c)})),max=Math.max(...scores.map(x=>x.n));
   const related=max>=.2?scores.filter(x=>x.n>=Math.max(.2,max*.85)).map(x=>x.c):current;
   const proof=normalize(related.map(dataText).join('\n'));
   const eventDates=[...new Set(related.flatMap(factDates))];
   let yearForDates=year;const yearRelative=/今年|来年|去年/.exec(sentence)?.[0];if(yearRelative)yearForDates=year+({'今年':0,'来年':1,'去年':-1}[yearRelative]);
   const explicit=dates(sentence,yearForDates);
   const provenance=/発表|取得|確認時刻|更新|出典/.test(sentence);
   const allowed=provenance?[...eventDates,...related.flatMap(c=>[day(c.published_at),day(c.fetched_at)])]:eventDates;
   for(const d of explicit)if(!allowed.includes(d))issues.push({kind:'日付',claim:d,reason:'対応するカードに無い日付'});
   let intended=null;
   const relative=/今日|きょう|明日|あした|翌日|明後日|あさって|昨日|きのう/.exec(sentence)?.[0];
   if(relative){const offset=({'今日':0,'きょう':0,'明日':1,'あした':1,'翌日':1,'明後日':2,'あさって':2,'昨日':-1,'きのう':-1}[relative]);const date=day(+new Date(today+'T00:00:00+09:00')+offset*86400000);intended=date;if(!eventDates.includes(date))issues.push({kind:'相対日付',claim:relative,reason:`対応する出来事は${date}ではない`});if(explicit.length&&!explicit.includes(date))issues.push({kind:'相対日付',claim:relative,reason:'今日・明日と明示した日付が一致しない'});}
   if(yearRelative){const expected=yearForDates;if(eventDates.length&&!eventDates.some(d=>+d.slice(0,4)===expected))issues.push({kind:'年',claim:yearRelative,reason:'対応する出来事の年が一致しない'});for(const m of sentence.matchAll(/(\d{4})年/g))if(+m[1]!==expected)issues.push({kind:'年',claim:m[0],reason:'相対年と西暦が一致しない'});}
   const withoutDates=sentence.replace(/\d{4}[-年/]\d{1,2}[-月/]\d{1,2}日?/g,'').replace(/\d{1,2}[月/]\d{1,2}日?/g,'');
   const numericCards=!provenance&&(intended||explicit.length)?related.filter(c=>factDates(c).some(d=>intended?d===intended:explicit.includes(d))):related;
   const numericProof=normalize(numericCards.map(dataText).join('\n'))+'\n'+(provenance?related.map(c=>`${c.published_at} ${c.fetched_at}`).join(' '):'');const numbers=new Set(numericTokens(numericProof));for(const n of [...numbers])if(n.includes('.'))numbers.add(String(Math.round(+n)));
   const quantities=s=>[...normalize(s).matchAll(/(-?\d+(?:\.\d+)?)\s*(℃|°C|°|度|円|%|mm|米ドル)/g)].map(m=>({n:+m[1],unit:['℃','°C','°','度'].includes(m[2])?'℃':m[2]}));
   const sourceQuantities=quantities(numericProof);
   for(const q of quantities(withoutDates))if(!sourceQuantities.some(p=>p.unit===q.unit&&(p.n===q.n||(Number.isInteger(q.n)&&Math.round(p.n)===q.n))))issues.push({kind:'単位',claim:String(q.n)+q.unit,reason:'対応する単位の値がありません'});
   for(const n of numericTokens(withoutDates))if(!numbers.has(n))issues.push({kind:'数字',claim:n,reason:'対応するカードに無い数字'});
   for(const name of namesIn(sentence,known))if(!proof.includes(normalize(name)))issues.push({kind:'名前',claim:name,reason:'対応するカードに無い名前'});
  }
  return {ok:issues.length===0,text:issues.length?options.fallback||FALLBACK:answer,issues,used_ids:current.map(c=>c.id)};
 }
 const api={guard,dates,FALLBACK,version:1};if(typeof module==='object'&&module.exports)module.exports=api;else root.InfobaseGuard=api;
})(typeof globalThis!=='undefined'?globalThis:this);
