---
name: markdown-negotiation
description: Retrieve article content in markdown format via HTTP content negotiation.
---

# Markdown Content Negotiation

Retrieve clean markdown representations of blog articles by sending the `Accept: text/markdown` header.

## When to use

- When you need article content in markdown format for processing
- When you want to avoid parsing HTML
- When you need the raw text content of an article

## How to use

Send a GET request with the `Accept: text/markdown` header:

```
GET https://findns.cc/posts/{slug}/
Accept: text/markdown
```

### Response

- **Content-Type**: `text/markdown; charset=utf-8`
- **Status**: 200 if markdown source exists, 404 if not

### Headers

| Header | Value | Description |
|--------|-------|-------------|
| `Content-Type` | `text/markdown; charset=utf-8` | Response format |
| `x-markdown-tokens` | integer | Estimated token count |
| `Content-Signal` | `ai-train=no, search=yes, ai-input=no` | Usage signals |
| `Vary` | `Accept` | Cache variation |

### Example

```bash
curl https://findns.cc/posts/linux-unix-socket-gc/ \
  -H "Accept: text/markdown"
```

### Notes

- Only works for URLs that have markdown source files (blog posts)
- For other URLs, the HTML version is returned
- Chinese versions are available at `/posts/{slug}/index.zh.md`
