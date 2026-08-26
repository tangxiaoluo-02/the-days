// ── 日記資料管理模組 ──
const EntryManager = (() => {
  let index = { entries: [], day_moods: {} };   // 快速摘要索引 + 每日心情（跟日記本身脫鉤，key 是 "YYYY-MM-DD"）
  let fullCache = new Map();     // 完整日記快取 { entryId -> entry }
  let driveIdMap = new Map();    // entryId -> drive file id
  let loadPromise = null;        // 追蹤 load() 進度，讓寫入操作可以安全等它完成再動手

  // ── 初始化：從 Drive 載入索引（重複呼叫只會真的跑一次，避免後面的呼叫把
  //    前面已經寫入的新日記蓋掉——這是殿下能「連線中也能立刻寫」的關鍵）──
  function load() {
    if (loadPromise) return loadPromise; // 已經在跑或跑完了，直接沿用同一份，不要重新抓一次
    loadPromise = (async () => {
      index = await Drive.loadIndex();
      // 確保欄位存在
      if (!Array.isArray(index.entries)) index.entries = [];
      if (!index.day_moods || typeof index.day_moods !== 'object') index.day_moods = {};
      return index;
    })();
    // 失敗的話清掉，讓之後的寫入操作有機會重新嘗試載入
    loadPromise.catch(() => { loadPromise = null; });
    return loadPromise;
  }

  // 確保 index 已經是從雲端載入的最新版本，才動手寫入——
  // 避免「殿下在資料還沒載完時就新增日記」導致稍後 load() 完成時把剛寫的東西覆蓋掉
  async function ensureLoaded() {
    await load();
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
      .replace(/!?\[(.*?)\]\([^)]*\)/g, '$1') // 移除連結/圖片語法，保留文字（.*? 才吃得到空白alt文字 ![]()）
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
    await ensureLoaded(); // 確保雲端索引已經載入完成，才動手寫，避免被稍後才完成的 load() 蓋掉
    const id  = uuid();
    const now = data.datetime || toLocalISOString(new Date());
    const photoFiles = data.photoFiles || [];
    const videoFiles = data.videoFiles || [];

    // 為每張照片產生臨時 ID，blob URL 存入快取讓 UI 立即顯示
    const photos = photoFiles.map((file, i) => {
      const tempId  = `_tmp_${id}_${i}`;
      const blobUrl = URL.createObjectURL(file);
      Drive.registerBlobUrl(tempId, blobUrl);
      return { drive_file_id: tempId, filename: file.name, taken_at: file._exifTime || null };
    });
    // 影片跟照片同一套「臨時ID+blob URL立即顯示」邏輯
    const videos = videoFiles.map((file, i) => {
      const tempId  = `_tmpv_${id}_${i}`;
      const blobUrl = URL.createObjectURL(file);
      Drive.registerBlobUrl(tempId, blobUrl);
      return { drive_file_id: tempId, filename: file.name };
    });

    const entry = {
      id, created_at: now, updated_at: now,
      content:   data.content  || '',
      photos,
      videos,
      tags:      data.tags     || [],
      has_links: hasLinks(data.content || ''),
      has_photos: photos.length > 0,
      has_videos: videos.length > 0,
      weather:   data.weather  || null,
      location:  data.location || null,
      word_count: wordCount(data.content || ''),
    };

    // ① 立即更新本機，讓 UI 馬上刷新
    fullCache.set(id, entry);
    index.entries.unshift(makeSummary(entry, null));
    // 補記過去日期時，不能只塞在最前面，要照日記時間重新排序
    index.entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // ② 背景上傳（不等待）
    _uploadInBackground(id, entry, photoFiles, videoFiles).catch(e => {
      console.error('背景同步失敗', e);
      App.toast('雲端同步失敗，請稍後重試', 'error');
    });

    return entry;
  }

  // ── 背景上傳：文字與照片/影片各自獨立，互不影響 ──
  async function _uploadInBackground(id, entry, photoFiles, videoFiles) {

    // ▶ 任務 A：快速存文字（獨立執行，失敗不影響任務 B）
    _saveTextOnly(id, entry).catch(e =>
      console.warn('[背景] 文字預存失敗（不影響照片上傳）:', e)
    );

    // ▶ 任務 B：上傳照片／影片 → 存完整 entry → 更新索引
    if (photoFiles.length === 0 && videoFiles.length === 0) {
      // 沒有照片影片，等任務 A 完成後就好
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

    // 上傳每支影片（不壓縮，原檔上傳）
    const videos = [];
    for (let i = 0; i < videoFiles.length; i++) {
      const file      = videoFiles[i];
      const tempId    = `_tmpv_${id}_${i}`;
      const yearMonth = entry.created_at.slice(0, 7);
      const driveId   = await Drive.uploadVideo(file, yearMonth);
      Drive.renameBlobUrl(tempId, driveId);
      videos.push({ drive_file_id: driveId, filename: file.name });
    }

    // 存完整 entry（含照片/影片真實 ID）
    const updated     = { ...entry, photos, videos };
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

  // 只存文字（不含照片/影片），讓重整頁面時至少文字不遺失
  async function _saveTextOnly(id, entry) {
    const textEntry   = { ...entry, photos: [], videos: [], has_photos: false, has_videos: false };
    const fileDriveId = await Drive.saveEntry(textEntry);
    driveIdMap.set(id, fileDriveId);
    const idx = index.entries.findIndex(e => e.id === id);
    if (idx >= 0) index.entries[idx] = makeSummary(textEntry, fileDriveId);
    await Drive.saveIndex(index);
  }

  // ── 更新日記（立即回應 + 背景上傳，跟 create 同一套邏輯）──
  async function update(id, data) {
    await ensureLoaded();
    let entry = fullCache.get(id);
    if (!entry) {
      const summary = index.entries.find(e => e.id === id);
      if (!summary) throw new Error('Entry not found');
      entry = await Drive.loadEntry(summary.drive_file_id);
      fullCache.set(id, entry);
    }

    // 保留使用者沒刪除的舊照片（已經有真實 drive_file_id，不需要重傳）
    const keepIds = new Set(data.keepPhotoIds || entry.photos.map(p => p.drive_file_id));
    const keptOldPhotos = entry.photos.filter(p => keepIds.has(p.drive_file_id));

    // 影片同一套保留邏輯（新上傳的一律保留，只有 keepVideoIds 才拿來篩選舊的）
    const keepVideoIds = new Set(data.keepVideoIds || (entry.videos || []).map(v => v.drive_file_id));
    const keptOldVideos = (entry.videos || []).filter(v => keepVideoIds.has(v.drive_file_id));

    // 新照片：先給臨時 ID + blob URL，讓 UI 立刻看得到，不等真正上傳完成
    const newPhotoFiles = data.newPhotoFiles || [];
    const tempIds = [];
    const tempPhotos = newPhotoFiles.map((file, i) => {
      const tempId = `_tmp_${id}_edit_${Date.now()}_${i}`;
      tempIds.push(tempId);
      const blobUrl = URL.createObjectURL(file);
      Drive.registerBlobUrl(tempId, blobUrl);
      return { drive_file_id: tempId, filename: file.name, taken_at: file._exifTime || null };
    });

    // 新影片，同一套臨時 ID 邏輯
    const newVideoFiles = data.newVideoFiles || [];
    const tempVideoIds = [];
    const tempVideos = newVideoFiles.map((file, i) => {
      const tempId = `_tmpv_${id}_edit_${Date.now()}_${i}`;
      tempVideoIds.push(tempId);
      const blobUrl = URL.createObjectURL(file);
      Drive.registerBlobUrl(tempId, blobUrl);
      return { drive_file_id: tempId, filename: file.name };
    });

    const updated = {
      ...entry,
      updated_at:  new Date().toISOString(),
      content:     data.content ?? entry.content,
      tags:        data.tags    ?? entry.tags,
      photos:      [...keptOldPhotos, ...tempPhotos],
      videos:      [...keptOldVideos, ...tempVideos],
      has_links:   hasLinks(data.content ?? entry.content),
      has_photos:  (keptOldPhotos.length + tempPhotos.length) > 0,
      has_videos:  (keptOldVideos.length + tempVideos.length) > 0,
      weather:     data.weather  ?? entry.weather,
      location:    data.location ?? entry.location,
      word_count:  wordCount(data.content ?? entry.content),
      created_at:  data.datetime ?? entry.created_at,
    };

    const driveId = driveIdMap.get(id) || index.entries.find(e => e.id === id)?.drive_file_id;

    // ① 立即更新本機，讓 UI 馬上刷新
    fullCache.set(id, updated);
    const idx = index.entries.findIndex(e => e.id === id);
    if (idx >= 0) index.entries[idx] = makeSummary(updated, driveId);
    index.entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // ② 背景上傳新照片/影片、存回 Drive（不等待）
    _updateInBackground(id, updated, newPhotoFiles, tempIds, keptOldPhotos, newVideoFiles, tempVideoIds, keptOldVideos, entry.created_at, driveId).catch(e => {
      console.error('背景同步失敗', e);
      App.toast('雲端同步失敗，請稍後重試', 'error');
    });

    return updated;
  }

  async function _updateInBackground(id, optimisticEntry, newPhotoFiles, tempIds, keptOldPhotos, newVideoFiles, tempVideoIds, keptOldVideos, entryCreatedAt, driveId) {
    let finalPhotos = keptOldPhotos;

    if (newPhotoFiles.length > 0) {
      const uploaded = [];
      for (let i = 0; i < newPhotoFiles.length; i++) {
        const file      = newPhotoFiles[i];
        const yearMonth = entryCreatedAt.slice(0, 7);
        const realDriveId = await Drive.uploadPhoto(file, yearMonth);
        Drive.renameBlobUrl(tempIds[i], realDriveId);
        uploaded.push({
          drive_file_id: realDriveId,
          filename: file.name,
          taken_at: file._exifTime || null,
        });
      }
      finalPhotos = [...keptOldPhotos, ...uploaded];
    }

    let finalVideos = keptOldVideos;

    if (newVideoFiles.length > 0) {
      const uploaded = [];
      for (let i = 0; i < newVideoFiles.length; i++) {
        const file      = newVideoFiles[i];
        const yearMonth = entryCreatedAt.slice(0, 7);
        const realDriveId = await Drive.uploadVideo(file, yearMonth);
        Drive.renameBlobUrl(tempVideoIds[i], realDriveId);
        uploaded.push({ drive_file_id: realDriveId, filename: file.name });
      }
      finalVideos = [...keptOldVideos, ...uploaded];
    }

    const finalEntry = {
      ...optimisticEntry,
      photos: finalPhotos, videos: finalVideos,
      has_photos: finalPhotos.length > 0, has_videos: finalVideos.length > 0,
    };
    await Drive.saveEntry(finalEntry);
    fullCache.set(id, finalEntry);

    const idx = index.entries.findIndex(e => e.id === id);
    if (idx >= 0) index.entries[idx] = makeSummary(finalEntry, driveId);
    await Drive.saveIndex(index);

    App.toast('已同步到雲端 ✓', 'success');
    App.refreshCurrentView();
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
    await ensureLoaded();
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
      has_videos: entry.has_videos || false,
      has_links:  entry.has_links,
      tags:       entry.tags,
      word_count: entry.word_count,
      weather:    entry.weather,
      location:   entry.location,
      first_photo: entry.photos[0]?.drive_file_id || null,
      photo_ids:  entry.photos.slice(0, 3).map(p => p.drive_file_id),
      drive_file_id: driveId,
    };
  }

  // ── 每日心情（跟日記脫鉤，殿下在月曆頁手動記錄「這天整體感覺如何」）──
  function getDayMood(dateStr) {
    return index.day_moods[dateStr] || null;
  }

  function getAllDayMoods() {
    return index.day_moods;
  }

  async function setDayMood(dateStr, moodId) {
    await ensureLoaded();
    if (moodId) index.day_moods[dateStr] = moodId;
    else delete index.day_moods[dateStr];
    await Drive.saveIndex(index);
  }

  // ── 匯入專用：直接新增已建好的 entry（不儲存索引，批次結束後再呼叫 saveCurrentIndex）──
  async function addEntry(entry) {
    const fileDriveId = await Drive.saveEntry(entry);
    fullCache.set(entry.id, entry);
    // 加入索引（不立即寫 Drive，等批次完成後統一儲存）
    const summary = makeSummary(entry, fileDriveId);
    index.entries.push(summary);
  }

  // ── 匯入專用：為已存在的 entry 補充照片（不重複新增）──
  async function addImportedPhotos(id, newPhotos) {
    if (!newPhotos.length) return;
    const summary = index.entries.find(e => e.id === id);
    if (!summary) return;

    // 從 Drive 讀取完整 entry
    const entry = await Drive.loadEntry(summary.drive_file_id);
    const existing = entry.photos || [];

    // 避免重複（以 filename 比對）
    const existingNames = new Set(existing.map(p => p.filename));
    const toAdd = newPhotos.filter(p => !existingNames.has(p.filename));
    if (!toAdd.length) return;

    const merged = [...existing, ...toAdd];
    const updated = { ...entry, photos: merged, has_photos: true };

    await Drive.saveEntry(updated);
    fullCache.set(id, updated);
    const idx = index.entries.findIndex(e => e.id === id);
    if (idx >= 0) index.entries[idx] = makeSummary(updated, summary.drive_file_id);
  }

  // ── 匯入專用：為已存在的 entry 補充影片（不重複新增）──
  async function addImportedVideos(id, newVideos) {
    if (!newVideos.length) return;
    const summary = index.entries.find(e => e.id === id);
    if (!summary) return;

    const entry = await Drive.loadEntry(summary.drive_file_id);
    const existing = entry.videos || [];

    const existingNames = new Set(existing.map(v => v.filename));
    const toAdd = newVideos.filter(v => !existingNames.has(v.filename));
    if (!toAdd.length) return;

    const merged = [...existing, ...toAdd];
    const updated = { ...entry, videos: merged, has_videos: true };

    await Drive.saveEntry(updated);
    fullCache.set(id, updated);
    const idx = index.entries.findIndex(e => e.id === id);
    if (idx >= 0) index.entries[idx] = makeSummary(updated, summary.drive_file_id);
  }

  // ── 匯入專用：批次完成後儲存最終索引 ──
  async function saveCurrentIndex() {
    index.entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    await Drive.saveIndex(index);
  }

  // ── 一次性清理：舊資料裡殘留的 Day One 內嵌標記（![](dayone-moment://...)）──
  // 只清文字，不動照片/影片本身。單篇失敗不中斷整批，最後一定會嘗試存回索引（即使中途有錯）。
  async function cleanupDayOneMarkers(onProgress) {
    await ensureLoaded();
    const total = index.entries.length;
    let scanned = 0, fixed = 0;
    const failed = [];

    try {
      for (const summary of index.entries) {
        scanned++;
        if (onProgress) onProgress(scanned, total, fixed);
        if (!summary.drive_file_id) continue;

        try {
          // 一律直接從 Drive 重新讀最新內容，不信任本機快取——避免其他裝置反向覆蓋過索引
          // 之後，這裡誤判「正文已經是乾淨的」就整篇跳過，漏了重算索引摘要
          const entry = await Drive.loadEntry(summary.drive_file_id);
          const contentDirty = !!entry.content && entry.content.includes('dayone-moment://');
          const previewDirty = !!summary.preview && summary.preview.includes('dayone-moment://');
          if (!contentDirty && !previewDirty) continue;

          const cleanedContent = contentDirty
            ? entry.content.replace(/!?\[[^\]]*\]\(dayone-moment:\/\/[^)]*\)/g, '').trim()
            : entry.content;
          const updated = {
            ...entry,
            content: cleanedContent,
            word_count: wordCount(cleanedContent),
            has_links: hasLinks(cleanedContent),
          };

          // 正文本身沒變就不用重寫那篇日記檔案，只需要重算摘要
          if (contentDirty) await Drive.saveEntry(updated);
          fullCache.set(summary.id, updated);
          const idx = index.entries.findIndex(e => e.id === summary.id);
          if (idx >= 0) index.entries[idx] = makeSummary(updated, summary.drive_file_id);
          fixed++;
        } catch (e) {
          console.error('[清理 Day One 標記] 單篇失敗，略過繼續:', summary.id, e);
          failed.push(summary.id);
        }
      }
    } finally {
      // 不管中途有沒有單篇失敗，只要有任何一篇修好了，一定要存回索引，
      // 避免「處理到一半」的成果因為後面某篇出錯而整批遺失
      if (fixed > 0) await Drive.saveIndex(index);
    }

    return { scanned, fixed, failed };
  }

  return { load, create, update, remove, getEntry, getIndex, addEntry, addImportedPhotos, addImportedVideos, saveCurrentIndex, cleanupDayOneMarkers, getDayMood, getAllDayMoods, setDayMood };
})();
