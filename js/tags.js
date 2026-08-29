// ── 標籤管理模組 ──
const TagManager = (() => {
  let tags = [];  // 扁平陣列，含 parent_id
  let loadPromise = null;

  // 批次管理模式狀態
  let batchMode = false;
  let selectedForBatch = new Set();

  // 重複呼叫只會真的跑一次，避免後面的呼叫把前面已經新增的標籤蓋掉
  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const data = await Drive.loadTags();
      tags = data.tags || [];
      await migrateColorsToPalette();
    })();
    loadPromise.catch(() => { loadPromise = null; });
    return loadPromise;
  }

  // 確保標籤已經從雲端載入完成，才動手新增/修改，避免被稍後才完成的 load() 蓋掉
  async function ensureLoaded() {
    await load();
  }

  async function save() {
    await Drive.saveTags({ tags });
  }

  // 舊資料校正：把不在色票裡的自訂顏色，自動換成色票裡最接近的顏色，
  // 只做一次（改完就存回 Drive），之後就一直是色票色，不用殿下手動重設
  async function migrateColorsToPalette() {
    const paletteLower = new Set(TAG_PALETTE.map(c => c.toLowerCase()));
    let changed = false;
    for (const t of tags) {
      if (!t.color || !paletteLower.has(t.color.toLowerCase())) {
        t.color = nearestPaletteColor(t.color || TAG_PALETTE[9]);
        changed = true;
      }
    }
    if (changed) await save();
  }

  function getAll() { return tags; }

  // 回傳扁平清單，帶 _depth 用於縮排顯示
  function getFlat() {
    const result = [];
    const roots  = tags.filter(t => !t.parent_id).sort((a,b) => a.order - b.order);
    for (const root of roots) {
      result.push({ ...root, _depth: 0 });
      const children = tags.filter(t => t.parent_id === root.id).sort((a,b) => a.order - b.order);
      for (const child of children) {
        result.push({ ...child, _depth: 1 });
      }
    }
    return result;
  }

  function getById(id) { return tags.find(t => t.id === id); }

  async function add(name, parentId, color) {
    await ensureLoaded();
    // 防呆：同名同層不重複建立
    const existing = tags.find(t =>
      t.name === name && t.parent_id === (parentId || null)
    );
    if (existing) return existing.id;

    const id = 'tag_' + Date.now();
    const order = tags.filter(t => t.parent_id === (parentId || null)).length;
    tags.push({ id, name, parent_id: parentId || null, color: color || TAG_PALETTE[9], order });
    await save();
    return id;
  }

  async function edit(id, name, color) {
    await ensureLoaded();
    const tag = tags.find(t => t.id === id);
    if (!tag) return;
    tag.name  = name;
    tag.color = color;
    await save();
  }

  async function remove(id) {
    await ensureLoaded();
    const children = tags.filter(t => t.parent_id === id);
    const toDelete = new Set([id, ...children.map(c => c.id)]);
    tags = tags.filter(t => !toDelete.has(t.id));
    await save();
  }

  // ── 批次刪除（含各自的子標籤）──
  async function removeMany(ids) {
    await ensureLoaded();
    const toDelete = new Set();
    for (const id of ids) {
      toDelete.add(id);
      tags.filter(t => t.parent_id === id).forEach(c => toDelete.add(c.id));
    }
    tags = tags.filter(t => !toDelete.has(t.id));
    await save();
  }

  // ── 批次搬到某個母標籤底下（或搬到頂層）──
  async function moveMany(ids, newParentId) {
    await ensureLoaded();
    const idSet = new Set(ids);
    // 不能把標籤搬到自己（或自己選取範圍內的另一個）底下
    if (idSet.has(newParentId)) return;
    const siblings = tags.filter(t => t.parent_id === (newParentId || null) && !idSet.has(t.id));
    let order = siblings.length;
    for (const id of ids) {
      const t = tags.find(x => x.id === id);
      if (!t) continue;
      t.parent_id = newParentId || null;
      t.order = order++;
    }
    await save();
  }

  // ── 排序（同層級內上移/下移，鍵盤/無障礙備用，主要操作是拖曳）──
  async function moveTag(id, dir) {
    const tag      = tags.find(t => t.id === id);
    if (!tag) return;
    const siblings = tags.filter(t => t.parent_id === tag.parent_id).sort((a,b) => a.order - b.order);
    const idx      = siblings.findIndex(t => t.id === id);
    const newIdx   = idx + dir;
    if (newIdx < 0 || newIdx >= siblings.length) return;
    // 交換 order
    [siblings[idx].order, siblings[newIdx].order] = [siblings[newIdx].order, siblings[idx].order];
    for (const s of siblings) {
      const t = tags.find(x => x.id === s.id);
      if (t) t.order = s.order;
    }
    await save();
    renderModal();
  }

  // ── 拖曳排序：把某個同層清單重新編號並存檔 ──
  async function reorderSiblings(parentId, orderedIds) {
    await ensureLoaded();
    orderedIds.forEach((id, idx) => {
      const t = tags.find(x => x.id === id);
      if (t) t.order = idx;
    });
    await save();
  }

  // ── 顏色選擇器：小圓點觸發按鈕 + 彈出色票面板（取代 <input type="color">）──
  // 回傳 { el, getColor }，el 插入畫面、getColor() 讀目前選的顏色
  function makeColorPicker(initialColor) {
    let current = initialColor;
    const wrap = document.createElement('div');
    wrap.className = 'tag-color-picker';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'tag-color-picker-trigger';
    trigger.style.background = current;
    trigger.title = '選擇標籤顏色';

    const panel = document.createElement('div');
    panel.className = 'tag-color-picker-panel hidden';
    for (const c of TAG_PALETTE) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'tag-color-swatch' + (c.toLowerCase() === current.toLowerCase() ? ' active' : '');
      sw.style.background = c;
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        current = c;
        trigger.style.background = c;
        panel.querySelectorAll('.tag-color-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        panel.classList.add('hidden');
      });
      panel.appendChild(sw);
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.tag-color-picker-panel').forEach(p => { if (p !== panel) p.classList.add('hidden'); });
      panel.classList.toggle('hidden');
    });
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => panel.classList.add('hidden'));

    wrap.appendChild(trigger);
    wrap.appendChild(panel);
    return { el: wrap, getColor: () => current };
  }

  let _newTagColorPicker = null;

  function getNewTagColor() {
    return _newTagColorPicker ? _newTagColorPicker.getColor() : TAG_PALETTE[9];
  }

  // ── 渲染標籤管理 Modal ──
  function renderModal() {
    // 更新父標籤下拉（新增標籤用、批次搬移用）
    const sel = document.getElementById('new-tag-parent');
    sel.innerHTML = '<option value="">（頂層標籤）</option>';
    for (const t of tags.filter(t => !t.parent_id).sort((a,b) => a.order - b.order)) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }

    const moveSel = document.getElementById('tags-batch-move-target');
    if (moveSel) {
      moveSel.innerHTML = '<option value="">搬到頂層</option>';
      for (const t of tags.filter(t => !t.parent_id).sort((a,b) => a.order - b.order)) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        moveSel.appendChild(opt);
      }
    }

    // 合併目標可以選任何一個標籤（不限頂層），用縮排表示層級
    const mergeSel = document.getElementById('tags-batch-merge-target');
    if (mergeSel) {
      mergeSel.innerHTML = '<option value="">合併到…</option>';
      for (const t of getFlat()) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = (t._depth ? '　' : '') + t.name;
        mergeSel.appendChild(opt);
      }
    }

    // 新增標籤的顏色選擇器（每次開啟重建，預設藍色）
    const colorSlot = document.getElementById('new-tag-color-picker');
    if (colorSlot) {
      colorSlot.innerHTML = '';
      _newTagColorPicker = makeColorPicker(TAG_PALETTE[9]);
      colorSlot.appendChild(_newTagColorPicker.el);
    }

    // 批次工具列
    const batchBar = document.getElementById('tags-batch-bar');
    if (batchBar) batchBar.classList.toggle('hidden', !batchMode);
    const batchToggleBtn = document.getElementById('tags-batch-toggle-btn');
    if (batchToggleBtn) batchToggleBtn.textContent = batchMode ? '結束批次管理' : '批次管理';
    const countEl = document.getElementById('tags-batch-count');
    if (countEl) countEl.textContent = `已選 ${selectedForBatch.size} 個`;

    const tree = document.getElementById('tags-tree');
    tree.innerHTML = '';

    const roots = tags.filter(t => !t.parent_id).sort((a,b) => a.order - b.order);
    for (const root of roots) {
      tree.appendChild(renderTagGroup(root));
    }
  }

  function toggleBatchMode() {
    batchMode = !batchMode;
    selectedForBatch.clear();
    renderModal();
  }

  // ── 渲染一組主標籤（含子標籤）──
  function renderTagGroup(root) {
    const group = document.createElement('div');
    group.className = 'tag-group';
    group.id = `group-${root.id}`;

    const children = tags.filter(t => t.parent_id === root.id).sort((a,b) => a.order - b.order);

    // 主標籤列
    group.appendChild(renderTagRow(root, false, children.length > 0));

    // 子標籤容器（預設折疊）
    const childWrap = document.createElement('div');
    childWrap.className = 'tag-children';
    childWrap.id = `children-${root.id}`;
    childWrap.style.display = 'none';
    for (const child of children) {
      childWrap.appendChild(renderTagRow(child, true, false));
    }

    // 子標籤新增列（批次模式下隱藏，避免操作衝突）
    if (!batchMode) {
      const addChildRow = document.createElement('div');
      addChildRow.className = 'tag-add-child';
      const addChildInput = document.createElement('input');
      addChildInput.type = 'text';
      addChildInput.placeholder = `新增「${root.name}」的子標籤…`;
      addChildInput.style.cssText = 'flex:1;border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px;outline:none';
      const addChildColorPicker = makeColorPicker(root.color);
      const addChildBtn = document.createElement('button');
      addChildBtn.textContent = '＋';
      addChildBtn.style.cssText = 'padding:3px 10px;background:var(--primary);color:#fff;border-radius:4px;font-size:13px';
      addChildBtn.onclick = async () => {
        const name = addChildInput.value.trim();
        if (!name) return;
        await add(name, root.id, addChildColorPicker.getColor());
        renderModal();
        // 展開父標籤
        setTimeout(() => {
          const cw = document.getElementById(`children-${root.id}`);
          if (cw) cw.style.display = '';
          const btn = document.getElementById(`toggle-${root.id}`);
          if (btn) btn.textContent = '▾';
        }, 50);
      };
      addChildInput.addEventListener('keydown', e => { if (e.key === 'Enter') addChildBtn.click(); });
      addChildRow.appendChild(addChildInput);
      addChildRow.appendChild(addChildColorPicker.el);
      addChildRow.appendChild(addChildBtn);
      childWrap.appendChild(addChildRow);
    }

    group.appendChild(childWrap);
    return group;
  }

  // ── 渲染單一標籤列 ──
  function renderTagRow(tag, isChild, hasChildren) {
    const row = document.createElement('div');
    row.className = 'tag-tree-item' + (isChild ? ' child' : '');
    row.dataset.id = tag.id;

    // 批次模式：勾選框
    if (batchMode) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'tag-batch-checkbox';
      checkbox.checked = selectedForBatch.has(tag.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedForBatch.add(tag.id);
        else selectedForBatch.delete(tag.id);
        const countEl = document.getElementById('tags-batch-count');
        if (countEl) countEl.textContent = `已選 ${selectedForBatch.size} 個`;
      });
      row.appendChild(checkbox);
    } else {
      // 拖曳把手（非批次模式才能拖曳排序，避免跟勾選操作衝突）
      const handle = document.createElement('span');
      handle.className = 'tag-drag-handle';
      handle.textContent = '⠿';
      handle.title = '按住拖曳排序';
      row.appendChild(handle);
      attachDragReorder(row, tag, handle);
    }

    // 顏色點
    const dot = document.createElement('span');
    dot.className = 'tag-color-dot-lg';
    dot.style.background = tag.color;

    // 名稱
    const name = document.createElement('span');
    name.className = 'tag-item-name';
    name.textContent = tag.name;

    row.appendChild(dot);
    row.appendChild(name);

    // 展開/折疊（主標籤才有）
    if (!isChild) {
      const toggleBtn = document.createElement('button');
      toggleBtn.id = `toggle-${tag.id}`;
      toggleBtn.className = 'tag-toggle-btn';
      toggleBtn.textContent = hasChildren ? '▸' : '＋';
      toggleBtn.title = hasChildren ? '展開子標籤' : '還沒有子標籤';
      toggleBtn.onclick = () => {
        const cw = document.getElementById(`children-${tag.id}`);
        if (!cw) return;
        const open = cw.style.display !== 'none';
        cw.style.display = open ? 'none' : '';
        toggleBtn.textContent = open ? '▸' : '▾';
      };
      row.appendChild(toggleBtn);
    }

    if (!batchMode) {
      const actions = document.createElement('div');
      actions.className = 'tag-tree-actions';
      const editBtn = makeIconBtn('✏️', '編輯', () => startInlineEdit(row, tag, isChild, hasChildren));
      const delBtn = makeIconBtn('🗑️', '刪除', async () => {
        const hasKids = tags.some(t => t.parent_id === tag.id);
        if (!confirm(hasKids ? `刪除「${tag.name}」及其所有子標籤？` : `刪除標籤「${tag.name}」？`)) return;
        await remove(tag.id);
        renderModal();
      });
      delBtn.className += ' del-btn';
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);
    }

    return row;
  }

  function makeIconBtn(text, title, onclick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.title = title;
    btn.onclick = onclick;
    return btn;
  }

  // ── 拖曳排序：按住把手拖動，放開時算出新順序存檔 ──
  // 用「浮動幽靈跟著手指走、原本的列留在原地」的做法，比較不用擔心拖曳中
  // 途不斷即時搬動 DOM 節點造成的座標錯亂，放開的當下才真正重新排序畫面。
  function attachDragReorder(row, tag, handle) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startRect = row.getBoundingClientRect();
      const offsetX = e.clientX - startRect.left;
      const offsetY = e.clientY - startRect.top;

      const getSiblingRows = () => {
        if (tag.parent_id) {
          const wrap = document.getElementById(`children-${tag.parent_id}`);
          return wrap ? [...wrap.querySelectorAll(':scope > .tag-tree-item')] : [];
        }
        return [...document.querySelectorAll('#tags-tree > .tag-group > .tag-tree-item:not(.child)')];
      };

      const ghost = row.cloneNode(true);
      ghost.classList.add('tag-drag-ghost');
      ghost.style.width  = startRect.width + 'px';
      ghost.style.left   = startRect.left + 'px';
      ghost.style.top    = startRect.top + 'px';
      document.body.appendChild(ghost);
      row.classList.add('tag-drag-source');

      let insertBeforeEl = null;

      function clearIndicators() {
        getSiblingRows().forEach(r => r.classList.remove('tag-drop-indicator'));
      }

      function onMove(ev) {
        ghost.style.left = (ev.clientX - offsetX) + 'px';
        ghost.style.top  = (ev.clientY - offsetY) + 'px';

        const siblings = getSiblingRows().filter(el => el !== row);
        insertBeforeEl = null;
        for (const sib of siblings) {
          const r = sib.getBoundingClientRect();
          const mid = r.top + r.height / 2;
          if (ev.clientY < mid) { insertBeforeEl = sib; break; }
        }
        clearIndicators();
        if (insertBeforeEl) insertBeforeEl.classList.add('tag-drop-indicator');
      }

      async function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        ghost.remove();
        row.classList.remove('tag-drag-source');
        clearIndicators();

        const siblings = getSiblingRows().filter(el => el !== row);
        const ids = siblings.map(el => el.dataset.id);
        if (insertBeforeEl) {
          const idx = ids.indexOf(insertBeforeEl.dataset.id);
          ids.splice(idx, 0, tag.id);
        } else {
          ids.push(tag.id);
        }
        await reorderSiblings(tag.parent_id, ids);
        renderModal();
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // ── Inline 編輯 ──
  function startInlineEdit(row, tag, isChild, hasChildren) {
    row.innerHTML = '';
    row.className = 'tag-tree-item tag-item-editing' + (isChild ? ' child' : '');

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = tag.name;
    nameInput.className = 'tag-edit-name';

    const colorPicker = makeColorPicker(tag.color);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '✓';
    saveBtn.className = 'tag-edit-save';
    saveBtn.onclick = async () => {
      const newName = nameInput.value.trim() || tag.name;
      await edit(tag.id, newName, colorPicker.getColor());
      renderModal();
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✗';
    cancelBtn.className = 'tag-edit-cancel';
    cancelBtn.onclick = () => renderModal();

    row.appendChild(nameInput);
    row.appendChild(colorPicker.el);
    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);
    nameInput.focus();
    nameInput.select();
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });
  }

  // ── 批次動作：刪除 ──
  async function batchDelete() {
    if (!selectedForBatch.size) return;
    if (!confirm(`確定要刪除選取的 ${selectedForBatch.size} 個標籤嗎？（含各自的子標籤）`)) return;
    await removeMany([...selectedForBatch]);
    selectedForBatch.clear();
    renderModal();
  }

  // ── 批次動作：搬移 ──
  async function batchMove(newParentId) {
    if (!selectedForBatch.size) return;
    await moveMany([...selectedForBatch], newParentId || null);
    selectedForBatch.clear();
    renderModal();
    App.toast('已搬移 ✓', 'success');
  }

  // ── 批次動作：合併——把選取的標籤全部合併進某一個目標標籤，
  //    合併完來源標籤會被刪除（跟目標標籤同一個的話會自動跳過）。
  //    用在「匯入 Day One 之後同一件事有兩個標籤」這種情境，例如把
  //    「家人」合併進「家庭」，所有貼「家人」的日記會改貼「家庭」。
  async function batchMergeInto(targetId) {
    if (!selectedForBatch.size) return;
    if (!targetId) { App.toast('請先選擇要合併到哪個標籤', 'error'); return; }
    const targetTag = getById(targetId);
    if (!targetTag) return;

    const sourceIds = [...selectedForBatch].filter(id => id !== targetId);
    if (!sourceIds.length) { App.toast('選取的標籤裡沒有可以合併的（跟目標標籤是同一個）', 'error'); return; }

    if (!confirm(`確定要把選取的 ${sourceIds.length} 個標籤都合併進「${targetTag.name}」嗎？\n\n這些標籤底下的日記會全部改貼「${targetTag.name}」，原本的標籤會被刪除，這個動作沒辦法復原。`)) return;

    App.showLoading('合併標籤中…');
    try {
      let totalCount = 0;
      for (const sourceId of sourceIds) {
        totalCount += await EntryManager.mergeTag(sourceId, targetId);
        await remove(sourceId);
      }
      selectedForBatch.clear();
      renderModal();
      App.toast(`已合併，共更新 ${totalCount} 篇日記 ✓`, 'success');
    } catch (e) {
      App.toast('合併失敗：' + e.message, 'error');
    } finally {
      App.hideLoading();
    }
  }

  // ── 匯入專用：取得或建立標籤（以預設顏色建立）──
  async function getOrCreate(name, parentId) {
    return await add(name, parentId || null, TAG_PALETTE[9]);
  }

  return {
    load, getAll, getFlat, getById, add, edit, remove, moveTag, renderModal, getOrCreate,
    getNewTagColor, toggleBatchMode, batchDelete, batchMove, batchMergeInto,
  };
})();
