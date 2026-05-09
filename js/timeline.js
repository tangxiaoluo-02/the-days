// ── 時間軸視圖模組 ──
const Timeline = (() => {
  let allCollapsed = false;

  function render(entries) {
    const container = document.getElementById('timeline-container');
    const empty     = document.getElementById('timeline-empty');
    container.innerHTML = '';

    if (!entries.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    // 按日期分組
    const groups = groupByDate(entries);

    for (const [dateKey, dayEntries] of groups) {
      container.appendChild(renderDay(dateKey, dayEntries));
    }
  }

  function groupByDate(entries) {
    const map = new Map();
    for (const e of entries) {
      const dateKey = e.created_at.slice(0, 10);
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey).push(e);
    }
    // 按日期升序（舊的在上）
    return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }

  function renderDay(dateKey, entries) {
    // 同一天內舊的在上
    entries.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const wrap = document.createElement('div');
    wrap.className = 'timeline-day';
    wrap.dataset.date = dateKey;

    // 日期標題
    const header = document.createElement('div');
    header.className = 'timeline-day-header';

    const dot = document.createElement('div');
    dot.className = 'day-dot';

    const label = document.createElement('div');
    label.className = 'day-label';
    label.textContent = formatDate(dateKey);

    const count = document.createElement('div');
    count.className = 'day-count';
    count.textContent = `${entries.length} 則`;

    const toggle = document.createElement('div');
    toggle.className = 'day-toggle';
    toggle.textContent = '▾';

    header.appendChild(dot);
    header.appendChild(label);
    header.appendChild(count);
    header.appendChild(toggle);

    // 日記清單
    const list = document.createElement('div');
    list.className = 'timeline-day-entries';

    for (const entry of entries) {
      list.appendChild(renderEntryCard(entry));
    }

    header.addEventListener('click', () => {
      const collapsed = list.style.display === 'none';
      list.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '▾' : '▸';
    });

    wrap.appendChild(header);
    wrap.appendChild(list);
    return wrap;
  }

  function renderEntryCard(entry) {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.id = entry.id;

    // 時間
    const time = document.createElement('div');
    time.className = 'entry-card-time';
    time.textContent = formatTime(entry.created_at);

    // 預覽文字
    const preview = document.createElement('div');
    preview.className = 'entry-card-preview';
    preview.textContent = entry.preview || '（無文字內容）';

    card.appendChild(time);
    card.appendChild(preview);

    // 標籤
    if (entry.tags?.length) {
      const tagsRow = document.createElement('div');
      tagsRow.className = 'entry-card-tags';
      for (const tagId of entry.tags) {
        const tag = TagManager.getAll().find(t => t.id === tagId);
        if (tag) tagsRow.appendChild(Editor.makeTagChip(tag));
      }
      card.appendChild(tagsRow);
    }

    // 縮圖
    if (entry.has_photos && entry.first_photo) {
      const photos = document.createElement('div');
      photos.className = 'entry-card-photos';
      const img = document.createElement('img');
      img.className = 'entry-thumb';
      img.alt = '照片';
      img.style.background = 'var(--surface-2)';
      Drive.getPhotoUrl(entry.first_photo).then(url => { img.src = url; });
      photos.appendChild(img);
      card.appendChild(photos);
    }

    // meta（天氣、位置、字數）
    const meta = document.createElement('div');
    meta.className = 'entry-card-meta';
    if (entry.weather) {
      const w = document.createElement('span');
      w.textContent = `${entry.weather.icon} ${entry.weather.condition}`;
      meta.appendChild(w);
    }
    if (entry.location?.name) {
      const l = document.createElement('span');
      l.textContent = `📍 ${entry.location.name}`;
      meta.appendChild(l);
    }
    if (entry.word_count) {
      const wc = document.createElement('span');
      wc.textContent = `${entry.word_count} 字`;
      meta.appendChild(wc);
    }
    if (meta.children.length) card.appendChild(meta);

    card.addEventListener('click', () => App.viewEntry(entry.id));
    return card;
  }

  function collapseAll() {
    // 日期組維持展開，但每則日記壓縮成一行
    document.querySelectorAll('.entry-card').forEach(el => el.classList.add('collapsed'));
    document.querySelectorAll('.timeline-day-entries').forEach(el => { el.style.display = ''; });
    document.querySelectorAll('.day-toggle').forEach(el => { el.textContent = '▾'; });
    allCollapsed = true;
  }

  function expandAll() {
    document.querySelectorAll('.entry-card').forEach(el => el.classList.remove('collapsed'));
    allCollapsed = false;
  }

  // ── 格式化 ──
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const wd = weekdays[d.getDay()];
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === today) return `今天（${m}月${day}日，週${wd}）`;
    if (dateStr === yesterday) return `昨天（${m}月${day}日，週${wd}）`;
    return `${d.getFullYear()}年 ${m}月${day}日，週${wd}`;
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('zh-TW', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei'
    });
  }

  return { render, collapseAll, expandAll };
})();
