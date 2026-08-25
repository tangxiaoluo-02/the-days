// ── Google OAuth 認證模組 ──
const Auth = (() => {
  let tokenClient = null;
  let accessToken  = null;
  let tokenExpiry  = 0;
  let onLoginCb    = null;
  let onLogoutCb   = null;
  let _silentAttempt = false; // 是否正在「悄悄續期」，用來決定失敗時要不要跳錯誤提示

  function init({ onLogin, onLogout }) {
    onLoginCb  = onLogin;
    onLogoutCb = onLogout;

    // 等 GIS script 載入完成
    const tryInit = () => {
      if (typeof google === 'undefined') {
        setTimeout(tryInit, 200);
        return;
      }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope:     CONFIG.SCOPES,
        callback:  handleTokenResponse,
        error_callback: (err) => {
          console.error('OAuth error', err);
          // 悄悄續期失敗時不要跳錯誤提示，讓使用者安靜地看到登入畫面就好
          if (!_silentAttempt) App.toast('登入失敗，請再試一次', 'error');
          _silentAttempt = false;
        },
      });

      // 嘗試從 localStorage 還原 token
      const saved = localStorage.getItem('td_token');
      if (saved) {
        const { token, expiry, user } = JSON.parse(saved);
        if (Date.now() < expiry) {
          accessToken = token;
          tokenExpiry = expiry;
          onLoginCb && onLoginCb(user);
          return;
        }
        // Google 存取權杖大約 1 小時就會過期（這個 App 沒有後端伺服器保管
        // refresh token，只能拿到短效的 access token，這是 Google 這種
        // 純前端登入方式的硬性限制）。過期了不代表殿下真的登出了，先悄悄
        // 試著在背景重新要一次權杖，瀏覽器裡如果還留著 Google 的登入狀態，
        // 通常不需要殿下再手動點一次「登入」。
        _silentAttempt = true;
        tokenClient.requestAccessToken({ prompt: '' });
      }
    };
    tryInit();
  }

  function handleTokenResponse(resp) {
    _silentAttempt = false;
    if (resp.error) return;
    accessToken = resp.access_token;
    tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;

    // 取得使用者資料
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    .then(r => r.json())
    .then(user => {
      localStorage.setItem('td_token', JSON.stringify({
        token: accessToken,
        expiry: tokenExpiry,
        user: { name: user.name, picture: user.picture, email: user.email }
      }));
      onLoginCb && onLoginCb({ name: user.name, picture: user.picture, email: user.email });
    });
  }

  function login() {
    if (!tokenClient) {
      App.toast('Google 服務尚未就緒，請稍後再試', 'error');
      return;
    }
    tokenClient.requestAccessToken({ prompt: '' });
  }

  function logout() {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken);
    }
    accessToken = null;
    tokenExpiry = 0;
    localStorage.removeItem('td_token');
    onLogoutCb && onLogoutCb();
  }

  async function getToken() {
    if (!accessToken || Date.now() >= tokenExpiry) {
      // Token 過期，靜默刷新
      await new Promise((resolve) => {
        const saved = localStorage.getItem('td_token');
        if (saved) {
          const { expiry } = JSON.parse(saved);
          if (Date.now() >= expiry) {
            tokenClient.requestAccessToken({ prompt: '' });
            const origCb = tokenClient.callback;
            tokenClient.callback = (resp) => {
              origCb(resp);
              resolve();
            };
            return;
          }
        }
        resolve();
      });
    }
    return accessToken;
  }

  function isLoggedIn() {
    return !!accessToken && Date.now() < tokenExpiry;
  }

  return { init, login, logout, getToken, isLoggedIn };
})();
