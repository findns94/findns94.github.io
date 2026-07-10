# Silver Bullet - Blog

个人博客，使用 Next.js 14 构建，部署在 GitHub Pages。

## 技术栈

- **框架**: Next.js 14 (App Router, Static Export)
- **样式**: Tailwind CSS + @tailwindcss/typography
- **内容**: Markdown + YAML frontmatter
- **代码高亮**: rehype-pretty-code (Shiki)
- **数学公式**: KaTeX
- **包管理**: pnpm

## 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
# 打开 http://localhost:3000

# 构建
pnpm build
# 输出在 out/ 目录
```

## 写文章

1. 创建文章目录和 `index.md`：

```bash
mkdir -p content/posts/my-post-title/images
```

2. 编写 `content/posts/my-post-title/index.md`：

```markdown
---
title: 文章标题
date: 2026-07-10
tags: [标签1, 标签2]
categories: [分类]
math: true  # 可选：启用数学公式
---

摘要部分（在 <!-- more --> 之前）

<!-- more -->

## 正文开始

正文内容...
```

3. 添加图片到 `content/posts/my-post-title/images/`，在 Markdown 中引用：
```markdown
![图片说明](/posts/my-post-title/images/screenshot.png)
```

4. 本地预览：`pnpm dev`

5. 提交并推送触发自动部署：

```bash
git add .
git commit -m "post: 文章标题"
git push origin hexo
```

## Frontmatter 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 文章标题 |
| `date` | string | ✅ | 发布日期 (YYYY-MM-DD) |
| `tags` | string[] | ❌ | 标签列表 |
| `categories` | string[] | ❌ | 分类列表 |
| `math` | boolean | ❌ | 是否启用 KaTeX 数学公式 |

## 部署

推送到 `hexo` 分支后，GitHub Actions 自动：
1. 安装依赖
2. 执行 `pnpm build` 静态构建
3. 部署到 GitHub Pages

在 GitHub 仓库设置中：
- **Settings → Pages → Source**: 选择 **GitHub Actions**

## 目录结构

```
├── content/posts/          # 文章内容（Markdown + 图片）
├── public/                 # 静态资源
├── src/
│   ├── app/                # Next.js App Router 页面
│   │   ├── layout.tsx      # 根布局
│   │   ├── page.tsx        # 首页（文章列表）
│   │   ├── posts/[slug]/   # 文章详情页（动态路由）
│   │   ├── tags/[tag]/     # 标签归档页（动态路由）
│   │   └── feed.xml/       # RSS Feed
│   ├── components/         # React 组件
│   └── lib/
│       ├── posts.ts        # 文章读取/解析
│       └── markdown.ts     # Markdown 编译为 HTML
└── .github/workflows/      # GitHub Actions 配置
```
