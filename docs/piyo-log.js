// ぴよの会話の記録（2026-11-04）。ぴよとのやり取りを、この端末に保存してから、Mac の Claude Pet の「会話記録の窓口」へ送る。
// 記録はぴよの答え作り・会話の記憶（history）・AI とは別。送り先は本人の Mac だけ（GitHub・公開ページには出ない）。
// 既定は「記録しない」。設定の画面の「会話の記録」で入れる。
// 部品 piyo-log/schema.js・recorder.js の元は、本人の OneDrive「ぴよりん/会話品質共有/collector」（3 つのぴよで共通）。
(function(){
  'use strict';
  const R=window.PiyoLogRecorder,S=window.PiyoLogSchema;
  if(!R||!S)return;
  const ON='piyo-log-on',LINK='piyo-log-link',DEV='piyo-log-device',STATE='piyo-log-state';
  const APP_VER=(document.querySelector('meta[name="piyo-ver"]')||{}).content||'';
  const ls={get:k=>{try{return localStorage.getItem(k)}catch(_){return null}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(_){}}};

  // 送信待ちは IndexedDB に（使えないときは localStorage）。どちらも消されることがあるので、送れた時刻と件数を画面に出す
  function idbStorage(){
    let dbp=null;
    const open=()=>dbp||(dbp=new Promise((ok,ng)=>{const r=indexedDB.open('piyo-log',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>ok(r.result);r.onerror=()=>ng(r.error)}));
    const tx=(mode,fn)=>open().then(db=>new Promise((ok,ng)=>{const t=db.transaction('kv',mode),st=t.objectStore('kv'),q=fn(st);t.oncomplete=()=>ok(q&&q.result);t.onerror=t.onabort=()=>ng(t.error)}));
    return{load:()=>tx('readonly',st=>st.get('state')).then(v=>v||null),save:s=>tx('readwrite',st=>st.put(JSON.parse(JSON.stringify(s)),'state'))};
  }
  const storage=typeof indexedDB!=='undefined'?idbStorage():R.stringStorage(()=>ls.get(STATE),v=>{localStorage.setItem(STATE,v)});

  let device=ls.get(DEV);
  if(!device||!/^dev_[0-9a-f]{32}$/.test(device)){device=S.newId('dev');ls.set(DEV,device)}
  const rec=R.createRecorder({app:'piyorin-news',appVer:APP_VER,deviceId:device,storage,tz:'Asia/Tokyo'});
  let conv=S.newId('cv');
  const open=new Set();
  const enabled=()=>ls.get(ON)==='1';

  // つなぎ方：「piyo-log v1 https://<Mac の住所> <合言葉>」（Mac の Claude Pet でコピーする）
  function parseLink(text){
    const m=String(text||'').trim().match(/^piyo-log v1 (https:\/\/[^\s/]+(?::\d+)?) ([A-Za-z0-9_-]{24,})$/);
    return m?{url:m[1],token:m[2]}:null;
  }
  function link(){try{const v=JSON.parse(ls.get(LINK)||'null');return v&&/^https:\/\//.test(v.url)&&v.token?v:null}catch(_){return null}}

  const quiet=p=>{p.catch(()=>{});return p};
  // 質問を受けた。返すのはやり取りの ID（記録しないときは null）。meta は読み取りの印など（小さな物だけ）
  function turn(q,meta,refs){
    if(!enabled())return null;
    const id=S.newId('tn');open.add(id);
    quiet(rec.startTurn({convId:conv,turnId:id,question:String(q||'').slice(0,S.LIMITS.question),parsed:meta||undefined,ctxRefs:refs&&refs.filter(Boolean).length?refs.filter(Boolean):undefined,flags:{aiSafe:true,share:true}}));
    return id;
  }
  // 答え終わった。status: ok・error・timeout・aborted・cut。answer は画面に出した文
  function end(id,r){
    if(!id||!open.has(id))return;
    open.delete(id);
    quiet(rec.endTurn(id,{status:r.status||'ok',answer:r.answer==null?undefined:String(r.answer).slice(0,S.LIMITS.answer),route:r.route,model:r.model,ms:r.ms,errorKind:r.errorKind==null?undefined:String(r.errorKind).slice(0,40)}).then(soon));
  }
  const isOpen=id=>!!id&&open.has(id);
  function feedback(id,f){
    if(!id||!enabled())return;
    quiet(rec.feedback({convId:conv,turnId:id,rating:f.rating||null,reason:f.reason,comment:f.comment?String(f.comment).slice(0,S.LIMITS.comment):undefined}).then(soon));
  }
  const newConv=()=>{conv=S.newId('cv')};

  // 送る。つながらなければ送信待ちに残し、間を延ばしてまた送る
  let timer=null,sending=null,lastTry=0;
  function sender(l){
    return async events=>{
      const ac=new AbortController(),t=setTimeout(()=>ac.abort(),10000);
      try{
        const r=await fetch(l.url+'/piyo-log/ingest',{method:'POST',signal:ac.signal,cache:'no-store',headers:{'content-type':'application/json',authorization:'Bearer '+l.token},body:JSON.stringify({events})});
        if(!r.ok)throw Object.assign(new Error('http'),{code:'http-'+r.status});
        return await r.json();
      }catch(e){if(!e.code)e.code=ac.signal.aborted?'timeout':'unreachable';throw e}
      finally{clearTimeout(t)}
    };
  }
  function flush(force){
    const l=link();if(!l)return Promise.resolve(null);
    if(sending)return sending;
    if(!force&&Date.now()-lastTry<rec.nextRetryMs())return Promise.resolve(null);
    lastTry=Date.now();
    sending=rec.flush(sender(l)).finally(()=>{sending=null;paint()});
    return sending;
  }
  function soon(){clearTimeout(timer);timer=setTimeout(()=>flush(false),1500)}

  // ---- 設定の画面の「会話の記録」 ----
  const box=()=>document.getElementById('set-piyolog');
  const when=iso=>iso?new Date(iso).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'まだ';
  const ERR={unreachable:'Mac につながりません（Mac が起きているか、Tailscale がオンか）',timeout:'Mac の返事が遅すぎました','http-401':'合言葉が違います（つなぎ方を貼り直してください）','http-403':'送り元が許可されていません','http-413':'大きすぎました','no-progress':'Mac が受け取りませんでした'};
  async function paint(){
    const el=box();if(!el)return;
    const st=await rec.status().catch(()=>null);const l=link();
    const s=el.querySelector('[data-pl="state"]');if(!s)return;
    const parts=[enabled()?'記録する：入':'記録する：切（いまは何も残しません）'];
    if(st){
      parts.push('送っていない記録 '+st.pending+' 件'+(st.overCap?'（多くなっています。Mac につないでください）':''));
      parts.push('最後に Mac へ送れた時刻 '+when(st.lastSyncAt));
      if(st.lastError)parts.push('送れなかったわけ：'+(ERR[st.lastError.kind]||st.lastError.kind));
      if(st.rejected)parts.push('Mac が受け付けなかった記録 '+st.rejected+' 件');
      if(st.saveError)parts.push('この端末に保存できませんでした（'+st.saveError+'）');
    }
    parts.push(l?'送り先：'+l.url.replace(/^https:\/\//,''):'送り先：まだ（つなぎ方を貼ると Mac へ送ります。それまではこの端末にためます）');
    s.textContent=parts.join('\n');
    el.querySelector('[data-pl="on"]').checked=enabled();
    el.querySelector('[data-pl="send"]').disabled=!l||!st||!st.pending;
  }
  function settings(){
    const el=box();if(!el||el.dataset.ready)return;el.dataset.ready='1';
    el.innerHTML='<p class="set-note">ぴよとのやり取り（質問・答え・答えられなかったこと・「ちがうよ」）を残して、ぴよの答えをよくするのに使います。送り先は Mac の Claude Pet だけで、GitHub や公開ページには出ません。</p>'
      +'<label class="pl-row"><input type="checkbox" data-pl="on"> 会話を記録する</label>'
      +'<p class="run-meta pl-state" data-pl="state" role="status"></p>'
      +'<textarea data-pl="link" rows="2" autocomplete="off" spellcheck="false" aria-label="会話記録のつなぎ方" placeholder="'+(link()?'保存済み（入れ直すときだけ貼り付け）':'つなぎ方（piyo-log v1 …）を貼り付け')+'"></textarea>'
      +'<div class="pl-acts"><button type="button" class="set-act" data-pl="save">つなぎ方を保存</button><button type="button" class="set-act" data-pl="send">いま送る</button><button type="button" class="set-act" data-pl="forget">つなぎ方を消す</button><button type="button" class="set-act" data-pl="clear">記録を全部消す</button></div>'
      +'<p class="set-note" data-pl="note" role="status"></p>';
    const $=k=>el.querySelector('[data-pl="'+k+'"]'),note=t=>{$('note').textContent=t};
    $('on').addEventListener('change',e=>{ls.set(ON,e.target.checked?'1':null);note(e.target.checked?'記録を始めました。':'記録をやめました。ためた記録は残っています（消すときは「記録を全部消す」）。');paint()});
    $('save').addEventListener('click',()=>{const v=parseLink($('link').value);if(!v)return note('つなぎ方をそのまま貼り付けてください（piyo-log v1 で始まる 1 行）。');ls.set(LINK,JSON.stringify(v));$('link').value='';$('link').placeholder='保存済み（入れ直すときだけ貼り付け）';note('保存しました。');flush(true)});
    $('send').addEventListener('click',async()=>{note('送っています…');const r=await flush(true);note(r&&r.pending===0?'送りました。':'送れなかった分は、あとでまた送ります。')});
    $('forget').addEventListener('click',()=>{ls.set(LINK,null);note('つなぎ方を消しました（ためた記録は残ります）。');paint()});
    $('clear').addEventListener('click',async()=>{
      if(!confirm('この端末の会話の記録を全部消しますか？（Mac に送った分も、次に送るときに消えます）'))return;
      await quiet(rec.remove('all'));note('消しました。');paint();flush(true);
    });
    paint();
  }

  quiet(rec.recover()).then(()=>{paint();flush(true)}); // 前に答えの途中で閉じた分は「途中で終わった」にする
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')flush(false)});
  setInterval(()=>flush(false),5*60e3);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',settings);else settings();
  document.addEventListener('click',e=>{if(e.target.closest('[data-set="open"]'))setTimeout(()=>{settings();paint()},0)});

  window.PiyoLog={turn,end,feedback,isOpen,newConv,flush,parseLink,status:()=>rec.status(),_rec:rec};
})();
