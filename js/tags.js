// ── 標籤管理模組 ──
const TagManager = (() => {
  let tags = [];  // 扁平陣列，含 parent_id

  async function load() {
    const data = await Drive.loadTags();
    tags = data.tags || [];
  }

  async function save() {
    await Drive.saveTags({ tags });
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
    // 防呆：同名同層不重複建立
    const existing = tags.find(t =>
      t.name === name && t.parent_id === (parentId || null)
    );
    if (existing) return existing.id;

    const id = 'tag_' + Date.now();
    const order = tags.filter(t => t.parent_id === (parentId || null)).length;
    tags.push({ id, name, parent_id: parentId || null, color: color || '#8B6914', order });
    await save();
    return id;
  }

  async function edit(id, name, color) {
    const tag = tags.find(t => t.id === id);
    if (!tag) return;
    tag.name  = name;
    tag.color = color;
    await save();
  }

  async function remove(id) {
    const children = tags.filter(t => t.parent_id === id);
    const toDelete = new Set([id, ...children.map(c => c.id)]);
    tags = tags.filter(t => !toDelete.has(t.id));
    await save();
  }

  // ── 排序（同層級內上移/下移）──
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

  // ── 渲染標籤管理 Modal ──
  function renderModal() {
    // 更新父標籤下拉
    const sel = document.getElementById('new-tag-parent');
    sel.innerHTML = '<option value="">（頂層標籤）</option>';
    for (const t of tags.filter(t => !t.parent_id).sort((a,b) => a.order - b.order)) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }

    const tree = document.getElementById('tags-tree');
    tree.innerHTML = '';

    const roots = tags.filter(t => !t.parent_id).sort((a,b) => a.order - b.order);
    for (const root of roots) {
      tree.appendChild(renderTagGroup(root));
    }
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
    // 子標籤新增列
    const addChildRow = document.createElement('div');
    addChildRow.className = 'tag-add-child';
    const addChildInput = document.createElement('input');
    addChildInput.type = 'text';
    addChildInput.placeholder = `新增「${root.name}」的子標籤…`;
    addChildInput.style.cssText = 'flex:1;border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px;outline:none';
    const addChildColor = document.createElement('input');
    addChildColor.type = 'color';
    addChildColor.value = root.color;
    addChildColor.style.cssText = 'width:28px;height:28px;border:none;border-radius:4px;cursor:pointer;padding:0';
    const addChildBtn = document.createElement('button');
    addChildBtn.textContent = '＋';
    addChildBtn.style.cssText = 'padding:3px 10px;background:var(--primary);color:#fff;border-radius:4px;font-size:13px';
    addChildBtn.onclick = async () => {
      const name = addChildInput.value.trim();
      if (!name) return;
      await add(name, root.id, addChildColor.value);
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
    addChildRow.appendChild(addChildColor);
    addChildRow.appendChild(addChildBtn);
    childWrap.appendChild(addChildRow);
    group.appendChild(childWrap);
    return group;
  }

  // ── 渲染單一標籤列 ──
  function renderTagRow(tag, isChild, hasChildren) {
    const row = document.createElement('div');
    row.className = 'tag-tree-item' + (isChild ? ' child' : '');
    row.dataset.id = tag.id;

    // 顏色點
    const dot = document.createElement('span');
    dot.className = 'tag-color-dot-lg';
    dot.style.background = tag.color;

    // 名稱
    const name = document.createElement('span');
    name.className = 'tag-item-name';
    name.textContent = tag.name;

    // 展開/折疊（主標籤才有）
    let toggleBtn = null;
    if (!isChild) {
      toggleBtn = document.createElement('button');
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
    }

    const actions = document.createElement('div');
    actions.className = 'tag-tree-actions';

    // 上移
    const upBtn = makeIconBtn('↑', '往上移', () => moveTag(tag.id, -1));
    // 下移
    const dnBtn = makeIconBtn('↓', '往下移', () => moveTag(tag.id, 1));
    // 編輯（inline）
    const editBtn = makeIconBtn('✏️', '編輯', () => startInlineEdit(row, tag, isChild, hasChildren));
    // 刪除
    const delBtn = makeIconBtn('🗑️', '刪除', async () => {
      const hasKids = tags.some(t => t.parent_id === tag.id);
      if (!confirm(hasKids ? `刪除「${tag.name}」及其所有子標籤？` : `刪除標籤「${tag.name}」？`)) return;
      await remove(tag.id);
      renderModal();
    });
    delBtn.className += ' del-btn';

    actions.appendChild(upBtn);
    actions.appendChild(dnBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(dot);
    row.appendChild(name);
    if (toggleBtn) row.appendChild(toggleBtn);
    row.appendChild(actions);
    return row;
  }

  function makeIconBtn(text, title, onclick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.title = title;
    btn.onclick = onclick;
    return btn;
  }

  // ── Inline 編輯 ──
  function startInlineEdit(row, tag, isChild, hasChildren) {
    row.innerHTML = '';
    row.className = 'tag-tree-item tag-item-editing' + (isChild ? ' child' : '');

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = tag.name;
    nameInput.className = 'tag-edit-name';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = tag.color;
    colorInput.className = 'tag-edit-color';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '✓';
    saveBtn.className = 'tag-edit-save';
    saveBtn.onclick = async () => {
      const newName = nameInput.value.trim() || tag.name;
      await edit(tag.id, newName, colorInput.value);
      renderModal();
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✗';
    cancelBtn.className = 'tag-edit-cancel';
    cancelBtn.onclick = () => renderModal();

    row.appendChild(nameInput);
    row.appendChild(colorInput);
    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);
    nameInput.focus();
    nameInput.select();
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });
  }

  // ── 匯入專用：取得或建立標籤（以預設顏色建立）──
  async function getOrCreate(name, parentId) {
    return await add(name, parentId || null, '#8B6914');
  }

  return { load, getAll, getFlat, getById, add, edit, remove, moveTag, renderModal, getOrCreate };
})();
