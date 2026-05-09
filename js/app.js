// ══════════════════════════════════════
//  The Days — 主程式
// ══════════════════════════════════════

// ── 全域輔助：開關 Modal ──
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

const App = (() => {
  let currentView = 'timeline';

  // ════════════════════════
  //  初始化
  // ════════════════════════
  async function init() {
    Auth.init({
      onLogin:  handleLogin,
      onLogout: handleLogout,
    });

    bindEvents();
  }

  async function handleLogin(user) {
    // 顯示使用者資訊
    document.getElementById('user-avatar').src = user.picture || '';
    document.getElementById('user-name').textContent = user.name || '';

    // 切換畫面
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');

    showLoading('連接 Google 雲端硬碟…');
    try {
      await Drive.init();
      await Promise.all([EntryManager.load(), TagManager.load()]);
      refreshCurrentView();
    } catch (e) {
      toast('載入失敗：' + e.message, 'error');
      console.error(e);
    } finally {
      hideLoading();
    }
  }

  function handleLogout() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
  }

  // ════════════════════════
  //  事件綁定
  // ════════════════════════
  function bindEvents() {

    // 登入 / 登出
    document.getElementById('login-btn').addEventListener('click', () => Auth.login());
    document.getElementById('logout-btn').addEventListener('click', () => {
      if (confirm('確定要登出嗎？')) Auth.logout();
    });

    // 視圖切換
    document.querySelectorAll('.view-tabs .tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-tabs .tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        switchView(btn.dataset.view);
      });
    });

    // 新增日記
    document.getElementById('new-entry-btn').addEventListener('click', () => Editor.open());

    // 時間軸折疊/展開
    document.getElementById('collapse-all-btn').addEventListener('click', () => Timeline.collapseAll());
    document.getElementById('expand-all-btn').addEventListener('click', () => Timeline.expandAll());

    // 月曆導航
    document.getElementById('cal-prev').addEventListener('click', () => Calendar.prevMonth());
    document.getElementById('cal-next').addEventListener('click', () => Calendar.nextMonth());
    document.getElementById('cal-today').addEventListener('click', () => Calendar.goToday());

    // Modal 關閉按鈕（通用）
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.modal;
        if (id) closeModal(id);
      });
    });
    // 點 backdrop 關閉
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', () => {
        const modal = bd.closest('.modal');
        if (modal) modal.classList.add('hidden');
      });
    });

    // ── 編輯器 ──
    document.getElementById('save-entry-btn').addEventListener('click', () => Editor.save());
    document.getElementById('reset-time-btn').addEventListener('click', () => Editor.resetTime());

    // Markdown 工具列
    document.querySelectorAll('.editor-toolbar [data-action]').forEach(btn => {
      btn.addEventListener('click', () => Editor.applyFormat(btn.dataset.action));
    });

    // 顏色選擇器
    document.getElementById('font-color-picker').addEventListener('input', (e) => {
      Editor.applyColor(e.target.value);
    });

    // 照片上傳
    document.getElementById('photo-input').addEventListener('change', (e) => {
      Editor.handlePhotoInput(Array.from(e.target.files));
      e.target.value = '';
    });

    // 標籤選擇器開關
    document.getElementById('add-tag-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      Editor.openTagPicker();
    });
    // tag-picker 內部點擊不關閉（輸入框才能正常使用）
    document.getElementById('tag-picker').addEventListener('click', (e) => {
      e.stopPropagation();
    });
    document.addEventListener('click', () => {
      document.getElementById('tag-picker').classList.add('hidden');
    });

    // 天氣/位置
    document.getElementById('fetch-weather-btn').addEventListener('click', async () => {
      const btn = document.getElementById('fetch-weather-btn');
      btn.textContent = '…';
      try {
        const { weather, location } = await Weather.fetchAll();
        Editor._pendingWeather  = weather;
        Editor._pendingLocation = location;
        document.getElementById('weather-info').textContent =
          `${weather.icon} ${weather.condition} ${weather.temperature}°C`;
        document.getElementById('location-info').textContent = location.name;
        toast('已取得天氣與位置 ✓');
      } catch (e) {
        toast('取得失敗：' + e.message, 'error');
      } finally {
        btn.textContent = '🌤';
      }
    });
    document.getElementById('fetch-location-btn').addEventListener('click', async () => {
      const btn = document.getElementById('fetch-location-btn');
      btn.textContent = '…';
      try {
        const { weather, location } = await Weather.fetchAll();
        Editor._pendingLocation = location;
        document.getElementById('location-info').textContent = location.name;
        if (!Editor._pendingWeather) {
          Editor._pendingWeather = weather;
          document.getElementById('weather-info').textContent =
            `${weather.icon} ${weather.condition} ${weather.temperature}°C`;
        }
        toast('已取得位置 ✓');
      } catch (e) {
        toast('取得位置失敗：' + e.message, 'error');
      } finally {
        btn.textContent = '📍';
      }
    });

    // ── 查看日記 ──
    document.getElementById('edit-entry-btn').addEventListener('click', async () => {
      const id = document.getElementById('view-modal').dataset.entryId;
      if (!id) return;
      closeModal('view-modal');
      showLoading('載入日記…');
      try {
        const entry = await EntryManager.getEntry(id);
        hideLoading();
        Editor.open(entry);
      } catch (e) {
        hideLoading();
        toast('載入失敗', 'error');
      }
    });

    document.getElementById('delete-entry-btn').addEventListener('click', async () => {
      const id = document.getElementById('view-modal').dataset.entryId;
      if (!id) return;
      if (!confirm('確定要刪除這篇日記嗎？\n（會移到回收桶，30 天內可回復）')) return;
      closeModal('view-modal');
      showLoading('刪除中…');
      try {
        await EntryManager.remove(id);
        refreshCurrentView();
        toast('已移到回收桶', 'success');
      } catch (e) {
        toast('刪除失敗：' + e.message, 'error');
      } finally {
        hideLoading();
      }
    });

    // ── 搜尋 ──
    document.getElementById('search-btn').addEventListener('click', () => {
      Search.renderTagFilter();
      openModal('search-modal');
      document.getElementById('search-input').focus();
    });
    document.getElementById('do-search-btn').addEventListener('click', doSearch);
    document.getElementById('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });

    // ── 標籤管理 ──
    document.getElementById('tags-btn').addEventListener('click', () => {
      TagManager.renderModal();
      openModal('tags-modal');
    });
    document.getElementById('add-tag-submit-btn').addEventListener('click', async () => {
      const name   = document.getElementById('new-tag-name').value.trim();
      const parent = document.getElementById('new-tag-parent').value;
      const color  = document.getElementById('new-tag-color').value;
      if (!name) { toast('請輸入標籤名稱', 'error'); return; }
      await TagManager.add(name, parent || null, color);
      document.getElementById('new-tag-name').value = '';
      TagManager.renderModal();
      toast('標籤已新增 ✓', 'success');
    });

    // ── 統計 ──
    document.getElementById('stats-btn').addEventListener('click', () => {
      Stats.render(EntryManager.getIndex());
      openModal('stats-modal');
    });

    // ── 回收桶 ──
    document.getElementById('trash-btn').addEventListener('click', () => {
      openModal('trash-modal');
      loadTrashModal();
    });

    // ── 燈箱 ──
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-backdrop').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev').addEventListener('click', () => lightboxNav(-1));
    document.getElementById('lightbox-next').addEventListener('click', () => lightboxNav(1));
    document.addEventListener('keydown', (e) => {
      const lb = document.getElementById('lightbox');
      if (lb.classList.contains('hidden')) return;
      if (e.key === 'ArrowLeft')  lightboxNav(-1);
      if (e.key === 'ArrowRight') lightboxNav(1);
      if (e.key === 'Escape')     closeLightbox();
    });
  }

  // ════════════════════════
  //  視圖切換
  // ════════════════════════
  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    document.getElementById(`${view}-view`).classList.remove('hidden');
    refreshCurrentView();
  }

  function refreshCurrentView() {
    const entries = EntryManager.getIndex();
    if (currentView === 'timeline') Timeline.render(entries);
    if (currentView === 'calendar') Calendar.render(entries);
    if (currentView === 'gallery')  Gallery.render(entries);
  }

  // ════════════════════════
  //  查看日記
  // ════════════════════════
  async function viewEntry(id) {
    showLoading('載入日記…');
    try {
      const entry = await EntryManager.getEntry(id);
      hideLoading();
      renderViewModal(entry);
    } catch (e) {
      hideLoading();
      toast('載入失敗：' + e.message, 'error');
    }
  }

  function renderViewModal(entry) {
    const modal = document.getElementById('view-modal');
    modal.dataset.entryId = entry.id;

    // 時間
    document.getElementById('view-datetime').textContent =
      new Date(entry.created_at).toLocaleString('zh-TW', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Asia/Taipei'
      });

    // 標籤
    const tagsEl = document.getElementById('view-tags');
    tagsEl.innerHTML = '';
    for (const tagId of (entry.tags || [])) {
      const tag = TagManager.getById(tagId);
      if (tag) tagsEl.appendChild(Editor.makeTagChip(tag));
    }

    // meta（天氣、位置）
    const metaEl = document.getElementById('view-meta');
    metaEl.innerHTML = '';
    if (entry.weather) {
      metaEl.innerHTML += `<span>${entry.weather.icon} ${entry.weather.condition} ${entry.weather.temperature}°C</span>`;
    }
    if (entry.location?.name) {
      metaEl.innerHTML += `<span>📍 ${entry.location.name}</span>`;
    }
    if (entry.word_count) {
      metaEl.innerHTML += `<span>${entry.word_count} 字</span>`;
    }

    // 內容（Markdown）
    document.getElementById('view-content').innerHTML =
      Editor.renderMarkdown(entry.content || '');

    // 照片
    const photosEl = document.getElementById('view-photos');
    photosEl.innerHTML = '';
    const urls = [];
    for (let i = 0; i < entry.photos.length; i++) {
      const photo = entry.photos[i];
      const img   = document.createElement('img');
      img.className = 'view-photo';
      img.alt = `照片 ${i + 1}`;
      img.style.background = 'var(--surface-2)';
      Drive.getPhotoUrl(photo.drive_file_id).then(url => {
        img.src = url;
        urls[i] = url;
      });
      img.addEventListener('click', () => openLightbox(urls, i));
      photosEl.appendChild(img);
    }

    openModal('view-modal');
  }

  // ════════════════════════
  //  搜尋
  // ════════════════════════
  function doSearch() {
    const q     = document.getElementById('search-input').value;
    const hasPhoto = document.getElementById('filter-has-photo').checked;
    const hasLink  = document.getElementById('filter-has-link').checked;
    const tagIds   = Search.getSelectedTagFilters();
    const results  = Search.run(q, { hasPhoto, hasLink, tags: tagIds });
    Search.renderResults(results);
  }

  // ════════════════════════
  //  回收桶
  // ════════════════════════
  async function loadTrashModal() {
    const list  = document.getElementById('trash-list');
    const empty = document.getElementById('trash-empty');
    list.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:8px">載入中…</p>';

    try {
      const trashEntries = await Drive.loadTrash();
      list.innerHTML = '';

      // 移除超過 30 天的
      const now = Date.now();
      const valid = trashEntries.filter(e => {
        const deletedAt = new Date(e.deleted_at).getTime();
        return (now - deletedAt) < 30 * 86400000;
      });

      if (!valid.length) {
        list.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
      }
      list.classList.remove('hidden');
      empty.classList.add('hidden');

      for (const e of valid) {
        const daysLeft = 30 - Math.floor((now - new Date(e.deleted_at).getTime()) / 86400000);
        const item = document.createElement('div');
        item.className = 'trash-item';

        const info = document.createElement('div');
        info.className = 'trash-item-info';
        const timeEl = document.createElement('div');
        timeEl.className = 'trash-item-time';
        timeEl.textContent = new Date(e.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const prev = document.createElement('div');
        prev.className = 'trash-item-preview';
        prev.textContent = (e.content || '').slice(0, 60) || '（無內容）';
        info.appendChild(timeEl);
        info.appendChild(prev);

        const days = document.createElement('div');
        days.className = 'trash-item-days';
        days.textContent = `剩 ${daysLeft} 天`;

        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'trash-restore-btn';
        restoreBtn.textContent = '回復';
        restoreBtn.onclick = async () => {
          showLoading('回復中…');
          try {
            const { entry } = await Drive.restoreFromTrash(e);
            const idx = EntryManager.getIndex();
            idx.unshift({
              id: entry.id,
              created_at: entry.created_at,
              preview: entry.content?.slice(0, 120) || '',
              has_photos: entry.has_photos,
              has_links: entry.has_links,
              tags: entry.tags,
              word_count: entry.word_count,
            });
            await Drive.saveIndex({ entries: idx });
            closeModal('trash-modal');
            refreshCurrentView();
            toast('日記已回復 ✓', 'success');
          } catch (err) {
            toast('回復失敗：' + err.message, 'error');
          } finally {
            hideLoading();
          }
        };

        item.appendChild(info);
        item.appendChild(days);
        item.appendChild(restoreBtn);
        list.appendChild(item);
      }
    } catch (e) {
      list.innerHTML = `<p style="color:var(--danger);padding:8px">載入失敗：${e.message}</p>`;
    }
  }

  // ════════════════════════
  //  燈箱
  // ════════════════════════
  let lightboxUrls = [];
  let lightboxIdx  = 0;

  function openLightbox(urls, idx) {
    lightboxUrls = urls;
    lightboxIdx  = idx;
    document.getElementById('lightbox-img').src = urls[idx];
    document.getElementById('lightbox').classList.remove('hidden');
    updateLightboxNav();
  }

  function closeLightbox() {
    document.getElementById('lightbox').classList.add('hidden');
  }

  function lightboxNav(dir) {
    lightboxIdx = (lightboxIdx + dir + lightboxUrls.length) % lightboxUrls.length;
    document.getElementById('lightbox-img').src = lightboxUrls[lightboxIdx];
    updateLightboxNav();
  }

  function updateLightboxNav() {
    document.getElementById('lightbox-prev').style.display = lightboxUrls.length > 1 ? '' : 'none';
    document.getElementById('lightbox-next').style.display = lightboxUrls.length > 1 ? '' : 'none';
  }

  // ════════════════════════
  //  Toast 通知
  // ════════════════════════
  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ` ${type}` : '');
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ════════════════════════
  //  載入遮罩
  // ════════════════════════
  function showLoading(msg = '載入中…') {
    document.getElementById('loading-text').textContent = msg;
    document.getElementById('loading-overlay').classList.remove('hidden');
  }

  function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
  }

  // ── Safari visualViewport 修正（鍵盤彈出時動態調整 modal 高度）──
  function initViewportFix() {
    if (!window.visualViewport) return;
    window.visualViewport.addEventListener('resize', () => {
      const h = window.visualViewport.height;
      document.querySelectorAll('.modal-box').forEach(el => {
        el.style.maxHeight = h * 0.95 + 'px';
        el.style.height    = h * 0.95 + 'px';
      });
    });
  }

  // ── 啟動 ──
  document.addEventListener('DOMContentLoaded', () => { init(); initViewportFix(); });

  return { toast, showLoading, hideLoading, refreshCurrentView, viewEntry };
})();
