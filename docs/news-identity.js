// 統合前のIDも残し、端末・同期先の非表示設定を引き継ぐ。
window.PiyoNewsIdentity = {
  ids(item) { return [item.id, ...(item.merged_ids || [])]; },
  deletion(item, records) {
    return this.ids(item).map(id => records[id]).filter(Boolean)
      .sort((a, b) => b.t - a.t || Number(b.on) - Number(a.on))[0];
  }
};
