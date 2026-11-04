// ぴよりんの購入記録（この端末のブラウザに保存。写真は IndexedDB、ほかは localStorage）
// 前半 PiyoBuy は画面を持たない決まり（テストで読む）、後半 PiyoBuyUI が「購入記録」のタブと記録の画面を作る。
(function(root){
  'use strict';
  const KEY='piyo-purchases', VER=1;
  const CATS={piyorin:'ぴよりん',cookie:'クッキー缶',goods:'その他'};
  // 定番（data/piyo-basics.json と公式サイト 2026-10-25 の値段。変わったら直す）
  const REGULAR={
    piyorin:[
      {name:'定番ぴよりん',price:450},{name:'いちごぴよりん',price:480},{name:'紅茶ぴよりん',price:480},
      {name:'チョコぴよりん',price:480},{name:'ももぴよりん',price:480},{name:'villageぴよりん',price:750},
      {name:'ぴよりんDX',price:6500},{name:'ぴよりんアイス',price:null}
    ],
    cookie:[{name:'ひよりの手作りクッキー缶',price:2800}],
    goods:[{name:'ぴよりんサブレ',price:750},{name:'ぴよりんマシュマロ',price:890}]
  };
  const SHOPS=[
    {name:'ぴよりんshop（名古屋駅）',short:'ぴよりんshop',slots:['9:00','12:00','15:00','18:00']},
    {name:'ぴよりんshop アトリエ店（勝川）',short:'アトリエ店',slots:['13:00']},
    {name:'ぴよりんvillage（名古屋駅）',short:'village',slots:[]},
    {name:'スマートぴよ約',short:'スマートぴよ約',slots:[]},
    {name:'ぴよりんMARKET（通販）',short:'MARKET',slots:[]}
  ];
  const CROWD=[null,'すいていた','少し並んだ','ふつうに並んだ','長い列','大行列・整理券'];
  const RATE=[null,'いまひとつ','まあまあ','ふつう','おいしい','最高！'];

  const isDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
  const todayJst=(now=Date.now())=>new Date(now+9*3600e3).toISOString().slice(0,10);
  const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
  const yen=n=>Number.isFinite(n)?n.toLocaleString('ja-JP')+'円':'';
  const int=(v,min,max)=>{const n=Math.round(Number(String(v??'').replace(/[,，円\s]/g,'')));return Number.isFinite(n)&&String(v??'').trim()!==''&&n>=min&&n<=max?n:null};
  const str=(v,max)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);

  // 予定（data/events.json）の題名から商品名にする：「ハロウィンぴよりん販売」→「ハロウィンぴよりん」
  function itemName(title){
    let t=str(title,80).replace(/\s*(の)?(先行販売|販売開始|期間限定販売|限定販売|販売|発売)$/,'').trim();
    return t||str(title,80);
  }
  // 予定が どの分類の買える物か（買える物でなければ null）
  const GOODS_WORD=/グッズ|ブランケット|傘|キーホルダー|ぬいぐるみ|カレンダー|ドール缶|乗車券|弁当|ケーキ|ステッカー|タオル|ポーチ/;
  function eventCat(e){
    if(!e||!e.title||(e.kind!=='sale'&&e.kind!=='release'))return null;
    const t=e.title;
    if(/ツアー|募集|アフタヌーンティー|予約受付|受付開始|クラウドファンディング/.test(t))return null;
    if(/クッキー缶/.test(t))return 'cookie';
    if(GOODS_WORD.test(t))return 'goods';
    if(/ぴよりん|ぴよ/.test(t)&&e.kind==='sale')return 'piyorin';
    return e.kind==='release'?'goods':null;
  }
  // ぴよメモ（記事の要約）から値段を拾う：「テイクアウト580円」「1,300円(税込)」
  function memoPrices(memo){
    const out=[],seen=new Set();
    const re=/(テイクアウト|店内飲食|イートイン|アソート|デコレーション|セット)?[\s:：]*([0-9][0-9,]{1,6})円/g;let m;
    while((m=re.exec(String(memo||'')))&&out.length<4){
      const p=int(m[2],1,999999);if(p==null||seen.has((m[1]||'')+p))continue;
      seen.add((m[1]||'')+p);out.push({label:m[1]||'',price:p});
    }
    return out;
  }
  // 買った日に売っている限定の物（と、その前後 7 日に終わった・始まる物）
  function limitedFor(events,date,memo,cat,range=7){
    if(!Array.isArray(events)||!isDate(date))return [];
    const lo=range==null?'0000-01-01':addDays(date,-range),hi=range==null?'9999-12-31':addDays(date,range),out=[],seen=new Set();
    for(const e of events){
      const c=eventCat(e);if(!c||(cat&&c!==cat)||!isDate(e.start))continue;
      const end=isDate(e.end)?e.end:e.start;
      if(end<lo||e.start>hi)continue;
      const name=itemName(e.title);if(seen.has(c+name))continue;seen.add(c+name);
      const m=memo&&(memo[e.src]||memo[e.id]);
      const prices=memoPrices(m&&m.memo);
      out.push({id:e.id,cat:c,name,start:e.start,end,place:str(e.place,60),url:e.url||'',
        onSale:e.start<=date&&date<=end,prices,price:prices.length?prices[0].price:null});
    }
    return out.sort((a,b)=>(b.onSale-a.onSale)||(a.start<b.start?1:-1));
  }
  // 過去の記録のため：これまでの限定ぜんぶ（新しい順）。ことばで絞る
  function allLimited(events,date,memo,cat,q){
    const words=String(q||'').toLowerCase().split(/[\s　]+/).filter(Boolean);
    return limitedFor(events,isDate(date)?date:todayJst(),memo,cat,null)
      .filter(x=>x.start<=todayJst()&&words.every(w=>(x.name+' '+x.place).toLowerCase().includes(w))) // まだ始まっていない物は出さない
      .sort((a,b)=>a.start<b.start?1:a.start>b.start?-1:0);
  }

  // ---------- 画像（data/piyo-images.json：ぴよりん図鑑と公式リリースの画像の住所） ----------
  // 記録には画像を入れず、表示するたびに最新の一覧から探す。買ったあとに図鑑に載れば、図鑑の画像に替わる。
  const ALIAS={'定番ぴよりん':'ぴよりん','いちごぴよりん':'イチゴぴよりん'};
  const nkey=s=>String(s||'').normalize('NFKC').replace(/[\s・･「」『』]/g,'').toLowerCase();
  const noParen=k=>k.replace(/[（(][^）)]*[）)]/g,'');
  const noYear=k=>k.replace(/20\d\d$/,'');
  const IMG_OK=/^https:\/\/(piyorin\.com\/wp\/wp-content\/uploads\/|prcdn\.freetls\.fastly\.net\/release_image\/)[^\s"'<>]+$/;
  const ixCache=new WeakMap();
  function imageIndex(images){
    if(!images||typeof images!=='object')return null;
    if(ixCache.has(images))return ixCache.get(images);
    const zk=new Map(),rel=new Map(),add=(m,k,v)=>{if(k&&!m.has(k))m.set(k,v)};
    for(const z of Array.isArray(images.zukan)?images.zukan:[]){ // 図鑑は新しい順。同じ名前は新しい方
      if(!z||!IMG_OK.test(z.img||''))continue;const k=nkey(z.name);add(zk,k,z);add(zk,noParen(k),z);
    }
    const rs=Object.entries(images.releases&&typeof images.releases==='object'?images.releases:{})
      .filter(([,v])=>v&&IMG_OK.test(v.img||'')).sort((a,b)=>(a[1].date<b[1].date?1:-1));
    for(const [id,v] of rs){add(rel,nkey(v.name||itemName(v.title)),v)}
    const ix={zk,rel,byId:images.releases||{}};ixCache.set(images,ix);return ix;
  }
  const relThumb=u=>/prcdn\.freetls\.fastly\.net/.test(u)?u+'?width=360&height=360&fit=bounds&format=jpeg':u;
  // {src（小さい画像）, full, from: 'zukan' | 'release', page}
  function imageFor(it,date,images){
    const ix=imageIndex(images);if(!ix||!it||!it.name)return null;
    const k=nkey(ALIAS[it.name]||it.name),y=String(date||'').slice(0,4);
    if(it.cat!=='goods'&&it.cat!=='cookie'){
      for(const kk of [k+y,k,noParen(k)+y,noParen(k),noYear(k)+y,noYear(k)]){const z=ix.zk.get(kk);
        if(z)return {src:z.thumb&&IMG_OK.test(z.thumb)?z.thumb:z.img,full:z.img,from:'zukan',page:images.zukanSource||'https://piyorin.com/detail/'}}
    }
    const r=(it.lid&&ix.byId[it.lid]&&IMG_OK.test(ix.byId[it.lid].img||'')?ix.byId[it.lid]:null)||ix.rel.get(k)||ix.rel.get(noParen(k));
    if(r)return {src:relThumb(r.img),full:r.img,from:'release',page:r.url||''};
    return null;
  }
  // 過去の記録の候補：図鑑の限定（通年商品は除く）と、ニュースから見つけたクッキー缶のリリース
  function archiveItems(images,cat,q){
    const words=String(q||'').toLowerCase().split(/[\s　]+/).filter(Boolean);
    const ok=n=>words.every(w=>nkey(n).includes(nkey(w)));
    if(!images)return [];
    if(cat==='piyorin')return (images.zukan||[]).filter(z=>z&&z.name&&!(z.tags||[]).includes('通年商品')&&ok(z.name))
      .map(z=>({id:z.id,name:z.name,sub:z.date||'図鑑',src:'zukan'}));
    if(cat==='cookie')return Object.entries(images.releases||{}).filter(([,v])=>v&&v.cat==='cookie'&&v.from==='news'&&v.name&&ok(v.name))
      .sort((a,b)=>a[1].date<b[1].date?1:-1).map(([id,v])=>({id,name:v.name,sub:(v.date||'').replaceAll('-','.'),src:'release',date:v.date}));
    return [];
  }

  // ---------- 記録 ----------
  function newId(now=Date.now()){return 'b'+now.toString(36)+Math.random().toString(36).slice(2,7)}
  function normItem(it){
    if(!it||typeof it!=='object')return null;
    const name=str(it.name,60);if(!name)return null;
    return {cat:CATS[it.cat]?it.cat:'goods',name,qty:int(it.qty,1,999)??1,price:int(it.price,0,999999),
      limited:it.limited?str(it.limited,80):'',period:it.period?str(it.period,30):'',
      lid:/^[\w.-]{1,60}$/.test(it.lid||'')?it.lid:'',
      rating:int(it.rating,1,5),note:String(it.note??'').trim().slice(0,500)};
  }
  function normalize(r,now=Date.now()){
    if(!r||typeof r!=='object')return null;
    const items=(Array.isArray(r.items)?r.items:[]).map(normItem).filter(Boolean).slice(0,30);
    if(!items.length||!isDate(r.date))return null;
    const time=/^\d{1,2}:\d{2}$/.test(r.time||'')?r.time:'';
    return {id:/^[a-z0-9]{4,40}$/i.test(r.id||'')?r.id:newId(now),date:r.date,time,shop:str(r.shop,60),
      crowd:int(r.crowd,1,5),wait:int(r.wait,0,1440),soldout:!!r.soldout,memo:String(r.memo??'').trim().slice(0,1000),
      photo:!!r.photo,fav:!!r.fav,items,createdAt:int(r.createdAt,0,9e15)??now,updatedAt:int(r.updatedAt,0,9e15)??now};
  }
  function total(r){
    let sum=0,known=false;
    for(const it of r.items||[]){if(it.price!=null){sum+=it.price*(it.qty||1);known=true}}
    return known?sum:null;
  }
  const count=r=>(r.items||[]).reduce((s,it)=>s+(it.qty||1),0);
  function sortRecs(list){return list.slice().sort((a,b)=>a.date!==b.date?(a.date<b.date?1:-1):((b.time||'')>(a.time||'')?1:(b.time||'')<(a.time||'')?-1:b.createdAt-a.createdAt))}
  function parseStore(raw){
    try{const d=JSON.parse(raw||'null');const list=Array.isArray(d)?d:(d&&Array.isArray(d.records)?d.records:[]);
      const out=[],ids=new Set();for(const r of list){const n=normalize(r);if(n&&!ids.has(n.id)){ids.add(n.id);out.push(n)}}return out}
    catch(e){return []}
  }
  const dumpStore=list=>JSON.stringify({v:VER,records:list});
  // 読み込み：同じ id は新しく直した方を残す
  function merge(cur,incoming){
    const map=new Map(cur.map(r=>[r.id,r]));let added=0,updated=0;
    for(const raw of incoming){const r=normalize(raw);if(!r)continue;const o=map.get(r.id);
      if(!o){map.set(r.id,r);added++}else if(r.updatedAt>o.updatedAt){map.set(r.id,r);updated++}}
    return {list:sortRecs([...map.values()]),added,updated};
  }
  // 絞り込み：期間（'all' | 'YYYY' | 'YYYY-MM'）・分類・ことば
  function filter(list,{period='all',cat='all',q=''}={}){
    const words=String(q||'').toLowerCase().split(/[\s　]+/).filter(Boolean);
    return list.filter(r=>{
      if(period!=='all'&&!r.date.startsWith(period))return false;
      if(cat==='fav'){if(!r.fav)return false}else if(cat!=='all'&&!r.items.some(it=>it.cat===cat))return false;
      if(!words.length)return true;
      const hay=[r.shop,r.memo,r.date,...r.items.map(it=>it.name+' '+(it.limited||'')+' '+(it.note||''))].join(' ').toLowerCase();
      return words.every(w=>hay.includes(w));
    });
  }
  function stats(list){
    const s={visits:list.length,pieces:0,piyorin:0,yen:0,kinds:new Set(),byName:new Map(),crowd:{sum:0,n:0},byShop:new Map(),rate:{sum:0,n:0},byRate:new Map()};
    for(const r of list){
      const t=total(r);if(t!=null)s.yen+=t;
      for(const it of r.items){s.pieces+=it.qty;if(it.cat==='piyorin'){s.piyorin+=it.qty;s.kinds.add(it.name)}
        s.byName.set(it.name,(s.byName.get(it.name)||0)+it.qty);
        if(it.rating){s.rate.sum+=it.rating;s.rate.n++;const b=s.byRate.get(it.name)||{sum:0,n:0};b.sum+=it.rating;b.n++;s.byRate.set(it.name,b)}}
      if(r.crowd){s.crowd.sum+=r.crowd;s.crowd.n++;
        if(r.shop){const b=s.byShop.get(r.shop)||{sum:0,n:0};b.sum+=r.crowd;b.n++;s.byShop.set(r.shop,b)}}
    }
    s.top=[...s.byName].sort((a,b)=>b[1]-a[1]).slice(0,3);
    s.crowdAvg=s.crowd.n?Math.round(s.crowd.sum/s.crowd.n*10)/10:null;
    s.rateAvg=s.rate.n?Math.round(s.rate.sum/s.rate.n*10)/10:null;
    // 評価の高い物（同じ点なら、たくさん評価した物）
    s.best=[...s.byRate].map(([n,b])=>[n,Math.round(b.sum/b.n*10)/10,b.n]).sort((a,b)=>b[1]-a[1]||b[2]-a[2]).slice(0,3);
    return s;
  }
  // はじめて買った限定か（その名前の記録がほかに無い）
  function firstTime(list,rec,it){
    return !list.some(r=>r.id!==rec.id&&(r.date<rec.date||(r.date===rec.date&&r.createdAt<rec.createdAt))&&r.items.some(x=>x.name===it.name));
  }

  const PiyoBuy={KEY,CATS,REGULAR,SHOPS,CROWD,RATE,itemName,eventCat,memoPrices,limitedFor,allLimited,imageFor,archiveItems,nkey,normalize,total,count,sortRecs,
    parseStore,dumpStore,merge,filter,stats,firstTime,todayJst,addDays,yen,newId};
  root.PiyoBuy=PiyoBuy;
  if(typeof module!=='undefined'&&module.exports)module.exports=PiyoBuy;
})(typeof window!=='undefined'?window:globalThis);

