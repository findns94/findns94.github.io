# New Post Guide

This document is the onboarding reference for writing a new blog post on this
site. Follow it so the post matches the repo's conventions and renders correctly.

## 1. Repository Overview

This is a **bilingual blog** built with **Next.js 14 (App Router, static export)**
and styled with **Tailwind CSS**. Markdown content is compiled to HTML at build
time via `unified`/`remark`/`rehype` (GFM, KaTeX math, syntax-highlighted code).
The site is deployed to `findns.cc` (previously `findns94.github.io`) as a static
export to GitHub Pages.

Key facts:
- Posts live in `content/posts/<slug>/`
- Images and charts are served from `public/posts/<slug>/`
- The author name is `FindNS94`
- Site title: **Silver Bullet**
- The Next.js source lives in `src/` (`src/app/` for routes, `src/components/`
  for UI, `src/lib/` for markdown compilation and post loading)

## 2. Directory & File Layout

For a post with slug `my-post-title`, create:

```
content/posts/my-post-title/
  index.md          # English version
  index.zh.md       # Chinese version
public/posts/my-post-title/
  images/           # downloaded cover + inline images
    cover.jpg
    <name>.jpg
  charts/           # separate SVG chart files (no inline SVG allowed)
    chart-1-<name>.svg
    chart-2-<name>.svg
```

**Rules:**
- Slug is lowercase kebab-case, descriptive of the topic.
- **Two language files are mandatory.** Generate English first, then rewrite
  into Chinese (see §7).
- **No inline SVG** in markdown — always use a separate `.svg` file referenced
  via `<figure><img src="..." loading="lazy"></figure>`.
- All image/chart filenames are in **English**.

## 3. Frontmatter

Both `index.md` and `index.zh.md` use this YAML frontmatter block:

```yaml
title: "Question-format title with primary keyword"
description: "Fact-dense, 150-160 chars, includes 1 statistic and source"
coverImage: "/posts/<slug>/images/cover.jpg"
coverImageAlt: "A descriptive sentence about the cover image"
ogImage: "/posts/<slug>/images/cover.jpg"
date: "YYYY-MM-DD HH:MM:SS"
lastUpdated: "YYYY-MM-DD HH:MM:SS"
author: "FindNS94"
tags: [TagOne, TagTwo, TagThree]
```

**Rules:**
- `date` / `lastUpdated` must be precise to the second: `"2026-08-08 22:30:00"`.
- `description` is 150–160 characters and should contain one specific statistic.
- `coverImage` and `ogImage` point to the same cover image. `ogImage` is used for
  the post's `og:image` meta tag and JSON-LD schema — it must be an absolute-path
  image (1200×630 recommended) so AI crawlers and social previews can render it.
- The Chinese version translates `title`, `description`, and `coverImageAlt` into
  Chinese but keeps `coverImage`, `ogImage`, `date`, `lastUpdated`, `author`, and
  `tags` identical to the English version.

## 4. Images

