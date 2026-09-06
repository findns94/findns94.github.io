/**
 * Markdown Content Negotiation + API Catalog Worker
 *
 * Implements:
 * - https://contentsignals.org/ Markdown-for-Agents spec
 * - RFC 9727 API Catalog at /.well-known/api-catalog
 *
 * When a request includes `Accept: text/markdown`, the worker fetches the
 * markdown source from the origin and returns it with the correct Content-Type.
 * All other requests pass through to HTML as normal.
 *
 * Token counting uses a simple ~4 chars/token heuristic (GPT tokenizer approx).
 * For production, consider using a proper tokenizer via WASM if precision matters.
 */

const ORIGIN = 'https://findns.cc'
const SITE_URL = 'https://findns.cc'

// Signals we want to declare on converted responses (matches robots.txt)
const CONTENT_SIGNAL = 'ai-train=no, search=yes, ai-input=no'

// RFC 9727 API Catalog linkset
const API_CATALOG = {
  linkset: [
    {
      anchor: `${SITE_URL}/feed.xml`,
      'service-desc': [
        {
          href: `${SITE_URL}/feed.xml`,
          type: 'application/rss+xml',
        },
      ],
      'service-doc': [
        {
          href: `${SITE_URL}/about`,
          type: 'text/html',
        },
      ],
      status: [
        {
          href: `${SITE_URL}/feed.xml`,
          type: 'application/rss+xml',
        },
      ],
    },
    {
      anchor: `${SITE_URL}/llms.txt`,
      'service-desc': [
        {
          href: `${SITE_URL}/llms.txt`,
          type: 'text/plain',
        },
      ],
      'service-doc': [
        {
          href: `${SITE_URL}/about`,
          type: 'text/html',
        },
      ],
      status: [
        {
          href: `${SITE_URL}/llms.txt`,
          type: 'text/plain',
        },
      ],
    },
    {
      anchor: `${SITE_URL}/sitemap.xml`,
      'service-desc': [
        {
          href: `${SITE_URL}/sitemap.xml`,
          type: 'application/xml',
        },
      ],
      'service-doc': [
        {
          href: `${SITE_URL}/about`,
          type: 'text/html',
        },
      ],
      status: [
        {
          href: `${SITE_URL}/sitemap.xml`,
          type: 'application/xml',
        },
      ],
    },
    {
      anchor: `${SITE_URL}/posts`,
      'service-desc': [
        {
          href: `${SITE_URL}/llms.txt`,
          type: 'text/plain',
        },
      ],
      'service-doc': [
        {
          href: `${SITE_URL}/posts`,
          type: 'text/html',
        },
      ],
      status: [
        {
          href: `${SITE_URL}/posts`,
          type: 'text/html',
        },
      ],
    },
  ],
}

interface Env {
  // No bindings needed; pure compute worker
}

/**
 * Estimate token count using the ~4 chars/token heuristic.
 * This is a rough approximation; actual GPT tokenizer may vary.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Given an HTML URL, derive the corresponding markdown source URL.
 *
 * The site mirrors markdown sources at the same path:
 *   /posts/<slug>/          -> /posts/<slug>/index.md
 *   /posts/<slug>/index.html -> /posts/<slug>/index.md
 *   /                       -> /index.md (if it exists)
 */
function getMarkdownUrl(url: string): string {
  const parsed = new URL(url)
  let pathname = parsed.pathname

  // Strip .html suffix if present
  if (pathname.endsWith('.html')) {
    pathname = pathname.slice(0, -5)
  }

  // Append index.md for directory paths
  if (pathname.endsWith('/')) {
    pathname += 'index.md'
  } else {
    pathname += '.md'
  }

  parsed.pathname = pathname
  return parsed.toString()
}

/**
 * Check if the request explicitly wants markdown.
 * Looks for text/markdown in the Accept header.
 */
function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false
  // Parse Accept header: "text/html, application/xhtml+xml, text/markdown;q=0.9"
  const types = accept.split(',').map(t => t.trim().toLowerCase().split(';')[0])
  return types.includes('text/markdown')
}

/**
 * Generate the API catalog response per RFC 9727.
 * Serves /.well-known/api-catalog with application/linkset+json.
 */
function handleApiCatalog(url: string): Response {
  const body = JSON.stringify(API_CATALOG, null, 2)
  const headers = new Headers()
  headers.set('Content-Type', 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"; charset=utf-8')
  headers.set('Content-Signal', CONTENT_SIGNAL)
  headers.set('Cache-Control', 'public, max-age=3600')
  headers.set('Vary', 'Accept')

  return new Response(body, {
    status: 200,
    headers,
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const accept = request.headers.get('Accept')

    // RFC 9727: API Catalog endpoint
    if (url.pathname === '/.well-known/api-catalog') {
      return handleApiCatalog(request.url)
    }

    // Only intercept requests that explicitly ask for markdown
    if (!wantsMarkdown(accept)) {
      return fetch(request)
    }

    // Fetch the markdown source from origin
    const mdUrl = getMarkdownUrl(request.url)
    const mdResponse = await fetch(mdUrl, {
      headers: {
        // Tell origin we want the raw file
        'Accept': 'text/markdown, text/plain;q=0.9, */*;q=0.8',
      },
    })

    // If markdown source doesn't exist, fall back to HTML
    if (!mdResponse.ok) {
      return new Response(
        `Markdown source not available for this URL. See ${request.url} for the HTML version.`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Vary': 'Accept',
          },
        }
      )
    }

    const mdBody = await mdResponse.text()
    const mdTokens = estimateTokens(mdBody)

    // Build response headers per the spec
    const headers = new Headers()
    headers.set('Content-Type', 'text/markdown; charset=utf-8')
    headers.set('Content-Signal', CONTENT_SIGNAL)
    headers.set('x-markdown-tokens', String(mdTokens))
    headers.set('Vary', 'Accept')

    // Preserve cache-related headers from origin
    const preserveHeaders = [
      'Cache-Control',
      'Expires',
      'Age',
      'Strict-Transport-Security',
      'Content-Security-Policy',
      'X-Frame-Options',
    ]
    for (const h of preserveHeaders) {
      const val = mdResponse.headers.get(h)
      if (val) headers.set(h, val)
    }

    return new Response(mdBody, {
      status: 200,
      headers,
    })
  },
}
