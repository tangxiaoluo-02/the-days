// ── Day One 匯入模組 ──
const DayOneImport = (() => {

  let _parsedEntries = [];  // 解析後備匯入的 entries
  let _zipFile = null;      // JSZip 物件
  let _photoIndex = null;   // Map: 正規化key → zip路徑（parseZip 時一次建好）
  let _videoIndex = null;   // Map: 正規化key → zip路徑（影片，跟 _photoIndex 同一套邏輯）

  // ── 天氣代碼 → emoji ──
  const WEATHER_EMOJI_MAP = {
    'Clear': '☀️', 'Sunny': '☀️', 'MostlySunny': '🌤',
    'PartlyCloudy': '⛅', 'MostlyCloudy': '🌥',
    'Cloudy': '☁️', 'Overcast': '☁️',
    'Drizzle': '🌦', 'Rain': '🌧', 'HeavyRain': '🌧',
    'Thunderstorm': '⛈', 'ScatteredThunderstorms': '⛈',
    'Snow': '❄️', 'Flurries': '🌨', 'Sleet': '🌨',
    'Fog': '🌫', 'Haze': '🌫', 'Smoke': '🌫',
    'Windy': '💨', 'Breezy': '💨',
    'Hot': '🔆', 'Cold': '🥶',
  };

  function weatherEmoji(code) {
    if (!code) return '🌤';
    // 完全比對
    if (WEATHER_EMOJI_MAP[code]) return WEATHER_EMOJI_MAP[code];
    // 部分比對（Day One 有時有複合代碼）
    for (const [key, emoji] of Object.entries(WEATHER_EMOJI_MAP)) {
      if (code.toLowerCase().includes(key.toLowerCase())) return emoji;
    }
    return '🌤';
  }

  // ── Day One UTC 日期 → 本地時區 ISO ──
  function toLocal(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return toLocalISOString(new Date());
    return toLocalISOString(d);
  }

  // ══════════════════════════════════
  //  步驟 1 → 2：解析 ZIP
  // ══════════════════════════════════
  // 瀏覽器端的 zip 解析超過這個大小容易發生 32-bit 數字溢位，誤判成「損毀」
  const MAX_SAFE_ZIP_SIZE = 1.8 * 1024 * 1024 * 1024; // 1.8GB

  async function handleFileSelect(file) {
    // 顯示「分析中」
    document.getElementById('import-analyzing').classList.remove('hidden');
    document.querySelector('.import-file-btn').style.opacity = '0.5';

    try {
      if (file.size > MAX_SAFE_ZIP_SIZE) {
        const err = new Error(
          `檔案太大了（${(file.size / 1024 / 1024 / 1024).toFixed(1)}GB）。瀏覽器處理這麼大的 zip 檔案容易出錯，` +
          `建議改成分批匯出（例如一次匯出幾個月的日記），把每批的檔案控制在 2GB 以內會比較穩定。`
        );
        err.isSizeError = true;
        throw err;
      }

      const zip = await JSZip.loadAsync(file);
      _zipFile = zip;

      // 找所有 JSON 日記檔（排除 __MACOSX 雜物）
      const jsonPaths = Object.keys(zip.files).filter(p =>
        p.endsWith('.json') && !p.includes('__MACOSX') && !zip.files[p].dir
      );

      if (!jsonPaths.length) throw new Error('找不到 JSON 日記檔，請確認是否為 Day One 匯出格式');

      let allEntries = [];
      for (const path of jsonPaths) {
        const text = await zip.files[path].async('text');
        let data;
        try { data = JSON.parse(text); } catch { continue; }
        if (Array.isArray(data.entries)) allEntries = allEntries.concat(data.entries);
      }

      if (!allEntries.length) throw new Error('未找到任何日記內容，請確認 ZIP 格式正確');

      _parsedEntries = allEntries;

      // ── 掃描 ZIP 中的實際圖片檔，建立索引 ──
      // 索引 key：檔名（不含副檔名）小寫，方便比對 Day One identifier
      _photoIndex = new Map();
      const imageExts = /\.(jpe?g|heic|heif|png|gif|webp)$/i;
      for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir || zipPath.includes('__MACOSX')) continue;
        if (!imageExts.test(zipPath)) continue;
        const basename = zipPath.split('/').pop();                    // e.g. "7BA3F4.jpeg"
        const nameNoExt = basename.replace(/\.[^.]+$/, '').toLowerCase(); // e.g. "7ba3f4"
        _photoIndex.set(nameNoExt, zipPath);
        // 也用完整 basename 小寫做 key（備用）
        _photoIndex.set(basename.toLowerCase(), zipPath);
      }
      const zipImageCount = new Set(_photoIndex.values()).size; // 實際圖片檔數量

      // ── 掃描 ZIP 中的實際影片檔，建立索引（跟照片同一套邏輯）──
      _videoIndex = new Map();
      const videoExts = /\.(mp4|mov|m4v|avi)$/i;
      for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir || zipPath.includes('__MACOSX')) continue;
        if (!videoExts.test(zipPath)) continue;
        const basename = zipPath.split('/').pop();
        const nameNoExt = basename.replace(/\.[^.]+$/, '').toLowerCase();
        _videoIndex.set(nameNoExt, zipPath);
        _videoIndex.set(basename.toLowerCase(), zipPath);
      }
      const zipVideoCount = new Set(_videoIndex.values()).size;

      // 計算 JSON 記錄的照片/影片數
      const totalPhotos = allEntries.reduce((sum, e) => sum + (e.photos?.length || 0), 0);
      const totalVideos = allEntries.reduce((sum, e) => sum + (e.videos?.length || 0), 0);

      // 日期範圍
      const dates = allEntries.map(e => e.creationDate).filter(Boolean).sort();
      const dateFrom = dates[0] ? new Date(dates[0]).toLocaleDateString('zh-TW') : '—';
      const dateTo   = dates[dates.length - 1] ? new Date(dates[dates.length - 1]).toLocaleDateString('zh-TW') : '—';

      // ── 照片狀態提示 ──
      let photoHint = '';
      if (totalPhotos === 0) {
        photoHint = `<div class="import-photo-hint ok">✅ 此批次無照片</div>`;
      } else if (zipImageCount === 0) {
        photoHint = `<div class="import-photo-hint warn">⚠️ ZIP 中找不到圖片檔案（共 ${totalPhotos} 筆照片記錄），請重新匯出並勾選「包含照片」</div>`;
      } else if (zipImageCount < totalPhotos) {
        photoHint = `<div class="import-photo-hint warn">⚠️ ZIP 中找到 ${zipImageCount} 個圖片檔，JSON 記錄 ${totalPhotos} 筆，可能有部分缺少</div>`;
      } else {
        photoHint = `<div class="import-photo-hint ok">✅ ZIP 中找到 ${zipImageCount} 個圖片檔，與記錄相符</div>`;
      }

      // ── 影片狀態提示（跟照片同一套邏輯）──
      let videoHint = '';
      if (totalVideos === 0) {
        videoHint = '';
      } else if (zipVideoCount === 0) {
        videoHint = `<div class="import-photo-hint warn">⚠️ ZIP 中找不到影片檔案（共 ${totalVideos} 筆影片記錄），請重新匯出並勾選「包含影片」</div>`;
      } else if (zipVideoCount < totalVideos) {
        videoHint = `<div class="import-photo-hint warn">⚠️ ZIP 中找到 ${zipVideoCount} 個影片檔，JSON 記錄 ${totalVideos} 筆，可能有部分缺少</div>`;
      } else {
        videoHint = `<div class="import-photo-hint ok">✅ ZIP 中找到 ${zipVideoCount} 個影片檔，與記錄相符</div>`;
      }

      // 渲染摘要
      document.getElementById('import-summary').innerHTML = `
        <div class="import-summary-stats">
          <div class="import-stat">
            <div class="import-stat-num">${allEntries.length}</div>
            <div class="import-stat-label">篇日記</div>
          </div>
          <div class="import-stat">
            <div class="import-stat-num">${totalPhotos}</div>
            <div class="import-stat-label">張照片記錄</div>
          </div>
          <div class="import-stat">
            <div class="import-stat-num">${zipImageCount}</div>
            <div class="import-stat-label">ZIP 圖片檔</div>
          </div>
          ${totalVideos > 0 ? `
          <div class="import-stat">
            <div class="import-stat-num">${totalVideos}</div>
            <div class="import-stat-label">支影片記錄</div>
          </div>
          <div class="import-stat">
            <div class="import-stat-num">${zipVideoCount}</div>
            <div class="import-stat-label">ZIP 影片檔</div>
          </div>` : ''}
        </div>
        <div class="import-date-range">📅 ${dateFrom} ～ ${dateTo}</div>
        ${photoHint}
        ${videoHint}
      `;

      goStep(2);
    } catch (e) {
      if (e.isSizeError) {
        alert(e.message); // 這類訊息需要殿下讀完並回去操作，用彈窗確保不會被3秒toast錯過
      } else {
        App.toast('解析失敗：' + e.message, 'error');
      }
    } finally {
      document.getElementById('import-analyzing').classList.add('hidden');
      document.querySelector('.import-file-btn').style.opacity = '';
    }
  }

  // ══════════════════════════════════
  //  步驟 2 → 3：開始匯入
  // ══════════════════════════════════
  async function runImport() {
    goStep(3);

    const total = _parsedEntries.length;
    let done = 0, newCount = 0, photoOnly = 0, photoMissing = 0, errors = 0;

    const setProgress = (msg) => {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      document.getElementById('import-progress-bar').style.width = pct + '%';
      document.getElementById('import-progress-text').textContent =
        msg || `處理中… ${done} / ${total}`;
    };

    setProgress('準備中…');

    // 按日期由舊到新排序，讓索引最終排序正確
    const sorted = [..._parsedEntries].sort(
      (a, b) => new Date(a.creationDate) - new Date(b.creationDate)
    );

    for (const e of sorted) {
      try {
        const preview = (e.text || '').slice(0, 40).replace(/\n/g, ' ');
        document.getElementById('import-current-entry').textContent =
          preview ? `「${preview}…」` : '';

        const result = await importOneEntry(e);
        if (result === 'new')            newCount++;
        else if (result === 'photo-only') photoOnly++;
        else if (result === 'no-photos')  photoMissing++;

        done++;
        setProgress(`處理中… ${done} / ${total}`);
      } catch (err) {
        console.error('[Import] 失敗:', err, e);
        errors++;
        done++;
        setProgress(`處理中… ${done} / ${total}（${errors} 筆錯誤）`);
      }
    }

    // 批次儲存最終索引
    try {
      await EntryManager.saveCurrentIndex();
    } catch (err) {
      console.error('[Import] 儲存索引失敗:', err);
    }

    // 重新整理視圖
    App.refreshCurrentView();

    // 顯示完成
    const lines = [];
    if (newCount > 0)      lines.push(`新增 ${newCount} 篇日記`);
    if (photoOnly > 0)     lines.push(`補充 ${photoOnly} 篇的照片／影片`);
    if (errors > 0)        lines.push(`${errors} 篇發生錯誤`);

    let doneText = lines.length ? lines.join('、') + ' 🎉' : '沒有需要更新的內容';
    if (photoMissing > 0) {
      doneText += `\n\n⚠️ 有 ${photoMissing} 篇日記在 ZIP 中找不到對應的照片或影片檔案。\n請重新從 Day One 匯出，並確認有勾選「包含照片」與「包含影片」。`;
    }
    document.getElementById('import-done-text').textContent = doneText;
    document.getElementById('import-done-text').style.whiteSpace = 'pre-wrap';

    goStep(4);
  }

  // ══════════════════════════════════
  //  單篇日記匯入（含重複偵測）
  //  回傳 'new' | 'photo-only' | 'skip'
  // ══════════════════════════════════
  async function importOneEntry(dayOneEntry) {
    const createdAt = toLocal(dayOneEntry.creationDate);
    const updatedAt = toLocal(dayOneEntry.modifiedDate || dayOneEntry.creationDate);

    // 計算此 entry 的 ID
    const id = dayOneEntry.uuid
      ? dayOneEntry.uuid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)
      : 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    // ── 重複偵測 ──
    const existingSummary = EntryManager.getIndex().find(e => e.id === id);

    if (existingSummary) {
      // 已存在 → 照片、影片分開檢查，各自嘗試補充缺的那一種
      // （不能像以前一樣只要 has_photos 就整篇跳過，因為現在還可能缺影片）
      let addedCount = 0, missingSomething = false;

      if (!existingSummary.has_photos) {
        const dayOnePhotos = dayOneEntry.photos || [];
        if (dayOnePhotos.length) {
          const photos = await uploadPhotos(dayOnePhotos, createdAt);
          if (photos.length > 0) {
            await EntryManager.addImportedPhotos(id, photos);
            addedCount += photos.length;
          } else {
            missingSomething = true; // 有記錄但 ZIP 裡找不到
          }
        }
      }

      if (!existingSummary.has_videos) {
        const dayOneVideos = dayOneEntry.videos || [];
        if (dayOneVideos.length) {
          const videos = await uploadVideos(dayOneVideos, createdAt);
          if (videos.length > 0) {
            await EntryManager.addImportedVideos(id, videos);
            addedCount += videos.length;
          } else {
            missingSomething = true;
          }
        }
      }

      if (addedCount > 0) return 'photo-only';
      if (missingSomething) return 'no-photos';
      return 'skip';
    }

    // ── 全新 entry ──

    // 標籤
    const tagIds = [];
    if (Array.isArray(dayOneEntry.tags)) {
      for (const tagName of dayOneEntry.tags) {
        if (tagName?.trim()) {
          tagIds.push(await TagManager.getOrCreate(tagName.trim()));
        }
      }
    }

    // 照片
    const photos = await uploadPhotos(dayOneEntry.photos || [], createdAt);

    // 影片（不壓縮，原檔上傳）
    const videos = await uploadVideos(dayOneEntry.videos || [], createdAt);

    // 天氣
    let weather = null;
    if (dayOneEntry.weather) {
      const w = dayOneEntry.weather;
      const code = w.conditionCode || w.weatherCode || '';
      weather = {
        icon:        weatherEmoji(code),
        condition:   w.conditionDescription || w.weatherServiceName || code || '未知',
        temperature: w.temperatureCelsius != null ? Math.round(w.temperatureCelsius) : null,
      };
    }

    // 位置
    let location = null;
    if (dayOneEntry.location) {
      const loc = dayOneEntry.location;
      const parts = [loc.placeName, loc.localityName, loc.administrativeArea, loc.country]
        .map(s => s?.trim()).filter(Boolean);
      const unique = [...new Set(parts)];
      if (unique.length) {
        location = {
          name: unique.slice(0, 3).join(', '),
          lat: loc.latitude  ?? null,
          lon: loc.longitude ?? null,
        };
      }
    }

    const content = (dayOneEntry.text || '').replace(/!?\[[^\]]*\]\(dayone-moment:\/\/[^)]*\)/g, '').trim();
    const entry = {
      id,
      created_at:  createdAt,
      updated_at:  updatedAt,
      content,
      photos,
      videos,
      tags:        tagIds,
      has_links:   /https?:\/\/[^\s)>"]+/.test(content),
      has_photos:  photos.length > 0,
      has_videos:  videos.length > 0,
      weather,
      location,
      word_count:  content.replace(/\s+/g, '').length,
    };

    await EntryManager.addEntry(entry);
    return 'new';
  }

  // ── 上傳一篇 entry 的所有照片，回傳 photo 物件陣列 ──
  async function uploadPhotos(dayOnePhotos, createdAt) {
    const photos = [];
    if (!Array.isArray(dayOnePhotos) || !_zipFile) return photos;
    for (const p of dayOnePhotos) {
      try {
        const file = await extractPhoto(p);
        if (file) {
          const yearMonth = createdAt.slice(0, 7);
          const compressed = await compressForImport(file);
          const driveId = await Drive.uploadPhoto(compressed, yearMonth);
          photos.push({
            drive_file_id: driveId,
            filename: file.name,
            taken_at: p.date ? toLocal(p.date) : null,
          });
        }
      } catch (err) {
        console.warn('[Import] 照片上傳失敗（略過）:', err);
      }
    }
    return photos;
  }

  // ══════════════════════════════════
  //  從 ZIP 提取照片（使用預建索引）
  // ══════════════════════════════════
  async function extractPhoto(photo) {
    if (!_zipFile || !_photoIndex) return null;

    const identifier = (photo.identifier || '').trim();
    const md5        = (photo.md5 || '').trim();
    const type       = (photo.type || 'jpeg').toLowerCase();

    // 依序嘗試各種可能的 key
    const keys = [];
    if (identifier) {
      keys.push(identifier.toLowerCase());
      // Day One identifier 有時帶連字號，有時沒有
      keys.push(identifier.toLowerCase().replace(/-/g, ''));
    }
    if (md5) {
      keys.push(md5.toLowerCase());
    }

    for (const key of keys) {
      const zipPath = _photoIndex.get(key);
      if (zipPath && _zipFile.files[zipPath]) {
        const blob = await _zipFile.files[zipPath].async('blob');
        const ext  = zipPath.split('.').pop().toLowerCase();
        return new File([blob], zipPath.split('/').pop(), { type: mimeForExt(ext) });
      }
    }

    // 最後備用：直接掃描（處理 identifier 只是 key 的一部分的情況）
    if (identifier) {
      for (const [key, zipPath] of _photoIndex) {
        if (key.includes(identifier.toLowerCase()) || identifier.toLowerCase().includes(key)) {
          const blob = await _zipFile.files[zipPath].async('blob');
          const ext  = zipPath.split('.').pop().toLowerCase();
          return new File([blob], zipPath.split('/').pop(), { type: mimeForExt(ext) });
        }
      }
    }

    return null;
  }

  function mimeForExt(ext) {
    return { png: 'image/png', heic: 'image/heic', gif: 'image/gif',
             webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'image/jpeg';
  }

  // ── 上傳一篇 entry 的所有影片，回傳 video 物件陣列（不壓縮，原檔上傳）──
  async function uploadVideos(dayOneVideos, createdAt) {
    const videos = [];
    if (!Array.isArray(dayOneVideos) || !_zipFile) return videos;
    for (const v of dayOneVideos) {
      try {
        const file = await extractVideo(v);
        if (file) {
          const yearMonth = createdAt.slice(0, 7);
          const driveId = await Drive.uploadVideo(file, yearMonth);
          videos.push({ drive_file_id: driveId, filename: file.name });
        }
      } catch (err) {
        console.warn('[Import] 影片上傳失敗（略過）:', err);
      }
    }
    return videos;
  }

  // ══════════════════════════════════
  //  從 ZIP 提取影片（跟 extractPhoto 同一套邏輯）
  // ══════════════════════════════════
  async function extractVideo(video) {
    if (!_zipFile || !_videoIndex) return null;

    const identifier = (video.identifier || '').trim();
    const md5        = (video.md5 || '').trim();

    const keys = [];
    if (identifier) {
      keys.push(identifier.toLowerCase());
      keys.push(identifier.toLowerCase().replace(/-/g, ''));
    }
    if (md5) keys.push(md5.toLowerCase());

    for (const key of keys) {
      const zipPath = _videoIndex.get(key);
      if (zipPath && _zipFile.files[zipPath]) {
        const blob = await _zipFile.files[zipPath].async('blob');
        const ext  = zipPath.split('.').pop().toLowerCase();
        return new File([blob], zipPath.split('/').pop(), { type: mimeForVideoExt(ext) });
      }
    }

    if (identifier) {
      for (const [key, zipPath] of _videoIndex) {
        if (key.includes(identifier.toLowerCase()) || identifier.toLowerCase().includes(key)) {
          const blob = await _zipFile.files[zipPath].async('blob');
          const ext  = zipPath.split('.').pop().toLowerCase();
          return new File([blob], zipPath.split('/').pop(), { type: mimeForVideoExt(ext) });
        }
      }
    }

    return null;
  }

  function mimeForVideoExt(ext) {
    return { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v',
             avi: 'video/x-msvideo' }[ext] || 'video/mp4';
  }

  // ══════════════════════════════════
  //  照片壓縮（目標 ≤1MB，匯入專用）
  // ══════════════════════════════════
  async function compressForImport(file) {
    const TARGET = 1 * 1024 * 1024;
    if (file.size <= TARGET) return file;

    const url = URL.createObjectURL(file);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        URL.revokeObjectURL(url);
        const steps = [
          { maxW: 1920, quality: 0.85 },
          { maxW: 1280, quality: 0.82 },
          { maxW: 960,  quality: 0.78 },
          { maxW: 640,  quality: 0.75 },
          { maxW: 640,  quality: 0.60 },
        ];
        const canvas = document.createElement('canvas');
        const ctx    = canvas.getContext('2d');
        for (const step of steps) {
          const w = Math.min(img.naturalWidth, step.maxW);
          const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
          canvas.width  = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', step.quality));
          if (blob && blob.size <= TARGET) {
            const name = file.name.replace(/\.[^.]+$/, '.webp');
            resolve(new File([blob], name, { type: 'image/webp' }));
            return;
          }
        }
        resolve(file); // 壓不下去就用原檔
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  // ══════════════════════════════════
  //  步驟切換
  // ══════════════════════════════════
  function goStep(n) {
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`import-step-${i}`);
      if (el) el.classList.toggle('hidden', i !== n);
    }
  }

  // ══════════════════════════════════
  //  Modal 開 / 關
  // ══════════════════════════════════
  function openImportModal() {
    _parsedEntries = [];
    _zipFile = null;
    _photoIndex = null;
    _videoIndex = null;
    document.getElementById('import-file-input').value = '';
    document.getElementById('import-analyzing').classList.add('hidden');
    document.querySelector('.import-file-btn').style.opacity = '';
    goStep(1);
    document.getElementById('import-modal').classList.remove('hidden');
  }

  function closeImportModal() {
    document.getElementById('import-modal').classList.add('hidden');
  }

  // ══════════════════════════════════
  //  事件綁定
  // ══════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    // 開啟匯入 Modal（設定選單）
    document.getElementById('import-btn').addEventListener('click', () => {
      document.getElementById('settings-menu').classList.add('hidden');
      openImportModal();
    });

    // 選擇檔案後觸發解析
    document.getElementById('import-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFileSelect(file);
      e.target.value = '';  // 允許重複選同一檔
    });

    // 返回重選（步驟 2 → 1）
    document.getElementById('import-back-btn').addEventListener('click', () => {
      _parsedEntries = [];
      _zipFile = null;
      _photoIndex = null;
    _videoIndex = null;
      document.getElementById('import-file-input').value = '';
      goStep(1);
    });

    // 開始匯入（步驟 2 → 3）
    document.getElementById('import-start-btn').addEventListener('click', runImport);

    // 完成（步驟 4）：關閉 Modal
    document.getElementById('import-done-btn').addEventListener('click', () => {
      closeImportModal();
    });

    // 點 backdrop 關閉（步驟 3 匯入中不可關閉）
    // 用 stopImmediatePropagation 防止 app.js 的通用處理器覆蓋
    document.getElementById('import-modal').querySelector('.modal-backdrop')
      .addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        if (!document.getElementById('import-step-3').classList.contains('hidden')) return;
        closeImportModal();
      });

    // modal-close ✕ 按鈕（步驟 3 除外）
    document.getElementById('import-modal').querySelector('.modal-close')
      .addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        if (!document.getElementById('import-step-3').classList.contains('hidden')) return;
        closeImportModal();
      });
  });

  return { openImportModal, closeImportModal };
})();
