// ── Google OAuth 認證模組 ──
const Auth = (() => {
  let tokenClient = null;
  let accessToken  = null;
  let tokenExpiry  = 0;
  let onLoginCb    = null;
  let onLogoutCb   = null;
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
        }
        // 過期了就不主動做任何事，直接停在登入畫面讓殿下自己點「登入」。
        // 這裡原本會在背景悄悄試著續期一次，省得殿下手動登入——但手機瀏覽器
        // （尤其 iOS Safari「加到主畫面」模式）幾乎都會擋掉這種沒有使用者
        // 手動點擊撐腰的彈出視窗請求，實測下來還是常常讓殿下卡在「登入處理
        // 中」，就算加了逾時保底也還是常態性卡住。殿下確認過寧可每次都手動
        // 點一次登入，也不要再遇到卡住問題——不主動嘗試，殿下的每一次「登入」
        // 點擊都會是唯一、乾淨、有真人手勢撐腰的請求，不會跟任何背景請求
        // 搶著跳出彈窗或卡在等一個不知道會不會成功的舊請求，這是目前這個
        // 純前端（無後端保管 refresh token）架構下最不容易卡住的做法。
      }
    };
    tryInit();
  }

  // 讓目前正在等待「跟 Google 要權杖」的呼叫端統一收到失敗結果——不管觸發來源是
  // Google 的 error_callback，還是下面 requestToken() 自己的逾時保底，都共用這一個
  // 出口，確保只會真正 reject 一次。
  function failPendingRequest(err) {
    if (!_pendingReject) return; // 已經結束過一次了（例如已經被逾時保底處理掉）
    const reject = _pendingReject;
    _pendingRequest = null;
    _pendingReject  = null;
    App.toast('登入逾時或失敗，請再點一次「登入」重試', 'error');
    reject(err);
  }

  // 統一的「跟 Google 要一次權杖」入口——同一時間只允許一個請求在跑，其他呼叫者
  // 直接跟著等同一個結果，不會各自另外開一個彈窗互相打架。
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

      // 保底逾時：Google 的 SDK 偶爾會完全不呼叫 callback、也不呼叫
      // error_callback，讓這個 promise 永遠卡在 pending。20 秒是給真人選
      // 帳號/輸入密碼留的合理寬限，逾時就當作失敗處理，讓殿下能重新點擊
      // 再試一次，不會被卡死。
      setTimeout(() => failPendingRequest(new Error('登入逾時，Google 服務沒有回應')), 20000);
    });
    return _pendingRequest;
  }

  function handleTokenResponse(resp) {
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
      // 已經有一個請求在跑了（例如殿下連續點了兩次），跟著等同一個結果就好，
      // 不要再另外開一個彈窗互相打架
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
      // 請求互相打架。這裡是「已經登入過、寫日記寫到一半權杖過期」的情境，
      // 跟 init() 那個「一開始就過期」的情境不同，維持原本的自動重試不變。
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
