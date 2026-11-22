// カレンダーの並べ方（2026-11-22）。画面に触らない計算だけを置く（試験は tests/piyo-cal.test.cjs）。
// 困りごと：期間の長い企画（推し旅・スタンプラリーなど）がカレンダーの段を全部ふさぎ、
// 2 日だけの限定販売（静岡みかんぴよりん）が「+2」の中に隠れて見えなかった。
// 直し方：期間の長い予定は週の下の細い線にして、短い予定に段を使う。日付を押せばその日の予定が全部出る。
(function(root){
  'use strict';
  const DAY=86400000;
  const KEY='piyo-cal';
  const DEFAULTS={group:true,longDays:14}; // group：期間の長い予定をまとめる／longDays：この日数を越えたら「長い」
  const MIN_DAYS=3,MAX_DAYS=60,SOON=7;      // SOON：長い予定でも、終わりがこの日数以内なら「もうすぐ終了」として前に出す
  const num=s=>Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10))/DAY;
  const endOf=e=>e.end||e.start;
  const span=e=>Math.max(1,num(endOf(e))-num(e.start)+1);
  const clampDays=n=>{n=Math.round(Number(n));return Number.isFinite(n)?Math.min(MAX_DAYS,Math.max(MIN_DAYS,n)):DEFAULTS.longDays};
  function fix(o){o=o&&typeof o==='object'?o:{};return{group:o.group!==false,longDays:clampDays(o.longDays===undefined?DEFAULTS.longDays:o.longDays)}}
  function load(storage){try{return fix(JSON.parse(storage.getItem(KEY)||'null'))}catch(_){return fix(null)}}
  function save(storage,o){const v=fix(o);try{storage.setItem(KEY,JSON.stringify(v))}catch(_){}return v}
  const isLong=(e,o)=>{o=fix(o);return o.group&&span(e)>o.longDays};
  // 始まりの早い順。同じ日に始まるなら長いほうを先に（上の段に帯が通る）
  const byStart=(a,b)=>a.start<b.start?-1:a.start>b.start?1:(endOf(b)>endOf(a)?1:endOf(b)<endOf(a)?-1:0);

  // 1 週間ぶんの帯の置き方。ws・we はその週の日曜と土曜（YYYY-MM-DD）。
  // 返すもの：bars（段に入った短い予定の帯）・hidden（段に入りきらなかった数。列の番号ごと）
  //          thin（期間の長い予定の細い線。週の下に重ねる。数は絞らない）・thinRows（細い線の段の数）
  function layoutWeek(events,ws,we,o){
    const maxLanes=(o&&o.maxLanes)||3;
    o=fix(o);
    const place=(lanes,ci,ce)=>{let lane=lanes.findIndex(l=>l.every(([x,y])=>ce<x||ci>y));if(lane<0){lane=lanes.length;lanes.push([])}lanes[lane].push([ci,ce]);return lane};
    const lanes=[],thinLanes=[],bars=[],thin=[],hidden={};
    events.filter(e=>e&&e.start).sort(byStart).forEach(e=>{
      const end=endOf(e);if(end<ws||e.start>we)return;
      const a=e.start<ws?ws:e.start,b=end>we?we:end;
      const ci=num(a)-num(ws),ce=num(b)-num(ws);
      const item={e,ci,ce,contL:e.start<ws,contR:end>we};
      if(isLong(e,o)){item.lane=place(thinLanes,ci,ce);thin.push(item);return}
      item.lane=place(lanes,ci,ce);
      if(item.lane>=maxLanes){for(let k=ci;k<=ce;k++)hidden[k]=(hidden[k]||0)+1;return}
      bars.push(item);
    });
    return{bars,hidden,thin,thinRows:thinLanes.length};
  }

  // その月（first〜last）の予定を、一覧に出す 3 つの組に分ける：これから・開催中の短い予定／期間の長い予定／終わった予定
  function agenda(events,first,last,today,o){
    o=fix(o);
    const inMonth=events.filter(e=>e&&e.start&&e.start<=last&&endOf(e)>=first).sort(byStart);
    const done=e=>endOf(e)<today;
    return{
      all:inMonth,
      main:inMonth.filter(e=>!done(e)&&!isLong(e,o)),
      long:inMonth.filter(e=>!done(e)&&isLong(e,o)),
      done:inMonth.filter(done),
    };
  }

  // その日にかかる予定を全部（短いものを先に）
  function dayEvents(events,day,o){
    o=fix(o);
    return events.filter(e=>e&&e.start&&e.start<=day&&endOf(e)>=day)
      .sort((a,b)=>(isLong(a,o)-isLong(b,o))||byStart(a,b));
  }

  // 「UPCOMING」に出す予定。開催中の長い企画が先頭を占めないように、これから始まる予定と短い予定を先に出す。
  // 返すもの：[{e,live,soon,left}]（live：開催中／soon：長い予定がもうすぐ終わる／left：終わりまでの日数）
  function upcoming(events,today,n,o){
    o=fix(o);
    const t=num(today);
    return events.filter(e=>e&&e.start&&endOf(e)>=today).map(e=>{
      const live=e.start<=today,left=num(endOf(e))-t;
      const longLive=live&&isLong(e,o);
      const soon=longLive&&left<=SOON;
      // 並べる日付：もうすぐ終わる長い予定は終わりの日、ほかは始まりの日。終わりの遠い長い予定は後ろへ
      return{e,live,soon,left,tail:longLive&&!soon?1:0,key:soon?endOf(e):e.start};
    }).sort((a,b)=>(a.tail-b.tail)||(a.key<b.key?-1:a.key>b.key?1:byStart(a.e,b.e)))
      .slice(0,n).map(({e,live,soon,left})=>({e,live,soon,left}));
  }

  // 開催中・あと何日 の短い言葉
  function status(e,today,o){
    o=fix(o);
    const end=endOf(e),t=num(today);
    if(end<today)return{text:'終了',cls:'done'};
    if(e.start<=today){
      const left=num(end)-t;
      if(left===0&&e.start!==end)return{text:'きょうまで',cls:'now'};
      if(isLong(e,o)&&left<=SOON)return{text:'あと'+left+'日で終了',cls:'now'};
      return{text:'開催中',cls:'now'};
    }
    const d=num(e.start)-t;
    return{text:d===1?'あした':'あと'+d+'日',cls:''};
  }

  root.PiyoCal={KEY,DEFAULTS,MIN_DAYS,MAX_DAYS,SOON,fix,load,save,span,isLong,layoutWeek,agenda,dayEvents,upcoming,status};
})(typeof window!=='undefined'?window:globalThis);
