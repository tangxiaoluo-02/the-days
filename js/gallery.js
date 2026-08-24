// ── 畫廊視圖模組 ──
const Gallery = (() => {

  function render(entries) {
    const container = document.getElementById('gallery-container');
    const empty     = document.getElementById('gallery-empty');
    container.innerHTML = '';

    const withPhotos = entries
      .filter(e => e.has_photos && e.first_photo)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // 依日記時間排序，不是插入順序

    if (!withPhotos.length) {
      empty.classList.remove('hidden');
      container.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    container.classList.remove('hidden');

    // 捲到快看到時才真的去抓照片，避免資料一多打開畫廊就同時塞爆幾百個下載請求
    const observer = new IntersectionObserver((observed) => {
      for (const o of observed) {
        if (!o.isIntersecting) continue;
        const img = o.target;
        Drive.getPhotoUrl(img.dataset.photoId).then(url => { img.src = url; });
        observer.unobserve(img);
      }
    }, { rootMargin: '600px' }); // 提前一點載入，正常速度捲動不會看到空白閃現

    for (const entry of withPhotos) {
      const item = document.createElement('div');
      item.className = 'gallery-item';

      const img = document.createElement('img');
      img.alt = entry.preview || '';
      img.style.minHeight = '80px';
      img.style.background = 'var(--surface-2)';
      img.dataset.photoId = entry.first_photo;
      observer.observe(img);

      const overlay = document.createElement('div');
      overlay.className = 'gallery-item-overlay';
      const d = new Date(entry.created_at);
      overlay.textContent = `${d.getMonth()+1}/${d.getDate()} ${entry.preview?.slice(0, 30) || ''}`;

      item.appendChild(img);
      item.appendChild(overlay);
      item.addEventListener('click', () => App.viewEntry(entry.id));
      container.appendChild(item);
    }
  }

  return { render };
})();
