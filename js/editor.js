// ── 日記編輯器模組 ──
const Editor = (() => {
  let editingId    = null;   // null = 新增，有值 = 編輯
  let pendingPhotos = [];    // { file, previewUrl, exifTime, compress }
  let keepPhotoIds  = [];    // 編輯時保留的舊照片 drive_file_id
  let selectedTags  = [];    // 已選擇的 tag id

  const textarea   = () => document.getElementById('entry-content');
  const preview    = () => document.getElementById('entry-preview');
  const photoList  = () => document.getElementById('photo-list');
  const dateInput  = () => document.getElementById('entry-datetime');

  // ── 草稿自動暫存（存在本機瀏覽器，寫沒存也不怕遺失）──
  const DRAFT_KEY = 'td_draft';
  let draftDebounceTimer  = null;
  let draftHandlerBound   = false;

  function loadMatchingDraft(forEditingId) {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      // editingId 一致（同一篇編輯中，或都是「新增」）才還原，避免草稿張冠李戴
      return (draft.editingId === forEditingId) ? draft : null;
    } catch (e) { return null; }
  }

  function saveDraftNow() {
    const content = textarea().value;
    if (!content.trim()) { clearDraft(); return; }
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        editingId, content,
        datetime: dateInput().value,
        tags: selectedTags,
        savedAt: Date.now(),
      }));
    } catch (e) { /* 儲存空間滿等例外，忽略即可，不影響編輯 */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  function bindDraftAutoSave() {
    if (draftHandlerBound) return;
    draftHandlerBound = true;
    textarea().addEventListener('input', () => {
      clearTimeout(draftDebounceTimer);
      draftDebounceTimer = setTimeout(saveDraftNow, 1500);
    });
  }

  // ── 開啟編輯器 ──
  async function open(entry = null) {
    editingId    = entry?.id || null;
    pendingPhotos = [];
    keepPhotoIds  = [];
    selectedTags  = entry ? [...(entry.tags || [])] : [];

    document.getElementById('editor-title').textContent = entry ? '編輯日記' : '新增日記';

    // 設定時間
    const now = entry ? new Date(entry.created_at) : new Date();
    dateInput().value = toLocalDatetimeString(now);

    // 設定內容
    textarea().value = entry?.content || '';
    preview().innerHTML = '';
    preview().classList.add('hidden');
    textarea().classList.remove('hidden');
    document.getElementById('preview-toggle-btn').title = '切換預覽';

    // 清空照片
    photoList().innerHTML = '';

    // 載入舊照片（編輯模式）
    if (entry && entry.photos?.length) {
      for (const photo of entry.photos) {
        keepPhotoIds.push(photo.drive_file_id);
        addOldPhotoThumb(photo);
      }
    }

    // 還原未儲存的草稿（同一篇 / 同樣是新增才還原）
    const draft = loadMatchingDraft(editingId);
    if (draft) {
      textarea().value = draft.content;
      if (draft.datetime) dateInput().value = draft.datetime;
      if (draft.tags) selectedTags = [...draft.tags];
      setTimeout(() => App.toast('已還原上次未儲存的草稿 📝', ''), 150);
    }

    // 渲染標籤選擇
    renderSelectedTags();
    bindDraftAutoSave();

    // 天氣/位置
    document.getElementById('weather-info').textContent = entry?.weather
      ? `${entry.weather.icon} ${entry.weather.condition} ${entry.weather.temperature}°C`
      : '—';
    document.getElementById('location-info').textContent = entry?.location?.name || '—';

    // 儲存暫存的天氣/位置（編輯時保留）
    Editor._pendingWeather  = entry?.weather  || null;
    Editor._pendingLocation = entry?.location || null;

    openModal('editor-modal');
    textarea().focus();
  }

  // ── 轉換時間為 <input datetime-local> 格式 ──
  function toLocalDatetimeString(date) {
    const d = new Date(date);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ── 重設時間為現在 ──
  function resetTime() {
    dateInput().value = toLocalDatetimeString(new Date());
  }

  // ── Markdown 工具列 ──
  function applyFormat(action) {
    const ta = textarea();
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const sel   = ta.value.slice(start, end);

    const wrap = (before, after = before) => {
      const text = sel || '文字';
      insertAt(ta, start, end, `${before}${text}${after}`);
    };
    const linePrefix = (prefix) => {
      const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
      ta.setSelectionRange(lineStart, lineStart);
      insertAt(ta, lineStart, lineStart, prefix);
    };

    switch (action) {
      case 'bold':    wrap('**'); break;
      case 'italic':  wrap('*');  break;
      case 'heading': linePrefix('## '); break;
      case 'ul':      linePrefix('- '); break;
      case 'ol':      linePrefix('1. '); break;
      case 'quote':   linePrefix('> '); break;
      case 'hr':      insertAt(ta, start, end, '\n---\n'); break;
      case 'preview': togglePreview(); break;
    }
  }

  function insertAt(ta, start, end, text) {
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + text.length, start + text.length);
  }

  // ── 文字顏色 ──
  function applyColor(color) {
    const ta = textarea();
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const sel   = ta.value.slice(start, end) || '文字';
    const html  = `<span style="color:${color}">${sel}</span>`;
    insertAt(ta, start, end, html);
  }

  // ── # Mention（已停用，保留備用）──
  function bindMentionTrigger() {
    // 取消 # 觸發，避免與 Markdown 標題語法衝突
    return;
  }
  function _mentionTrigger_unused() {
    const ta = textarea();
    ta.addEventListener('input', onMentionInput);
    ta.addEventListener('keydown', onMentionKeydown);
    document.addEventListener('click', hideMention);
  }

  function onMentionInput() {
    const ta = textarea();
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const match = before.match(/#([^#\n]*)$/);
    if (match) {
      mentionStart = pos - match[0].length;
      showMention(match[1]);
    } else {
      hideMention();
    }
  }

  function onMentionKeydown(e) {
    const picker = document.getElementById('mention-picker');
    if (picker.classList.contains('hidden')) return;
    const items = picker.querySelectorAll('.mention-item');
    let active = picker.querySelector('.mention-item.active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!active) { items[0]?.classList.add('active'); return; }
      active.classList.remove('active');
      const next = active.nextElementSibling;
      (next?.classList.contains('mention-item') ? next : items[0])?.classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!active) { items[items.length-1]?.classList.add('active'); return; }
      active.classList.remove('active');
      const prev = active.previousElementSibling;
      (prev?.classList.contains('mention-item') ? prev : items[items.length-1])?.classList.add('active');
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.click();
    } else if (e.key === 'Escape') {
      hideMention();
    }
  }

  function showMention(query) {
    const picker = document.getElementById('mention-picker');
    picker.innerHTML = '';
    const all = TagManager.getFlat();
    const filtered = query
      ? all.filter(t => t.name.toLowerCase().includes(query.toLowerCase()))
      : all;

    if (!filtered.length && !query) {
      const empty = document.createElement('div');
      empty.className = 'mention-empty';
      empty.textContent = '尚無標籤';
      picker.appendChild(empty);
    }

    for (const tag of filtered.slice(0, 8)) {
      const item = document.createElement('div');
      item.className = 'mention-item';
      const dot = document.createElement('span');
      dot.className = 'tag-color-dot';
      dot.style.background = tag.color;
      const name = document.createElement('span');
      name.textContent = '#' + tag.name;
      item.appendChild(dot);
      item.appendChild(name);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertMention(tag);
      });
      picker.appendChild(item);
    }

    // 若沒有完全匹配，提供「建立新標籤」
    if (query && !all.find(t => t.name === query)) {
      const create = document.createElement('div');
      create.className = 'mention-create';
      create.textContent = `＋ 建立標籤「${query}」`;
      create.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        const id = await TagManager.add(query, null, '#2E6E96');
        const newTag = TagManager.getAll().find(t => t.id === id);
        if (newTag) insertMention(newTag);
      });
      picker.appendChild(create);
    }

    // 定位選取器在游標附近
    const ta = textarea();
    const rect = ta.getBoundingClientRect();
    picker.style.left = rect.left + 'px';
    picker.style.top  = (rect.bottom + 4) + 'px';
    picker.classList.remove('hidden');
  }

  function hideMention() {
    document.getElementById('mention-picker').classList.add('hidden');
    mentionStart = -1;
  }

  function insertMention(tag) {
    const ta = textarea();
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, mentionStart);
    const after  = ta.value.slice(pos);
    ta.value = before + '#' + tag.name + ' ' + after;
    ta.selectionStart = ta.selectionEnd = mentionStart + tag.name.length + 2;
    if (!selectedTags.includes(tag.id)) {
      selectedTags.push(tag.id);
      renderSelectedTags();
    }
    hideMention();
    ta.focus();
  }

  // ── 切換預覽 ──
  function togglePreview() {
    const isPreview = !preview().classList.contains('hidden');
    if (isPreview) {
      preview().classList.add('hidden');
      textarea().classList.remove('hidden');
      document.getElementById('preview-toggle-btn').title = '切換預覽';
    } else {
      const md = textarea().value;
      preview().innerHTML = renderMarkdown(md);
      textarea().classList.add('hidden');
      preview().classList.remove('hidden');
      document.getElementById('preview-toggle-btn').title = '回到編輯';
    }
  }

  // ── Markdown 渲染（含超連結自動偵測） ──
  function renderMarkdown(text) {
    // 先把純 URL 轉成 Markdown link（避免重複處理 [text](url) 格式）
    const withLinks = text.replace(
      /(?<!\()(https?:\/\/[^\s)>"']+)/g,
      (url) => `[${url}](${url})`
    );
    return marked.parse(withLinks, { breaks: true, gfm: true });
  }

  // ── 照片壓縮：逐步縮小直到 ≤ 1MB ──
  const COMPRESS_TARGET = 1 * 1024 * 1024; // 1MB

  async function compressImage(file) {
    // 已經夠小就跳過
    if (file.size <= COMPRESS_TARGET) return file;

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        const srcW = img.width, srcH = img.height;
        const aspect = srcW / srcH;

        // 從大到小嘗試，直到輸出 ≤ 1MB
        const steps = [
          { maxW: 1920, quality: 0.85 },
          { maxW: 1280, quality: 0.82 },
          { maxW: 960,  quality: 0.78 },
          { maxW: 640,  quality: 0.75 },
          { maxW: 640,  quality: 0.60 }, // 保底
        ];

        for (const step of steps) {
          const w = Math.min(srcW, step.maxW);
          const h = Math.round(w / aspect);

          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);

          const blob = await new Promise(res =>
            canvas.toBlob(res, 'image/webp', step.quality)
          );

          if (blob && blob.size <= COMPRESS_TARGET) {
            const out = new File(
              [blob],
              file.name.replace(/\.[^.]+$/, '.webp'),
              { type: 'image/webp' }
            );
            out._exifTime = file._exifTime;
            resolve(out);
            return;
          }
        }

        // 理論上不會跑到這裡，但以防萬一
        resolve(file);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  // ── 照片上傳 ──
  async function handlePhotoInput(files) {
    for (const file of files) {
      let exifTime = null;
      try {
        const exif = await exifr.parse(file, ['DateTimeOriginal']);
        if (exif?.DateTimeOriginal) {
          exifTime = exif.DateTimeOriginal.toISOString();
        }
      } catch (e) { /* 無 EXIF */ }

      file._exifTime = exifTime;

      // 壓縮照片再使用
      const previewUrl = URL.createObjectURL(file);
      const entry = { file, previewUrl, exifTime, compress: true }; // 預設壓縮
      pendingPhotos.push(entry);
      addNewPhotoThumb(entry);
    }

    // 如果有 EXIF 時間，詢問是否使用第一張
    const firstExif = pendingPhotos.find(p => p.exifTime);
    if (firstExif && !editingId) {
      const use = confirm(`偵測到照片拍攝時間：${formatDatetime(firstExif.exifTime)}\n是否以此作為日記創建時間？`);
      if (use) {
        dateInput().value = toLocalDatetimeString(new Date(firstExif.exifTime));
      }
    }
  }

  function addNewPhotoThumb(entry) {
    const { file, previewUrl, exifTime } = entry;
    const wrap = document.createElement('div');
    wrap.className = 'photo-preview-wrap';
    wrap.dataset.key = previewUrl;

    const img = document.createElement('img');
    img.className = 'photo-preview';
    img.src = previewUrl;
    if (exifTime) img.title = `拍攝時間：${formatDatetime(exifTime)}`;

    const rm = document.createElement('div');
    rm.className = 'photo-remove';
    rm.textContent = '✕';
    rm.onclick = () => {
      pendingPhotos = pendingPhotos.filter(p => p.previewUrl !== previewUrl);
      wrap.remove();
    };

    // 壓縮 / 原檔切換按鈕
    const qualityToggle = document.createElement('div');
    qualityToggle.className = 'photo-quality-toggle';
    qualityToggle.title = '點擊切換壓縮/原檔';
    qualityToggle.textContent = '壓縮';
    qualityToggle.dataset.compress = 'true';
    qualityToggle.onclick = () => {
      const isCompress = qualityToggle.dataset.compress === 'true';
      qualityToggle.dataset.compress = isCompress ? 'false' : 'true';
      qualityToggle.textContent = isCompress ? '原檔' : '壓縮';
      qualityToggle.classList.toggle('original', isCompress);
      entry.compress = !isCompress;
    };

    wrap.appendChild(img);
    wrap.appendChild(rm);
    wrap.appendChild(qualityToggle);
    photoList().appendChild(wrap);
  }

  function addOldPhotoThumb(photo) {
    const wrap = document.createElement('div');
    wrap.className = 'photo-preview-wrap';
    wrap.dataset.driveId = photo.drive_file_id;

    const img = document.createElement('img');
    img.className = 'photo-preview';
    img.src = '';
    img.style.background = 'var(--surface-2)';
    // 懶載入
    Drive.getPhotoUrl(photo.drive_file_id).then(url => { img.src = url; });

    const rm = document.createElement('div');
    rm.className = 'photo-remove';
    rm.textContent = '✕';
    rm.onclick = () => {
      keepPhotoIds = keepPhotoIds.filter(id => id !== photo.drive_file_id);
      wrap.remove();
    };

    wrap.appendChild(img);
    wrap.appendChild(rm);
    photoList().appendChild(wrap);
  }

  // ── 標籤相關 ──
  function renderSelectedTags() {
    const container = document.getElementById('selected-tags');
    container.innerHTML = '';
    const allTags = TagManager.getAll();
    for (const tagId of selectedTags) {
      const tag = allTags.find(t => t.id === tagId);
      if (!tag) continue;
      const chip = makeTagChip(tag, true);
      container.appendChild(chip);
    }
  }

  function makeTagChip(tag, removable = false) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.style.background = tag.color + '22';
    chip.style.color = tag.color;
    chip.style.border = `1px solid ${tag.color}44`;

    const dot = document.createElement('span');
    dot.className = 'tag-color-dot';
    dot.style.background = tag.color;
    chip.appendChild(dot);

    const name = document.createElement('span');
    name.textContent = tag.name;
    chip.appendChild(name);

    if (removable) {
      const x = document.createElement('span');
      x.className = 'tag-x';
      x.textContent = '✕';
      x.onclick = () => {
        selectedTags = selectedTags.filter(id => id !== tag.id);
        renderSelectedTags();
      };
      chip.appendChild(x);
    }
    return chip;
  }

  // 改用智慧標籤選取器
  function openTagPicker() {
    SmartTagPicker.open(
      document.getElementById('add-tag-btn'),
      selectedTags,
      (newIds) => {
        selectedTags = newIds;
        renderSelectedTags();
      }
    );
  }

  // 舊版 tag-picker（保留供向後相容）
  function _renderTagPicker_unused() {
    const picker = document.getElementById('tag-picker');
    picker.innerHTML = '';
    const flat = TagManager.getFlat();
    for (const tag of flat) {
      const item = document.createElement('div');
      item.className = 'tag-picker-item' + (selectedTags.includes(tag.id) ? ' selected' : '');
      item.style.paddingLeft = tag._depth ? `${8 + tag._depth * 12}px` : '8px';

      const dot = document.createElement('span');
      dot.className = 'tag-color-dot';
      dot.style.background = tag.color;
      item.appendChild(dot);

      const name = document.createElement('span');
      name.textContent = tag.name;
      item.appendChild(name);

      item.onclick = () => {
        if (selectedTags.includes(tag.id)) {
          selectedTags = selectedTags.filter(id => id !== tag.id);
          item.classList.remove('selected');
        } else {
          selectedTags.push(tag.id);
          item.classList.add('selected');
        }
        renderSelectedTags();
      };
      picker.appendChild(item);
    }

    // 直接新增標籤的快速輸入列
    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:4px;padding:6px 4px;border-top:1px solid var(--border);margin-top:4px';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '新增標籤…';
    input.style.cssText = 'flex:1;border:1px solid var(--border);border-radius:4px;padding:3px 7px;font-size:12px;outline:none';
    const addBtn = document.createElement('button');
    addBtn.textContent = '＋';
    addBtn.style.cssText = 'padding:3px 8px;background:var(--primary);color:#fff;border-radius:4px;font-size:13px';
    addBtn.onclick = async (e) => {
      e.stopPropagation();
      const name = input.value.trim();
      if (!name) return;
      const id = await TagManager.add(name, null, '#2E6E96');
      selectedTags.push(id);
      input.value = '';
      renderTagPicker();
      renderSelectedTags();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
    });
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    picker.appendChild(addRow);
  }

  // ── 儲存 ──
  async function save() {
    const content  = textarea().value.trim();
    // 手動解析 datetime-local 值（避免瀏覽器 UTC 解析差異）
    const [datePart, timePart] = dateInput().value.split('T');
    const [dy, dm, dd]  = datePart.split('-').map(Number);
    const [dh, dmin]    = timePart.split(':').map(Number);
    const datetime = toLocalISOString(new Date(dy, dm - 1, dd, dh, dmin, 0));
    const processedPhotos = await Promise.all(pendingPhotos.map(p => p.compress ? compressImage(p.file) : p.file));
    const data = {
      content, datetime,
      tags:          selectedTags,
      photoFiles:    processedPhotos, // 新增日記用
      newPhotoFiles: processedPhotos, // 編輯日記用
      keepPhotoIds,
      weather:       Editor._pendingWeather,
      location:      Editor._pendingLocation,
    };

    // 新增／編輯都一樣：立即關閉、立即顯示，照片在背景上傳
    try {
      if (editingId) {
        await EntryManager.update(editingId, data);
      } else {
        await EntryManager.create(data);
      }
    } catch (e) {
      App.toast((editingId ? '更新失敗：' : '儲存失敗：') + e.message, 'error');
      return;
    }

    clearDraft(); // 存成功了，草稿就不需要了
    closeModal('editor-modal');
    App.refreshCurrentView();
    if (pendingPhotos.length > 0) {
      App.toast((editingId ? '日記已更新，照片上傳中… ⏫' : '日記已儲存，照片上傳中… ⏫'), '');
    } else {
      App.toast((editingId ? '日記已更新 ✓' : '日記已儲存 ✓'), 'success');
    }
  }

  // ── 輔助 ──
  function formatDatetime(iso) {
    return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  }

  return {
    open,
    save,
    resetTime,
    applyFormat,
    applyColor,
    handlePhotoInput,
    openTagPicker,
    renderMarkdown,
    makeTagChip,
    _pendingWeather:  null,
    _pendingLocation: null,
  };
})();
