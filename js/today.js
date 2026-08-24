// ── 今日視圖模組 ──
const Today = (() => {

  const PROMPTS = [
    '今天排練裡，有哪個瞬間讓你突然入戲了？',
    '最近讀到的一段文字，有沒有哪一句特別打中你？',
    '如果今天要對三個月後的自己說一句話，你會說什麼？',
    '今天有沒有哪個小動作，做完之後覺得特別踏實？',
    '這陣子在忙的作品裡，哪一場戲讓你最捨不得刪？',
    '今天遇到的人事物裡，有沒有哪個畫面值得寫下來？',
    '如果今天的心情是一段唱腔，會是什麼調？',
    '最近有沒有哪句台詞，一直在腦中揮之不去？',
    '今天有沒有什麼決定，做完之後鬆了一口氣？',
    '如果要用一個顏色形容今天，會是什麼顏色，為什麼？',
    '最近觀察到的哪個小細節，之後可能派得上用場？',
    '今天有沒有什麼事，是「明明很小但影響很大」的？',
    '這一季巡演／排練下來，有沒有哪個瞬間讓你想哭？',
    '今天最想感謝的人是誰？想跟他說什麼？',
    '如果明天要跟後輩分享一件事，你會說什麼？',
  ];

  function render(entries) {
    renderGreeting();
    renderPrompt();
    renderOnThisDay(entries);
    renderRecent(entries);
  }

  function renderGreeting() {
    const h = new Date().getHours();
    const greet = h < 5 ? '夜深了' : h < 12 ? '早安' : h < 18 ? '午安' : '晚安';
    document.getElementById('today-greet').textContent = `${greet}，殿下`;

    const now = new Date();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    document.getElementById('today-date').textContent =
      `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 週${weekdays[now.getDay()]}`;
  }

  function renderPrompt() {
    const todayStr = localDateStr(new Date());
    let hash = 0;
    for (let i = 0; i < todayStr.length; i++) {
      hash = (hash * 31 + todayStr.charCodeAt(i)) >>> 0;
    }
    document.getElementById('today-prompt-text').textContent = PROMPTS[hash % PROMPTS.length];
  }

  function renderOnThisDay(entries) {
    const section = document.getElementById('otd-section');
    section.innerHTML = '';

    const now = new Date();
    const thisYear = now.getFullYear();
    const matches = entries
      .filter(e => {
        const d = new Date(e.created_at);
        return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() !== thisYear;
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!matches.length) return;

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = '📌 當年今日';
    section.appendChild(title);

    for (const e of matches.slice(0, 2)) {
      const yearsAgo = thisYear - new Date(e.created_at).getFullYear();
      const card = document.createElement('div');
      card.className = 'otd-card';

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `${yearsAgo} 年前`;

      const text = document.createElement('div');
      text.className = 't';
      text.textContent = (e.preview || '（無文字內容）').slice(0, 60);

      card.appendChild(badge);
      card.appendChild(text);
      card.addEventListener('click', () => App.viewEntry(e.id));
      section.appendChild(card);
    }
  }

  function renderRecent(entries) {
    const list = document.getElementById('today-recent-list');
    list.innerHTML = '';

    const todayStr = localDateStr(new Date());
    const todayEntries = entries
      .filter(e => e.created_at.slice(0, 10) === todayStr)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)); // 時間正序，早的在上面

    if (!todayEntries.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📖</div>
          <p>今天還沒有日記，點左側「新增日記」開始記錄吧！</p>
        </div>`;
      return;
    }

    for (const e of todayEntries) {
      const card = document.createElement('div');
      card.className = 'entry-card';

      const time = document.createElement('div');
      time.className = 'entry-card-time';
      time.textContent = formatTime(e.created_at);

      const preview = document.createElement('div');
      preview.className = 'entry-card-preview';
      preview.textContent = e.preview || '（無文字內容）';

      card.appendChild(time);
      card.appendChild(preview);

      const thumbs = renderEntryThumbs(e);
      if (thumbs) card.appendChild(thumbs);

      card.addEventListener('click', () => App.viewEntry(e.id));
      list.appendChild(card);
    }
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const period = h < 12 ? '上午' : '下午';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${period} ${h12}:${m}`;
  }

  return { render };
})();
