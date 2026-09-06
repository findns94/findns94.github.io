---
name: bilingual-access
description: Access articles in both English and Chinese language versions.
---

# Bilingual Content Access

Access blog articles in both English (EN) and Chinese (ZH) language versions.

## When to use

- When you need content in a specific language
- When you want to compare translations
- When serving multilingual audiences

## Language versions

Each article has two language versions:

| Language | URL Pattern | Markdown URL |
|----------|-------------|--------------|
| English | `/posts/{slug}/` | `/posts/{slug}/index.md` |
| Chinese | `/posts/{slug}/` (with `Accept-Language: zh`) | `/posts/{slug}/index.zh.md` |

## How to use

### HTML versions

```bash
# English (default)
curl https://findns.cc/posts/linux-unix-socket-gc/

# Chinese (via Accept-Language header)
curl https://findns.cc/posts/linux-unix-socket-gc/ \
  -H "Accept-Language: zh-CN,zh;q=0.9"
```

### Markdown versions

```bash
# English markdown
curl https://findns.cc/posts/linux-unix-socket-gc/ \
  -H "Accept: text/markdown"

# Chinese markdown (direct file access)
curl https://findns.cc/posts/linux-unix-socket-gc/index.zh.md
```

## Content parity

- Both versions cover the same topics and statistics
- Chinese versions are **信达雅** rewrites, not literal translations
- Source URLs and statistics are preserved across languages
- Tags are identical in both versions
