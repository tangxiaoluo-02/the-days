// ── 時光隧道：回顧「過去任何一年、同月同日」的所有日記，依年份分組 ──
const TimeTunnel = (() => {

  function open(entries, month, day) {
    const matches = entries.filter(e => {
      const d = new Date(e.created_at);
      return d.getMonth() === month && d.getDate() === day;
    });

    document.getElementById('tt-title').textContent = `🌀 ${month + 1}月${day}日 時光隧道`;
    document.getElementById('tt-subtitle').textContent =
      `共 ${matches.length} 篇日記，橫跨 ${new Set(matches.map(e => new Date(e.created_at).getFullYear())).size} 個年份`;

    render(matches);
    document.getElementById('time-tunnel-page').classList.remove('hidden');
  }

  function render(matches) {
    const container = document.getElementById('tt-container');
    container.innerHTML = '';

    const byYear = groupByYear(matches);
    for (const [year, yearEntries] of byYear) {
      container.appendChild(renderYearGroup(year, yearEntries));
    }
  }

  function groupByYear(entries) {
    const map = new Map();
    for (const e of entries) {
      const year = new Date(e.created_at).getFullYear();
      if (!map.has(year)) map.set(year, []);
      map.get(year).push(e);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return new Map([...map.entries()].sort((a, b) => b[0] - a[0])); // 新到舊
  }

  function renderYearGroup(year, yearEntries) {
    const wrap = document.createElement('div');
    wrap.className = 'tt-year-group';

    const header = document.createElement('div');
    header.className = 'tt-year-header';
    header.innerHTML = `<span class="tt-year-label">${year} 年</span><span class="tt-year-count">${yearEntries.length} 篇</span>`;
    wrap.appendChild(header);

    for (const e of yearEntries) wrap.appendChild(renderEntryCard(e));
    return wrap;
  }

  function renderEntryCard(entry) {
    const card = document.createElement('div');
    card.className = 'entry-card';

    const time = document.createElement('div');
    time.className = 'entry-card-time';
    time.textContent = formatTime(entry.created_at);

    const preview = document.createElement('div');
    preview.className = 'entry-card-preview';
    preview.textContent = entry.preview || '（無文字內容）';

    card.appendChild(time);
    card.appendChild(preview);

    const thumbs = renderEntryThumbs(entry);
    if (thumbs) card.appendChild(thumbs);

    if (entry.tags?.length) {
      const tagsRow = document.createElement('div');
      tagsRow.className = 'entry-card-tags';
      for (const tagId of entry.tags) {
        const tag = TagManager.getById(tagId);
        if (tag) tagsRow.appendChild(Editor.makeTagChip(tag));
      }
      card.appendChild(tagsRow);
    }

    card.addEventListener('click', () => App.viewEntry(entry.id));
    return card;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const period = h < 12 ? '上午' : '下午';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${period} ${h12}:${m}`;
  }

  return { open };
})();
