// ── 智慧標籤選取器（可搜尋 + 即時建立 + 選取切換）──
const SmartTagPicker = (() => {
  let selectedIds = [];
  let onChangeCb  = null;

  const getEl    = () => document.getElementById('smart-tag-picker');
  const getInput = () => document.getElementById('stp-input');
  const getList  = () => document.getElementById('stp-list');

  // ── 開啟（錨點元素、目前已選 ids、onChange 回呼）──
  function open(anchorEl, currentTagIds, onChange) {
    selectedIds = [...(currentTagIds || [])];
    onChangeCb  = onChange;

    const picker = getEl();
    // 桌面：浮動在錨點下方
    if (window.innerWidth > 640) {
      const rect = anchorEl.getBoundingClientRect();
      const left = Math.min(rect.left, window.innerWidth - 280);
      const top  = rect.bottom + 6;
      picker.style.left = left + 'px';
      picker.style.top  = top  + 'px';
      picker.style.bottom = 'auto';
    }

    getInput().value = '';
    render('');
    picker.classList.remove('hidden');
    getInput().focus();
  }

  function close() {
    getEl().classList.add('hidden');
  }

  // ── 渲染列表 ──
  function render(query) {
    const list = getList();
    list.innerHTML = '';
    const q    = query.trim().toLowerCase();
    const flat = TagManager.getFlat();

    // 支援「父/子」格式篩選
    let filtered;
    if (q.includes('/')) {
      const [parentQ, childQ] = q.split('/').map(s => s.trim());
      filtered = flat.filter(t => {
        if (!t.parent_id) return false;
        const parent = TagManager.getById(t.parent_id);
        return parent?.name.toLowerCase().includes(parentQ) &&
               (!childQ || t.name.toLowerCase().includes(childQ));
      });
    } else {
      filtered = q ? flat.filter(t => t.name.toLowerCase().includes(q)) : flat;
    }

    if (!filtered.length && !q) {
      const empty = document.createElement('div');
      empty.className = 'stp-empty';
      empty.textContent = '尚無標籤，輸入名稱建立第一個';
      list.appendChild(empty);
    }

    for (const tag of filtered) {
      const isSelected = selectedIds.includes(tag.id);
      const item = document.createElement('div');
      item.className = 'stp-item' + (isSelected ? ' stp-selected' : '');
      item.style.paddingLeft = tag._depth ? `${12 + tag._depth * 14}px` : '12px';

      const check = document.createElement('span');
      check.className = 'stp-check';
      check.textContent = isSelected ? '✓' : '';

      const dot = document.createElement('span');
      dot.className = 'tag-color-dot';
      dot.style.background = tag.color;
      dot.style.flexShrink = '0';

      const name = document.createElement('span');
      name.style.flex = '1';
      name.textContent = tag.name;

      item.appendChild(check);
      item.appendChild(dot);
      item.appendChild(name);

      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 防止 input 失焦
        toggleTag(tag.id);
        render(getInput().value);
      });
      list.appendChild(item);
    }

    // 建立標籤選項（支援「父/子」格式）
    const displayQ = query.trim();
    if (displayQ) {
      if (displayQ.includes('/')) {
        // ── A/B 格式：建立子標籤 ──
        const [parentName, childName] = displayQ.split('/').map(s => s.trim());
        if (childName) {
          const childExact = flat.find(t => {
            const parent = TagManager.getById(t.parent_id);
            return t.name === childName && parent?.name === parentName;
          });
          if (!childExact) {
            const createItem = document.createElement('div');
            createItem.className = 'stp-create';
            createItem.innerHTML = `＋ 建立子標籤「<strong>${parentName}</strong> / <strong>${childName}</strong>」`;
            createItem.addEventListener('mousedown', async (e) => {
              e.preventDefault();
              App.showLoading('建立標籤…');
              // 找或建立父標籤
              let parentTag = TagManager.getAll().find(t => t.name === parentName && !t.parent_id);
              const parentId = parentTag
                ? parentTag.id
                : await TagManager.add(parentName, null, '#8B6914');
              // 建立子標籤
              const childId = await TagManager.add(childName, parentId, '#8B6914');
              App.hideLoading();
              selectedIds.push(childId);
              getInput().value = '';
              render('');
              onChangeCb && onChangeCb([...selectedIds]);
              App.toast(`子標籤「${parentName} / ${childName}」已建立 ✓`, 'success');
            });
            list.appendChild(createItem);
          }
        }
      } else {
        // ── 一般格式：建立頂層標籤 ──
        const exactMatch = flat.find(t => t.name.toLowerCase() === q);
        if (!exactMatch) {
          const createItem = document.createElement('div');
          createItem.className = 'stp-create';
          createItem.innerHTML = `＋ 建立標籤「<strong>${displayQ}</strong>」`;
          createItem.addEventListener('mousedown', async (e) => {
            e.preventDefault();
            App.showLoading('建立標籤…');
            const id = await TagManager.add(displayQ, null, '#8B6914');
            App.hideLoading();
            selectedIds.push(id);
            getInput().value = '';
            render('');
            onChangeCb && onChangeCb([...selectedIds]);
            App.toast(`標籤「${displayQ}」已建立 ✓`, 'success');
          });
          list.appendChild(createItem);
        }
      }
    }
  }

  function toggleTag(id) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter(x => x !== id);
    } else {
      selectedIds.push(id);
    }
    onChangeCb && onChangeCb([...selectedIds]);
  }

  // ── 初始化（在 DOMContentLoaded 後呼叫一次）──
  function init() {
    getInput().addEventListener('input', (e) => render(e.target.value));
    getInput().addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    getEl().addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => close());

    // 完成按鈕（手機版）
    document.querySelector('.stp-done-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      close();
    });
  }

  return { init, open, close };
})();
