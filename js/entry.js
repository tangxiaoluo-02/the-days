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

  // ── 從內容提取純文字（去 Markdown） ──
  function plainText(md) {
    return md
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/^>\s+/gm, '')
      .replace(/<[^>]+>/g, '')
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

  // ── 建立新日記 ──
  async function create(data) {
    const id = uuid();
    const now = data.datetime || new Date().toISOString();

    // 上傳照片
    const photos = [];
    for (const photoFile of (data.photoFiles || [])) {
      const yearMonth = now.slice(0, 7);
      const driveId = await Drive.uploadPhoto(photoFile, yearMonth);
      photos.push({
        drive_file_id: driveId,
        filename: photoFile.name,
        taken_at: photoFile._exifTime || null,
      });
    }

    const entry = {
      id,
      created_at: now,
      updated_at: now,
      content: data.content || '',
      photos,
      tags: data.tags || [],
      has_links: hasLinks(data.content || ''),
      has_photos: photos.length > 0,
      weather: data.weather || null,
      location: data.location || null,
      word_count: wordCount(data.content || ''),
    };

    // 儲存完整 entry 到 Drive
    const driveId = await Drive.saveEntry(entry);
    driveIdMap.set(id, driveId);
    fullCache.set(id, entry);

    // 更新索引
    const summary = makeSummary(entry, driveId);
    index.entries.unshift(summary);
    await Drive.saveIndex(index);

    return entry;
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
