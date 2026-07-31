const MOTZ_OVERLAY_ID = "motz-collector-overlay";
const MOTZ_VISIBLE_CLASS = "motz-collector-visible";
const MOTZ_DRAGGING_CLASS = "motz-collector-dragging";
const MOTZ_EXTENSION_VERSION = "0.1.11";

let draggedItem = null;
let hideTimer = 0;
let dragging = false;
let sending = false;
let lastPointerPosition = { x: 0, y: 0 };

function normalizeUrl(value, baseUrl = location.href) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return /^https?:\/\//i.test(raw) ? raw : "";
  }
}

function srcSetUrls(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function firstUrl(values, baseUrl = location.href) {
  for (const value of values.flat()) {
    const url = normalizeUrl(value, baseUrl);
    if (url) return url;
  }
  return "";
}

function backgroundImageUrl(target) {
  let node = target instanceof Element ? target : null;
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const match = getComputedStyle(node).backgroundImage?.match(/url\((['"]?)(.*?)\1\)/);
    const url = normalizeUrl(match?.[2]);
    if (url) return url;
  }
  return "";
}

function collectFromElement(target) {
  const element = target?.closest?.("img, picture, source, video, a[href]");
  const fallbackBackground = backgroundImageUrl(target);
  if (!element && !fallbackBackground) return null;

  const image = element?.matches?.("img") ? element : element?.querySelector?.("img");
  const link = element?.closest?.("a[href]");
  const url = firstUrl([
    image?.currentSrc,
    image?.src,
    image?.getAttribute?.("src"),
    image?.getAttribute?.("data-src"),
    image?.getAttribute?.("data-original"),
    image?.getAttribute?.("data-lazy-src"),
    image?.getAttribute?.("data-actualsrc"),
    image?.getAttribute?.("data-image"),
    image?.getAttribute?.("data-zoom-src"),
    image?.getAttribute?.("data-large_image"),
    srcSetUrls(image?.getAttribute?.("srcset")),
    srcSetUrls(image?.getAttribute?.("data-srcset")),
    element?.getAttribute?.("src"),
    element?.getAttribute?.("poster"),
    link?.href,
    fallbackBackground,
  ]);

  if (!url) return null;
  return {
    url,
    pageUrl: location.href,
    title: document.title || "",
    alt: image?.alt || link?.textContent?.trim() || "",
  };
}

function collectFromDataTransfer(dataTransfer) {
  const html = dataTransfer?.getData?.("text/html") || "";
  const uriList = dataTransfer?.getData?.("text/uri-list") || "";
  const plainText = dataTransfer?.getData?.("text/plain") || "";
  const firefoxUrl = dataTransfer?.getData?.("text/x-moz-url") || "";
  const downloadUrl = dataTransfer?.getData?.("DownloadURL") || "";
  const urls = [];

  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("img, source, video, a[href], meta[property='og:image'], meta[name='twitter:image']").forEach((element) => {
        urls.push(
          element.currentSrc,
          element.src,
          element.href,
          element.getAttribute("href"),
          element.getAttribute("src"),
          element.getAttribute("data-src"),
          element.getAttribute("data-original"),
          element.getAttribute("data-lazy-src"),
          element.getAttribute("data-actualsrc"),
          element.getAttribute("data-image"),
          element.getAttribute("data-zoom-src"),
          element.getAttribute("data-large_image"),
          element.getAttribute("poster"),
          element.getAttribute("content"),
          ...srcSetUrls(element.getAttribute("srcset")),
          ...srcSetUrls(element.getAttribute("data-srcset")),
        );
      });
    } catch {
      // Fallbacks below still cover plain URL drags.
    }
  }

  urls.push(...String(uriList).split(/\r?\n/));
  urls.push(...String(firefoxUrl).split(/\r?\n/));
  urls.push(...String(plainText).match(/https?:\/\/[^\s"'<>]+/gi) || []);
  urls.push(String(downloadUrl).split(":").slice(2).join(":"));

  const url = firstUrl(urls);
  if (!url) return null;
  return {
    url,
    pageUrl: location.href,
    title: document.title || "",
    alt: "",
  };
}

function hasPotentialUrlDrag(dataTransfer) {
  return Array.from(dataTransfer?.types || [])
    .map((type) => String(type).toLowerCase())
    .some((type) => ["text/html", "text/uri-list", "text/plain", "url", "text/x-moz-url", "downloadurl"].includes(type));
}

function ensureOverlay() {
  let overlay = document.getElementById(MOTZ_OVERLAY_ID);
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = MOTZ_OVERLAY_ID;
  overlay.innerHTML = `
    <div class="motz-collector-card" role="presentation">
      <button class="motz-collector-close" type="button" aria-label="关闭">×</button>
      <div class="motz-collector-preview" aria-hidden="true"></div>
      <div class="motz-collector-copy">
        <strong>MOTZ 白板</strong>
        <span>拖到此处收藏参考</span>
        <em>插件 v${MOTZ_EXTENSION_VERSION}</em>
      </div>
      <div class="motz-collector-targets">
        <button class="motz-collector-zone" type="button" data-motz-target="library">素材库</button>
        <button class="motz-collector-zone" type="button" data-motz-target="board">当前白板</button>
      </div>
      <div class="motz-collector-status"></div>
    </div>
  `;

  overlay.addEventListener("dragenter", keepOverlayAlive);
  overlay.addEventListener("dragover", (event) => {
    keepOverlayAlive(event);
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  overlay.addEventListener("drop", handleOverlayDrop);
  overlay.addEventListener("click", handleOverlayClick);
  overlay.addEventListener("pointerup", handleOverlayPointerUp);
  overlay.querySelector(".motz-collector-close")?.addEventListener("click", (event) => {
    event.stopPropagation();
    dragging = false;
    hideOverlay();
  });
  document.documentElement.appendChild(overlay);
  return overlay;
}

function hasUsablePointerPosition(position) {
  return Number.isFinite(position?.x) && Number.isFinite(position?.y) && (position.x > 0 || position.y > 0);
}

function positionOverlay(overlay, position) {
  const card = overlay?.querySelector(".motz-collector-card");
  if (!card || !hasUsablePointerPosition(position)) return;

  const margin = 12;
  const rect = card.getBoundingClientRect();
  const cardWidth = rect.width || 268;
  const cardHeight = rect.height || 286;
  const maxLeft = Math.max(margin, window.innerWidth - cardWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - cardHeight - margin);

  // Keep the dragged image under the pointer while leaving the target buttons below it.
  const left = Math.min(maxLeft, Math.max(margin, position.x - cardWidth / 2));
  const top = Math.min(maxTop, Math.max(margin, position.y - 68));
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

function keepOverlayAlive(event) {
  if (event) event.stopPropagation();
  window.clearTimeout(hideTimer);
}

function showOverlay(item, position = null) {
  window.clearTimeout(hideTimer);
  if (item) draggedItem = item;
  dragging = true;
  const overlay = ensureOverlay();
  const preview = overlay.querySelector(".motz-collector-preview");
  const status = overlay.querySelector(".motz-collector-status");
  if (preview) preview.style.backgroundImage = draggedItem?.url ? `url("${draggedItem.url.replace(/"/g, "%22")}")` : "";
  if (status) {
    status.textContent = "";
    status.dataset.error = "false";
  }
  overlay.classList.add(MOTZ_VISIBLE_CLASS, MOTZ_DRAGGING_CLASS);
  positionOverlay(overlay, hasUsablePointerPosition(position) ? position : lastPointerPosition);
}

function hideOverlay() {
  window.clearTimeout(hideTimer);
  const overlay = document.getElementById(MOTZ_OVERLAY_ID);
  overlay?.classList.remove(MOTZ_VISIBLE_CLASS, MOTZ_DRAGGING_CLASS);
}

function hideOverlayLater(delay = 1300) {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!dragging && !sending) hideOverlay();
  }, delay);
}

function setStatus(text, isError = false) {
  const overlay = ensureOverlay();
  const status = overlay.querySelector(".motz-collector-status");
  if (!status) return;
  status.textContent = text;
  status.dataset.error = isError ? "true" : "false";
}

async function postToMotz(payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const port = chrome.runtime.connect({ name: "MOTZ_COLLECT_PORT" });
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        // The port may already be closed by Chrome.
      }
      reject(new Error("保存超时，请确认 MOTZ 白板仍在运行"));
    }, 50000);

    port.onMessage.addListener((result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (result?.ok) {
        resolve(result);
      } else {
        reject(new Error(result?.error || "发送失败"));
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error(chrome.runtime.lastError?.message || "插件后台连接已断开"));
    });

    port.postMessage({ type: "MOTZ_COLLECT", ...payload });
  });
}

