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
    // 子標籤一起刪除
    const children = tags.filter(t => t.parent_id === id);
    const toDelete = new Set([id, ...children.map(c => c.id)]);
    tags = tags.filter(t => !toDelete.has(t.id));
    await save();
  }

  // ── 渲染標籤管理 Modal ──
  function renderModal() {
    // 更新父標籤下拉
    const sel = document.getElementById('new-tag-parent');
    sel.innerHTML = '<option value="">（頂層標籤）</option>';
    for (const t of tags.filter(t => !t.parent_id)) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }

    // 渲染樹
    const tree = document.getElementById('tags-tree');
    tree.innerHTML = '';
    for (const tag of getFlat()) {
      tree.appendChild(renderTagRow(tag));
    }
  }

  function renderTagRow(tag) {
    const row = document.createElement('div');
    row.className = 'tag-tree-item' + (tag._depth ? ' child' : '');

    const dot = document.createElement('span');
    dot.className = 'tag-color-dot';
    dot.style.background = tag.color;
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.display = 'inline-block';
    dot.style.marginRight = '4px';

    const name = document.createElement('span');
    name.textContent = tag.name;

    const actions = document.createElement('div');
    actions.className = 'tag-tree-actions';

    // 編輯
    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️';
    editBtn.title = '編輯';
    editBtn.onclick = async () => {
      const newName  = prompt('標籤名稱', tag.name);
      if (!newName) return;
      const newColor = prompt('標籤顏色 (hex)', tag.color) || tag.color;
      await edit(tag.id, newName, newColor);
      renderModal();
    };

    // 刪除
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑️';
    delBtn.className = 'del-btn';
    delBtn.title = '刪除';
    delBtn.onclick = async () => {
      const hasChildren = tags.some(t => t.parent_id === tag.id);
      const msg = hasChildren ? `刪除「${tag.name}」及其所有子標籤？` : `刪除標籤「${tag.name}」？`;
      if (!confirm(msg)) return;
      await remove(tag.id);
      renderModal();
    };

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(actions);
    return row;
  }

  return { load, getAll, getFlat, getById, add, edit, remove, renderModal };
})();
