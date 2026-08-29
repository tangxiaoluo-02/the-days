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

      // 時間段篩選（比較本地日期字串）
      const entryDate = e.created_at.slice(0, 10);
      if (filters.dateFrom && entryDate < filters.dateFrom) return false;
      if (filters.dateTo   && entryDate > filters.dateTo)   return false;

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
    if (!results.length) return;

    for (const e of results) {
      const item = document.createElement('div');
      item.className = 'search-result-item';

      // 時間
      const d = new Date(e.created_at);
      const h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
      const period = h < 12 ? '上午' : '下午';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const time = document.createElement('div');
      time.className = 'search-result-time';
      time.textContent = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${period} ${h12}:${m}`;

      // 預覽（高亮）
      const prev = document.createElement('div');
      prev.className = 'search-result-preview';
      prev.innerHTML = highlight(e.preview || '（無內容）', e._tokens);

      item.appendChild(time);
      item.appendChild(prev);

      // 標籤
      if (e.tags?.length) {
        const tagsRow = document.createElement('div');
        tagsRow.className = 'search-result-tags';
        for (const tagId of e.tags) {
          const tag = TagManager.getById(tagId);
          if (tag) tagsRow.appendChild(Editor.makeTagChip(tag));
        }
        item.appendChild(tagsRow);
      }

      item.addEventListener('click', () => {
        App.closeSearchPage();
        App.viewEntry(e.id);
      });
      container.appendChild(item);
    }
  }

  // ── 初始化標籤篩選狀態 ──
  let _selectedFilterTagIds = [];

  function initTagFilter() {
    _selectedFilterTagIds = [];
    renderSelectedFilterChips();
    document.getElementById('tag-filter-label').textContent = '標籤篩選';
  }

  // ── 渲染標籤篩選下拉 ──
  function renderTagFilterDropdown() {
    const dd = document.getElementById('tag-filter-dropdown');
    dd.innerHTML = '';
    const flat = TagManager.getFlat();
    if (!flat.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:10px 12px;font-size:12px;color:var(--text-3)';
      empty.textContent = '尚無標籤';
      dd.appendChild(empty);
      return;
    }
    for (const tag of flat) {
      const item = document.createElement('div');
      const sel  = _selectedFilterTagIds.includes(tag.id);
      item.className = 'tag-filter-item' + (sel ? ' selected' : '');
      item.style.paddingLeft = tag._depth ? `${12 + tag._depth * 14}px` : '12px';

      const check = document.createElement('span');
      check.className = 'tag-filter-check';
      check.textContent = sel ? '✓' : '';

      const dot = document.createElement('span');
      dot.className = 'tag-color-dot';
      dot.style.background = tag.color;
      dot.style.flexShrink = '0';

      const name = document.createElement('span');
      name.textContent = tag.name;

      item.appendChild(check);
      item.appendChild(dot);
      item.appendChild(name);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (_selectedFilterTagIds.includes(tag.id)) {
          _selectedFilterTagIds = _selectedFilterTagIds.filter(id => id !== tag.id);
        } else {
          _selectedFilterTagIds.push(tag.id);
        }
        renderTagFilterDropdown();
        renderSelectedFilterChips();
        updateTagFilterBtn();
      });
      dd.appendChild(item);
    }
  }

  function renderSelectedFilterChips() {
    const area = document.getElementById('selected-filter-tags');
    area.innerHTML = '';
    for (const tagId of _selectedFilterTagIds) {
      const tag = TagManager.getById(tagId);
      if (!tag) continue;
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      styleTagChip(chip, tag.color);
      chip.style.cursor = 'pointer';
      const dot = document.createElement('span');
      dot.className = 'tag-color-dot';
      dot.style.background = TAG_CHIP_INK;
      dot.style.opacity = '0.35';
      const nm = document.createElement('span');
      nm.textContent = tag.name;
      const x = document.createElement('span');
      x.className = 'tag-x';
      x.textContent = '✕';
      x.onclick = () => {
        _selectedFilterTagIds = _selectedFilterTagIds.filter(id => id !== tagId);
        renderSelectedFilterChips();
        updateTagFilterBtn();
      };
      chip.appendChild(dot);
      chip.appendChild(nm);
      chip.appendChild(x);
      area.appendChild(chip);
    }
  }

  function updateTagFilterBtn() {
    const n = _selectedFilterTagIds.length;
    document.getElementById('tag-filter-label').textContent =
      n > 0 ? `標籤篩選 (${n})` : '標籤篩選';
    document.getElementById('tag-filter-btn').classList.toggle('active', n > 0);
  }

  function getSelectedTagFilters() {
    return [..._selectedFilterTagIds];
  }

  function setTagFilter(ids) {
    _selectedFilterTagIds = [...ids];
    renderSelectedFilterChips();
    updateTagFilterBtn();
  }

  return { run, renderResults, initTagFilter, renderTagFilterDropdown, getSelectedTagFilters, setTagFilter };
})();
