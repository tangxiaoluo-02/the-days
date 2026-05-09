// ── 日記編輯器模組 ──
const Editor = (() => {
  let editingId    = null;   // null = 新增，有值 = 編輯
  let pendingPhotos = [];    // { file, previewUrl, exifTime }
  let keepPhotoIds  = [];    // 編輯時保留的舊照片 drive_file_id
  let selectedTags  = [];    // 已選擇的 tag id

  const textarea   = () => document.getElementById('entry-content');
  const preview    = () => document.getElementById('entry-preview');
  const photoList  = () => document.getElementById('photo-list');
  const dateInput  = () => document.getElementById('entry-datetime');

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

    // 渲染標籤選擇
    renderSelectedTags();

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

      const previewUrl = URL.createObjectURL(file);
      pendingPhotos.push({ file, previewUrl, exifTime });
      addNewPhotoThumb(file, previewUrl, exifTime);
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

  function addNewPhotoThumb(file, previewUrl, exifTime) {
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

    wrap.appendChild(img);
    wrap.appendChild(rm);
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

  function openTagPicker() {
    const picker = document.getElementById('tag-picker');
    picker.classList.toggle('hidden');
    if (!picker.classList.contains('hidden')) renderTagPicker();
  }

  function renderTagPicker() {
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
  }

  // ── 儲存 ──
  async function save() {
    const content  = textarea().value.trim();
    const datetime = new Date(dateInput().value).toISOString();

    App.showLoading('儲存日記中…');
    try {
      const data = {
        content,
        datetime,
        tags:           selectedTags,
        photoFiles:     pendingPhotos.map(p => p.file),
        newPhotoFiles:  pendingPhotos.map(p => p.file),
        keepPhotoIds,
        weather:        Editor._pendingWeather,
        location:       Editor._pendingLocation,
      };

      if (editingId) {
        await EntryManager.update(editingId, data);
        App.toast('日記已更新 ✓', 'success');
      } else {
        await EntryManager.create(data);
        App.toast('日記已儲存 ✓', 'success');
      }

      closeModal('editor-modal');
      App.refreshCurrentView();
    } catch (e) {
      App.toast('儲存失敗：' + e.message, 'error');
    } finally {
      App.hideLoading();
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
