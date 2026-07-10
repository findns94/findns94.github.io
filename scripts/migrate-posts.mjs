#!/usr/bin/env node
/**
 * Migrate Hexo posts to Next.js format.
 *
 * Reads from source/_posts/*.md (Hexo format) and outputs to content/posts/<slug>/index.md
 * with images copied to content/posts/<slug>/images/.
 *
 * Transformations:
 *   - frontmatter: mathjax: true → math: true
 *   - image refs: ![alt](slug/image.png) → ![alt](./images/image.png)
 *   - copies image files from source/_posts/<slug>/ to content/posts/<slug>/images/
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, 'source', '_posts')
const OUTPUT_DIR = path.join(ROOT, 'content', 'posts')
const PUBLIC_DIR = path.join(ROOT, 'public', 'posts')

// Simple YAML frontmatter parser (avoids extra dependency)
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const raw = match[1]
  const body = match[2]
  const frontmatter = {}

  for (const line of raw.split(/\r?\n/)) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()

    // Parse arrays like [tag1, tag2] or ["tag1", "tag2"]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1)
      frontmatter[key] = inner
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else if (value === 'true') {
      frontmatter[key] = true
    } else if (value === 'false') {
      frontmatter[key] = false
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, '')
    }
  }

  return { frontmatter, body }
}

function transformFrontmatter(frontmatter) {
  const result = { ...frontmatter }
  // mathjax → math
  if (result.mathjax === true) {
    result.math = true
    delete result.mathjax
  }
  return result
}

function frontmatterToYaml(fm) {
  const lines = ['---']
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`)
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

function transformImageRefs(body, slug) {
  // Match ![alt](path) where path starts with the slug
  return body.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, imgPath) => {
      // If the image path starts with the slug prefix, rewrite to public URL
      if (imgPath.startsWith(`${slug}/`)) {
        const filename = imgPath.slice(slug.length + 1)
        return `![${alt}](/posts/${slug}/images/${filename})`
      }
      return match
    }
  )
}

function migrate() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`)
    process.exit(1)
  }

  const mdFiles = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.md'))
  console.log(`Found ${mdFiles.length} markdown files to migrate\n`)

  let migrated = 0
  let imagesCopied = 0

  for (const mdFile of mdFiles) {
    const slug = mdFile.replace(/\.md$/, '')
    const sourcePath = path.join(SOURCE_DIR, mdFile)
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8')

    const { frontmatter, body } = parseFrontmatter(sourceContent)
    const transformedFm = transformFrontmatter(frontmatter)
    const transformedBody = transformImageRefs(body, slug)

    // Create output directory
    const outputDir = path.join(OUTPUT_DIR, slug)
    fs.mkdirSync(outputDir, { recursive: true })

    // Write index.md
    const outputContent = frontmatterToYaml(transformedFm) + '\n\n' + transformedBody
    fs.writeFileSync(path.join(outputDir, 'index.md'), outputContent)

    // Copy images from source/_posts/<slug>/ to public/posts/<slug>/images/
    const sourceImagesDir = path.join(SOURCE_DIR, slug)
    const publicImagesDir = path.join(PUBLIC_DIR, slug, 'images')
    if (fs.existsSync(sourceImagesDir) && fs.statSync(sourceImagesDir).isDirectory()) {
      const imageFiles = fs.readdirSync(sourceImagesDir).filter((f) => {
        const ext = path.extname(f).toLowerCase()
        return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'].includes(ext)
      })

      if (imageFiles.length > 0) {
        fs.mkdirSync(publicImagesDir, { recursive: true })
        for (const img of imageFiles) {
          fs.copyFileSync(
            path.join(sourceImagesDir, img),
            path.join(publicImagesDir, img)
          )
          imagesCopied++
        }
      }
    }

    console.log(`  ✓ ${mdFile} → content/posts/${slug}/ (${fs.existsSync(sourceImagesDir) ? fs.readdirSync(sourceImagesDir).length : 0} files in source folder)`)
    migrated++
  }

  console.log(`\nDone! Migrated ${migrated} posts, copied ${imagesCopied} images.`)
}

migrate()