async function sendItemToMotz(target, item) {
  if (sending) return;
  if (!item?.url) {
    setStatus("没有识别到图片链接", true);
    dragging = false;
    hideOverlayLater(2400);
    return;
  }

  sending = true;
  dragging = false;
  setStatus("已点到，正在保存...");
  try {
    const result = await postToMotz({
      source: "motz-browser-extension",
      target: target === "board" ? "board" : "library",
      items: [item],
    });
    setStatus(target === "board" ? `已保存 ${result.imported || 1} 张并发送` : `已保存 ${result.imported || 1} 张到素材库`);
    hideOverlayLater(1000);
  } catch (error) {
    setStatus(`发送失败：${error?.message || "请打开新版 MOTZ 白板"}`, true);
    hideOverlayLater(5200);
  } finally {
    sending = false;
  }
}

function targetFromEvent(event) {
  return event.target.closest?.("[data-motz-target]")?.dataset.motzTarget || "";
}

function handleOverlayDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const item = draggedItem || collectFromDataTransfer(event.dataTransfer);
  sendItemToMotz(targetFromEvent(event) || "library", item);
}

function handleOverlayClick(event) {
  const target = targetFromEvent(event);
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  sendItemToMotz(target, draggedItem);
}

function handleOverlayPointerUp(event) {
  const target = targetFromEvent(event);
  if (!target || !dragging) return;
  event.preventDefault();
  event.stopPropagation();
  sendItemToMotz(target, draggedItem);
}

