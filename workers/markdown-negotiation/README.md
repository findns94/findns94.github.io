# Markdown Content Negotiation Worker

Implements [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)
content negotiation per the [Content Signals](https://contentsignals.org/) spec.

## How it works

1. **Build step**: `scripts/copy-markdown.mjs` copies markdown sources from
   `content/posts/<slug>/` to `out/posts/<slug>/` during `pnpm build`.
2. **Worker**: Intercepts requests to `findns.cc`. When `Accept: text/markdown`
   is present, serves the markdown source; otherwise passes through to HTML.

## Signals declared

```
Content-Signal: ai-train=no, search=yes, ai-input=no
```

## Deploy

```bash
cd workers/markdown-negotiation
npx wrangler deploy
```

Then in Cloudflare Dashboard, configure the route:

| Field | Value |
|-------|-------|
| Route | `findns.cc/*` |
| Worker | `markdown-negotiation` |

## Test

```bash
# Should return markdown
curl https://findns.cc/posts/linux-unix-socket-gc/ \
  -H "Accept: text/markdown" \
  -D -

# Should return HTML (default browser behavior)
curl https://findns.cc/posts/linux-unix-socket-gc/ -D -
```

## Validate

```bash
curl -X POST https://isitagentready.com/api/scan \
  -H "Content-Type: application/json" \
  -d '{"url": "https://findns.cc"}'
```

Check that `checks.contentAccessibility.markdownNegotiation.status` returns `"pass"`.
