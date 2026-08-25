// ── Google Drive API 操作模組 ──
const Drive = (() => {
  const BASE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  let rootFolderId    = null;
  let entriesFolderId = null;
  let photosFolderId  = null;
  let trashFolderId   = null;

  // 記憶體快取（blob URL）
  const photoCache = new Map();

  // ── IndexedDB 持久快取 ──
  let photoDB = null;
  (async () => {
    try {
      const req = indexedDB.open('TheDaysPhotos', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('photos');
      req.onsuccess = e => { photoDB = e.target.result; };
    } catch(e) {}
  })();

  async function idbGet(id) {
    if (!photoDB) return null;
    return new Promise(res => {
      try {
        const r = photoDB.transaction('photos','readonly').objectStore('photos').get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror   = () => res(null);
      } catch(e) { res(null); }
    });
  }

  async function idbPut(id, blob) {
    if (!photoDB) return;
    try {
      photoDB.transaction('photos','readwrite').objectStore('photos').put(blob, id);
    } catch(e) {}
  }

  // ── 基礎請求 ──
  async function req(url, options = {}) {
    const token = await Auth.getToken();
    const resp = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${resp.status}`);
    }
    if (resp.status === 204) return null;
    return resp.json();
  }

  async function reqMedia(url) {
    const token = await Auth.getToken();
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.blob();
  }

  // ── 資料夾操作 ──
  async function findOrCreateFolder(name, parentId = null) {
    const q = parentId
      ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
      : `name='${name}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;

    const res = await req(`${BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`);
    if (res.files.length > 0) return res.files[0].id;

    const body = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) body.parents = [parentId];

    const created = await req(`${BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return created.id;
  }

  // ── 本機快取 Drive 資料夾/檔案 ID，省掉重複查找的來回等待 ──
  const ID_CACHE_KEY = 'td_drive_ids';

  function loadIdCache() {
    try { return JSON.parse(localStorage.getItem(ID_CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveIdCache(patch) {
    try { localStorage.setItem(ID_CACHE_KEY, JSON.stringify({ ...loadIdCache(), ...patch })); } catch (e) {}
  }

  async function init() {
    const cache = loadIdCache();
    if (cache.rootFolderId && cache.entriesFolderId && cache.photosFolderId && cache.trashFolderId) {
      // 沿用上次記住的資料夾 ID，完全不用打 API 查找，直接可以用
      rootFolderId    = cache.rootFolderId;
      entriesFolderId = cache.entriesFolderId;
      photosFolderId  = cache.photosFolderId;
      trashFolderId   = cache.trashFolderId;
      return;
    }
    rootFolderId = await findOrCreateFolder(CONFIG.DRIVE_FOLDER_NAME);
    // entries/photos/trash 互不相依，平行查找可以省下不少等待時間
    [entriesFolderId, photosFolderId, trashFolderId] = await Promise.all([
      findOrCreateFolder('entries', rootFolderId),
      findOrCreateFolder('photos',  rootFolderId),
      findOrCreateFolder('trash',   rootFolderId),
    ]);
    saveIdCache({ rootFolderId, entriesFolderId, photosFolderId, trashFolderId });
  }

  // ── 取得或建立月份子資料夾 ──
  async function getMonthFolder(parentId, yearMonth) {
    return findOrCreateFolder(yearMonth, parentId);
  }

  // ── JSON 檔案操作 ──
  async function readJson(fileId) {
    const blob = await reqMedia(`${BASE}/files/${fileId}?alt=media`);
    const text = await blob.text();
    return JSON.parse(text);
  }

  async function writeJson(name, data, folderId, existingFileId = null) {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });

    if (existingFileId) {
      return updateFile(existingFileId, blob, 'application/json');
    }

    return uploadFile(name, blob, 'application/json', folderId);
  }

  async function uploadFile(name, blob, mimeType, folderId) {
    const metadata = { name, parents: [folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const token = await Auth.getToken();
    const resp = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name,size`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    return resp.json();
  }

  async function updateFile(fileId, blob, mimeType) {
    const token = await Auth.getToken();
    const resp = await fetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: blob,
    });
    if (!resp.ok) throw new Error(`Update failed: ${resp.status}`);
    return resp.json();
  }

  async function deleteFile(fileId) {
    await req(`${BASE}/files/${fileId}`, { method: 'DELETE' });
  }

  async function listFiles(folderId, fields = 'files(id,name,createdTime,size)') {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await req(`${BASE}/files?q=${q}&fields=${fields}&pageSize=1000&orderBy=createdTime`);
    return res.files;
  }

  async function findFile(name, folderId) {
    const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
    const res = await req(`${BASE}/files?q=${q}&fields=files(id,name)&pageSize=1`);
    return res.files[0] || null;
  }

  // ── 照片操作 ──
  async function uploadPhoto(file, yearMonth) {
    const folderId = await getMonthFolder(photosFolderId, yearMonth);
    const uploaded = await uploadFile(file.name, file, file.type, folderId);
    return uploaded.id;
  }

  async function getPhotoUrl(fileId) {
    // 1. 記憶體快取
    if (photoCache.has(fileId)) return photoCache.get(fileId);
    // 2. IndexedDB 持久快取
    const cached = await idbGet(fileId);
    if (cached) {
      const url = URL.createObjectURL(cached);
      photoCache.set(fileId, url);
      return url;
    }
    // 3. 從 Drive 下載，並存入快取
    const blob = await reqMedia(`${BASE}/files/${fileId}?alt=media`);
    idbPut(fileId, blob); // 存入 IndexedDB（非同步，不等待）
    const url = URL.createObjectURL(blob);
    photoCache.set(fileId, url);
    return url;
  }

  // ── index.json 操作 ──
  let indexFileId = null;

  async function loadIndex() {
    const cache = loadIdCache();
    if (cache.indexFileId) {
      try {
        const data = await readJson(cache.indexFileId);
        indexFileId = cache.indexFileId;
        return data;
      } catch (e) { /* 快取的檔案 ID 失效了（例如手動在 Drive 裡搬動過），往下重新查找 */ }
    }
    const file = await findFile('index.json', rootFolderId);
    if (!file) {
      return { entries: [], last_updated: new Date().toISOString() };
    }
    indexFileId = file.id;
    saveIdCache({ indexFileId: file.id });
    return readJson(file.id);
  }

  async function saveIndex(data) {
    data.last_updated = new Date().toISOString();
    const result = await writeJson('index.json', data, rootFolderId, indexFileId);
    if (!indexFileId) { indexFileId = result.id; saveIdCache({ indexFileId: result.id }); }
  }

  // ── tags.json 操作 ──
  let tagsFileId = null;

  async function loadTags() {
    const cache = loadIdCache();
    if (cache.tagsFileId) {
      try {
        const data = await readJson(cache.tagsFileId);
        tagsFileId = cache.tagsFileId;
        return data;
      } catch (e) { /* 快取失效，往下重新查找 */ }
    }
    const file = await findFile('tags.json', rootFolderId);
    if (!file) return { tags: [] };
    tagsFileId = file.id;
    saveIdCache({ tagsFileId: file.id });
    return readJson(file.id);
  }

  async function saveTags(data) {
    const result = await writeJson('tags.json', data, rootFolderId, tagsFileId);
    if (!tagsFileId) { tagsFileId = result.id; saveIdCache({ tagsFileId: result.id }); }
  }

  // ── 日記 entry 操作 ──
  async function saveEntry(entry) {
    const yearMonth = entry.created_at.slice(0, 7);
    const folderId  = await getMonthFolder(entriesFolderId, yearMonth);
    const filename  = `${entry.id}.json`;

    const existing = await findFile(filename, folderId);
    const result = await writeJson(filename, entry, folderId, existing?.id);
    return result.id;
  }

  async function loadEntry(entryFileId) {
    return readJson(entryFileId);
  }

  async function moveToTrash(entry, driveFileId) {
    const trashEntry = { ...entry, deleted_at: new Date().toISOString(), original_drive_id: driveFileId };
    const result = await writeJson(`${entry.id}.json`, trashEntry, trashFolderId);

    // 刪除原始檔案
    if (driveFileId) await deleteFile(driveFileId);
    return result.id;
  }

  async function loadTrash() {
    const files = await listFiles(trashFolderId);
    const entries = [];
    for (const f of files) {
      try {
        const data = await readJson(f.id);
        data._trash_file_id = f.id;
        entries.push(data);
      } catch (e) { /* skip */ }
    }
    return entries;
  }

  async function restoreFromTrash(trashEntry) {
    const { _trash_file_id, ...entry } = trashEntry;
    delete entry.deleted_at;
    delete entry.original_drive_id;
    const driveId = await saveEntry(entry);
    await deleteFile(_trash_file_id);
    return { entry, driveId };
  }

  async function deleteFromTrash(trashFileId) {
    await deleteFile(trashFileId);
  }

  // 把 blob URL 注冊到快取（供背景上傳用的臨時佔位）
  function registerBlobUrl(id, url) { photoCache.set(id, url); }
  // 背景上傳完成後，把臨時 ID 的快取轉到真實 Drive ID
  function renameBlobUrl(oldId, newId) {
    if (photoCache.has(oldId)) {
      photoCache.set(newId, photoCache.get(oldId));
      photoCache.delete(oldId);
    }
  }

  return {
    init,
    readJson, writeJson,
    uploadPhoto, getPhotoUrl,
    registerBlobUrl, renameBlobUrl,
    loadIndex, saveIndex,
    loadTags, saveTags,
    saveEntry, loadEntry,
    moveToTrash, loadTrash, restoreFromTrash, deleteFromTrash,
  };
})();
