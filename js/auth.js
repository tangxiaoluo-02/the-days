// ── Google OAuth 認證模組 ──
const Auth = (() => {
  let tokenClient = null;
  let accessToken  = null;
  let tokenExpiry  = 0;
  let onLoginCb    = null;
  let onLogoutCb   = null;
  let _silentAttempt  = false; // 是否正在「悄悄續期」，用來決定失敗時要不要跳錯誤提示
  let _pendingRequest = null;  // 目前有沒有一個「跟 Google 要權杖」的請求正在跑（大家共用同一個）
  let _pendingReject  = null;  // 配合 _pendingRequest，讓 error_callback 也能讓對應的 promise 正確結束
                                // （不然請求失敗時 promise 會永遠卡著，呼叫端會整個掛住不動）

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
          failPendingRequest(new Error(err?.type || '登入權杖續期失敗'));
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
        requestToken().catch(() => {}); // 失敗的話 error_callback 已經處理過了，這裡不用重複反應
      }
    };
    tryInit();
  }

  // 讓目前正在等待「跟 Google 要權杖」的呼叫端統一收到失敗結果——不管觸發來源是
  // Google 的 error_callback，還是下面 requestToken() 自己的逾時保底，都共用這一個
  // 出口，確保只會真正 reject 一次，也確保「悄悄續期」失敗時不會多跳一次錯誤提示。
  function failPendingRequest(err) {
    if (!_pendingReject) return; // 已經結束過一次了（例如已經被逾時保底處理掉）
    const reject = _pendingReject;
    _pendingRequest = null;
    _pendingReject  = null;
    // 悄悄續期失敗時不要跳錯誤提示，讓使用者安靜地看到登入畫面就好
    if (!_silentAttempt) App.toast('登入逾時或失敗，請再點一次「登入」重試', 'error');
    _silentAttempt = false;
    reject(err);
  }

  // 統一的「跟 Google 要一次權杖」入口——同一時間只允許一個請求在跑，其他呼叫者
  // 直接跟著等同一個結果，不會各自另外開一個彈窗互相打架。
  // 這是解決「頁面剛打開時背景悄悄續期」跟「殿下手動點登入」同時搶著跳出 Google
  // 帳號選擇彈窗、選完又跳第二次、最後整個分頁當機這個問題的關鍵。
  function requestToken() {
    if (_pendingRequest) return _pendingRequest;
    _pendingRequest = new Promise((resolve, reject) => {
      _pendingReject = reject;
      const origCallback = tokenClient.callback;
      tokenClient.callback = (resp) => {
        tokenClient.callback = origCallback; // 用完就恢復，避免下次疊加包裝
        _pendingRequest = null;
        _pendingReject  = null;
        origCallback(resp);
        // Google 有時候不是走 error_callback，而是直接用這個「成功」callback
        // 回傳一個帶 error 欄位的結果——這種情況也要 reject，不然一樣會卡住
        if (resp?.error) reject(new Error(resp.error));
        else resolve(resp);
      };
      tokenClient.requestAccessToken({ prompt: '' });

      // 保底逾時：手機 Safari 有時候會擋掉「不是使用者直接點擊觸發」的彈出視窗
      // （例如頁面剛打開時的背景悄悄續期），這種情況下 Google 的 SDK 可能完全不會
      // 呼叫 callback、也不會呼叫 error_callback，讓這個 promise 永遠卡在 pending。
      // 殿下就會卡在「登入處理中，請稍候」動彈不得——因為手動點登入時發現已經有
      // 一個請求在跑，只會跟著等同一個（早就卡死的）結果，永遠等不到。
      // 20 秒是抓一個對真人互動彈出視窗（選帳號、輸入密碼）也夠用的寬限，逾時
      // 就當作失敗處理，讓殿下能重新點擊再試一次，不會被卡死。
      setTimeout(() => failPendingRequest(new Error('登入逾時，Google 服務沒有回應')), 20000);
    });
    return _pendingRequest;
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

  async function login() {
    if (!tokenClient) {
      // 剛打開頁面時，Google 的登入服務程式可能還在背景載入中，殿下這時點登入
      // 以前會直接放棄、跳一個容易被忽略的提示，殿下常常沒注意到要再點一次。
      // 改成在這裡等它準備好（最多 8 秒），準備好就自動繼續登入，不用殿下自己重試
      App.toast('連線 Google 服務中，請稍候…', '');
      const ready = await waitForTokenClient(8000);
      if (!ready) {
        App.toast('連線 Google 服務失敗，請檢查網路後重新整理頁面再試一次', 'error');
        return;
      }
    }
    if (_pendingRequest) {
      // 已經有一個請求在背景跑了（通常是頁面剛打開時的悄悄續期），跟著等同一個
      // 結果就好，不要再另外開一個彈窗。這裡故意接一個空的 catch——失敗的話
      // error_callback 自己已經跳過提示了，這裡不用重複顯示
      App.toast('登入處理中，請稍候…', '');
      await _pendingRequest.catch(() => {});
      return;
    }
    requestToken().catch(() => {});
  }

  function waitForTokenClient(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (tokenClient) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 200);
      };
      check();
    });
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
      // Token 過期，靜默刷新——一樣透過共用的 requestToken()，避免跟其他地方的
      // 請求互相打架
      const saved = localStorage.getItem('td_token');
      if (saved) {
        const { expiry } = JSON.parse(saved);
        if (Date.now() >= expiry) {
          await requestToken();
        }
      }
    }
    return accessToken;
  }

  function isLoggedIn() {
    return !!accessToken && Date.now() < tokenExpiry;
  }

  return { init, login, logout, getToken, isLoggedIn };
})();
