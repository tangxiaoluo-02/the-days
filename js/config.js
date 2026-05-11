// ── 殿下請在這裡填入 Google Cloud Console 取得的 Client ID ──
const CONFIG = {
  CLIENT_ID: '496284264885-ejuvq51r2t5mn2q3g79ub9k4fa6ovjr1.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
  DRIVE_FOLDER_NAME: 'The Days',
};

// ── 全域日期工具（使用本地時間，避免 UTC 時區偏差）──

/** 回傳本地日期字串，如 "2026-05-12" */
function localDateStr(d) {
  const date = d || new Date();
  const y   = date.getFullYear();
  const m   = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
