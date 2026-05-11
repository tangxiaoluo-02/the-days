// ── 日記資料管理模組 ──
const EntryManager = (() => {
  let index = { entries: [] };   // 快速摘要索引
  let fullCache = new Map();     // 完整日記快取 { entryId -> entry }
  let driveIdMap = new Map();    // entryId -> drive file id

  // ── 初始化：從 Drive 載入索引 ──
  async function load() {
    index = await Drive.loadIndex();
    // 確保欄位存在
    if (!Array.isArray(index.entries)) index.entries = [];
    return index;
  }

  // ── 生成 UUID ──
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ── 從內容提取純文字（去 Markdown，保留換行）──
  function plainText(md) {
    return md
      .replace(/#{1,6}\s+/g, '')          // 移除標題 #
      .replace(/\*\*(.+?)\*\*/g, '$1')    // 移除粗體
      .replace(/\*(.+?)\*/g, '$1')        // 移除斜體
      .replace(/`(.+?)`/g, '$1')          // 移除行內程式碼
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // 移除連結，保留文字
      .replace(/^>\s+/gm, '')             // 移除引用符號
      .replace(/<[^>]+>/g, '')            // 移除 HTML 標籤
      .replace(/\r\n/g, '\n')             // 統一換行符
      .trim();
  }

  // ── 擷取預覽文字 ──
  function makePreview(content) {
    return plainText(content).slice(0, 120);
  }

  // ── 計算字數 ──
  function wordCount(content) {
    return plainText(content).replace(/\s+/g, '').length;
  }

  // ── 檢測超連結 ──
  function hasLinks(content) {
    return /https?:\/\/[^\s)>"]+/.test(content);
  }

  // ── 建立新日記（立即回應 + 背景上傳）──
  async function create(data) {
    const id  = uuid();
    const now = data.datetime || toLocalISOString(new Date());
    const photoFiles = data.photoFiles || [];

    // 為每張照片產生臨時 ID，blob URL 存入快取讓 UI 立即顯示
    const photos = photoFiles.map((file, i) => {
      const tempId  = `_tmp_${id}_${i}`;
      const blobUrl = URL.createObjectURL(file);
      Drive.registerBlobUrl(tempId, blobUrl);
      return { drive_file_id: tempId, filename: file.name, taken_at: file._exifTime || null };
    });

    const entry = {
      id, created_at: now, updated_at: now,
      content:   data.content  || '',
      photos,
      tags:      data.tags     || [],
      has_links: hasLinks(data.content || ''),
      has_photos: photos.length > 0,
      weather:   data.weather  || null,
      location:  data.location || null,
      word_count: wordCount(data.content || ''),
    };

    // ① 立即更新本機，讓 UI 馬上刷新
    fullCache.set(id, entry);
    index.entries.unshift(makeSummary(entry, null));

    // ② 背景上傳（不等待）
    _uploadInBackground(id, entry, photoFiles).catch(e => {
      console.error('背景同步失敗', e);
      App.toast('雲端同步失敗，請稍後重試', 'error');
    });

    return entry;
  }

  // ── 背景上傳：文字與照片各自獨立，互不影響 ──
  async function _uploadInBackground(id, entry, photoFiles) {

    // ▶ 任務 A：快速存文字（獨立執行，失敗不影響任務 B）
    _saveTextOnly(id, entry).catch(e =>
      console.warn('[背景] 文字預存失敗（不影響照片上傳）:', e)
    );

    // ▶ 任務 B：上傳照片 → 存完整 entry → 更新索引
    if (photoFiles.length === 0) {
      // 沒有照片，等任務 A 完成後就好
      try {
        await _saveTextOnly(id, entry);
        App.toast('已同步到雲端 ✓', 'success');
      } catch(e) {
        App.toast('同步失敗，請稍後重試', 'error');
      }
      return;
    }

    // 上傳每張照片
    const photos = [];
    for (let i = 0; i < photoFiles.length; i++) {
      const file      = photoFiles[i];
      const tempId    = `_tmp_${id}_${i}`;
      const yearMonth = entry.created_at.slice(0, 7);
      const driveId   = await Drive.uploadPhoto(file, yearMonth);
      Drive.renameBlobUrl(tempId, driveId);
      photos.push({
        drive_file_id: driveId,
        filename: file.name,
        taken_at: file._exifTime || null,
      });
    }

    // 存完整 entry（含照片真實 ID）
    const updated     = { ...entry, photos };
    const fileDriveId = await Drive.saveEntry(updated);
    driveIdMap.set(id, fileDriveId);
    fullCache.set(id, updated);

    // 更新索引
    const idx = index.entries.findIndex(e => e.id === id);
    if (idx >= 0) index.entries[idx] = makeSummary(updated, fileDriveId);
    await Drive.saveIndex(index);

    App.toast('已同步到雲端 ✓', 'success');
    App.refreshCurrentView();
  }

  // 只存文字（不含照片），讓重整頁面時至少文字不遺失
  async function _saveTextOnly(id, entry) {
    const textEntry   = { ...entry, photos: [], has_photos: false };
    const fileDriveId = await Drive.saveEntry(textEntry);
    driveIdMap.set(id, fileDriveId);
    const idx = index.entries.findIndex(e => e.id === id);
    if (idx >= 0) index.entries[idx] = makeSummary(textEntry, fileDriveId);
    await Drive.saveIndex(index);
  }

  // ── 更新日記 ──
  async function update(id, data) {
    let entry = fullCache.get(id);
    if (!entry) {
      const summary = index.entries.find(e => e.id === id);
      if (!summary) throw new Error('Entry not found');
      entry = await Drive.loadEntry(summary.drive_file_id);
      fullCache.set(id, entry);
    }

    // 處理新照片
    const newPhotos = [...entry.photos];
    for (const photoFile of (data.newPhotoFiles || [])) {
      const yearMonth = entry.created_at.slice(0, 7);
      const driveId = await Drive.uploadPhoto(photoFile, yearMonth);
      newPhotos.push({
        drive_file_id: driveId,
        filename: photoFile.name,
        taken_at: photoFile._exifTime || null,
      });
    }

    // 移除被刪掉的照片
    const keepIds = new Set(data.keepPhotoIds || newPhotos.map(p => p.drive_file_id));
    const filteredPhotos = newPhotos.filter(p => keepIds.has(p.drive_file_id));

    const updated = {
      ...entry,
      updated_at:  new Date().toISOString(),
      content:     data.content ?? entry.content,
      tags:        data.tags    ?? entry.tags,
      photos:      filteredPhotos,
      has_links:   hasLinks(data.content ?? entry.content),
      has_photos:  filteredPhotos.length > 0,
      weather:     data.weather  ?? entry.weather,
      location:    data.location ?? entry.location,
      word_count:  wordCount(data.content ?? entry.content),
      created_at:  data.datetime ?? entry.created_at,
    };

    const driveId = driveIdMap.get(id) || index.entries.find(e => e.id === id)?.drive_file_id;
    await Drive.saveEntry(updated);
    fullCache.set(id, updated);

    // 更新索引
    const idx = index.entries.findIndex(e => e.id === id);
    if (idx >= 0) index.entries[idx] = makeSummary(updated, driveId);
    // 重新排序（時間可能被修改）
    index.entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    await Drive.saveIndex(index);

    return updated;
  }

  // ── 刪除日記（移到回收桶） ──
  async function remove(id) {
    const entry = await getEntry(id);
    const summary = index.entries.find(e => e.id === id);
    const driveId = summary?.drive_file_id;

    await Drive.moveToTrash(entry, driveId);

    index.entries = index.entries.filter(e => e.id !== id);
    await Drive.saveIndex(index);
    fullCache.delete(id);
    driveIdMap.delete(id);
  }

  // ── 取得完整日記 ──
  async function getEntry(id) {
    if (fullCache.has(id)) return fullCache.get(id);
    const summary = index.entries.find(e => e.id === id);
    if (!summary) throw new Error('Entry not found');
    const entry = await Drive.loadEntry(summary.drive_file_id);
    fullCache.set(id, entry);
    return entry;
  }

  // ── 取得索引摘要（所有） ──
  function getIndex() {
    return index.entries;
  }

  // ── 建立摘要物件 ──
  function makeSummary(entry, driveId) {
    return {
      id: entry.id,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      preview: makePreview(entry.content),
      has_photos: entry.has_photos,
      has_links:  entry.has_links,
      tags:       entry.tags,
      word_count: entry.word_count,
      weather:    entry.weather,
      location:   entry.location,
      first_photo: entry.photos[0]?.drive_file_id || null,
      drive_file_id: driveId,
    };
  }

  return { load, create, update, remove, getEntry, getIndex };
})();
