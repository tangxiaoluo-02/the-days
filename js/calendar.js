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
      const cell    = makeDayCell(d, false, dateStr, count, dateStr === todayStr, dateStr === selectedDate);
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

  function makeDayCell(day, otherMonth, dateStr, count = 0, isToday = false, isSelected = false) {
    const cell = document.createElement('div');
    cell.className = 'cal-day'
      + (otherMonth ? ' cal-other-month' : '')
      + (isToday    ? ' cal-today'       : '')
      + (isSelected ? ' cal-selected'    : '');

    const num = document.createElement('div');
    num.className = 'cal-day-num';
    num.textContent = day;
    cell.appendChild(num);

    if (count > 0) {
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

    if (!entries.length) {
      panel.classList.add('hidden');
      return;
    }

    const d = new Date(dateStr + 'T00:00:00');
    title.textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（共 ${entries.length} 則）`;

    list.innerHTML = '';
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
      preview.textContent = e.preview || '（無文字內容）';

      item.appendChild(time);
      item.appendChild(preview);

      // 顯示標籤
      if (e.tags?.length) {
        const tagsRow = document.createElement('div');
        tagsRow.className = 'entry-card-tags';
        for (const tagId of e.tags) {
          const tag = TagManager.getById(tagId);
          if (tag) tagsRow.appendChild(Editor.makeTagChip(tag));
        }
        item.appendChild(tagsRow);
      }

      item.addEventListener('click', () => App.viewEntry(e.id));
      list.appendChild(item);
    }

    panel.classList.remove('hidden');
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
    selectedDate = now.toISOString().slice(0, 10);
    drawCalendar();
  }

  return { render, prevMonth, nextMonth, goToday };
})();
