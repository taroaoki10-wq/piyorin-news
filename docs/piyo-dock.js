/* 町の天気を well dock（infobase）から読む 3 段の道。画面を持たない部品（ブラウザと Node の両方で使う）。
 *  1. 直の道   https://<Mac の hostname>:8444/v1/weather?town=…   2 秒で切る。失敗したら 60 秒は試さない
 *  2. Cloudflare の道  <piyo-infobase の url>/v1/weather?town=…      2.5 秒で切る（Tailscale が落ちていても使える）
 *  3. （この部品の外）Open-Meteo。index.html の今の流れ
 * 鍵は端末の piyo-infobase の key（Authorization: Bearer）だけを送る。Mac の合言葉（piyo-mac の token）は送らない。
 * 返事（窓口の約束の形）を、index.html の weatherDays が作る「日の配列」と同じ形に直す。 */
(function(root){
  'use strict';
  const KEY_SETTING='piyo-dockwx';          // '0' のときだけ切（既定は入り）
  const KEY_INFOBASE='piyo-infobase';       // infobase.js と同じ鍵の置き場
  const DIRECT_PORT='8444', DIRECT_MS=2000, CLOUD_MS=2500, SKIP_MS=60e3, STALE_MS=3*3600e3, MAX_OLD_MS=6*3600e3;
  const JST=9*3600e3;
  const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const numOrNull=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
  const addDay=s=>new Date(Date.parse(s+'T00:00:00Z')+86400e3).toISOString().slice(0,10);

  // 天気の言葉を weatherKind（図の絵を選ぶ）が読める形にそろえる：空白を取る・「曇」→「くもり」・「晴」→「晴れ」
  function word(v){
    if(typeof v!=='string')return '';
    return v.replace(/[\s　]+/g,'').replace(/曇り|曇/g,'くもり').replace(/晴れ|晴/g,'晴れ');
  }
  // at（'2026-11-23T24:00:00+09:00' など）→ {date,hour}（日本時間）。読めなければ null。時刻の端数は切り捨て
  function jstParts(at){
    if(typeof at!=='string')return null;
    const s=/(Z|[+-]\d{2}:?\d{2})$/.test(at)?at:at+'+09:00'; // 時差の無い文字は日本時間として読む（端末の時間帯に頼らない）
    const ms=Date.parse(s);if(!Number.isFinite(ms))return null;
    const iso=new Date(ms+JST).toISOString();
    return{date:iso.slice(0,10),hour:Number(iso.slice(11,13))};
  }
  // 古さの判定（1 か所）：窓口の stale が true、または as_of（daily と hourly のうち新しい方）が 3 時間より前。as_of が読めなければ古いとは言わない
  function asOfMs(body){
    const a=body&&body.as_of,list=[];
    if(typeof a==='string')list.push(a);else if(isObj(a)){list.push(a.daily,a.hourly)}
    const ms=list.map(v=>typeof v==='string'?Date.parse(v):NaN).filter(Number.isFinite);
    return ms.length?Math.max(...ms):null;
  }
  function isStale(body,now){
    if(body&&body.stale===true)return true;
    const at=asOfMs(body);return at!==null&&now-at>STALE_MS;
  }
  // 古い予報で答えるときの一言
  function noteOf(asOf){
    if(!Number.isFinite(asOf))return '（少し前の予報だぴよ。新しい予報はいま取れなかったぴよ。）';
    const t=new Date(asOf+JST);
    return `（${t.getUTCHours()}時${String(t.getUTCMinutes()).padStart(2,'0')}分に取った予報だぴよ。新しい予報はいま取れなかったぴよ。）`;
  }
  // 出典の名前：sources の daily・hourly（重なりは 1 つ）。無ければ「気象庁・tenki.jp」
  function sourceName(body){
    const s=isObj(body&&body.sources)?body.sources:{},out=[];
    for(const k of ['daily','hourly']){const v=typeof s[k]==='string'?s[k].replace(/[\s　]+/g,' ').trim().slice(0,30):'';if(v&&!out.includes(v))out.push(v)}
    return out.length?out.map(v=>/^Open-Meteo/.test(v)?'Open-Meteo.com（CC BY 4.0）':v).join('・'):'気象庁・tenki.jp';
  }

  // 1 時間ごとの点：'日付 時' → {temp,word,pop}。hour が 24 の行は次の日の 0 時。読めない行は捨てる
  function points(body){
    const pts=new Map();
    if(body&&Array.isArray(body.hourly))for(const r of body.hourly){
      if(!isObj(r))continue;const p=jstParts(r.at);if(!p)continue;
      pts.set(p.date+' '+p.hour,{temp:numOrNull(r.temp),word:word(r.weather),pop:numOrNull(r.pop)});
    }
    return pts;
  }
  const pointAt=(pts,date,h)=>h<24?pts.get(date+' '+h):pts.get(addDay(date)+' 0'); // h は 0〜24（24 は次の日の 0 時）
  // その日の雨の区間：今の weatherDays と同じ。3 時間の区間の h+1・h+2・h+3 時の値の最大（3 つそろった区間だけ）
  function rainHoursOf(pts,date){
    const out=[];
    for(let h=0;h<24;h+=3){
      const v=[1,2,3].map(k=>pointAt(pts,date,h+k)).map(p=>p?p.pop:null).filter(x=>x!==null);
      if(v.length===3)out.push({from:h,to:h+3,rain:Math.max(...v)});
    }
    return out;
  }
  // その日の 3 時間ごとの点：今の hoursOf と同じ。h 時の気温と言葉があるとき、雨は h+1〜h+3 時のうち有る値の最大
  function hoursOfDay(pts,date){
    const hs=[];
    for(let h=0;h<24;h+=3){
      const p=pts.get(date+' '+h);if(!p||p.temp===null||!p.word)continue;
      const v=[1,2,3].map(k=>pointAt(pts,date,h+k)).map(q=>q?q.pop:null).filter(x=>x!==null);
      hs.push({h,temp:Math.round(p.temp)||0,word:p.word,rain:v.length?Math.max(...v):null});
    }
    return hs;
  }
  // 今日と明日の 3 時間ごとの点だけ（daily が欠けていても作れる。名古屋の図が使う）。{日付:[…]}
  function hoursByDate(body,today){
    const out={};if(!DATE_RE.test(today||''))return out;
    try{const pts=points(body);for(const date of [today,addDay(today)]){const hs=hoursOfDay(pts,date);if(hs.length)out[date]=hs}}catch(_){}
    return out;
  }
  // 約束の形 → 日の配列（weatherDays と同じ形）。today は日本時間の今日（'YYYY-MM-DD'）。作れなければ null
  function normalize(body,today){
    try{
      if(!isObj(body)||!Array.isArray(body.daily)||!DATE_RE.test(today||''))return null;
      const tomorrow=addDay(today),pts=points(body);
      const dayPoints=date=>{const out=[];for(let h=0;h<24;h++){const p=pts.get(date+' '+h);if(p)out.push(p)}return out}; // その日の 0〜23 時の点
      const out=[];
      for(const d of body.daily){
        if(!isObj(d)||!DATE_RE.test(d.date||''))continue;
        const date=d.date,w=word(d.weather);
        let max=numOrNull(d.max),min=numOrNull(d.min),pop=numOrNull(d.pop);
        const day=dayPoints(date),temps=day.map(p=>p.temp).filter(v=>v!==null),pops=day.map(p=>p.pop).filter(v=>v!==null);
        // 最高・最低は、その日の 1 日分（22 時間以上）の点がそろうときだけ 1 時間ごとの値で埋める（夜に「これから先」だけで最高を決めない）
        if(temps.length>=22){if(max===null)max=Math.max(...temps);if(min===null)min=Math.min(...temps)}
        if(pop===null&&pops.length)pop=Math.max(...pops);
        if(!w||max===null||min===null)continue; // 今の Open-Meteo と同じ扱い（その日は出さない）
        const near=date===today||date===tomorrow,hours=near?hoursOfDay(pts,date):[];
        out.push({date,word:w,max:Math.round(max),min:Math.round(min),rain:pop,sunrise:null,sunset:null,uv:null,wind:null,precipitation:null,rainHours:near?rainHoursOf(pts,date):[],...(hours.length?{hours}:{})});
      }
      return out.length?out:null;
    }catch(_){return null}
  }
  // 名古屋の図：今の 3 時間ごとの点に、dock の点を重ねる（同じ時は dock が勝つ。dock に無い時は今の点を残す）
  function mergeHours(base,over){
    const m=new Map();for(const p of Array.isArray(base)?base:[])if(p&&Number.isFinite(p.h))m.set(p.h,p);
    for(const p of Array.isArray(over)?over:[])if(p&&Number.isFinite(p.h))m.set(p.h,p);
    return [...m.values()].sort((a,b)=>a.h-b.h);
  }

  // 直の道の住所（URL として解いた hostname に :8444。つなぎ方の url にポートがあっても hostname だけ使う）
  function directUrl(macUrl,town){
    try{
      const u=new URL(String(macUrl||''));if(u.protocol!=='https:'||!u.hostname)return '';
      const o=new URL('https://'+u.hostname);o.port=DIRECT_PORT;o.pathname='/v1/weather';o.searchParams.set('town',town);
      return o.toString();
    }catch(_){return ''}
  }
  // Cloudflare の道の住所（infobase の url。infobase-client.js と同じ条件：https か 127.0.0.1）
  function cloudUrl(base,town){
    try{
      const b=String(base||'').replace(/\/$/,'');
      if(!(/^https:\/\//.test(b)||/^http:\/\/127\.0\.0\.1:\d+$/.test(b)))return '';
      const o=new URL(b+'/v1/weather');o.searchParams.set('town',town);return o.toString();
    }catch(_){return ''}
  }

  /* env：{fetch, storage, getMac, today, now, setTimeout, clearTimeout, directMs, cloudMs, skipMs}
   * town(name) → {days, via:'direct'|'cloud', srcName, asOf, stale} か null（どちらの道でも作れない。Open-Meteo へ） */
  function create(env){
    env=env||{};
    const doFetch=env.fetch||((...a)=>root.fetch(...a));
    const now=env.now||(()=>Date.now());
    const st=env.setTimeout||((f,ms)=>root.setTimeout(f,ms)),ct=env.clearTimeout||(t=>root.clearTimeout(t));
    const today=env.today||(()=>new Date(now()+JST).toISOString().slice(0,10));
    const directMs=env.directMs||DIRECT_MS,cloudMs=env.cloudMs||CLOUD_MS,skipMs=env.skipMs||SKIP_MS;
    let directDownUntil=0,cloudDownUntil=0;
    const storage=()=>env.storage||null;
    const on=()=>{try{const s=storage();return !s||s.getItem(KEY_SETTING)!=='0'}catch(_){return true}};
    const config=()=>{try{const v=JSON.parse((storage()&&storage().getItem(KEY_INFOBASE))||'{}');return isObj(v)?v:{}}catch(_){return{}}};

    // 1 回の問い合わせ。時間は fetch から json の読みまで全部で ms（fetch が signal を無視しても進む）。
    // → {kind:'ok',body} | {kind:'unknown'}（窓口は生きていて、その町が無い）| {kind:'fail'}
    function call(url,key,ms){
      return new Promise(resolve=>{
        let done=false,ac=null;try{ac=new AbortController()}catch(_){}
        const fin=v=>{if(done)return;done=true;ct(timer);if(v.kind==='fail'&&ac){try{ac.abort()}catch(_){}}resolve(v)};
        const timer=st(()=>fin({kind:'fail'}),ms);
        (async()=>{
          const res=await doFetch(url,{headers:{Authorization:'Bearer '+key},cache:'no-store',redirect:'error',...(ac?{signal:ac.signal}:{})});
          if(res.ok){
            const body=await res.json();
            return isObj(body)&&(Array.isArray(body.daily)||Array.isArray(body.hourly))?{kind:'ok',body}:{kind:'fail'};
          }
          if(res.status===404){ // 知らない町（窓口の決まった文）か、窓口が古くて口が無いか
            let j=null;try{j=await res.json()}catch(_){}
            if(isObj(j)&&typeof j.error==='string'&&j.error.includes('その町の天気'))return{kind:'unknown'};
          }
          return{kind:'fail'};
        })().then(fin,()=>fin({kind:'fail'}));
      });
    }
    // → {days（答えに使える日の配列。今日が作れなければ null）, hours（新しい中身のときだけ。{日付:[…]}）, via, srcName, asOf, stale}。何も作れなければ null
    function build(body,via){
      const t=now(),td=today(),stale=isStale(body,t);
      let days=normalize(body,td);if(days&&!days.some(d=>d.date===td))days=null; // 今日が作れないなら答えには使わない
      const hours=stale?{}:hoursByDate(body,td);
      if(!days&&!Object.keys(hours).length)return null;
      return{days,hours,via,srcName:sourceName(body),asOf:asOfMs(body),stale};
    }
    // 古い中身を使ってよいか：取った時刻が分かり、日本時間で今日のもので、6 時間以内
    function usableOld(at){return Number.isFinite(at)&&now()-at<=MAX_OLD_MS&&new Date(at+JST).toISOString().slice(0,10)===new Date(now()+JST).toISOString().slice(0,10)}
    async function town(name){
      if(!on()||typeof name!=='string'||!name)return null;
      const cfg=config();if(typeof cfg.key!=='string'||!cfg.key||cfg.enabled===false)return null;
      const mac=env.getMac?env.getMac():null;
      const steps=[];
      if(mac&&mac.url&&now()>=directDownUntil){const u=directUrl(mac.url,name);if(u)steps.push({via:'direct',url:u,ms:directMs})}
      if(now()>=cloudDownUntil){const u=cloudUrl(cfg.url,name);if(u)steps.push({via:'cloud',url:u,ms:cloudMs})} // Cloudflare も落ちたら 60 秒は試さない（町ごとに 2.5 秒待たせないため）
      let stale=null,partial=null; // stale：古いが日の配列が作れた中身。partial：新しいが日の配列は作れず、3 時間ごとの点だけ作れた中身
      for(const s of steps){
        const r=await call(s.url,cfg.key,s.ms);
        if(r.kind==='fail'){if(s.via==='direct')directDownUntil=now()+skipMs;else cloudDownUntil=now()+skipMs;continue}
        if(r.kind==='unknown')continue; // 道は生きている。次の道（と Open-Meteo）に聞く
        const got=build(r.body,s.via);if(!got)continue;
        if(!got.stale&&got.days)return got;
        if(got.stale&&got.days){if(usableOld(got.asOf)&&(!stale||got.asOf>stale.asOf))stale=got} // 古い中身は「同じ日・6 時間以内」だけ（それより古い予報では答えない）
        else if(!got.stale&&!partial)partial=got;
      }
      if(stale)return partial?{...stale,hours:partial.hours}:stale;
      return partial;
    }
    return{town,on,directDown:()=>now()<directDownUntil};
  }

  const api={create,normalize,hoursByDate,mergeHours,directUrl,cloudUrl,word,jstParts,asOfMs,isStale,noteOf,sourceName,KEY_SETTING,KEY_INFOBASE,DIRECT_MS,CLOUD_MS,SKIP_MS,MAX_OLD_MS,STALE_MS};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PiyoDock=api;
})(typeof globalThis!=='undefined'?globalThis:this);
