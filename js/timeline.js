// ── 時間軸視圖模組（以月分組，延遲載入未展開的月份）──
const Timeline = (() => {
  let monthEntriesMap = new Map(); // monthKey -> entries[]
  const renderedMonths = new Set(); // 已經 render 過內容的月份（避免重複建 DOM）

  function render(entries) {
    const container = document.getElementById('timeline-container');
    const empty     = document.getElementById('timeline-empty');
    const rail      = document.getElementById('timeline-rail');
    container.innerHTML = '';
    rail.innerHTML = '';
    renderedMonths.clear();

    if (!entries.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    monthEntriesMap = groupByMonth(entries);
    const monthKeys = [...monthEntriesMap.keys()]; // 新到舊
    const todayMonthKey = localDateStr(new Date()).slice(0, 7);
    const defaultOpenKey = monthEntriesMap.has(todayMonthKey) ? todayMonthKey : monthKeys[0];

    for (const key of monthKeys) {
      container.appendChild(renderMonthGroup(key, monthEntriesMap.get(key), key === defaultOpenKey));
    }

    renderRail(monthKeys, rail);
  }

  function groupByMonth(entries) {
    const map = new Map();
    for (const e of entries) {
      const key = e.created_at.slice(0, 7); // YYYY-MM
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))); // 新到舊
  }

  function groupByDate(entries) {
    const map = new Map();
    for (const e of entries) {
      const dateKey = e.created_at.slice(0, 10);
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey).push(e);
    }
    return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))); // 新到舊
  }

  // ── 月分組 ──
  function renderMonthGroup(monthKey, monthEntries, defaultOpen) {
    const wrap = document.createElement('div');
    wrap.className = 'month-group';
    wrap.dataset.month = monthKey;

    const header = document.createElement('div');
    header.className = 'month-header';

    const dot = document.createElement('span');
    dot.className = 'm-dot';

    const label = document.createElement('span');
    label.className = 'm-label';
    label.textContent = formatMonth(monthKey);

    const count = document.createElement('span');
    count.className = 'm-count';
    count.textContent = `${monthEntries.length} 篇`;

    const chev = document.createElement('span');
    chev.className = 'm-chev';
    chev.textContent = '›';

    header.appendChild(dot);
    header.appendChild(label);
    header.appendChild(count);
    header.appendChild(chev);

    const body = document.createElement('div');
    body.className = 'month-body';

    header.addEventListener('click', () => toggleMonth(wrap, body, monthKey));

    wrap.appendChild(header);
    wrap.appendChild(body);

    if (defaultOpen) {
      renderMonthBody(body, monthEntries);
      renderedMonths.add(monthKey);
      wrap.classList.add('open');
    }

    return wrap;
  }

  function toggleMonth(wrap, body, monthKey) {
    const willOpen = !wrap.classList.contains('open');
    if (willOpen && !renderedMonths.has(monthKey)) {
      renderMonthBody(body, monthEntriesMap.get(monthKey));
      renderedMonths.add(monthKey);
    }
    wrap.classList.toggle('open', willOpen);
  }

  function renderMonthBody(body, monthEntries) {
    body.innerHTML = '';
    const days = groupByDate(monthEntries);
    for (const [dateKey, dayEntries] of days) {
      body.appendChild(renderDayRow(dateKey, dayEntries));
    }
  }

  function renderDayRow(dateKey, entries) {
    entries.sort((a, b) => a.created_at.localeCompare(b.created_at));

    const row = document.createElement('div');
    row.className = 'day-row';

    const head = document.createElement('div');
    head.className = 'day-head';
    head.innerHTML = `${formatDayLabel(dateKey)} <span class="cnt">· ${entries.length} 則</span>`;
    row.appendChild(head);

    for (const entry of entries) row.appendChild(renderEntryCompact(entry));

    return row;
  }

  // ── 精簡列（時間軸統一用這個呈現，不分單篇/多篇）──
  function renderEntryCompact(entry) {
    const el = document.createElement('div');
    el.className = 'entry-compact';

    const t = document.createElement('span');
    t.className = 'ct';
    t.textContent = formatTime(entry.created_at);

    const p = document.createElement('span');
    p.className = 'cp';
    p.textContent = entry.preview || '（無文字內容）';

    el.appendChild(t);
    el.appendChild(p);
    el.addEventListener('click', () => App.viewEntry(entry.id));
    return el;
  }

  // ── 右側年份快速跳轉 ──
  function renderRail(monthKeys, rail) {
    const years = [...new Set(monthKeys.map(k => k.slice(0, 4)))]; // 已是新到舊
    for (const year of years) {
      const btn = document.createElement('button');
      btn.textContent = year;
      btn.addEventListener('click', () => {
        rail.querySelectorAll('button').forEach(b => b.classList.remove('cur'));
        btn.classList.add('cur');
        const firstMonthOfYear = monthKeys.find(k => k.startsWith(year));
        const target = document.querySelector(`.month-group[data-month="${firstMonthOfYear}"]`);
        if (!target) return;
        const body = target.querySelector('.month-body');
        if (!renderedMonths.has(firstMonthOfYear)) {
          renderMonthBody(body, monthEntriesMap.get(firstMonthOfYear));
          renderedMonths.add(firstMonthOfYear);
        }
        target.classList.add('open');
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      rail.appendChild(btn);
    }
    if (rail.firstChild) rail.firstChild.classList.add('cur');
  }

  // ── 全部收合／全部展開（作用在「月」層級）──
  function collapseAll() {
    document.querySelectorAll('.month-group').forEach(g => g.classList.remove('open'));
  }

  function expandAll() {
    document.querySelectorAll('.month-group').forEach(g => {
      const key = g.dataset.month;
      if (!renderedMonths.has(key)) {
        renderMonthBody(g.querySelector('.month-body'), monthEntriesMap.get(key));
        renderedMonths.add(key);
      }
      g.classList.add('open');
    });
  }

  // ── 格式化 ──
  function formatMonth(monthKey) {
    const [y, m] = monthKey.split('-');
    return `${y}年${parseInt(m, 10)}月`;
  }

  function formatDayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const wd = weekdays[d.getDay()];
    const today     = localDateStr(new Date());
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    if (dateStr === today) return `今天（${m}月${day}日，週${wd}）`;
    if (dateStr === yesterday) return `昨天（${m}月${day}日，週${wd}）`;
    return `${m}月${day}日，週${wd}`;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const period = h < 12 ? '上午' : '下午';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${period} ${h12}:${m}`;
  }

  return { render, collapseAll, expandAll };
})();
