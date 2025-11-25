import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from 'fumadocs-mdx/config'
import { z } from 'zod'
import { remarkAdmonition } from 'fumadocs-core/mdx-plugins'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.vercel.app/docs/mdx/collections#define-docs
export const docs = defineDocs({
  dir: 'content/iteration',
  docs: {
    schema: frontmatterSchema,
  },
  meta: {
    schema: metaSchema,
  },
})

import { remarkImage } from 'fumadocs-core/mdx-plugins'

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [
      remarkMath,
      [
        remarkImage,
        {
          useImport: true,
        },
      ],
      remarkAdmonition,
    ],
    rehypePlugins: (v) => [rehypeKatex, ...v],
  },
})
