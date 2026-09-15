// 索引、键位与库内设置跟随素材库保存：主进程把它们写在 <素材库>/.motz_data 下
// （index.json / keybindings.json / settings.json，见 electron/main.cjs）。
// 渲染端在这里维护一份内存镜像，让 useStoredState 仍然能同步读取；写入按区域节流后
// 经 IPC 提交，主窗口与浮窗之间由主进程广播同步，替代原先 localStorage 的 storage 事件。
// 在浏览器里跑 `npm run dev` 时没有 preload 桥，自动降级回 localStorage。

const defaultLibraryId = "library-default";
const writeDelay = 320;
const librariesRegistryKey = "reference-board-libraries";

// 跟随素材库落盘的区域名，必须与 electron/main.cjs 的 motzDataAreas 保持一致。
const libraryAreas = [
  "assets",
  "boards",
  "folders",
  "items",
  "keybindings",
  "import-mode",
  "selected-tag-filters",
  "asset-sort-mode",
  "board-view-states",
  "collapsed-folders",
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const areaAlternation = libraryAreas
  .slice()
  .sort((left, right) => right.length - left.length)
  .map(escapeRegExp)
  .join("|");
const scopedKeyPattern = new RegExp(`^reference-board-library-(.+)-(${areaAlternation})$`);
const defaultKeyPattern = new RegExp(`^reference-board-(${areaAlternation})$`);

const values = new Map();
const listeners = new Map();
const pendingWrites = new Map();
const hydratedLibraries = new Set();
const librariesWithData = new Set();

export function libraryStorageKey(libraryId, area) {
  if (!libraryId || libraryId === defaultLibraryId) return `reference-board-${area}`;
  return `reference-board-library-${libraryId}-${area}`;
}

export function parseLibraryStorageKey(key) {
  const text = String(key || "");
  const scoped = text.match(scopedKeyPattern);
  if (scoped) return { libraryId: scoped[1], area: scoped[2] };
  const plain = text.match(defaultKeyPattern);
  if (plain) return { libraryId: defaultLibraryId, area: plain[1] };
  return null;
}

export function isLibraryStorageKey(key) {
  return Boolean(parseLibraryStorageKey(key));
}

function bridge() {
  if (typeof window === "undefined") return null;
  return window.referenceBoard ?? null;
}

function readLocalValue(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch {
    // localStorage 被限制或内容损坏时退回默认值。
  }
  return typeof fallback === "function" ? fallback() : fallback;
}

function writeLocalValue(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 无法写入时只保留内存状态，界面依旧可用。
  }
}

export function readLibraryValue(key, fallback) {
  const ref = parseLibraryStorageKey(key);
  if (!ref) return typeof fallback === "function" ? fallback() : fallback;
  if (values.has(key)) return values.get(key);
  if (!bridge()) return readLocalValue(key, fallback);
  return typeof fallback === "function" ? fallback() : fallback;
}

export function writeLibraryValue(key, value) {
  const ref = parseLibraryStorageKey(key);
  if (!ref) return;
  values.set(key, value);
  const api = bridge();
  if (!api) {
    writeLocalValue(key, value);
    return;
  }
  // 该库还没注水时先不落盘，否则首帧的默认值会覆盖磁盘上的索引。
  if (!hydratedLibraries.has(ref.libraryId)) return;
  const pending = pendingWrites.get(key);
  if (pending) window.clearTimeout(pending);
  pendingWrites.set(
    key,
    window.setTimeout(() => flushKey(key), writeDelay),
  );
}

export function subscribeLibraryKey(key, listener) {
  if (typeof listener !== "function") return () => {};
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);
  return () => listeners.get(key)?.delete(listener);
}

function notify(key) {
  listeners.get(key)?.forEach((listener) => listener(values.get(key)));
}

function flushKey(key) {
  pendingWrites.delete(key);
  const ref = parseLibraryStorageKey(key);
  const api = bridge();
  if (!ref || !api?.writeLibraryData || !values.has(key)) return;
  Promise.resolve(api.writeLibraryData(ref.libraryId, ref.area, values.get(key))).catch(() => {});
}

// 关闭窗口时用同步通道补写，异步 invoke 会随渲染进程销毁被丢弃。
export function flushLibraryWrites() {
  Array.from(pendingWrites.keys()).forEach((key) => {
    window.clearTimeout(pendingWrites.get(key));
    const ref = parseLibraryStorageKey(key);
    const api = bridge();
    if (!ref || !api || !values.has(key)) {
      pendingWrites.delete(key);
      return;
    }
    pendingWrites.delete(key);
    const value = values.get(key);
    if (typeof api.writeLibraryDataSync === "function") {
      try {
        api.writeLibraryDataSync(ref.libraryId, ref.area, value);
        return;
      } catch {
        // 同步通道不可用时退回异步写入。
      }
    }
    Promise.resolve(api.writeLibraryData?.(ref.libraryId, ref.area, value)).catch(() => {});
  });
}

function applyArea(libraryId, area, value) {
  if (!libraryAreas.includes(area) || value === undefined) return;
  const key = libraryStorageKey(libraryId, area);
  values.set(key, value);
  notify(key);
}

