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
  let currentView = 'today';

  // ════════════════════════
  //  初始化
  // ════════════════════════
  async function init() {
    Auth.init({
      onLogin:  handleLogin,
      onLogout: handleLogout,
    });

    bindEvents();
    checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForUpdate();
    });
  }

  // ── 偵測有沒有新版本（手機「加到主畫面」模式沒有下拉重新整理，殿下重新
  //    點開圖示時常常只是「恢復」舊分頁繼續跑，不會真的重新抓一次網頁，
  //    導致改版後殿下一直卡在舊程式碼）。version.txt 用 no-store 強制略過
  //    快取，永遠拿到 GitHub Pages 上最新的內容；跟這份程式碼自己知道的
  //    APP_VERSION 不一樣，就代表現在跑的是舊版，跳出提示讓殿下自己選擇
  //    要不要重新整理（不能自動重整，殿下可能正在寫日記寫到一半）。
  let updateBannerShown = false;
  async function checkForUpdate() {
    if (updateBannerShown) return;
    try {
      const res = await fetch(`version.txt?_=${Date.now()}`, { cache: 'no-store' });
      const latest = (await res.text()).trim();
      if (latest && latest !== APP_VERSION) {
        updateBannerShown = true;
        document.getElementById('update-banner').classList.remove('hidden');
      }
    } catch (e) { /* 離線或網路問題，不用打擾殿下，下次還會再檢查 */ }
  }

  async function handleLogin(user) {
    // 顯示使用者資訊
    document.getElementById('user-avatar').src = user.picture || '';
    document.getElementById('user-name').textContent = user.name || '';

    // 切換畫面
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');

    // 先用現有（可能還是空的）資料渲染一次，讓殿下可以立刻按「新增日記」開始寫，
    // 不用等雲端資料回來——實際存檔時 EntryManager/TagManager 內部會自己等資料
    // 載完才動手寫，不會因為搶快而把稍後載入的資料蓋掉。
    refreshCurrentView();

    const syncEl = document.getElementById('sync-status');
    syncEl.classList.remove('hidden');
    try {
      await Drive.init();
      await Promise.all([EntryManager.load(), TagManager.load()]);
      refreshCurrentView(); // 真正的資料到了，再刷新一次畫面
    } catch (e) {
      toast('雲端同步失敗，請檢查網路連線：' + e.message, 'error');
      console.error(e);
    } finally {
      syncEl.classList.add('hidden');
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
      document.getElementById('settings-menu').classList.add('hidden');
      if (confirm('確定要登出嗎？')) Auth.logout();
    });

    // 重新整理 App（手機「加到主畫面」模式沒有瀏覽器的重新整理按鈕，
    // 遇到卡住/疑似還在跑舊版程式碼時，這是唯一能強制重新載入的入口）
    document.getElementById('reload-app-btn').addEventListener('click', () => {
      document.getElementById('settings-menu').classList.add('hidden');
      location.reload();
    });
    document.getElementById('update-reload-btn').addEventListener('click', () => location.reload());

    // 設定選單開關
    document.getElementById('settings-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('settings-menu').classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      document.getElementById('settings-menu').classList.add('hidden');
    });
    document.getElementById('settings-menu').addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // 視圖切換（只綁定有 data-view 的分頁，搜尋按鈕雖然視覺上同排但走自己的邏輯）
    document.querySelectorAll('.view-tabs .tab[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-tabs .tab[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        switchView(btn.dataset.view);
      });
    });

    // 新增日記
    document.getElementById('new-entry-btn').addEventListener('click', () => {
      // 在月曆頁選了某一天再按新增，直接帶入那天的日期，方便補記過去的日記，
      // 不用開了編輯器才手動點時間欄位改日期
      const selectedDate = currentView === 'calendar' ? Calendar.getSelectedDate() : null;
      Editor.open(null, selectedDate ? { defaultDate: selectedDate } : {});
    });
    document.getElementById('today-prompt-btn').addEventListener('click', () => Editor.open());

    // 時間軸折疊/展開
    document.getElementById('collapse-all-btn').addEventListener('click', () => Timeline.collapseAll());
    document.getElementById('expand-all-btn').addEventListener('click', () => Timeline.expandAll());

    // 月曆導航
    document.getElementById('cal-prev').addEventListener('click', () => Calendar.prevMonth());
    document.getElementById('cal-next').addEventListener('click', () => Calendar.nextMonth());
    document.getElementById('cal-today').addEventListener('click', () => Calendar.goToday());
    document.getElementById('day-copy-btn').addEventListener('click', () => Calendar.copyDayText());

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

    // 照片上傳
    document.getElementById('photo-input').addEventListener('change', (e) => {
      Editor.handlePhotoInput(Array.from(e.target.files));
      e.target.value = '';
    });

    // 影片上傳
    document.getElementById('video-input').addEventListener('change', (e) => {
      Editor.handleVideoInput(Array.from(e.target.files));
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
        // 編輯前一律重新抓 Drive 上最新版本，避免拿分頁裡可能過時的快取內容當底去改，
        // 把其他分頁/裝置這段時間新增的內容蓋掉
        const entry = await EntryManager.getEntryFresh(id);
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

    // ── 查看日記：切換同一天的上一則／下一則 ──
    document.getElementById('view-prev-btn').addEventListener('click', () => navigateViewEntry(-1));
    document.getElementById('view-next-btn').addEventListener('click', () => navigateViewEntry(1));
    attachSwipeNav(document.querySelector('#view-modal .modal-box'), {
      onSwipeLeft:  () => navigateViewEntry(1),
      onSwipeRight: () => navigateViewEntry(-1),
    });

    // ── 搜尋頁面 ──
    document.getElementById('search-btn').addEventListener('click', openSearchPage);
    document.getElementById('search-back-btn').addEventListener('click', closeSearchPage);
    document.getElementById('tt-back-btn').addEventListener('click', closeTimeTunnel);
    document.getElementById('do-search-btn').addEventListener('click', doSearch);
    document.getElementById('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
    document.getElementById('filter-date-clear').addEventListener('click', () => {
      document.getElementById('filter-date-from').value = '';
      document.getElementById('filter-date-to').value   = '';
    });
    // 標籤篩選下拉
    document.getElementById('tag-filter-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = document.getElementById('tag-filter-dropdown');
      if (dd.classList.contains('hidden')) {
        Search.renderTagFilterDropdown();
        dd.classList.remove('hidden');
        document.getElementById('tag-filter-btn').classList.add('active');
      } else {
        dd.classList.add('hidden');
        document.getElementById('tag-filter-btn').classList.remove('active');
      }
    });
    document.getElementById('tag-filter-dropdown').addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => {
      document.getElementById('tag-filter-dropdown').classList.add('hidden');
      document.getElementById('tag-filter-btn').classList.remove('active');
    });

    // ── 標籤管理 ──
    document.getElementById('tags-btn').addEventListener('click', () => {
      TagManager.renderModal();
      openModal('tags-modal');
    });
    document.getElementById('add-tag-submit-btn').addEventListener('click', async () => {
      const name   = document.getElementById('new-tag-name').value.trim();
      const parent = document.getElementById('new-tag-parent').value;
      const color  = TagManager.getNewTagColor();
      if (!name) { toast('請輸入標籤名稱', 'error'); return; }
      await TagManager.add(name, parent || null, color);
      document.getElementById('new-tag-name').value = '';
      TagManager.renderModal();
      toast('標籤已新增 ✓', 'success');
    });

    // ── 標籤批次管理 ──
    document.getElementById('tags-batch-toggle-btn').addEventListener('click', () => {
      TagManager.toggleBatchMode();
    });
    document.getElementById('tags-batch-delete-btn').addEventListener('click', () => {
      TagManager.batchDelete();
    });
    document.getElementById('tags-batch-move-btn').addEventListener('click', () => {
      const target = document.getElementById('tags-batch-move-target').value;
      TagManager.batchMove(target || null);
    });
    document.getElementById('tags-batch-merge-btn').addEventListener('click', () => {
      const target = document.getElementById('tags-batch-merge-target').value;
      TagManager.batchMergeInto(target);
    });

    // ── 統計 ──
    document.getElementById('stats-btn').addEventListener('click', () => {
      document.getElementById('settings-menu').classList.add('hidden');
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
    // 手機左右滑動切換照片（同一篇日記裡的其他張）
    attachSwipeNav(document.getElementById('lightbox'), {
      onSwipeLeft:  () => lightboxNav(1),
      onSwipeRight: () => lightboxNav(-1),
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
    if (currentView === 'today')    Today.render(entries);
    if (currentView === 'timeline') Timeline.render(entries);
    if (currentView === 'calendar') Calendar.render(entries);
    if (currentView === 'gallery')  Gallery.render(entries);
    Stats.renderMini(entries);

    // 疊在畫面最上層的全版頁面（搜尋／時光隧道）如果目前開著，也要一起刷新，
    // 不然從裡面刪除日記後，畫面要等重新整理過才會消失
    if (!document.getElementById('search-page').classList.contains('hidden')) {
      doSearch();
    }
    if (!document.getElementById('time-tunnel-page').classList.contains('hidden')) {
      TimeTunnel.refresh(entries);
    }
  }

  // ════════════════════════
  //  查看日記
  // ════════════════════════
  // 目前查看視窗「同一天」的日記清單＋目前是第幾則，用來做上一則／下一則切換
  let viewDayEntries = [];
  let viewDayIdx     = 0;

  async function viewEntry(id) {
    showLoading('載入日記…');
    try {
      const entry = await EntryManager.getEntry(id);
      // 算出「這一天」的所有日記（依時間排序），讓查看視窗可以左右切換同一天的其他篇
      const dayStr = entry.created_at.slice(0, 10);
      viewDayEntries = EntryManager.getIndex()
        .filter(e => e.created_at.slice(0, 10) === dayStr)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      viewDayIdx = viewDayEntries.findIndex(e => e.id === id);
      hideLoading();
      renderViewModal(entry);
    } catch (e) {
      hideLoading();
      toast('載入失敗：' + e.message, 'error');
    }
  }

  // 切換到同一天的上一則／下一則（循環），不用關掉查看視窗回列表重選
  async function navigateViewEntry(dir) {
    if (viewDayEntries.length <= 1) return;
    viewDayIdx = (viewDayIdx + dir + viewDayEntries.length) % viewDayEntries.length;
    const nextId = viewDayEntries[viewDayIdx].id;
    try {
      const entry = await EntryManager.getEntry(nextId);
      renderViewModal(entry);
    } catch (e) {
      toast('載入失敗：' + e.message, 'error');
    }
  }

  function renderViewModal(entry) {
    const modal = document.getElementById('view-modal');
    modal.dataset.entryId = entry.id;

    // 只有這一天有不只一篇日記時，才顯示上一則／下一則按鈕
    const hasMultiple = viewDayEntries.length > 1;
    document.getElementById('view-prev-btn').classList.toggle('view-nav-invisible', !hasMultiple);
    document.getElementById('view-next-btn').classList.toggle('view-nav-invisible', !hasMultiple);

    // 時間
    document.getElementById('view-datetime').textContent =
      new Date(entry.created_at).toLocaleString('zh-TW', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Asia/Taipei'
      });

    // 標籤（可點擊編輯）
    const tagsEl = document.getElementById('view-tags');
    let viewEntryTags = [...(entry.tags || [])];

    function renderViewTags() {
      tagsEl.innerHTML = '';
      for (const tagId of viewEntryTags) {
        const tag = TagManager.getById(tagId);
        if (tag) tagsEl.appendChild(Editor.makeTagChip(tag));
      }
      // 編輯按鈕
      const editTagBtn = document.createElement('button');
      editTagBtn.className = 'view-edit-tags-btn';
      editTagBtn.textContent = viewEntryTags.length > 0 ? '✏️' : '＋ 新增標籤';
      editTagBtn.title = '編輯標籤';
      editTagBtn.onclick = (e) => {
        e.stopPropagation();
        SmartTagPicker.open(editTagBtn, viewEntryTags, async (newIds) => {
          viewEntryTags = newIds;
          renderViewTags();
          // 背景儲存（不等待，不擋 UI）——只傳要改的 tags，其餘欄位（內文、時間、照片）
          // 讓 update() 自己重新向 Drive 抓最新版本再套用，不要在這裡先讀一份可能過時的
          // 內容再整包傳回去，避免把其他分頁這段時間新增的內容蓋掉
          try {
            await EntryManager.update(entry.id, { tags: newIds });
          } catch(e) { console.warn('標籤儲存失敗', e); }
        });
      };
      tagsEl.appendChild(editTagBtn);
    }
    renderViewTags();

    // meta（天氣、位置）
    const metaEl = document.getElementById('view-meta');
    metaEl.innerHTML = '';
    const dayMood = EntryManager.getDayMood(entry.created_at.slice(0, 10));
    if (dayMood) {
      const m = getMood(dayMood);
      if (m) metaEl.innerHTML += `<span class="day-mood-badge">${moodIconSVG(dayMood, 16)} ${m.label}</span>`;
    }
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

    // 影片
    const videosEl = document.getElementById('view-videos');
    videosEl.innerHTML = '';
    for (const video of entry.videos || []) {
      const el = document.createElement('video');
      el.className = 'view-video';
      el.controls = true;
      el.playsInline = true;
      el.style.background = '#000';
      Drive.getVideoUrl(video.drive_file_id).then(url => { el.src = url; });
      videosEl.appendChild(el);
    }

    openModal('view-modal');
    modal.querySelector('.modal-box').scrollTop = 0; // 切到下一則時從頂部開始看，不要沿用上一則的捲動位置
  }

  // ════════════════════════
  //  搜尋頁面
  // ════════════════════════
  function openSearchPage() {
    document.getElementById('search-page').classList.remove('hidden');
    document.getElementById('search-hint').classList.remove('hidden');
    document.getElementById('search-empty').classList.add('hidden');
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-input').focus();
    Search.initTagFilter();
  }

  function closeSearchPage() {
    document.getElementById('search-page').classList.add('hidden');
    document.getElementById('search-input').value = '';
  }

  // ════════════════════════
  //  時光隧道頁面
  // ════════════════════════
  function closeTimeTunnel() {
    document.getElementById('time-tunnel-page').classList.add('hidden');
  }

  // 從統計頁面點標籤直接跳到搜尋結果
  function openSearchWithTag(tagId) {
    openSearchPage();
    Search.setTagFilter([tagId]);
    doSearch(); // 以該標籤為篩選條件執行搜尋
  }

  function doSearch() {
    const q        = document.getElementById('search-input').value;
    const hasPhoto = document.getElementById('filter-has-photo').checked;
    const hasLink  = document.getElementById('filter-has-link').checked;
    const tagIds   = Search.getSelectedTagFilters();
    const dateFrom = document.getElementById('filter-date-from').value;
    const dateTo   = document.getElementById('filter-date-to').value;
    const results  = Search.run(q, { hasPhoto, hasLink, tags: tagIds, dateFrom, dateTo });

    document.getElementById('search-hint').classList.add('hidden');
    document.getElementById('search-empty').classList.toggle('hidden', results.length > 0);
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
              has_videos: entry.has_videos || false,
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

  // ── 通用左右滑動偵測（手機用）：判斷手勢明顯偏水平方向且滑動距離夠遠才觸發，
  //    避免跟畫面正常的上下捲動互相打架 ──
  function attachSwipeNav(el, { onSwipeLeft, onSwipeRight, threshold = 50 } = {}) {
    let startX = 0, startY = 0, tracking = false;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return; // 太短或偏垂直，當作捲動不處理
      if (dx < 0) onSwipeLeft?.(); else onSwipeRight?.();
    }, { passive: true });
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

  // ── 啟動 ──
  document.addEventListener('DOMContentLoaded', () => {
    init();
    SmartTagPicker.init();
  });

  return { toast, showLoading, hideLoading, refreshCurrentView, viewEntry, closeSearchPage, openSearchWithTag };
})();