// ===================== 画面 =====================
(function(){
  'use strict';
  if(typeof document==='undefined'||!window.PiyoBuy)return;
  const B=window.PiyoBuy;
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const WD=['日','月','火','水','木','金','土'];
  const wd=d=>WD[new Date(d+'T12:00:00+09:00').getUTCDay()];
  const md=d=>{const [y,m,dd]=d.split('-');return `${+m}/${+dd}`};
  let recs=[], opts={events:()=>[],toast:()=>{},onCount:()=>{}}, memo=null, memoLoading=null;
  let view={period:'all',cat:'all',q:''};
  let form=null; // 書いている途中の記録
  const urls=new Map(); // 写真の表示用 URL

  function load(){try{recs=B.sortRecs(B.parseStore(localStorage.getItem(B.KEY)))}catch(e){recs=[]}}
  function save(){try{localStorage.setItem(B.KEY,B.dumpStore(recs));return true}catch(e){opts.toast('保存できませんでした（ブラウザの空きが足りないかもしれません）');return false}}

  // ---------- 写真（IndexedDB） ----------
  let dbp=null;
  function db(){
    if(dbp)return dbp;
    dbp=new Promise((res,rej)=>{try{const q=indexedDB.open('piyo-buy',1);q.onupgradeneeded=()=>q.result.createObjectStore('photos');
      q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)}catch(e){rej(e)}});
    return dbp;
  }
  async function idb(mode,fn){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction('photos',mode);const st=tx.objectStore('photos');const q=fn(st);tx.oncomplete=()=>res(q&&q.result);tx.onerror=()=>rej(tx.error)})}
  const putPhoto=(id,blob)=>idb('readwrite',st=>st.put(blob,id));
  const getPhoto=id=>idb('readonly',st=>st.get(id)).catch(()=>null);
  const delPhoto=id=>idb('readwrite',st=>st.delete(id)).catch(()=>{});
  async function photoUrl(id){
    if(urls.has(id))return urls.get(id);
    const b=await getPhoto(id);if(!b)return null;const u=URL.createObjectURL(b);urls.set(id,u);return u;
  }
  function dropUrl(id){const u=urls.get(id);if(u){URL.revokeObjectURL(u);urls.delete(id)}}
  // 長い辺 900px の JPEG に縮める（1 枚 100KB ほど）
  function shrink(file){
    return new Promise((res,rej)=>{
      const img=new Image(),u=URL.createObjectURL(file);
      img.onload=()=>{const s=Math.min(1,900/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement('canvas');
        c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        URL.revokeObjectURL(u);c.toBlob(b=>b?res(b):rej(new Error('photo')),'image/jpeg',.8)};
      img.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('photo'))};img.src=u;
    });
  }
  const blobToData=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.onerror=()=>r(null);f.readAsDataURL(b)});
  const dataToBlob=async d=>{try{return await (await fetch(d)).blob()}catch(e){return null}};

  let images=null,imagesLoading=null;
  function needImages(){
    if(images||imagesLoading)return imagesLoading;
    imagesLoading=fetch('data/piyo-images.json?t='+Date.now()).then(r=>r.ok?r.json():null).then(d=>{images=d&&typeof d==='object'?d:{};renderList();if(form)renderForm()}).catch(()=>{images={}});
    return imagesLoading;
  }
  const thumb=(it,date,cls='by-thumb')=>{const im=B.imageFor(it,date,images);return im?`<img class="${cls}" src="${esc(im.src)}" alt="" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`:''};
  function needMemo(){
    if(memo||memoLoading)return memoLoading;
    memoLoading=fetch('data/piyo-memo.json?t='+Date.now()).then(r=>r.ok?r.json():null).then(m=>{memo=m&&typeof m==='object'?m:{};if(form)renderForm()}).catch(()=>{memo={}});
    return memoLoading;
  }

  // ---------- 一覧 ----------
  const crowdDots=n=>n?`<span class="by-crowd" title="混雑度 ${n}／5：${B.CROWD[n]}"><span class="dots" aria-hidden="true">${'●'.repeat(n)}<i>${'●'.repeat(5-n)}</i></span>${esc(B.CROWD[n])}</span>`:'';
  function periods(){
    const ys=[...new Set(recs.map(r=>r.date.slice(0,4)))].sort().reverse();
    const t=B.todayJst(),ym=t.slice(0,7);
    return [['all','すべて'],[ym,'今月'],...ys.map(y=>[y,y+'年'])];
  }
  function renderList(){
    const box=$('view-buy');if(!box)return;
    const list=B.filter(recs,view),s=B.stats(list);
    const per=periods();if(!per.some(p=>p[0]===view.period))view.period='all';
    $('buy-period').innerHTML=per.map(([k,l])=>`<option value="${k}"${k===view.period?' selected':''}>${l}</option>`).join('');
    $('buy-seg').innerHTML=[['all','すべて'],['piyorin','ぴよりん'],['cookie','クッキー缶'],['goods','その他'],['fav','★ お気に入り']].map(([k,l])=>
      `<button type="button" data-k="${k}" aria-pressed="${view.cat===k}">${l}</button>`).join('');
    $('buy-sum').innerHTML=recs.length?`
      <div><b>${s.visits}</b><span>回</span></div>
      <div><b>${s.piyorin}</b><span>ぴよ</span></div>
      <div><b>${s.kinds.size}</b><span>種類のぴよりん</span></div>
      <div><b>${s.yen.toLocaleString('ja-JP')}</b><span>円</span></div>
      ${s.crowdAvg!=null?`<div><b>${s.crowdAvg}</b><span>混雑の平均</span></div>`:''}
      ${s.rateAvg!=null?`<div><b>${s.rateAvg}</b><span>評価の平均</span></div>`:''}
      ${s.best.length&&s.best[0][1]>=4?`<p class="by-top">評価が高い：${s.best.filter(b=>b[1]>=4).map(([n,a])=>`${esc(n)} ★${a}`).join('・')}</p>`:''}
      ${s.top.length?`<p class="by-top">よく買う：${s.top.map(([n,c])=>`${esc(n)} ${c}`).join('・')}</p>`:''}`:'';
    $('buy-sum').hidden=!recs.length;
    $('buy-tools').hidden=!recs.length;
    $('buy-list').innerHTML=list.length?list.map(card).join(''):(recs.length
      ?'<p class="empty">この条件の記録はありません。</p>'
      :'<p class="empty by-empty">まだ記録はありません。<br>上の「＋ 記録する」から、買ったぴよりんを残せます。</p>');
    list.forEach(r=>{if(r.photo)photoUrl(r.id).then(u=>{const im=box.querySelector(`[data-ph="${r.id}"]`);if(im&&u){im.src=u;im.closest('.by-ph').hidden=false}})});
    opts.onCount(recs.length);
  }
  // 写真が無いときは、1 つめの物の画像（図鑑・公式リリース）を上に出す。出どころを小さく添える
  function headImg(r){
    for(const it of r.items){const im=B.imageFor(it,r.date,images);if(im)return `<div class="by-ph by-official"><img src="${esc(im.src)}" alt="" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"><a class="by-credit" href="${esc(/^https:\/\//.test(im.page)?im.page:'#')}" target="_blank" rel="noopener">${im.from==='zukan'?'画像：ぴよりん図鑑':'画像：公式リリース'}</a></div>`}
    return '';
  }
  function card(r){
    const t=B.total(r);
    return `<article class="by-card" data-id="${esc(r.id)}">
      ${r.photo?`<div class="by-ph" hidden><img data-ph="${esc(r.id)}" alt="" loading="lazy"></div>`:headImg(r)}
      <div class="by-in">
        <div class="by-h"><span class="by-d">${r.date.replaceAll('-','.')}<small>${wd(r.date)}${r.time?' '+esc(r.time):''}</small></span>
          <button type="button" class="by-fav" data-fav="${esc(r.id)}" aria-pressed="${r.fav}" aria-label="お気に入り" title="お気に入り">★</button></div>
        ${r.shop?`<p class="by-shop">${esc(r.shop)}</p>`:''}
        <ul class="by-items">${r.items.map(it=>`<li>${thumb(it,r.date,'by-ithumb')||'<span class="by-ithumb by-noimg" aria-hidden="true"></span>'}<span class="by-n"><span class="by-cat c-${it.cat}">${B.CATS[it.cat]}</span>${esc(it.name)}${it.limited?'<em>限定</em>':''}${it.limited&&B.firstTime(recs,r,it)?'<em class="by-new">はじめて</em>':''}</span><span class="by-q">${it.qty>1?'×'+it.qty:''}${it.price!=null?`<small>${B.yen(it.price*it.qty)}</small>`:''}</span>${it.rating||it.note?`<span class="by-ix">${it.rating?`<span class="by-stars" title="評価 ${it.rating}／5：${B.RATE[it.rating]}" aria-label="評価 ${it.rating}／5">${'★'.repeat(it.rating)}<i>${'★'.repeat(5-it.rating)}</i></span>`:''}${it.note?`<span class="by-note">${esc(it.note)}</span>`:''}</span>`:''}</li>`).join('')}</ul>
        <div class="by-f">${crowdDots(r.crowd)}${r.wait!=null?`<span class="by-w">待ち ${r.wait}分</span>`:''}${r.soldout?'<span class="by-w">このあと売り切れ</span>':''}${t!=null?`<b class="by-t">${B.yen(t)}</b>`:''}</div>
        ${r.memo?`<p class="by-memo">${esc(r.memo)}</p>`:''}
        <div class="by-act"><button type="button" data-edit="${esc(r.id)}">直す</button><button type="button" data-again="${esc(r.id)}">同じ物を記録</button></div>
      </div></article>`;
  }

  // ---------- 記録の画面 ----------
  function blank(){return {id:null,date:B.todayJst(),time:'',shop:'',crowd:null,wait:'',soldout:false,memo:'',fav:false,photo:false,
    newPhoto:null,dropPhoto:false,items:[{cat:'piyorin',name:'',qty:1,price:'',limited:'',period:'',rating:null,note:''}],tab:0}}
  function openForm(rec,again){
    needMemo();needImages();
    if(rec){
      form=Object.assign(blank(),JSON.parse(JSON.stringify(rec)),{newPhoto:null,dropPhoto:false,tab:0});
      form.wait=rec.wait??'';form.items=rec.items.map(it=>Object.assign({},it,{price:it.price??''}));
      if(again){form.id=null;form.date=B.todayJst();form.time='';form.crowd=null;form.wait='';form.soldout=false;form.memo='';form.photo=false;form.fav=false;form.items.forEach(x=>{x.rating=null;x.note=''})}
    }else form=blank();
    $('buy-scrim').hidden=false;$('buy-modal').hidden=false;
    document.documentElement.classList.add('buy-open');
    renderForm();
    $('buy-modal').querySelector('.set-body').scrollTop=0;
  }
  function closeForm(){
    form=null;$('buy-scrim').hidden=true;$('buy-modal').hidden=true;document.documentElement.classList.remove('buy-open');
    const p=$('by-prev');if(p&&p.dataset.u){URL.revokeObjectURL(p.dataset.u)}
  }
  const chip=(attr,label,on,sub,img)=>`<button type="button" class="by-chip${on?' on':''}${img?' has-img':''}" ${attr} aria-pressed="${!!on}">${img||''}<span>${esc(label)}${sub?`<small>${esc(sub)}</small>`:''}</span></button>`;
  function renderForm(){
    if(!form)return;
    const f=form, it=f.items[f.tab]||f.items[0];
    const ev=opts.events()||[];
    const lim=B.limitedFor(ev,f.date,memo,it.cat);
    const onSale=lim.filter(x=>x.onSale), near=lim.filter(x=>!x.onSale);
    const regular=B.REGULAR[it.cat]||[];
    const allLim=B.limitedFor(ev,f.date,memo,null);
    // 場所の候補：店・この日の限定の場所・前に書いた場所
    const used=[...new Set(recs.map(r=>r.shop).filter(Boolean))];
    const limPlaces=[...new Set(allLim.filter(x=>x.onSale&&x.place&&x.cat!=='goods').flatMap(x=>x.place.split(/[、,，・]/)).map(p=>p.trim()).filter(p=>p&&!B.SHOPS.some(sh=>sh.name.includes(p)||p.includes(sh.short)||/^ぴよりん(shop|village)?$/.test(p))))];
    const shops=[...B.SHOPS.map(s=>s.name),...limPlaces,...used].filter((v,i,a)=>a.indexOf(v)===i).slice(0,10);
    const shopDef=B.SHOPS.find(s=>s.name===f.shop);
    const tot=B.total({items:f.items.map(x=>({qty:+x.qty||1,price:x.price===''?null:+x.price}))});
    const hit=lim.find(x=>x.name===it.name);
    $('buy-h').textContent=f.id?'記録を直す':'ぴよりんを記録する';
    $('buy-form').innerHTML=`
      <section class="set-sec"><h3>いつ</h3>
        <div class="by-row"><input type="date" id="by-date" value="${esc(f.date)}" max="${B.addDays(B.todayJst(),1)}" aria-label="買った日">
          <input type="time" id="by-time" value="${esc(f.time)}" aria-label="買った時刻（わからなければ空で）"></div>
        <div class="by-chips">${chip('data-day="0"','今日',f.date===B.todayJst())}${chip('data-day="-1"','昨日',f.date===B.addDays(B.todayJst(),-1))}${chip('data-day="-2"','おととい',f.date===B.addDays(B.todayJst(),-2))}${f.date<B.addDays(B.todayJst(),-2)?`<span class="by-past">過去の記録（${esc(f.date.replaceAll('-','.'))}）</span>`:''}</div>
        ${shopDef&&shopDef.slots.length?`<div class="by-chips">${shopDef.slots.map(s=>chip(`data-slot="${s}"`,s+' の回',f.time===s.padStart(5,'0')||f.time===s)).join('')}</div>`:''}
      </section>
      <section class="set-sec"><h3>買った物 <small>${f.items.length>1?`${f.items.length}つ`:''}</small></h3>
        ${f.items.length>1?`<div class="by-lines">${f.items.map((x,i)=>`<button type="button" class="by-line${i===f.tab?' on':''}" data-tab="${i}">${esc(x.name||'（未入力）')}${+x.qty>1?' ×'+x.qty:''}</button>`).join('')}</div>`:''}
        <div class="by-seg" role="group" aria-label="分類">${Object.entries(B.CATS).map(([k,l])=>`<button type="button" data-cat="${k}" aria-pressed="${it.cat===k}">${l}</button>`).join('')}</div>
        ${onSale.length?`<p class="by-lab">${md(f.date)} に${f.date<B.todayJst()?'売っていた':'売っている'}限定</p><div class="by-chips">${onSale.map(x=>chip(`data-lim="${esc(x.id)}"`,x.name,it.name===x.name,`${md(x.start)}${x.end!==x.start?'〜'+md(x.end):''}${x.price!=null?' · '+B.yen(x.price):''}`,thumb({cat:x.cat,name:x.name,lid:x.id},f.date))).join('')}</div>`:''}
        ${regular.length?`<p class="by-lab">${it.cat==='goods'?'定番のおかし':'定番'}</p><div class="by-chips">${regular.map(x=>chip(`data-reg="${esc(x.name)}"`,x.name,it.name===x.name,x.price!=null?B.yen(x.price):'',thumb({cat:it.cat,name:x.name},f.date))).join('')}</div>`:''}
        ${near.length?`<details class="by-near"${near.some(x=>x.name===it.name)?' open':''}><summary>前後 1 週間の限定（${near.length}）</summary><div class="by-chips">${near.map(x=>chip(`data-lim="${esc(x.id)}"`,x.name,it.name===x.name,`${md(x.start)}${x.end!==x.start?'〜'+md(x.end):''}`,thumb({cat:x.cat,name:x.name,lid:x.id},x.start))).join('')}</div></details>`:''}
        ${it.cat!=='goods'||allLim.some(x=>x.cat==='goods')?`<details class="by-near" id="by-all"${f.allOpen?' open':''}><summary>これまでの限定から探す</summary>
          <input type="search" id="by-allq" value="${esc(f.allQ||'')}" placeholder="例：ハロウィン、2025、ゴジラ" aria-label="これまでの限定を探す">
          <div class="by-chips" id="by-allres">${allChips(f,it)}</div></details>`:''}
        <label class="by-fld"><span>${it.cat==='goods'?'品名（自由に入力）':'名前（自由に入力もできます）'}</span>
          <input type="text" id="by-name" value="${esc(it.name)}" maxlength="60" placeholder="${it.cat==='goods'?'例：ぴよりんトートバッグ':it.cat==='cookie'?'例：ひよりの手作りクッキー缶（冬ver.）':'例：ハロウィンぴよりん'}" list="by-names" autocomplete="off"></label>
        <datalist id="by-names">${[...new Set(recs.flatMap(r=>r.items.filter(x=>x.cat===it.cat).map(x=>x.name)))].map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
        <div class="by-row">
          <label class="by-fld by-qty"><span>数</span><span class="by-step"><button type="button" data-qty="-1" aria-label="1つ減らす">−</button><input type="number" id="by-qty" inputmode="numeric" min="1" max="999" value="${esc(it.qty)}"><button type="button" data-qty="1" aria-label="1つ増やす">＋</button></span></label>
          <label class="by-fld"><span>1つの値段（円）</span><input type="number" id="by-price" inputmode="numeric" min="0" value="${esc(it.price)}" placeholder="わからなければ空で"></label>
        </div>
        ${hit&&hit.prices.length>1?`<div class="by-chips">${hit.prices.map(p=>chip(`data-pp="${p.price}"`,(p.label||'値段')+' '+B.yen(p.price),+it.price===p.price)).join('')}</div>`:''}
        ${hit&&hit.prices.length?'<p class="by-hint">値段は記事のまとめから入れました。ちがうときは直してください。</p>':''}
        <div class="by-fld"><span>この物の評価</span>
          <div class="by-rate" role="radiogroup" aria-label="評価（5 段階）">${[1,2,3,4,5].map(n=>`<button type="button" role="radio" data-rate="${n}" aria-checked="${it.rating===n}" aria-label="${n}／5" title="${B.RATE[n]}">${(it.rating||0)>=n?'★':'☆'}</button>`).join('')}<small>${it.rating?esc(B.RATE[it.rating]):'押して選ぶ（もう一度押すと消す）'}</small></div></div>
        <label class="by-fld"><span>この物のメモ</span><textarea id="by-note" rows="2" maxlength="500" placeholder="味・食感・表情・また買いたいか など">${esc(it.note||'')}</textarea></label>
        <div class="by-row by-lact"><button type="button" class="set-act" data-add>＋ 買った物を足す</button>${f.items.length>1?'<button type="button" class="set-act by-danger" data-rm>この物を外す</button>':''}</div>
      </section>
      <section class="set-sec"><h3>どこで</h3>
        <div class="by-chips">${shops.map(s=>chip(`data-shop="${esc(s)}"`,s,f.shop===s)).join('')}</div>
        <label class="by-fld"><span>場所（自由に入力もできます）</span><input type="text" id="by-shop" value="${esc(f.shop)}" maxlength="60" placeholder="例：アスティ静岡"></label>
      </section>
      <section class="set-sec"><h3>混み具合</h3>
        <div class="by-crowd5" role="radiogroup" aria-label="混雑度">${[1,2,3,4,5].map(n=>`<button type="button" role="radio" data-crowd="${n}" aria-checked="${f.crowd===n}"><b>${n}</b><small>${B.CROWD[n]}</small></button>`).join('')}</div>
        <div class="by-row"><label class="by-fld"><span>待った時間（分）</span><input type="number" id="by-wait" inputmode="numeric" min="0" max="1440" value="${esc(f.wait)}" placeholder="例：20"></label>
          <label class="by-chk"><input type="checkbox" id="by-sold"${f.soldout?' checked':''}><span>このあと売り切れた</span></label></div>
      </section>
      <section class="set-sec"><h3>この日のメモ・写真</h3>
        <textarea id="by-memo" rows="3" maxlength="1000" placeholder="だれと行ったか・お店のようす・天気 など">${esc(f.memo)}</textarea>
        <div class="by-row"><label class="set-act by-file">写真を選ぶ<input type="file" id="by-photo" accept="image/*" hidden></label>
          ${(f.photo&&!f.dropPhoto)||f.newPhoto?'<button type="button" class="set-act by-danger" data-nophoto>写真を外す</button>':''}</div>
        <img id="by-prev" class="by-prev" alt="" hidden>
      </section>
      ${f.id?'<section class="set-sec"><button type="button" class="set-act by-danger" data-del>この記録を消す</button></section>':''}`;
    $('buy-total').textContent=tot!=null?'合計 '+B.yen(tot):'';
    // 写真の見本
    const pv=$('by-prev');
    if(f.newPhoto){const u=URL.createObjectURL(f.newPhoto);pv.src=u;pv.dataset.u=u;pv.hidden=false}
    else if(f.photo&&!f.dropPhoto&&f.id){photoUrl(f.id).then(u=>{if(u&&$('by-prev')){$('by-prev').src=u;$('by-prev').hidden=false}})}
  }
  function allChips(f,it){
    const all=B.allLimited(opts.events()||[],f.date,memo,it.cat,f.allQ);
    const seen=new Set(all.map(x=>B.nkey(x.name)));
    const arc=B.archiveItems(images,it.cat,f.allQ).filter(x=>!seen.has(B.nkey(x.name))&&(seen.add(B.nkey(x.name)),true));
    if(!all.length&&!arc.length)return '<p class="by-hint">見つかりません。下の欄に自由に入力できます。</p>';
    const MAX=f.allQ?60:30;
    return [...all.map(x=>chip(`data-lim="${esc(x.id)}" data-setdate="1"`,x.name,it.name===x.name,`${x.start.slice(0,4)}.${md(x.start)}${x.end!==x.start?'〜'+md(x.end):''}`,thumb({cat:x.cat,name:x.name,lid:x.id},x.start))),
      ...arc.map(x=>chip(`data-arc="${esc(x.id)}"`,x.name,it.name===x.name,x.sub,thumb({cat:it.cat,name:x.name,lid:x.src==='release'?x.id:''},x.date||f.date)))]
      .slice(0,MAX).join('')+(all.length+arc.length>MAX?`<p class="by-hint">ほかに ${all.length+arc.length-MAX} 件。ことばで絞ってください（例：2024、ハロウィン）。</p>`:'');
  }
  function pickArchive(id){
    const it=form.items[form.tab];
    const z=(images&&images.zukan||[]).find(x=>x.id===id),r=images&&images.releases&&images.releases[id];
    if(z){it.name=z.name;it.limited=z.name;it.period=z.date||'';it.lid=''}
    else if(r){it.name=r.name;it.limited=r.name;it.period=r.date||'';it.lid=id}
  }
  // 入力欄の今の値を form に写す（描き直す前に呼ぶ）
  function pull(){
    if(!form||!$('by-date'))return;const f=form,it=f.items[f.tab];
    f.date=$('by-date').value||f.date;f.time=$('by-time').value;f.shop=$('by-shop').value.trim();f.wait=$('by-wait').value;
    f.soldout=$('by-sold').checked;f.memo=$('by-memo').value;
    if(it){const n=$('by-name').value.trim();if(n!==it.name){it.name=n;it.limited='';it.period='';it.lid=''}it.qty=$('by-qty').value;it.price=$('by-price').value;it.note=$('by-note').value}
  }
  function pickLimited(id,setDate){
    const ev=(opts.events()||[]).find(e=>e.id===id);if(!ev)return;
    if(setDate&&(form.date<ev.start||form.date>(ev.end||ev.start)))form.date=ev.start>B.todayJst()?B.todayJst():ev.start; // 買った日が期間の外なら、期間の初日にする（あとで直せる）
    const it=form.items[form.tab];const x=B.limitedFor([ev],form.date,memo,null)[0]||{name:B.itemName(ev.title),price:null};
    it.cat=B.eventCat(ev)||it.cat;it.name=x.name;it.limited=x.name;it.period=`${ev.start}〜${ev.end||ev.start}`;it.lid=ev.id;
    if(x.price!=null)it.price=x.price;
    if(!form.shop&&x.place&&!/、/.test(x.place))form.shop=x.place;
  }
  async function submit(more){
    pull();const f=form;
    const items=f.items.filter(x=>x.name.trim());
    if(!items.length){opts.toast('買った物の名前を入れてください');form.tab=0;renderForm();setTimeout(()=>$('by-name')&&$('by-name').focus(),50);return}
    const now=Date.now(),old=f.id?recs.find(r=>r.id===f.id):null;
    const rec=B.normalize({id:f.id||B.newId(now),date:f.date,time:f.time,shop:f.shop,crowd:f.crowd,wait:f.wait,soldout:f.soldout,memo:f.memo,fav:f.fav,
      photo:f.newPhoto?true:(f.photo&&!f.dropPhoto),items,createdAt:old?old.createdAt:now,updatedAt:now},now);
    if(!rec){opts.toast('日付を確かめてください');return}
    if(f.newPhoto){try{await putPhoto(rec.id,f.newPhoto);dropUrl(rec.id)}catch(e){rec.photo=false;opts.toast('写真は保存できませんでした')}}
    else if(f.dropPhoto&&old&&old.photo){await delPhoto(rec.id);dropUrl(rec.id)}
    recs=B.sortRecs(old?recs.map(r=>r.id===rec.id?rec:r):[...recs,rec]);
    if(!save())return;
    const keep=more?{date:rec.date,shop:rec.shop}:null;
    closeForm();renderList();
    if(keep){openForm(null);Object.assign(form,keep);renderForm()}
    const lim=rec.items.find(it=>it.limited&&B.firstTime(recs,rec,it));
    opts.toast(lim?`はじめての ${lim.name} を記録したぴよ！`:old?'記録を直したぴよ':'記録したぴよ！');
  }
  async function remove(id){
    const r=recs.find(x=>x.id===id);if(!r)return;
    if(!confirm(`${r.date.replaceAll('-','.')} の記録（${r.items.map(x=>x.name).join('、')}）を消しますか？`))return;
    recs=recs.filter(x=>x.id!==id);save();if(r.photo){await delPhoto(id);dropUrl(id)}
    closeForm();renderList();opts.toast('記録を消しました');
  }

  // ---------- 書き出し・読み込み（設定の画面） ----------
  async function exportAll(){
    const out=[];for(const r of recs){const o=Object.assign({},r);if(r.photo){const b=await getPhoto(r.id);if(b)o.photoData=await blobToData(b)}out.push(o)}
    const blob=new Blob([JSON.stringify({app:'piyorin-news',kind:'purchases',v:1,exportedAt:new Date().toISOString(),records:out},null,1)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`ぴよりん購入記録_${B.todayJst()}.json`;
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
  }
  async function importFile(file){
    let d;try{d=JSON.parse(await file.text())}catch(e){opts.toast('読めないファイルでした');return}
    const list=Array.isArray(d)?d:(d&&Array.isArray(d.records)?d.records:null);
    if(!list){opts.toast('購入記録のファイルではないようです');return}
    const m=B.merge(recs,list);
    const photos=new Map(list.filter(r=>r&&r.id&&typeof r.photoData==='string'&&r.photoData.startsWith('data:image/')).map(r=>[r.id,r.photoData]));
    for(const r of m.list){if(photos.has(r.id)){const b=await dataToBlob(photos.get(r.id));if(b){try{await putPhoto(r.id,b);dropUrl(r.id);r.photo=true}catch(e){r.photo=false}}else r.photo=false}}
    recs=m.list;save();renderList();renderSet();
    opts.toast(`読み込みました（新しく ${m.added}件・更新 ${m.updated}件）`);
  }
  function renderSet(){
    const el=$('set-buy');if(!el)return;
    el.innerHTML=`<p class="set-note">記録は ${recs.length}件。この端末のブラウザにだけ保存されます。機種を変える前やブラウザのデータを消す前に、書き出しておくと安心です（写真も入ります）。</p>
      <div class="by-row"><button type="button" class="set-act" id="buy-export"${recs.length?'':' disabled'}>書き出す</button>
      <label class="set-act by-file">ファイルから読み込む<input type="file" id="buy-import" accept="application/json,.json" hidden></label></div>`;
  }

  // ---------- つなぐ ----------
  function mount(o){
    opts=Object.assign(opts,o||{});load();
    const box=$('view-buy');if(!box)return;
    box.addEventListener('click',e=>{
      const t=e.target.closest('button');if(!t)return;
      if(t.id==='buy-new')return openForm(null);
      if(t.dataset.k){view.cat=t.dataset.k;return renderList()}
      if(t.dataset.edit)return openForm(recs.find(r=>r.id===t.dataset.edit));
      if(t.dataset.again)return openForm(recs.find(r=>r.id===t.dataset.again),true);
      if(t.dataset.fav){const r=recs.find(x=>x.id===t.dataset.fav);if(r){r.fav=!r.fav;r.updatedAt=Date.now();save();renderList()}}
    });
    $('buy-period').addEventListener('change',e=>{view.period=e.target.value;renderList()});
    let tm;$('buy-q').addEventListener('input',e=>{clearTimeout(tm);tm=setTimeout(()=>{view.q=e.target.value;renderList()},120)});
    const m=$('buy-modal');
    m.addEventListener('click',e=>{
      const t=e.target.closest('button');if(!t||!form)return;
      if(t.id==='buy-close'||t.id==='buy-cancel')return closeForm();
      if(t.id==='buy-save')return submit(false);
      if(t.id==='buy-more')return submit(true);
      pull();const it=form.items[form.tab];
      if(t.dataset.cat){if(it.cat!==t.dataset.cat){it.cat=t.dataset.cat;if(it.limited||B.REGULAR[it.cat]&&!B.REGULAR[it.cat].some(x=>x.name===it.name)){it.name='';it.price='';it.limited='';it.period='';it.lid=''}}}
      else if(t.dataset.lim){pickLimited(t.dataset.lim,!!t.dataset.setdate);form.allOpen=!!t.dataset.setdate}
      else if(t.dataset.day)form.date=B.addDays(B.todayJst(),+t.dataset.day);
      else if(t.dataset.reg){const x=(B.REGULAR[it.cat]||[]).find(r=>r.name===t.dataset.reg);if(x){it.name=x.name;it.price=x.price??'';it.limited='';it.period='';it.lid=''}}
      else if(t.dataset.arc){pickArchive(t.dataset.arc);form.allOpen=true}
      else if(t.dataset.pp)it.price=+t.dataset.pp;
      else if(t.dataset.qty)it.qty=Math.max(1,Math.min(999,(+it.qty||1)+(+t.dataset.qty)));
      else if('add' in t.dataset){form.items.push({cat:it.cat,name:'',qty:1,price:'',limited:'',period:'',rating:null,note:''});form.tab=form.items.length-1}
      else if('rm' in t.dataset){form.items.splice(form.tab,1);form.tab=Math.max(0,form.tab-1)}
      else if(t.dataset.tab)form.tab=+t.dataset.tab;
      else if(t.dataset.shop)form.shop=t.dataset.shop;
      else if(t.dataset.slot)form.time=t.dataset.slot.padStart(5,'0');
      else if(t.dataset.rate){const n=+t.dataset.rate;it.rating=it.rating===n?null:n}
      else if(t.dataset.crowd){const n=+t.dataset.crowd;form.crowd=form.crowd===n?null:n}
      else if('nophoto' in t.dataset){form.newPhoto=null;form.dropPhoto=true}
      else if('del' in t.dataset)return remove(form.id);
      else return;
      const sc=m.querySelector('.set-body').scrollTop;renderForm();m.querySelector('.set-body').scrollTop=sc;
    });
    m.addEventListener('toggle',e=>{if(form&&e.target.id==='by-all')form.allOpen=e.target.open},true);
    m.addEventListener('change',async e=>{
      if(!form)return;
      if(e.target.id==='by-date'){pull();renderForm();return}
      if(e.target.id==='by-photo'&&e.target.files[0]){pull();try{form.newPhoto=await shrink(e.target.files[0]);form.dropPhoto=false}catch(_){opts.toast('この写真は読めませんでした')}renderForm()}
    });
    m.addEventListener('input',e=>{if(form&&e.target.id==='by-allq'){form.allQ=e.target.value;const it=form.items[form.tab];$('by-allres').innerHTML=allChips(form,it);return}if(form&&(e.target.id==='by-price'||e.target.id==='by-qty')){pull();const tot=B.total({items:form.items.map(x=>({qty:+x.qty||1,price:x.price===''?null:+x.price}))});$('buy-total').textContent=tot!=null?'合計 '+B.yen(tot):''}});
    $('buy-scrim').addEventListener('click',closeForm);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&form)closeForm()});
    const sb=$('set-buy');
    if(sb){sb.addEventListener('click',e=>{if(e.target.id==='buy-export')exportAll()});
      sb.addEventListener('change',e=>{if(e.target.id==='buy-import'&&e.target.files[0]){importFile(e.target.files[0]);e.target.value=''}})}
    window.addEventListener('storage',e=>{if(e.key===B.KEY){load();renderList();renderSet()}});
    renderList();renderSet();
  }
  window.PiyoBuyUI={mount,render:()=>{needImages();renderList();renderSet()},open:()=>openForm(null),get count(){return recs.length}};
})();
