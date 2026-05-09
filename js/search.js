// ── 搜尋模組 ──
const Search = (() => {

  // ── 解析查詢語法（AND / OR / NOT / 括號） ──
  function parseQuery(raw) {
    // 正規化
    const q = raw.trim();
    if (!q) return null;

    // 拆成 token：NOT, AND, OR, "phrase", word
    const tokens = [];
    const re = /NOT\s+"([^"]+)"|NOT\s+(\S+)|AND|OR|"([^"]+)"|(\S+)/gi;
    let m;
    while ((m = re.exec(q)) !== null) {
      if (m[1] || m[2]) tokens.push({ type: 'NOT', val: (m[1] || m[2]).toLowerCase() });
      else if (m[0].toUpperCase() === 'AND') tokens.push({ type: 'AND' });
      else if (m[0].toUpperCase() === 'OR')  tokens.push({ type: 'OR' });
      else tokens.push({ type: 'TERM', val: (m[3] || m[4]).toLowerCase() });
    }
    return tokens;
  }

  function matchTokens(text, tokens) {
    if (!tokens || !tokens.length) return true;
    const t = text.toLowerCase();

    // 簡易邏輯：NOT 必須不含，TERM/AND 必須都含，OR 任一含
    const notTerms  = tokens.filter(k => k.type === 'NOT').map(k => k.val);
    const orGroups  = [];
    let   curAnd    = [];

    for (const tok of tokens) {
      if (tok.type === 'NOT') continue;
      if (tok.type === 'OR') {
        if (curAnd.length) { orGroups.push(curAnd); curAnd = []; }
      } else if (tok.type === 'TERM') {
        curAnd.push(tok.val);
      }
      // AND 不需動作（預設就是 AND）
    }
    if (curAnd.length) orGroups.push(curAnd);

    for (const not of notTerms) {
      if (t.includes(not)) return false;
    }

    if (!orGroups.length) return true;
    return orGroups.some(group => group.every(term => t.includes(term)));
  }

  // ── 高亮文字 ──
  function highlight(text, tokens) {
    if (!tokens) return escHtml(text);
    const terms = tokens
      .filter(t => t.type === 'TERM')
      .map(t => t.val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!terms.length) return escHtml(text);
    const re = new RegExp(`(${terms.join('|')})`, 'gi');
    return escHtml(text).replace(re, '<mark class="search-highlight">$1</mark>');
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── 執行搜尋 ──
  function run(rawQuery, filters = {}) {
    const entries = EntryManager.getIndex();
    const tokens  = parseQuery(rawQuery);

    return entries.filter(e => {
      // 全文搜尋
      if (tokens && !matchTokens(e.preview + ' ' + (e.tags?.map(id => {
        const t = TagManager.getById(id); return t?.name || '';
      }).join(' ')), tokens)) return false;

      // 篩選器
      if (filters.hasPhoto && !e.has_photos) return false;
      if (filters.hasLink  && !e.has_links)  return false;
      if (filters.tags?.length) {
        const matchTag = filters.tags.every(tagId => e.tags?.includes(tagId));
        if (!matchTag) return false;
      }

      return true;
    }).map(e => ({ ...e, _tokens: tokens }));
  }

  // ── 渲染搜尋結果 ──
  function renderResults(results) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    if (!results.length) {
      container.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:20px">找不到符合的日記</p>';
      return;
    }

    for (const e of results) {
      const item = document.createElement('div');
      item.className = 'search-result-item';

      const time = document.createElement('div');
      time.className = 'search-result-time';
      time.textContent = new Date(e.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

      const prev = document.createElement('div');
      prev.className = 'search-result-preview';
      prev.innerHTML = highlight(e.preview || '（無內容）', e._tokens);

      item.appendChild(time);
      item.appendChild(prev);
      item.addEventListener('click', () => {
        closeModal('search-modal');
        App.viewEntry(e.id);
      });
      container.appendChild(item);
    }
  }

  // ── 渲染標籤篩選 ──
  function renderTagFilter() {
    const list = document.getElementById('search-tag-list');
    list.innerHTML = '';
    for (const tag of TagManager.getFlat()) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.style.cursor = 'pointer';
      chip.style.background  = tag.color + '22';
      chip.style.color       = tag.color;
      chip.style.border      = `1px solid ${tag.color}44`;
      chip.textContent       = tag.name;
      chip.dataset.id        = tag.id;
      chip.dataset.selected  = 'false';
      chip.onclick = () => {
        const sel = chip.dataset.selected === 'true';
        chip.dataset.selected = sel ? 'false' : 'true';
        chip.style.opacity = sel ? '1' : '0.5';
        chip.style.textDecoration = sel ? '' : 'line-through';
      };
      list.appendChild(chip);
    }
  }

  function getSelectedTagFilters() {
    return [...document.querySelectorAll('#search-tag-list .tag-chip[data-selected="true"]')]
      .map(el => el.dataset.id);
  }

  return { run, renderResults, renderTagFilter, getSelectedTagFilters };
})();
