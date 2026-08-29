// ── 月曆視圖模組 ──
const Calendar = (() => {
  let currentYear  = new Date().getFullYear();
  let currentMonth = new Date().getMonth(); // 0-11
  let selectedDate = null;
  let allEntries   = [];

  function render(entries) {
    allEntries = entries;
    drawCalendar();
  }

  function drawCalendar() {
    const title = document.getElementById('cal-title');
    const grid  = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    title.textContent = `${currentYear} 年 ${currentMonth + 1} 月`;

    // 星期標題
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    for (const wd of weekdays) {
      const cell = document.createElement('div');
      cell.className = 'cal-weekday';
      cell.textContent = wd;
      grid.appendChild(cell);
    }

    // 計算當月天數與起始星期
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();

    const todayStr = localDateStr(new Date());

    // 建立當月所有日期的日記數量 map
    const countMap = new Map();
    for (const e of allEntries) {
      const d = e.created_at.slice(0, 10);
      countMap.set(d, (countMap.get(d) || 0) + 1);
    }

    const dayMoods = EntryManager.getAllDayMoods();

    // 填充上個月尾巴
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const cell = makeDayCell(day, true, null);
      grid.appendChild(cell);
    }

    // 填充當月
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const count   = countMap.get(dateStr) || 0;
      const cell    = makeDayCell(d, false, dateStr, count, dateStr === todayStr, dateStr === selectedDate, dayMoods[dateStr]);
      grid.appendChild(cell);
    }

    // 填充下個月開頭
    const total = firstDay + daysInMonth;
    const remain = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let d = 1; d <= remain; d++) {
      const cell = makeDayCell(d, true, null);
      grid.appendChild(cell);
    }

    // 如果有選中日期，顯示該天日記
    if (selectedDate) showDayEntries(selectedDate);
  }

  function makeDayCell(day, otherMonth, dateStr, count = 0, isToday = false, isSelected = false, moodId = null) {
    const cell = document.createElement('div');
    cell.className = 'cal-day'
      + (otherMonth ? ' cal-other-month' : '')
      + (isToday    ? ' cal-today'       : '')
      + (isSelected ? ' cal-selected'    : '');

    const num = document.createElement('div');
    num.className = 'cal-day-num';
    num.textContent = day;
    cell.appendChild(num);

    const mood = moodId ? getMood(moodId) : null;
    if (mood) {
      // 有記錄心情就顯示插畫，比純圓點更一眼看出整月心情
      const moodEl = document.createElement('div');
      moodEl.className = 'cal-mood';
      moodEl.innerHTML = moodIconSVG(moodId, 15);
      moodEl.title = mood.label;
      cell.appendChild(moodEl);
    } else if (count > 0) {
      const dots = document.createElement('div');
      dots.className = 'cal-day-dots';
      const maxDots = Math.min(count, 3);
      for (let i = 0; i < maxDots; i++) {
        const dot = document.createElement('div');
        dot.className = 'cal-dot';
        dots.appendChild(dot);
      }
      cell.appendChild(dots);
    }

    if (!otherMonth && dateStr) {
      cell.addEventListener('click', () => {
        selectedDate = dateStr;
        drawCalendar();
      });
    }

    return cell;
  }

  function showDayEntries(dateStr) {
    const panel = document.getElementById('day-entries-panel');
    const title = document.getElementById('day-entries-title');
    const list  = document.getElementById('day-entries-list');

    const entries = allEntries
      .filter(e => e.created_at.slice(0, 10) === dateStr)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)); // 舊的在上

    const d = new Date(dateStr + 'T00:00:00');
    title.textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日` + (entries.length ? `（共 ${entries.length} 則）` : '');

    document.getElementById('day-copy-btn').classList.toggle('hidden', entries.length === 0);

    // 先在背景把完整內文預先抓好、存進 EntryManager 的快取，等殿下真的按下
    // 「複製本日文字」時幾乎不用再等 Drive，才不會因為等太久被瀏覽器拒絕複製權限
    for (const e of entries) EntryManager.getEntry(e.id).catch(() => {});

    renderDayMoodPicker(dateStr);

    list.innerHTML = '';
    if (!entries.length) {
      list.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:8px 0">這天還沒有日記</p>';
    }
    for (const e of entries) {
      const item = document.createElement('div');
      item.className = 'entry-card';
      item.style.marginBottom = '8px';

      const time = document.createElement('div');
      time.className = 'entry-card-time';
      const _d = new Date(e.created_at);
      const _h = _d.getHours(), _m = String(_d.getMinutes()).padStart(2,'0');
      const _p = _h < 12 ? '上午' : '下午';
      const _h12 = _h === 0 ? 12 : _h > 12 ? _h - 12 : _h;
      time.textContent = `${_p} ${_h12}:${_m}`;

      const preview = document.createElement('div');
      preview.className = 'entry-card-preview';
      preview.innerHTML = entryPreviewHtml(e);

      item.appendChild(time);
      item.appendChild(preview);

      const thumbs = renderEntryThumbs(e);
      if (thumbs) item.appendChild(thumbs);

      const tags = renderEntryTags(e);
      if (tags) item.appendChild(tags);

      item.addEventListener('click', () => App.viewEntry(e.id));
      list.appendChild(item);
    }

    panel.classList.remove('hidden');
  }

  // ── 當日心情選擇器（跟日記完全脫鉤，殿下回顧完一天後手動記錄整體感覺）──
  function renderDayMoodPicker(dateStr) {
    const wrap = document.getElementById('day-mood-picker');
    wrap.innerHTML = '';
    const current = EntryManager.getDayMood(dateStr);
    for (const m of MOODS) {
      const isActive = current === m.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mood-btn' + (isActive ? ' active' : '');
      if (isActive) {
        btn.style.background = m.color + '22';
        btn.style.borderColor = m.color;
      }
      btn.title = m.label;
      btn.innerHTML = moodIconSVG(m.id, 26);
      btn.addEventListener('click', async () => {
        const newMood = isActive ? null : m.id; // 再點一次取消
        await EntryManager.setDayMood(dateStr, newMood);
        App.toast(newMood ? '已記錄這天的心情 ✓' : '已清除這天的心情', 'success');
        drawCalendar(); // 重繪格子跟面板，反映最新心情
      });
      wrap.appendChild(btn);
    }
  }

  function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    selectedDate = null;
    document.getElementById('day-entries-panel').classList.add('hidden');
    drawCalendar();
  }

  function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    selectedDate = null;
    document.getElementById('day-entries-panel').classList.add('hidden');
    drawCalendar();
  }

  function goToday() {
    const now = new Date();
    currentYear  = now.getFullYear();
    currentMonth = now.getMonth();
    selectedDate = localDateStr(now);
    drawCalendar();
  }

  // ── 複製選定日期的所有日記文字（含時間戳），方便貼到其他筆記軟體 ──
  async function copyDayText() {
    if (!selectedDate) return;
    const entries = allEntries
      .filter(e => e.created_at.slice(0, 10) === selectedDate)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!entries.length) return;

    const btn   = document.getElementById('day-copy-btn');
    const label = document.getElementById('day-copy-btn-label');
    const originalLabel = label.textContent;
    btn.disabled = true;
    label.textContent = '準備中…';

    try {
      // 索引裡的 preview 只有前120字，要一篇篇抓完整內文才不會複製到被截斷的文字
      const fullEntries = await Promise.all(entries.map(e => EntryManager.getEntry(e.id)));
      const blocks = fullEntries.map(entry => {
        const d  = new Date(entry.created_at);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `⏳${hh}:${mm}\n${entry.content || ''}`;
      });
      await copyTextToClipboard(blocks.join('\n\n-----\n'));
      App.toast(`已複製 ${entries.length} 則日記文字 ✓`, 'success');
    } catch (e) {
      console.error('[複製本日文字] 失敗:', e);
      App.toast('複製失敗：' + e.message, 'error');
    } finally {
      btn.disabled = false;
      label.textContent = originalLabel;
    }
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) {
      // Clipboard API 要求「使用者點擊後很短時間內」執行，前面抓完整內文要連線 Drive、
      // 常常等太久導致瀏覽器判定逾時拒絕（NotAllowedError）。這裡自動退回舊式方法重試一次，
      // 不讓殿下需要手動點兩次。
      console.warn('[複製本日文字] Clipboard API 失敗，改用備用方案:', e);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // 給「新增日記」按鈕用：目前有沒有選中某一天，讓補記那天日記時可以直接帶入日期
  function getSelectedDate() {
    return selectedDate;
  }

  return { render, prevMonth, nextMonth, goToday, copyDayText, getSelectedDate };
})();
