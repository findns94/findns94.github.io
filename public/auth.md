# auth.md

## Silver Bullet — Agent Authentication & Registration

**Service**: Silver Bullet (findns.cc)
**Type**: Public content site
**Authentication required**: No

### Audience

This site is a bilingual blog (English / Chinese) covering technology, finance, and lifestyle topics. All content is publicly accessible and does not require authentication for reading.

### Available Access Methods

#### Anonymous Read (default)

- **Method**: No credentials required
- **Endpoint**: `https://findns.cc/posts/*`
- **Description**: All blog posts, feeds, and metadata are publicly accessible. AI agents may crawl and index content per the signals declared in `robots.txt`.

#### Content Negotiation

- **Method**: HTTP `Accept` header
- **Endpoint**: `https://findns.cc/posts/*`
- **Description**: Request `Accept: text/markdown` to receive markdown representations of articles instead of HTML.

### Registration

This service does not require agent registration for read access. All content is open.

### Rate Limits

No formal rate limits are enforced. Agents should crawl respectfully (e.g., 1 request per second).

### Contact

For questions about automated access, see [About](/about).
