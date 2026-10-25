// 年別保管庫も同じ一覧に含める。IDを保ち、最新ファイルの判定を優先する。
window.PiyoNewsArchive = {
  combine(current, archived) {
    const key = item => JSON.stringify([item.id, item.title]);
    const currentKeys = new Set(current.map(key));
    return [...current, ...archived.filter(item => !currentKeys.has(key(item)))]
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  async load(bust) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const get = async file => {
      const response = await fetch('data/archive/' + file + '.json' + bust, {signal: controller.signal, cache: 'no-store'});
      if (!response.ok) throw new Error('過去の記事を取得できませんでした');
      return response.json();
    };
    try {
      const index = await get('index');
      if (!Array.isArray(index.years) || !index.years.every(y => /^(\d{4}|unknown)$/.test(y))) throw new Error('保管庫の一覧が不正です');
      const years = await Promise.all(index.years.map(get));
      if (!years.every(items => Array.isArray(items) && items.every(n => n && typeof n.id === 'string' && typeof n.date === 'string'))) throw new Error('保管庫の記事が不正です');
      return years.flat();
    } finally {
      clearTimeout(timer);
    }
  }
};
