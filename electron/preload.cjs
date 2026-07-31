const { contextBridge, ipcRenderer, webUtils } = require("electron");

const pendingBoardFileResults = [];
const boardFileListeners = new Set();

ipcRenderer.on("board-file-opened", (_event, payload) => {
  if (boardFileListeners.size === 0) {
    pendingBoardFileResults.push(payload);
    return;
  }
  boardFileListeners.forEach((listener) => listener(payload));
});

contextBridge.exposeInMainWorld("referenceBoard", {
  openFloatingBoard: (boardId) => ipcRenderer.invoke("open-floating-board", boardId),
  closeFloatingWindow: () => ipcRenderer.invoke("close-floating-window"),
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window-toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  isAlwaysOnTop: () => ipcRenderer.invoke("window-is-always-on-top"),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("window-set-always-on-top", value),
  beginWindowDrag: () => ipcRenderer.invoke("window-drag-begin"),
  moveWindowDrag: (drag) => ipcRenderer.invoke("window-drag-move", drag),
  listSystemFonts: () => ipcRenderer.invoke("list-system-fonts"),
  getLibraryRoot: (libraryId) => ipcRenderer.invoke("get-library-root", libraryId),
  activateLibrary: (library) => ipcRenderer.invoke("activate-library", library),
  chooseLibraryRoot: (libraryId) => ipcRenderer.invoke("choose-library-root", libraryId),
  saveBoardFile: (payload) => ipcRenderer.invoke("save-board-file", payload),
  openBoardFile: () => ipcRenderer.invoke("open-board-file"),
  signalRendererReady: () => ipcRenderer.send("renderer-ready"),
  onBoardFileOpen: (callback) => {
    if (typeof callback !== "function") return () => {};
    boardFileListeners.add(callback);
    while (pendingBoardFileResults.length > 0) callback(pendingBoardFileResults.shift());
    return () => boardFileListeners.delete(callback);
  },
  getFilePath: (file) => webUtils?.getPathForFile?.(file) || file?.path || "",
  importImageFiles: (folderName) => ipcRenderer.invoke("import-image-files", folderName),
  importImagePaths: (filePaths, folderName, typeLabel) => ipcRenderer.invoke("import-image-paths", filePaths, folderName, typeLabel),
  importImageData: (items, folderName) => ipcRenderer.invoke("import-image-data", items, folderName),
  importImageUrls: (urls, folderName, originalSource) => ipcRenderer.invoke("import-image-urls", urls, folderName, originalSource),
  importImageFolder: () => ipcRenderer.invoke("import-image-folder"),
  renameLibraryAsset: (sourcePath, nextTitle) => ipcRenderer.invoke("rename-library-asset", sourcePath, nextTitle),
  deleteLibraryFiles: (filePaths, libraryId) => ipcRenderer.invoke("delete-library-files", filePaths, libraryId),
  showItemInFolder: (filePath) => ipcRenderer.invoke("show-item-in-folder", filePath),
  checkMediaPaths: (filePaths) => ipcRenderer.invoke("check-media-paths", filePaths),
  resolveMediaReferences: (entries) => ipcRenderer.invoke("resolve-media-references", entries),
  getMediaThumbnails: (entries) => ipcRenderer.invoke("get-media-thumbnails", entries),
  scanLibraryMedia: () => ipcRenderer.invoke("scan-library-media"),
  onPluginCollect: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("plugin-collect", listener);
    return () => ipcRenderer.removeListener("plugin-collect", listener);
  },
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.shell = "electron";
});
