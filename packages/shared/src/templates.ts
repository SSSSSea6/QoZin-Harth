import { z } from 'zod'

// 帖子模板：api 用来校验字段，web 用来渲染表单。discussion 每个圈默认可用。

export const discussionFields = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().max(5000).default(''),
})
export type DiscussionFields = z.infer<typeof discussionFields>

export const secondhandFields = z.object({
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000).default(''),
  // 单位分，0 为免费
  priceFen: z.number().int().min(0).max(100_000_00),
})
export type SecondhandFields = z.infer<typeof secondhandFields>

export const TEMPLATES = {
  discussion: {
    key: 'discussion',
    name: '讨论',
    postNoun: '帖子',
    alwaysEnabled: true,
    fields: discussionFields,
  },
  secondhand: {
    key: 'secondhand',
    name: '二手',
    postNoun: '闲置',
    alwaysEnabled: false,
    fields: secondhandFields,
  },
} as const

export type TemplateKey = keyof typeof TEMPLATES
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[]

export const templateKeySchema = z.enum(
  TEMPLATE_KEYS as [TemplateKey, ...TemplateKey[]],
)

export function parsePostFields(
  key: TemplateKey,
  raw: unknown,
): { title: string; fields: Record<string, unknown> } | null {
  switch (key) {
    case 'discussion': {
      const parsed = discussionFields.safeParse(raw)
      return parsed.success
        ? { title: parsed.data.title, fields: parsed.data }
        : null
    }
    case 'secondhand': {
      const parsed = secondhandFields.safeParse(raw)
      return parsed.success
        ? { title: parsed.data.title, fields: parsed.data }
        : null
    }
  }
}

export function postExcerpt(
  key: TemplateKey,
  fields: Record<string, unknown>,
  max = 120,
): string {
  const source =
    key === 'discussion' ? fields.body : key === 'secondhand' ? fields.description : ''
  const text = String(source ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export const POST_STATUSES = ['open', 'matched', 'completed', 'cancelled'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export const createPostInput = z.object({
  templateKey: templateKeySchema,
  fields: z.record(z.string(), z.unknown()),
})

export const responseInput = z.object({
  message: z.string().trim().min(1).max(500),
})

export const commentInput = z.object({
  content: z.string().trim().min(1).max(1000),
})

export const reviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
})
