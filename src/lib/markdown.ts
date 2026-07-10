import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeKatex from 'rehype-katex'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeStringify from 'rehype-stringify'

export async function compileMarkdown(source: string): Promise<string> {
  // Remove HTML comments (e.g. Hexo's <!-- more --> separator)
  const cleanedSource = source.replace(/<!--[\s\S]*?-->/g, '')

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypePrettyCode, {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },
    })
    .use(rehypeKatex)
    .use(rehypeStringify, { allowDangerousHtml: true })

  const result = await processor.process(cleanedSource)
  return String(result)
}
