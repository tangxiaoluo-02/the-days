// ── 殿下請在這裡填入 Google Cloud Console 取得的 Client ID ──
const CONFIG = {
  CLIENT_ID: '496284264885-ejuvq51r2t5mn2q3g79ub9k4fa6ovjr1.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
  DRIVE_FOLDER_NAME: 'The Days',
};

// ── 心情選項（手繪插畫，不用系統表情符號）──
const MOODS = [
  { id: 'super',   label: '特棒', color: '#FF6FA0' },
  { id: 'happy',   label: '快樂', color: '#FFC53D' },
  { id: 'calm',    label: '平靜', color: '#5FCBA8' },
  { id: 'okay',    label: '普通', color: '#5BB8F0' },
  { id: 'sad',     label: '難過', color: '#5C86D6' },
  { id: 'angry',   label: '生氣', color: '#FF6B5B' },
  { id: 'nervous', label: '緊張', color: '#B98AF2' },
  { id: 'tired',   label: '疲倦', color: '#FF9F5C' },
];

function getMood(id) {
  return MOODS.find(m => m.id === id) || null;
}

// ── 心情插畫（手繪墨線 + 不規則色塊）──
const MOOD_BLOB_PATH = 'M50,7 C69,5 93,17 94,40 C95,61 83,87 57,93 C36,98 10,85 6,62 C2,40 15,14 36,9 C40,8 45,7.5 50,7 Z';
const MOOD_INK = '#3B2A1E';

function moodFaceMarkup(id) {
  const s = `fill="none" stroke="${MOOD_INK}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"`;
  switch (id) {
    case 'super': return `
      <path d="M28,42 Q37,30 46,42" ${s}/>
      <path d="M54,42 Q63,30 72,42" ${s}/>
      <path d="M26,58 Q50,84 74,58" ${s}/>
      <path d="M16,22 L16,32 M11,27 L21,27" ${s} stroke-width="3"/>
      <path d="M82,32 L82,40 M78,36 L86,36" ${s} stroke-width="2.6"/>`;
    case 'happy': return `
      <path d="M29,43 Q37,32 45,43" ${s}/>
      <path d="M55,43 Q63,32 71,43" ${s}/>
      <path d="M27,59 Q50,80 73,59" ${s}/>`;
    case 'calm': return `
      <path d="M30,45 Q37,42 44,45" ${s} stroke-width="3.6"/>
      <path d="M56,45 Q63,42 70,45" ${s} stroke-width="3.6"/>
      <path d="M39,64 Q50,68 61,64" ${s} stroke-width="3.6"/>`;
    case 'okay': return `
      <circle cx="37" cy="46" r="3.8" fill="${MOOD_INK}"/>
      <circle cx="63" cy="46" r="3.8" fill="${MOOD_INK}"/>
      <path d="M34,66 L66,66" ${s}/>`;
    case 'sad': return `
      <circle cx="37" cy="48" r="3.4" fill="${MOOD_INK}"/>
      <circle cx="63" cy="48" r="3.4" fill="${MOOD_INK}"/>
      <path d="M25,36 Q33,32 40,37" ${s} stroke-width="3.2"/>
      <path d="M60,37 Q67,32 75,36" ${s} stroke-width="3.2"/>
      <path d="M33,73 Q50,60 67,73" ${s}/>
      <path d="M27,54 Q23,62 27,68 Q31,62 27,54 Z" fill="#BFE0FF" stroke="${MOOD_INK}" stroke-width="2.4"/>`;
    case 'angry': return `
      <path d="M27,37 L42,44" ${s} stroke-width="3.6"/>
      <path d="M73,37 L58,44" ${s} stroke-width="3.6"/>
      <circle cx="37" cy="50" r="3" fill="${MOOD_INK}"/>
      <circle cx="63" cy="50" r="3" fill="${MOOD_INK}"/>
      <path d="M32,68 L42,64 L50,68 L58,64 L68,68" ${s} stroke-width="3.6"/>`;
    case 'nervous': return `
      <circle cx="37" cy="46" r="5.2" fill="none" stroke="${MOOD_INK}" stroke-width="3"/>
      <circle cx="63" cy="46" r="5.2" fill="none" stroke="${MOOD_INK}" stroke-width="3"/>
      <circle cx="38.5" cy="44.5" r="1.6" fill="${MOOD_INK}"/>
      <circle cx="64.5" cy="44.5" r="1.6" fill="${MOOD_INK}"/>
      <path d="M32,67 Q37,62 42,67 Q47,62 52,67 Q57,62 62,67 Q67,62 71,67" ${s} stroke-width="3.4"/>
      <path d="M75,32 Q71,40 75,46 Q79,40 75,32 Z" fill="#BFE0FF" stroke="${MOOD_INK}" stroke-width="2.2"/>`;
    case 'tired': return `
      <path d="M29,45 L45,45" ${s}/>
      <path d="M55,45 L71,45" ${s}/>
      <path d="M34,66 Q50,61 66,66" ${s}/>
      <path d="M69,25 L76,18 M73,28 L81,24" ${s} stroke-width="3.2"/>`;
    default: return '';
  }
}

/** 回傳心情插畫的 SVG 標記字串，size 為顯示的像素大小 */
function moodIconSVG(id, size = 20) {
  const m = getMood(id);
  if (!m) return '';
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${m.label}">
    <path d="${MOOD_BLOB_PATH}" fill="${m.color}" stroke="${MOOD_INK}" stroke-width="3.4" stroke-linejoin="round"/>
    ${moodFaceMarkup(id)}
  </svg>`;
}

// ── 全域日期工具（使用本地時間，避免 UTC 時區偏差）──

/** 回傳本地日期字串，如 "2026-05-12" */
function localDateStr(d) {
  const date = d || new Date();
  const y   = date.getFullYear();
  const m   = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 建立日記卡片用的縮圖列（最多 3 張），沒有照片回傳 null。
 *  相容舊資料：如果索引還沒有 photo_ids（尚未重新存檔過），退回用 first_photo 顯示 1 張。 */
function renderEntryThumbs(entry) {
  const photoIds = entry.photo_ids?.length ? entry.photo_ids : (entry.first_photo ? [entry.first_photo] : []);
  if (!photoIds.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'entry-card-photos';
  for (const photoId of photoIds) {
    const img = document.createElement('img');
    img.className = 'entry-thumb';
    img.alt = '照片';
    img.style.background = 'var(--surface-2)';
    Drive.getPhotoUrl(photoId).then(url => { img.src = url; });
    wrap.appendChild(img);
  }
  return wrap;
}

/** 回傳帶時區的 ISO 字串，如 "2026-05-12T01:30:00+08:00" */
function toLocalISOString(d) {
  const date   = d || new Date();
  const y      = date.getFullYear();
  const mo     = String(date.getMonth() + 1).padStart(2, '0');
  const day    = String(date.getDate()).padStart(2, '0');
  const h      = String(date.getHours()).padStart(2, '0');
  const min    = String(date.getMinutes()).padStart(2, '0');
  const s      = String(date.getSeconds()).padStart(2, '0');
  const offset = -date.getTimezoneOffset();              // 分鐘
  const sign   = offset >= 0 ? '+' : '-';
  const oh     = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const om     = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${y}-${mo}-${day}T${h}:${min}:${s}${sign}${oh}:${om}`;
}
