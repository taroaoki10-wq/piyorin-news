/* infobase の共通クライアント。ブラウザとNodeの両方で使う。鍵・返事・質問はログに残さない。 */
(function(root){
 function valid(card,now=Date.now()){return !!card&&!/Yahoo|NHK/i.test(card.publisher_name||card.origin||'')&&card.type==='メイン'&&card.status==='確定'&&['確認済み','裏付けあり'].includes(card.verdict)&&Date.parse(card.expires_at)>now;}
 function create(config={}){
  const doFetch=config.fetch||((...args)=>fetch(...args));
  const base=String(config.url||'').replace(/\/$/,'');
  const enabled=config.enabled!==false&&!!config.key&&(/^https:\/\//.test(base)||/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
  async function request(path,options={}){if(!enabled)return null;try{const res=await doFetch(base+path,{...options,headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},signal:AbortSignal.timeout(config.timeout||1800),cache:'no-store',redirect:'error'});if(!res.ok)return null;return await res.json();}catch{return null;}}
  async function cards(query={}){const data=await request('/v1/cards?'+new URLSearchParams(query));return data?.cards?.filter(c=>valid(c))||null;}
  async function feedback(card_id,kind){return request('/v1/feedback',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),card_id,kind})});}
  return{request,cards,feedback,enabled};
 }
 function toOpenMeteo(cards,now=Date.now()){
  const selected=(cards||[]).filter(c=>valid(c,now)&&c.source==='open-meteo-nagoya'&&c.structured?.area==='名古屋市');if(!selected.length)return null;
  const days=[...new Map(selected.map(c=>[c.structured.forecast_date,c])).values()].sort((a,b)=>a.structured.forecast_date.localeCompare(b.structured.forecast_date));
  const hours=days.flatMap(c=>c.timeline||[]).sort((a,b)=>a.at.localeCompare(b.at));if(!hours.length)return null;
  const daily={time:[],temperature_2m_max:[],temperature_2m_min:[],weather_code:[],precipitation_probability_max:[],sunrise:[],sunset:[],uv_index_max:[],wind_speed_10m_max:[]};
  for(const c of days){daily.time.push(c.structured.forecast_date);for(const key of Object.keys(daily).filter(k=>k!=='time'))daily[key].push(c.structured.daily?.[key]??({temperature_2m_max:c.structured.high,temperature_2m_min:c.structured.low}[key])??null);}
  const mapping={temperature_2m:'temperature',precipitation_probability:'precipitation_probability',weather_code:'weather_code',precipitation:'precipitation',is_day:'is_day',relative_humidity_2m:'humidity',wind_speed_10m:'wind_speed'};
  const hourly={time:hours.map(h=>h.at.slice(0,16))};for(const[key,field]of Object.entries(mapping))hourly[key]=hours.map(h=>h[field]??null);
  return {hourly,daily,current:days[0].structured.current||null,infobase_ids:days.map(c=>c.id),infobase_cards:days,infobase_source:'Open-Meteo（infobase）'};
 }
 function newsItems(cards){return(cards||[]).filter(c=>valid(c)).map(c=>({t:c.title,u:c.url,s:c.origin||c.source,d:c.published_at,h:(()=>{try{return new URL(c.publisher_url||c.url).hostname;}catch{return'';}})(),infobase_id:c.id,verdict:c.verdict,reader_only:!!c.reader_only}));}
 const api={create,valid,toOpenMeteo,newsItems};if(typeof module==='object'&&module.exports)module.exports=api;else root.InfobaseClient=api;
})(typeof globalThis!=='undefined'?globalThis:this);
