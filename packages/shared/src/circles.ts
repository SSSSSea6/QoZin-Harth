import { z } from 'zod'

// 身份圈 1、社群圈 2、行动圈 3，双人圈不计层级
export const MAX_CIRCLE_DEPTH = 3

export const CIRCLE_VISIBILITIES = ['public', 'private'] as const
export type CircleVisibility = (typeof CIRCLE_VISIBILITIES)[number]

export const CIRCLE_NAME_MAX = 32
export const MESSAGE_MAX = 2000

// 各层默认沉寂阈值（天），null 不休眠
export const DORMANCY_DAYS_BY_DEPTH: Record<number, number | null> = {
  1: null,
  2: 90,
  3: 30,
}
export const DORMANCY_DAYS_DM = 2

// 倒计时时长（天）
export const RENEWAL_WINDOW_DAYS = 7

export const createCircleInput = z.object({
  name: z.string().trim().min(1).max(CIRCLE_NAME_MAX),
  visibility: z.enum(CIRCLE_VISIBILITIES),
  parentIds: z.array(z.string()).min(1).max(4),
})
export type CreateCircleInput = z.infer<typeof createCircleInput>

export const messageInput = z.object({
  content: z.string().trim().min(1).max(MESSAGE_MAX),
  replyToId: z.string().optional(),
})
export type MessageInput = z.infer<typeof messageInput>