function applyBundle(entry) {
  const libraryId = String(entry?.libraryId || "").trim();
  if (!libraryId) return;
  const data = entry?.data && typeof entry.data === "object" ? entry.data : {};
  Object.entries(data.index ?? {}).forEach(([area, value]) => applyArea(libraryId, area, value));
  Object.entries(data.settings ?? {}).forEach(([area, value]) => applyArea(libraryId, area, value));
  if (data.keybindings && typeof data.keybindings === "object" && Object.keys(data.keybindings).length > 0) applyArea(libraryId, "keybindings", data.keybindings);
  hydratedLibraries.add(libraryId);
  if (entry?.hasData) librariesWithData.add(libraryId);
}

// 其它窗口（浮窗 / 主窗口）写入后由主进程广播过来；内容相同则不通知，避免两侧互相回写。
function applyRemoteChange(change) {
  const libraryId = String(change?.libraryId || "").trim();
  const area = String(change?.area || "");
  if (!libraryId || !libraryAreas.includes(area)) return;
  const key = libraryStorageKey(libraryId, area);
  try {
    if (values.has(key) && JSON.stringify(values.get(key)) === JSON.stringify(change.value)) return;
  } catch {
    // 结构无法序列化时按有变化处理。
  }
  values.set(key, change.value);
  notify(key);
}

export function storedLibraryIds() {
  const ids = new Set([defaultLibraryId]);
  try {
    const raw = window.localStorage.getItem(librariesRegistryKey);
    const libraries = raw ? JSON.parse(raw) : [];
    (Array.isArray(libraries) ? libraries : []).forEach((library) => {
      const id = String(library?.id || "").trim();
      if (id) ids.add(id);
    });
  } catch {
    // 注册表损坏时只加载默认库。
  }
  return Array.from(ids);
}

function collectLegacyEntries() {
  const entries = [];
  const keys = [];
  try {
    Object.keys(window.localStorage).forEach((key) => {
      const ref = parseLibraryStorageKey(key);
      if (!ref) return;
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      try {
        entries.push({ ...ref, value: JSON.parse(raw) });
        keys.push(key);
      } catch {
        // 旧值本身无法解析时跳过。
      }
    });
  } catch {
    return { entries, keys };
  }

  // 导入方式过去存在库注册表里，现在跟随素材库，需要一并搬进 settings.json。
  try {
    const raw = window.localStorage.getItem(librariesRegistryKey);
    const libraries = raw ? JSON.parse(raw) : [];
    (Array.isArray(libraries) ? libraries : []).forEach((library) => {
      const mode = library?.importMode;
      if (mode !== "reference" && mode !== "copy") return;
      entries.push({ libraryId: String(library?.id || defaultLibraryId) || defaultLibraryId, area: "import-mode", value: mode });
    });
  } catch {
    // 注册表损坏时跳过导入方式迁移。
  }

  return { entries, keys };
}

async function migrateLegacyData(api) {
  const { entries, keys } = collectLegacyEntries();
  if (entries.length === 0) return;
  try {
    await api.migrateLegacyLibraryData(entries);
  } catch {
    return;
  }
  keys.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 删除失败时下次启动会重新走一遍迁移，主进程侧不会覆盖已有数据。
    }
  });
}

let bootPromise = null;

export function bootLibraryData() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    const api = bridge();
    if (!api?.readAllLibraryData) return;
    const libraryIds = storedLibraryIds();
    await migrateLegacyData(api);
    try {
      const result = await api.readAllLibraryData(libraryIds);
      (result?.libraries ?? []).forEach(applyBundle);
    } catch {
      // 读取失败时保持内存默认值，界面仍可打开。
    }
    api.onLibraryDataChanged?.(applyRemoteChange);
    if (typeof window !== "undefined") window.addEventListener("beforeunload", flushLibraryWrites);
  })();
  return bootPromise;
}

// 新建素材库后按需加载它的数据；启动时已经加载过的库直接返回。
export async function ensureLibraryHydrated(libraryId) {
  const id = String(libraryId || "").trim() || defaultLibraryId;
  if (hydratedLibraries.has(id)) return;
  const api = bridge();
  if (!api?.readLibraryData) return;
  try {
    applyBundle(await api.readLibraryData(id));
  } catch {
    // 读取失败时保留默认值。
  }
}

// 更换素材库保存位置后，把内存里的索引与设置补写到新位置，避免数据留在旧目录。
export function persistLibraryData(libraryId) {
  const id = String(libraryId || "").trim() || defaultLibraryId;
  const api = bridge();
  if (!api?.writeLibraryData) return;
  libraryAreas.forEach((area) => {
    const key = libraryStorageKey(id, area);
    if (!values.has(key)) return;
    const pending = pendingWrites.get(key);
    if (pending) window.clearTimeout(pending);
    pendingWrites.delete(key);
    Promise.resolve(api.writeLibraryData(id, area, values.get(key))).catch(() => {});
  });
}

export function libraryHasStoredData(libraryId) {
  const id = String(libraryId || "").trim() || defaultLibraryId;
  if (librariesWithData.has(id)) return true;
  const api = bridge();
  return libraryAreas.some((area) => {
    if (area === "keybindings") return false;
    const key = libraryStorageKey(id, area);
    const value = api ? values.get(key) : readLocalValue(key, null);
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
  });
}

export function hasAnyLibraryStoredData(libraryIds) {
  const ids = Array.isArray(libraryIds) && libraryIds.length > 0 ? libraryIds : [defaultLibraryId];
  return ids.some((id) => libraryHasStoredData(id));
}
