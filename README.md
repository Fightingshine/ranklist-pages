# 排行表 (纯静态离线版 · GitHub Pages)

一个完全运行在浏览器端的纯静态排行榜应用（Tier List），无需任何 Node.js 服务端或 MySQL 数据库，专为 **GitHub Pages** 静态托管量身打造。

---

## 🌟 特性

- **纯静态托管**：打包后均为纯 HTML/CSS/JS 静态文件，支持直接发布到 GitHub Pages、Vercel、Cloudflare Pages 等任意静态托管平台。
- **IndexedDB 本地引擎**：排行榜结构、项目、用户上传的照片与短视频完整持久化在当前浏览器的 IndexedDB 中。
- **预置初始数据**：首屏预置内置数据（“山山山ranklist”、“东北菜”），首次打开自动注入并展示轻量封面图。
- **移动端与触屏体验优化**：
  - 电脑端：流畅 HTML5 拖拽排序与跨档移动。
  - 手机/平板触屏端：每张卡片配备 `‹` 前移、`›` 后移微调按钮，以及即时“调档下拉框”，单手即可完成排行榜重排。
- **数据备份与跨端迁移**：
  - 支持 **一键导出 ZIP**：将所有数据以及本地上传的全部图片文件打包为一个 `.zip` 下载。
  - 支持 **一键导入恢复**：上传之前的 `.zip` 备份，自动在任意新电脑、新手机或不同浏览器中完整恢复数据。

---

## 🚀 部署至 GitHub Pages

1. **新建 GitHub 仓库**：
   在 GitHub 上创建一个新的仓库（例如 `easyranklist-pages` 或 `ranklist`）。
2. **推送到 GitHub**：
   ```bash
   git init
   git add .
   git commit -m "feat: 初始化 ranklist-pages 纯静态项目"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
   git push -u origin main
   ```
3. **开启 GitHub Pages**：
   - 进入 GitHub 仓库页面，点击 **Settings** -> **Pages**。
   - 在 **Build and deployment** 下的 **Source** 中选择 **GitHub Actions**。
   - 稍等片刻，内置的 `.github/workflows/deploy.yml` 会自动完成构建与上线，页面上方会显示专属访问链接（如 `https://<用户名>.github.io/<仓库名>/`）。

---

## 💻 本地开发与测试

```bash
# 1. 安装依赖（推荐使用国内镜像源）
npm install --registry=https://registry.npmmirror.com

# 2. 启动本地开发服务 (默认端口 5001)
npm run dev

# 3. 生产环境打包
npm run build

# 4. 本地静态预览
npm run preview
```

---

## 📁 目录结构

```text
├── .github/workflows/deploy.yml   # GitHub Actions 自动化部署流水线
├── public/
│   ├── covers/                    # 预置提取的项目轻量封面缩略图 (WebP)
│   └── initial-data.json          # 预置排行榜种子数据
├── src/
│   ├── services/
│   │   ├── db.ts                  # IndexedDB 打开与事务操作封装
│   │   ├── storage.ts             # 纯前端业务 CRUD 接口 (对齐 REST API 规范)
│   │   ├── seed.ts                # 首次加载检测与初始数据注入
│   │   └── backup.ts              # JSZip 备份导出与解包恢复
│   ├── types.ts                   # 核心 TypeScript 类型
│   ├── App.tsx                    # 排行榜主应用与交互
│   ├── styles.css                 # 响应式与触屏样式
│   └── main.tsx                   # 入口
├── vite.config.ts                 # 配置相对路径 base: './' 兼容任意仓库路径
└── package.json
```
