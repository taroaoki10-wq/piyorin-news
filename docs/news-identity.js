// 統合前のIDも残し、端末・同期先の非表示設定を引き継ぐ。
window.PiyoNewsIdentity = {
  ids(item) { return [item.id, ...(item.merged_ids || [])]; },
  // 判定待ち：公式でなく、題に「ぴよりん」が無く、AI がまだ「関係あり」と決めていない記事。判定が済むまで出さない
  // （2026-11-28：判定待ちの間は出たままだったので、通信社の記事「カブス、佐藤輝明外野手と6年契約発表」が最大 9 時間出ていた）
  pending(item) {
    if (!item || item.cat === 'official') return false;
    const j = item.jg;
    if (j && typeof j.ok === 'boolean') return false;
    return !/ぴよりん|ピヨリン|piyorin/i.test(String(item.title || '').normalize('NFKC'));
  },
  deletion(item, records) {
    return this.ids(item).map(id => records[id]).filter(Boolean)
      .sort((a, b) => b.t - a.t || Number(b.on) - Number(a.on))[0];
  }
};