### Sourcing
- Prefer **[Pixabay](https://pixabay.com)** (free, no attribution required).
- Alternatives: **[Unsplash](https://unsplash.com)**, then **[Pexels](https://pexels.com)**.
- Target cover size: 1200×630 (OG-compatible) or 1920×1080.

### Download, do not hotlink
Every image must be **downloaded** into `public/posts/<slug>/images/`. Never
reference another site's URL directly in the markdown.

Verify each download is a valid image (not an HTML error page):
```bash
curl -sI "<url>" | head -1        # expect HTTP 200
file <downloaded-file>             # expect "JPEG image data"
```

### Referencing
Use standard markdown inside the post body:
```markdown
![Descriptive alt text — topic keywords naturally](/posts/<slug>/images/<file>.jpg)
```

The cover image is repeated as the first content image, right after the frontmatter:
```markdown
![<coverImageAlt>](/posts/<slug>/images/cover.jpg)
```

### Alt text
Alt text is a full descriptive sentence — not a fragment. It should read naturally
and include relevant topic keywords.

## 5. Charts / SVGs

Charts are generated as **separate SVG files** in `public/posts/<slug>/charts/`,
embedded via:
```html
<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/<slug>/charts/chart-1-<name>.svg"
       alt="Detailed description of the chart: what it shows, the data, and the key takeaway"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>
```

### Critical: SVG must be valid XML
SVGs are embedded via `<img>`, so the browser parses them as standalone XML.
**One syntax error → broken image icon.** The single most common failure is a
bare `&` in an attribute (e.g. `S&P 500`) — it must be `S&amp;P 500`.

See [`svg_format.md`](./svg_format.md) for the full diagnosis/fixing guide and a
validation checklist (run `xmllint --noout <file>.svg` before committing).

### Chart style
Match the existing dark-mode-compatible style:
- `viewBox`, `role="img"`, `aria-label`, `<title>`, `<desc>`.
- `currentColor` for axis/text (adapts to theme), explicit hex fills for bars.
- Font: `'Inter', system-ui, sans-serif`.
- Source attribution line at the bottom of the chart.
- Diverse chart types across a post (grouped bar, horizontal bar, lollipop, line…).

## 6. Tags

- **Maximum 3 tags** per post.
- Tags are always in **English**, even on the Chinese version.
- **Aggregate with existing tags.** Check all posts' tags first:
  ```bash
  grep -rh "^tags:" content/posts/*/index.md | sed 's/tags: //' | sort | uniq -c | sort -rn
  ```
  Prefer reusing an existing tag set when it fits. The current tag inventory
  includes clusters like `[Finance, Investment, AI]`, `["Linux", "Kernel", "Testing"]`,
  `[Deep Learning, Computer Vision]`, `[Blockchain, Security]`, etc.
- It is acceptable to update an older post's tags to keep the taxonomy coherent.

## 7. Bilingual Workflow

1. **Write `index.md` (English) first** — full article.
2. **Rewrite `index.zh.md` (Chinese) second** — this is a **信达雅** rewrite
   (faithful, expressive, elegant), **not** a sentence-by-sentence translation.
   - Preserve all facts, statistics, and source URLs.
   - Translate source names where a Chinese name exists (e.g. "华泰证券",
     "国家统计局"), but keep the URL and any English proper nouns.
   - Keep `tags` identical to the English version.
   - Translate the "Key Takeaways" box (中文版 uses "核心要点").

## 8. Required Content Elements

Every post should include these structural elements (in order):

1. **Cover image** — repeated right after frontmatter.
2. **Introduction** — hook with a surprising statistic, problem statement, what the
   reader will learn.
3. **Key Takeaways box** (中文版: 核心要点) — 3–5 bullets, 40–60 words combined,
   self-contained, with at least one statistic + source name.
4. **H2 sections** — 60–70% as questions. Each opens with an **answer-first**
   paragraph (40–60 words) containing a statistic + source.
5. **Information gain markers** — at least 2–3, as HTML comments before the
   relevant paragraph:
   - `<!-- [PERSONAL EXPERIENCE] ... -->`
   - `<!-- [UNIQUE INSIGHT] ... -->`
   - `<!-- [ORIGINAL DATA] ... -->`
6. **Citation capsules** — in each major H2, a 40–60 word self-contained, quotable
   passage with one claim + one data point + source.
7. **Visuals** — alternate `[IMAGE]`, `[CHART]` every 300–500 words; never cluster
   the same type.
8. **FAQ section** — 3–5 questions, 40–60 word answers, each with a statistic.
9. **Conclusion** — key takeaways + call to action.
10. **Sources block** — full source list at the bottom:
    ```
    ## Sources
    - Publisher, Title, retrieved YYYY-MM-DD, https://url
    ```

## 9. Citation Format

In prose, always attribute:
```markdown
Investors earned 3–6% less than funds annually ([Morningstar](https://www.morningstar.com), 2024).
```

The source block at the bottom gives full provenance:
```markdown
- Morningstar, "Mind the Gap" annual report, 2024, https://www.morningstar.com
```

## 10. INTERNAL-LINK Placeholders

During drafting, internal linking opportunities may be marked with:
```markdown
[INTERNAL-LINK: anchor text → target description]
```

**Delete every `INTERNAL-LINK` line** from the final markdown before finishing.
These are drafting aids, not publishable content.

## 11. AI-Native & AI-Friendly Technical Requirements

This site is optimized so AI systems (ChatGPT, Claude, Perplexity, Google AI
Overviews) can crawl, parse, and **cite** its content. The infrastructure is
already in place — your job is to feed it correctly. See the post
[How Do You Make Your Blog AI-Native and AI-Friendly?](/posts/ai-native-ai-friendly-blog-cloudflare/)
for the full rationale.

**What's automatic (already wired up — don't break it):**
- **JSON-LD `BlogPosting` schema** is generated per-post from the frontmatter
  (`title`, `description`, `ogImage`, `author`, `date`, `lastUpdated`, `tags`).
  Keep those frontmatter fields complete and accurate.
- **`WebSite` + `Person` schema** is injected site-wide from the root layout.
- **Per-post Open Graph + Twitter metadata** (`og:image`, `og:type: article`,
  `article:published_time`, `twitter:card: summary_large_image`) is generated
  from the frontmatter. A correct `ogImage` is required for rich previews.
- **`robots.txt`** explicitly allows AI crawlers (GPTBot, ClaudeBot, PerplexityBot,
  OAI-SearchBot, Claude-SearchBot, Google-Extended, CCBot, Applebot-Extended).
- **`llms.txt`** is auto-generated from the post index at build time.
- **Static HTML export** — content ships in raw HTML, visible to crawlers that
  don't execute JavaScript (GPTBot, ClaudeBot, PerplexityBot). Never move content
  behind client-side rendering.

**What you must do in each post:**
- Write a fact-dense **`description`** (150–160 chars + statistic) — it becomes the
  schema description and OG description.
- Set a correct **`ogImage`** (the cover image path) — it becomes `og:image` and
  the schema `image`.
- Use **answer-first paragraphs** and **citation capsules** (see §8) — these are
  the quotable units AI systems lift into responses.
- Include a **FAQ section** with question-format headings — AI systems favor Q&A
  structure for extraction.
- Keep the **heading hierarchy clean**: one H1, H2s as questions, H3s only as
  children of an H2. The build adds slug IDs to every heading via `rehype-slug`.

## 12. Final Pre-Commit Checklist

- [ ] Both `index.md` and `index.zh.md` exist.
- [ ] Frontmatter complete: title, description (150–160 chars + stat), coverImage,
      coverImageAlt, ogImage, date/lastUpdated (YYYY-MM-DD HH:MM:SS), author, tags.
- [ ] Tags: max 3, English, aggregated with existing inventory.
- [ ] All images downloaded to `public/posts/<slug>/images/` (not hotlinked).
- [ ] All SVGs are separate files in `public/posts/<slug>/charts/` (no inline SVG).
- [ ] All SVGs pass `xmllint --noout` (valid XML, no bare `&`).
- [ ] Cover image repeated as first content image.
- [ ] Key Takeaways box present (EN: "Key Takeaways", ZH: "核心要点").
- [ ] ≥2 information gain markers (`[PERSONAL EXPERIENCE]` / `[UNIQUE INSIGHT]` /
      `[ORIGINAL DATA]`).
- [ ] FAQ section with 3–5 items.
- [ ] Sources block at the bottom.
- [ ] All `INTERNAL-LINK` lines removed.
