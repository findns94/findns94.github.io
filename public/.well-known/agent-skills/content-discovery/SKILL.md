---
name: content-discovery
description: Discover and access blog content via RSS, sitemap, and llms.txt index.
---

# Content Discovery

Discover and access articles on the Silver Bullet blog (findns.cc).

## When to use

- When you need to find articles by topic, tag, or date
- When you want to list all available content
- When you need the latest posts

## Methods

### RSS Feed

Fetch the RSS feed to get the latest posts:

```
GET https://findns.cc/feed.xml
```

Returns RSS 2.0 XML with titles, descriptions, publication dates, and links.

### Sitemap

Fetch the sitemap for all page URLs:

```
GET https://findns.cc/sitemap.xml
```

Returns XML sitemap with all public page URLs.

### llms.txt Index

Fetch the llms.txt index for a text-based content listing:

```
GET https://findns.cc/llms.txt
```

Returns a plain text list of all posts with titles and URLs.

### Tag Pages

Browse content by tag:

```
GET https://findns.cc/tags/{tag-name}
```

Example: `https://findns.cc/tags/linux`

## Content URLs

Individual articles follow the pattern:

```
https://findns.cc/posts/{slug}/
```

Where `slug` is a lowercase kebab-case identifier (e.g., `linux-unix-socket-gc`).
