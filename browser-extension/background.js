const MOTZ_BRIDGE_URLS = ["http://127.0.0.1:39875", "http://127.0.0.1:39876"];
const REQUEST_TIMEOUT_MS = 45000;
const BRIDGE_STATUS_TIMEOUT_MS = 1800;
const REMOTE_IMAGE_TIMEOUT_MS = 16000;
const CONTEXT_MENU_LIBRARY = "motz-save-library";
const CONTEXT_MENU_BOARD = "motz-send-board";
const REMOTE_IMAGE_LIMIT_BYTES = 80 * 1024 * 1024;

function extensionFromContentType(contentType = "") {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/avif": ".avif",
    "image/tiff": ".tif",
  };
  return map[normalized] || "";
}

function mimeFromFileName(fileName = "") {
  const ext = String(fileName).split(".").pop()?.toLowerCase();
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    avif: "image/avif",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return map[ext] || "";
}

function fileNameFromUrl(remoteUrl, contentType = "", index = 0) {
  let fileName = "";
  try {
    const url = new URL(remoteUrl);
    fileName = decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch {
    fileName = "";
  }

  const cleanName = fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  const hasImageExt = /\.(jpe?g|png|gif|webp|bmp|avif|tiff?)$/i.test(cleanName);
  const ext = hasImageExt ? "" : extensionFromContentType(contentType) || ".png";
  return cleanName ? `${cleanName}${ext}` : `web-image-${Date.now()}-${index}${ext}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function sanitizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      url: String(item?.url || "").trim(),
      pageUrl: String(item?.pageUrl || "").trim(),
      title: String(item?.title || "").trim(),
      alt: String(item?.alt || "").trim(),
    }))
    .filter((item) => /^https?:\/\//i.test(item.url))
    .slice(0, 24);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteImageItem(item, index = 0) {
  if (!/^https?:\/\//i.test(item?.url || "")) return item;

  const expectedSize = Number(item.size || 0);
  if (expectedSize > REMOTE_IMAGE_LIMIT_BYTES) {
    throw new Error("网页图片超过插件传输限制");
  }

  const fetchOptions = {
    credentials: "include",
    cache: "force-cache",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  };

  if (/^https?:\/\//i.test(item.pageUrl || "")) {
    fetchOptions.referrer = item.pageUrl;
    fetchOptions.referrerPolicy = "strict-origin-when-cross-origin";
  }

  const response = await fetchWithTimeout(item.url, fetchOptions, REMOTE_IMAGE_TIMEOUT_MS);
  if (!response.ok) throw new Error(`浏览器读取图片失败 HTTP ${response.status}`);

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > REMOTE_IMAGE_LIMIT_BYTES) {
    throw new Error("网页图片超过插件传输限制");
  }

  const blob = await response.blob();
  if (blob.size > REMOTE_IMAGE_LIMIT_BYTES) {
    throw new Error("网页图片超过插件传输限制");
  }

  const fileName = fileNameFromUrl(item.url, response.headers.get("content-type") || blob.type || "", index);
  const mimeType =
    (response.headers.get("content-type") || blob.type || mimeFromFileName(fileName) || "image/png")
      .split(";")[0]
      .trim()
      .toLowerCase();

  if (!mimeType.startsWith("image/")) {
    throw new Error("网页返回的不是图片数据");
  }

  const buffer = await blob.arrayBuffer();
  return {
    ...item,
    dataUrl: `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`,
    fileName,
    mimeType,
  };
}

async function preparePayloadForBridge(payload) {
  const items = sanitizeItems(payload.items);
  const preparedItems = [];

  for (const [index, item] of items.entries()) {
    try {
      preparedItems.push(await fetchRemoteImageItem(item, index));
    } catch (error) {
      preparedItems.push({
        ...item,
        browserFetchError: error?.message || "浏览器读取图片失败",
      });
    }
  }

  return {
    ...payload,
    items: preparedItems,
  };
}

async function requestJson(baseUrl, path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, options, timeoutMs);
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok && body.ok !== false, status: response.status, bridgeUrl: baseUrl, ...body };
}

async function requestAnyBridge(path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const errors = [];
  for (const baseUrl of MOTZ_BRIDGE_URLS) {
    try {
      const result = await requestJson(baseUrl, path, options, timeoutMs);
      if (result.ok || result.status < 500) return result;
      errors.push(`桌面端保存失败：${result.error || `HTTP ${result.status}`}`);
    } catch (error) {
      errors.push(error?.name === "AbortError" ? "连接桌面端超时" : "没有连上 MOTZ 桌面端");
    }
  }
  return { ok: false, error: errors.find(Boolean) || "没有连上 MOTZ 桌面端" };
}

async function postToMotz(payload) {
  const status = await requestAnyBridge("/status", {}, BRIDGE_STATUS_TIMEOUT_MS);
  if (!status.ok) return status;
  const preparedPayload = await preparePayloadForBridge(payload);
  return requestAnyBridge("/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preparedPayload),
  });
}

function notify(title, message) {
  if (!chrome.notifications?.create) return;
  try {
    chrome.notifications.create(
      {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message: String(message || ""),
      },
      () => {
        void chrome.runtime.lastError;
      },
    );
  } catch {
    // Notifications are a convenience; collection should not depend on them.
  }
}

function rebuildContextMenus() {
  if (!chrome.contextMenus?.removeAll) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_LIBRARY,
      title: "收藏到 MOTZ 素材库",
      contexts: ["image"],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_BOARD,
      title: "发送到 MOTZ 当前白板",
      contexts: ["image"],
    });
  });
}

async function collectContextImage(target, info, tab) {
  const items = sanitizeItems([
    {
      url: info?.srcUrl || info?.linkUrl || "",
      pageUrl: info?.pageUrl || tab?.url || "",
      title: tab?.title || "",
      alt: "",
    },
  ]);

  if (items.length === 0) {
    return { ok: false, error: "没有识别到图片链接" };
  }

  return postToMotz({
    source: "motz-browser-extension-context-menu",
    target,
    items,
  });
}

chrome.runtime.onInstalled.addListener(rebuildContextMenus);
chrome.runtime.onStartup.addListener(rebuildContextMenus);
rebuildContextMenus();

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (![CONTEXT_MENU_LIBRARY, CONTEXT_MENU_BOARD].includes(info?.menuItemId)) return;
  const target = info.menuItemId === CONTEXT_MENU_BOARD ? "board" : "library";
  const targetLabel = target === "board" ? "当前白板" : "素材库";

  collectContextImage(target, info, tab)
    .then((result) => {
      if (!result?.ok) {
        notify("MOTZ 收藏失败", result?.error || "没有连上 MOTZ 白板");
        return;
      }

      const count = result.imported || result.accepted || 1;
      notify("MOTZ 白板", `已保存 ${count} 张到 ${targetLabel}`);
    })
    .catch((error) => {
      notify("MOTZ 收藏失败", error?.message || "没有连上 MOTZ 白板");
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "MOTZ_STATUS") {
    requestAnyBridge("/status").then(sendResponse);
    return true;
  }

  if (message?.type !== "MOTZ_COLLECT") return false;

  const items = sanitizeItems(message.items);
  if (items.length === 0) {
    sendResponse({ ok: false, error: "没有识别到可收藏的网页图片链接。" });
    return false;
  }

  // Compatibility for older already-open pages: answer immediately so Chrome
  // does not close the message channel while localhost networking is pending.
  sendResponse({ ok: true, queued: true });
  postToMotz({
    source: "motz-browser-extension",
    target: message.target === "board" ? "board" : "library",
    items,
  }).catch(() => {});

  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "MOTZ_COLLECT_PORT") return;

  port.onMessage.addListener(async (message) => {
    if (message?.type !== "MOTZ_COLLECT") {
      port.postMessage({ ok: false, error: "Unsupported message" });
      port.disconnect();
      return;
    }

    const items = sanitizeItems(message.items);
    if (items.length === 0) {
      port.postMessage({ ok: false, error: "没有识别到可收藏的网页图片链接。" });
      port.disconnect();
      return;
    }

    const result = await postToMotz({
      source: "motz-browser-extension",
      target: message.target === "board" ? "board" : "library",
      items,
    }).catch((error) => ({ ok: false, error: `后台连接失败：${error?.message || "没有连上 MOTZ 桌面端"}` }));

    port.postMessage(result);
    port.disconnect();
  });
});
