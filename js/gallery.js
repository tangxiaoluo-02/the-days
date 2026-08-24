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

    for (const entry of withPhotos) {
      const item = document.createElement('div');
      item.className = 'gallery-item';

      const img = document.createElement('img');
      img.alt = entry.preview || '';
      img.style.minHeight = '80px';
      img.style.background = 'var(--surface-2)';
      Drive.getPhotoUrl(entry.first_photo).then(url => { img.src = url; });

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
