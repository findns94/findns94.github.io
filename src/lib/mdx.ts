import { serialize } from 'next-mdx-remote/serialize'
import type { MDXRemoteSerializeResult } from 'next-mdx-remote'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import rehypePrettyCode from 'rehype-pretty-code'

export async function compileMdx(source: string): Promise<MDXRemoteSerializeResult> {
  // Remove HTML comments (e.g. Hexo's <!-- more --> separator) before MDX parsing
  const cleanedSource = source.replace(/<!--[\s\S]*?-->/g, '')

  return serialize(cleanedSource, {
    parseFrontmatter: true,
    mdxOptions: {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [
        rehypeSlug,
        [
          rehypePrettyCode,
          {
            theme: {
              light: 'github-light',
              dark: 'github-dark',
            },
            keepBackground: false,
          },
        ],
        rehypeKatex,
      ] as any,
    },
  })
}
