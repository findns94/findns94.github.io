/**
 * Markdown Content Negotiation + API Catalog + OAuth Metadata Worker
 *
 * Implements:
 * - https://contentsignals.org/ Markdown-for-Agents spec
 * - RFC 9727 API Catalog at /.well-known/api-catalog
 * - RFC 9728 OAuth Protected Resource Metadata at /.well-known/oauth-protected-resource
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

// RFC 9728 OAuth Protected Resource Metadata
const OAUTH_PROTECTED_RESOURCE = {
  resource: `${SITE_URL}`,
  authorization_servers: [],
  bearer_methods_supported: [],
  resource_name: "Silver Bullet Blog",
  resource_documentation: `${SITE_URL}/about`,
  resource_policy_uri: `${SITE_URL}/privacy`,
  resource_tos_uri: `${SITE_URL}/terms`,
}

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
 * Generate the OAuth Protected Resource Metadata response per RFC 9728.
 * Serves /.well-known/oauth-protected-resource with application/json.
 */
function handleOAuthProtectedResource(): Response {
  const body = JSON.stringify(OAUTH_PROTECTED_RESOURCE, null, 2)
  const headers = new Headers()
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'public, max-age=3600')
  return new Response(body, { status: 200, headers })
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

/**
 * Add RFC 8288 Link discovery headers to a response.
 * Used on the homepage to advertise machine-readable resources.
 */
function addLinkHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  const links = [
    `</.well-known/api-catalog>; rel="api-catalog"`,
    `</llms.txt>; rel="service-desc"; type="text/plain"`,
    `</feed.xml>; rel="service-desc"; type="application/rss+xml"`,
    `</sitemap.xml>; rel="service-desc"; type="application/xml"`,
    `</posts>; rel="service-doc"; type="text/html"`,
    `</about>; rel="describedby"; type="text/html"`,
  ]
  headers.set('Link', links.join(', '))
  return new Response(response.body, { status: response.status, headers })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const accept = request.headers.get('Accept')

    // RFC 9728: OAuth Protected Resource Metadata endpoint
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return handleOAuthProtectedResource()
    }

    // RFC 9727: API Catalog endpoint
    if (url.pathname === '/.well-known/api-catalog') {
      return handleApiCatalog(request.url)
    }

    // Homepage: add Link discovery headers
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const response = await fetch(request)
      return addLinkHeaders(response)
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
