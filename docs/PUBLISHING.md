# GitHub 发布说明

MOTZ 白板采用“源码进入 Git，构建文件进入 GitHub Releases”的结构。这样仓库克隆速度快，安装包也拥有独立的版本、下载量和校验值。

## 第一次创建仓库

1. 在 GitHub 新建一个空仓库，推荐名称 `motz-whiteboard`。
2. 不要在网页端额外创建 README、许可证或 `.gitignore`，本地已经准备完成。
3. 在本机配置提交身份：

```powershell
git config --global user.name "你的 GitHub 显示名"
git config --global user.email "你的 GitHub 邮箱或 noreply 邮箱"
```

4. 在项目目录执行：

```powershell
git add .
git commit -m "Release: MOTZ Whiteboard 0.3.82"
git remote add origin https://github.com/<OWNER>/motz-whiteboard.git
git push -u origin main
```

如果使用 SSH，请将远程地址替换为：

```text
git@github.com:<OWNER>/motz-whiteboard.git
```

## 发布 0.3.82

确认仓库的 Actions 权限允许读写仓库内容，然后创建版本标签：

```powershell
git tag -a v0.3.82 -m "MOTZ Whiteboard 0.3.82"
git push origin v0.3.82
```

标签会触发 `.github/workflows/release-windows.yml`：

1. 安装锁定版本的依赖。
2. 构建 Windows 安装包。
3. 构建 Windows 便携包。
4. 打包浏览器插件。
5. 生成 SHA256 校验文件。
6. 创建 GitHub Release 并上传全部文件。

也可以在 GitHub 的 **Actions → Build Windows Release → Run workflow** 手动测试构建。手动运行只生成 Actions Artifact，不会创建正式 Release。

## 发布后页面设置

进入仓库 **Settings**：

- 在 **General → Social preview** 上传 `docs/images/app-preview.png`。
- 在仓库首页右侧 **About** 填写简介：`本地参考素材库与无限白板，为 CG 和视觉创作工作流设计。`
- 添加 Topics：`reference-manager`、`whiteboard`、`cg-art`、`electron`、`react`、`pureref-alternative`。
- 如果仓库公开，在确认授权方式后补充合适的 LICENSE。

## 后续版本

1. 修改 `package.json` 版本。
2. 修改 `browser-extension/manifest.json` 插件版本（仅插件有更新时）。
3. 更新 `CHANGELOG.md`。
4. 添加 `.github/release-notes/v<版本>.md`，或让 GitHub 自动生成说明。
5. 提交代码并推送新的 `v<版本>` 标签。

## 当前本地发布文件

```text
release/MOTZ-Whiteboard-Setup-0.3.82-x64.exe
release/MOTZ-Whiteboard-Portable-0.3.82-x64.exe
release/MOTZ-browser-extension-0.1.11.zip
release/SHA256SUMS-0.3.82.txt
```

`release/` 已被 `.gitignore` 排除。这些文件应上传到 Release，不应使用 Git LFS 或直接提交到源码历史。