document.addEventListener(
  "pointerdown",
  (event) => {
    lastPointerPosition = { x: event.clientX, y: event.clientY };
  },
  true,
);

document.addEventListener(
  "dragstart",
  (event) => {
    const item = collectFromElement(event.target) || collectFromDataTransfer(event.dataTransfer);
    if (!item && !hasPotentialUrlDrag(event.dataTransfer)) return;
    draggedItem = item;
    const position = hasUsablePointerPosition({ x: event.clientX, y: event.clientY })
      ? { x: event.clientX, y: event.clientY }
      : lastPointerPosition;
    showOverlay(item, position);
  },
  true,
);

document.addEventListener(
  "dragenter",
  (event) => {
    const item = draggedItem || collectFromElement(event.target);
    const overlay = ensureOverlay();
    if ((item || hasPotentialUrlDrag(event.dataTransfer)) && !overlay.classList.contains(MOTZ_VISIBLE_CLASS)) {
      showOverlay(item, { x: event.clientX, y: event.clientY });
    }
  },
  true,
);

document.addEventListener(
  "dragover",
  (event) => {
    if (!draggedItem && !hasPotentialUrlDrag(event.dataTransfer)) return;
    keepOverlayAlive();
    const overlay = ensureOverlay();
    if (!overlay.classList.contains(MOTZ_VISIBLE_CLASS)) {
      showOverlay(draggedItem, { x: event.clientX, y: event.clientY });
    }
  },
  true,
);

document.addEventListener(
  "drop",
  () => {
    dragging = false;
    hideOverlayLater(1000);
  },
  true,
);

document.addEventListener(
  "dragend",
  () => {
    dragging = false;
    hideOverlayLater(1800);
  },
  true,
);

document.addEventListener("keyup", (event) => {
  if (event.key === "Escape") {
    dragging = false;
    hideOverlay();
  }
});
