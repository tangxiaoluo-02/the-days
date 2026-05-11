// ── 寫作統計模組 ──
const Stats = (() => {

  // 取得本地日期字串（避免 UTC 偏差）
  function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function render(entries) {
    const container = document.getElementById('stats-content');
    container.innerHTML = '';

    if (!entries.length) {
      container.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:20px">還沒有日記資料</p>';
      return;
    }

    // ── 基本數字 ──
    const totalWords   = entries.reduce((s, e) => s + (e.word_count || 0), 0);
    const withPhotos   = entries.filter(e => e.has_photos).length;
    const todayStr     = localDateStr(new Date());
    const todayCount   = entries.filter(e => e.created_at.slice(0, 10) === todayStr).length;
    const streak       = calcStreak(entries);
    const longestStreak = calcLongestStreak(entries);

    // 有記錄的不同日期數（用 Set 去重）
    const uniqueDates = new Set(entries.map(e => e.created_at.slice(0, 10)));
    const totalDays   = uniqueDates.size;

    const grid = document.createElement('div');
    grid.className = 'stats-grid';
    const cards = [
      { num: entries.length,   label: '總篇數' },
      { num: totalWords,       label: '總字數' },
      { num: withPhotos,       label: '含照片篇數' },
      { num: todayCount,       label: '今日篇數' },
      { num: streak,           label: '連續天數 🔥' },
      { num: longestStreak,    label: '最長連續天' },
      { num: totalDays,        label: '記錄天數' },
      { num: (totalWords / entries.length).toFixed(0), label: '平均每篇字數' },
    ];
    for (const c of cards) {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `<div class="stat-num">${c.num}</div><div class="stat-label">${c.label}</div>`;
      grid.appendChild(card);
    }
    container.appendChild(grid);

    // ── 每月篇數 ──
    container.appendChild(renderMonthlyChart(entries));

    // ── 連續天數熱圖（最近 70 天） ──
    container.appendChild(renderStreakHeatmap(entries));

    // ── 最常使用標籤 Top 5 ──
    container.appendChild(renderTopTags(entries));
  }

  function calcStreak(entries) {
    const dates = new Set(entries.map(e => e.created_at.slice(0, 10)));
    let streak = 0;
    let d = new Date();
    while (true) {
      const s = localDateStr(d); // 用本地日期，避免 UTC 偏差
      if (!dates.has(s)) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function calcLongestStreak(entries) {
    const dates = [...new Set(entries.map(e => e.created_at.slice(0, 10)))].sort();
    if (!dates.length) return 0;
    let longest = 1, cur = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i-1]);
      const curr = new Date(dates[i]);
      const diff = (curr - prev) / 86400000;
      if (diff === 1) { cur++; longest = Math.max(longest, cur); }
      else cur = 1;
    }
    return longest;
  }

  function renderMonthlyChart(entries) {
    const section = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'stats-section-title';
    title.textContent = '每月篇數';
    section.appendChild(title);

    const monthMap = new Map();
    for (const e of entries) {
      const m = e.created_at.slice(0, 7);
      monthMap.set(m, (monthMap.get(m) || 0) + 1);
    }

    const months = [...monthMap.keys()].sort().slice(-12);
    const max    = Math.max(...months.map(m => monthMap.get(m)));

    const chart = document.createElement('div');
    chart.style.cssText = 'display:flex;align-items:flex-end;gap:6px;height:80px;margin-top:8px';

    for (const m of months) {
      const cnt = monthMap.get(m);
      const pct = max > 0 ? (cnt / max) * 100 : 0;
      const col = document.createElement('div');
      col.style.cssText = `flex:1;display:flex;flex-direction:column;align-items:center;gap:3px`;
      const bar = document.createElement('div');
      bar.style.cssText = `width:100%;background:var(--accent);border-radius:4px 4px 0 0;height:${pct}%;min-height:4px;transition:height 0.3s`;
      bar.title = `${m}：${cnt} 篇`;
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:9px;color:var(--text-3);writing-mode:vertical-rl;transform:rotate(180deg)';
      lbl.textContent = m.slice(5);
      col.appendChild(bar);
      col.appendChild(lbl);
      chart.appendChild(col);
    }
    section.appendChild(chart);
    return section;
  }

  function renderStreakHeatmap(entries) {
    const section = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'stats-section-title';
    title.textContent = '最近 70 天記錄';
    section.appendChild(title);

    const dates = new Set(entries.map(e => e.created_at.slice(0, 10)));
    const bar = document.createElement('div');
    bar.className = 'streak-bar';

    for (let i = 69; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const s = localDateStr(d); // 用本地日期
      const cell = document.createElement('div');
      cell.className = 'streak-day' + (dates.has(s) ? ' active' : '');
      cell.title = `${s}：${dates.has(s) ? '有記錄' : '無記錄'}`;
      bar.appendChild(cell);
    }
    section.appendChild(bar);
    return section;
  }

  function renderTopTags(entries) {
    const section = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'stats-section-title';
    title.textContent = '最常使用標籤 Top 5';
    section.appendChild(title);

    const tagCount = new Map();
    for (const e of entries) {
      for (const t of (e.tags || [])) {
        tagCount.set(t, (tagCount.get(t) || 0) + 1);
      }
    }

    const top = [...tagCount.entries()]
      .sort((a,b) => b[1] - a[1])
      .slice(0, 5);

    if (!top.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'color:var(--text-3);font-size:13px';
      empty.textContent = '尚未使用標籤';
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px';
    const max = top[0][1];
    for (const [tagId, cnt] of top) {
      const tag = TagManager.getById(tagId);
      if (!tag) continue;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;border-radius:6px;padding:4px 6px;transition:background 0.15s';
      row.title = `點擊搜尋含「${tag.name}」的日記`;
      row.addEventListener('mouseenter', () => row.style.background = 'var(--surface-2)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', () => {
        closeModal('stats-modal');
        App.openSearchWithTag(tagId);
      });
      const namePart = document.createElement('span');
      namePart.style.cssText = `color:${tag.color};min-width:80px`;
      namePart.textContent = tag.name;
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'flex:1;background:var(--surface-2);border-radius:4px;height:8px;overflow:hidden';
      const barInner = document.createElement('div');
      barInner.style.cssText = `width:${(cnt/max*100).toFixed(0)}%;background:${tag.color};height:100%;border-radius:4px`;
      barWrap.appendChild(barInner);
      const cntPart = document.createElement('span');
      cntPart.style.cssText = 'color:var(--text-3);min-width:30px;text-align:right';
      cntPart.textContent = cnt;
      row.appendChild(namePart);
      row.appendChild(barWrap);
      row.appendChild(cntPart);
      list.appendChild(row);
    }
    section.appendChild(list);
    return section;
  }

  return { render };
})();
