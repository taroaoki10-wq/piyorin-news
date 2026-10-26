// 明示して開いたときだけ寸法を採取する。本文・入力値・保存情報・認証情報は読まない。
(() => {
  'use strict';
  const guard=document.getElementById('piyo-guard');
  if(!guard)return;
  const layer=document.getElementById('piyo-layer'),log=document.getElementById('piyo-log'),input=document.getElementById('piyo-input');
  let panel=null,probe=null,output=null,samples=[],lastFit=null,started=0,hold=0,origin=null,pending=0;
  const clean=n=>Number.isFinite(n)?Math.round(n*100)/100:null;
  const rect=el=>{
    const r=el.getBoundingClientRect();
    return {上:clean(r.top),下:clean(r.bottom),高さ:clean(r.height),幅:clean(r.width)};
  };
  const style=el=>{
    const s=getComputedStyle(el);
    return {高さ:s.height,最大高さ:s.maxHeight,下余白:s.paddingBottom,下位置:s.bottom,移動:s.translate,変形:s.transform};
  };
  const text=()=>JSON.stringify({診断版:'piyo-display-1',説明:'寸法のみ。会話・入力文・キー・保存情報を含まない。外部送信なし。',記録:samples},null,2);
  function capture(reason){
    if(!panel)return;
    const vv=window.visualViewport;
    samples.push({合図:reason,経過秒:clean((performance.now()-started)/1000),
      ホーム画面起動:!!navigator.standalone||matchMedia('(display-mode: standalone)').matches,
      入力中:document.activeElement===input,チャット表示:!layer.hidden,
      画面:{幅:innerWidth,高さ:innerHeight,画素倍率:devicePixelRatio,スクロールX:clean(scrollX),スクロールY:clean(scrollY)},
      レイアウト:{幅:document.documentElement.clientWidth,高さ:document.documentElement.clientHeight},
      可視領域:vv?{幅:clean(vv.width),高さ:clean(vv.height),上移動:clean(vv.offsetTop),拡大率:clean(vv.scale)}:null,
      固定原点:rect(probe),チャット:rect(layer),会話欄:rect(log),入力欄:rect(document.getElementById('piyo-form')),
      会話スクロール:{表示高さ:log.clientHeight,内容高さ:log.scrollHeight,位置:clean(log.scrollTop)},
      チャットCSS:style(layer),会話CSS:style(log),安全領域:getComputedStyle(layer).getPropertyValue('--piyo-safe-top').trim(),
      最終計算:lastFit});
    if(samples.length>24)samples.shift();
    panel.querySelector('[data-status]').textContent='表示診断1：'+samples.length+'件記録';
    if(output&&!output.hidden)output.value=text();
  }
  function queue(reason){clearTimeout(pending);if(panel)pending=setTimeout(()=>capture(reason),700)}
  function stop(){
    clearTimeout(pending);panel?.remove();probe?.remove();panel=probe=output=null;samples=[];lastFit=null;
  }
  function start(){
    if(panel)return;
    samples=[];started=performance.now();
    probe=document.createElement('div');
    probe.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    probe.setAttribute('aria-hidden','true');document.body.append(probe);
    panel=document.createElement('section');panel.id='piyo-display-diagnostics';panel.setAttribute('aria-label','表示の診断');
    panel.style.cssText='position:fixed;z-index:100;top:calc(env(safe-area-inset-top,0px) + 8px);left:12px;right:12px;max-width:520px;margin-left:auto;box-sizing:border-box;padding:10px;border:1px solid #8a8068;border-radius:12px;background:#fffdf4;color:#252014;font:13px/1.45 sans-serif;box-shadow:0 2px 14px #0003';
    panel.innerHTML='<b data-status>表示診断1</b><div>キーボードを開いて閉じ、結果をコピーしてください。会話やキーは含みません。</div><div data-actions></div><textarea aria-label="診断結果" readonly hidden></textarea>';
    output=panel.querySelector('textarea');output.style.cssText='width:100%;height:100px;margin-top:8px;font:12px monospace';
    const actions=panel.querySelector('[data-actions]');actions.style.cssText='display:flex;gap:8px;margin-top:6px';
    function button(label,fn){
      const b=document.createElement('button');b.type='button';b.textContent=label;
      b.style.cssText='font:inherit;padding:7px 10px;border:1px solid #8a8068;border-radius:8px;background:#fff;color:#252014';
      b.addEventListener('pointerdown',e=>e.preventDefault());b.addEventListener('click',fn);actions.append(b);
    }
    button('結果をコピー',async()=>{
      capture('コピー');const report=text();
      try{await navigator.clipboard.writeText(report);if(panel)panel.querySelector('[data-status]').textContent='コピーしました。Codexへ貼ってください。'}
      catch(_){if(!panel)return;output.hidden=false;output.value=report;output.focus();output.select();panel.querySelector('[data-status]').textContent='下の結果を選択してコピーしてください。'}
    });
    button('終了',stop);document.body.append(panel);capture('開始');
  }
  // チャットの灰色の背景を1.5秒長押しして開く。通常の見た目・高さは変更しない。
  function cancelHold(){clearTimeout(hold);hold=0;origin=null}
  guard.addEventListener('pointerdown',e=>{
    if(e.button!==0||panel)return;
    cancelHold();origin={x:e.clientX,y:e.clientY};hold=setTimeout(()=>{hold=0;start()},1500);
  });
  guard.addEventListener('pointermove',e=>{if(origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>12)cancelHold()});
  for(const type of ['pointerup','pointercancel','pointerleave'])guard.addEventListener(type,cancelHold);
  input.addEventListener('focus',()=>queue('入力開始'));
  input.addEventListener('blur',()=>queue('入力終了'));
  window.addEventListener('resize',()=>queue('画面変更'));
  if(window.visualViewport)for(const type of ['resize','scroll'])window.visualViewport.addEventListener(type,()=>queue('可視領域変更'));
  window.PiyoDisplayDiagnostics={fit(value){if(!panel)return;lastFit={基準高さ:clean(value.baseHeight),可視高さ:clean(value.visibleHeight),下からの持上げ:clean(value.inset),キーボード判定:!!value.keyboard,拡大判定:!!value.zoomed,会話上限:clean(value.logMaxHeight)}}};
})();
