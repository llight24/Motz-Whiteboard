import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { bootLibraryData } from "./dataStore.js";
import "./styles.css";

// 索引、键位与设置存在素材库目录下的 .motz_data 里，先完成加载与旧数据迁移再挂载界面，
// 否则首帧会拿着默认值把整库索引覆盖成空。
bootLibraryData().finally(() => {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
