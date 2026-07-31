const MOTZ_BRIDGE_URLS = ["http://127.0.0.1:39875", "http://127.0.0.1:39876"];
const REQUEST_TIMEOUT_MS = 1800;

document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

function updateStatus(response) {
  const status = document.getElementById("status");
  const online = Boolean(response?.ok);
  status.textContent = online ? "桌面端已连接" : response?.error || "请先打开 MOTZ 白板桌面端";
  status.classList.toggle("offline", !online);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body.ok !== false, ...body };
  } finally {
    clearTimeout(timer);
  }
}

async function checkStatus() {
  const errors = [];
  for (const bridgeUrl of MOTZ_BRIDGE_URLS) {
    try {
      const result = await fetchWithTimeout(`${bridgeUrl}/status`);
      if (result.ok) {
        updateStatus(result);
        return;
      }
      errors.push(result.error || "桌面端未响应");
    } catch (error) {
      errors.push(error?.name === "AbortError" ? "连接超时" : "连接失败");
    }
  }
  updateStatus({ ok: false, error: errors.find(Boolean) || "请先打开 MOTZ 白板桌面端" });
}

document.getElementById("check")?.addEventListener("click", checkStatus);
checkStatus();
