// ── 天氣與位置模組（使用 Open-Meteo，不需 API Key）──
const Weather = (() => {

  const WMO_CODES = {
    0:  { text: '晴天',   icon: '☀️' },
    1:  { text: '晴時多雲', icon: '🌤' },
    2:  { text: '多雲',   icon: '⛅' },
    3:  { text: '陰天',   icon: '☁️' },
    45: { text: '有霧',   icon: '🌫' },
    48: { text: '凍霧',   icon: '🌫' },
    51: { text: '毛毛雨', icon: '🌦' },
    53: { text: '毛毛雨', icon: '🌦' },
    55: { text: '毛毛雨', icon: '🌦' },
    61: { text: '小雨',   icon: '🌧' },
    63: { text: '中雨',   icon: '🌧' },
    65: { text: '大雨',   icon: '🌧' },
    71: { text: '小雪',   icon: '🌨' },
    73: { text: '中雪',   icon: '❄️' },
    75: { text: '大雪',   icon: '❄️' },
    80: { text: '陣雨',   icon: '🌦' },
    81: { text: '陣雨',   icon: '🌦' },
    82: { text: '大陣雨', icon: '⛈' },
    95: { text: '雷陣雨', icon: '⛈' },
    96: { text: '雷陣雨', icon: '⛈' },
    99: { text: '雷陣雨', icon: '⛈' },
  };

  async function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('瀏覽器不支援定位'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        err => reject(new Error('定位失敗：' + err.message)),
        { timeout: 8000 }
      );
    });
  }

  async function reverseGeocode(lat, lng) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=zh-TW`;
      const resp = await fetch(url, { headers: { 'Accept-Language': 'zh-TW' } });
      const data = await resp.json();
      const addr = data.address || {};
      return addr.city || addr.town || addr.county || addr.state || '未知地點';
    } catch {
      return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
    }
  }

  async function fetchWeather(lat, lng) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
      + `&current=temperature_2m,weathercode&timezone=Asia/Taipei&forecast_days=1`;
    const resp = await fetch(url);
    const data = await resp.json();
    const cur  = data.current;
    const code = cur.weathercode;
    const info = WMO_CODES[code] || { text: '未知天氣', icon: '🌡' };

    return {
      condition:   info.text,
      icon:        info.icon,
      temperature: Math.round(cur.temperature_2m),
      code,
    };
  }

  async function fetchAll() {
    const { lat, lng } = await getLocation();
    const [weather, locationName] = await Promise.all([
      fetchWeather(lat, lng),
      reverseGeocode(lat, lng),
    ]);
    return {
      weather: { ...weather },
      location: { name: locationName, lat, lng },
    };
  }

  return { fetchAll };
})();
