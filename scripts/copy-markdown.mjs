/**
 * Post-build script: copy markdown source files to the output directory
 * so they can be served via content negotiation by the Cloudflare Worker.
 *
 * Mirrors content/posts/<slug>/index.md -> out/posts/<slug>/index.md
 *                content/posts/<slug>/index.zh.md -> out/posts/<slug>/index.zh.md
 */
import { cp, mkdir } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const contentDir = join(root, 'content', 'posts')
const outDir = join(root, 'out', 'posts')

async function copyMarkdown() {
  const slugs = await readdir(contentDir)
  let copied = 0

  for (const slug of slugs) {
    const postDir = join(contentDir, slug)
    const files = await readdir(postDir)

    for (const file of files) {
      // Copy .md files (index.md, index.zh.md)
      if (file.endsWith('.md')) {
        const src = join(postDir, file)
        const destDir = join(outDir, slug)
        const dest = join(destDir, file)

        await mkdir(destDir, { recursive: true })
        await cp(src, dest)
        copied++
      }
    }
  }

  console.log(`[copy-markdown] Copied ${copied} markdown file(s) to out/`)
}

copyMarkdown().catch(err => {
  console.error('[copy-markdown] Error:', err)
  process.exit(1)
})
