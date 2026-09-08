import { z } from 'zod'

export const REPORT_TARGET_TYPES = ['post', 'comment', 'response', 'review', 'message', 'user', 'tool', 'circle'] as const
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number]

export const REPORT_REASONS = {
  spam: '垃圾广告',
  abuse: '辱骂骚扰',
  illegal: '违法违规',
  privacy: '泄露隐私',
  other: '其他',
} as const
export type ReportReason = keyof typeof REPORT_REASONS

export const REPORT_DETAIL_MAX = 500
export const APPEAL_TEXT_MAX = 500
export const MODERATION_REASON_MAX = 300
export const MUTE_DAYS_OPTIONS = [1, 7, 30] as const

export const reportInputSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().min(1).max(64),
  reason: z.enum(['spam', 'abuse', 'illegal', 'privacy', 'other']),
  detail: z.string().trim().max(REPORT_DETAIL_MAX).optional(),
})

export const decideReportSchema = z.object({
  action: z.enum(['hide', 'mute', 'ban', 'tool_suspend', 'dismiss']),
  reason: z.string().trim().min(1).max(MODERATION_REASON_MAX),
  days: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional(),
})

export const GOVERNANCE_ERROR_CODES = {
  BLOCKED: '对方或你已屏蔽，不能私聊',
  CONTENT_REJECTED: '内容含有不允许的词',
  MUTED: '禁言中',
  BANNED: '账号已被封禁',
  SUSPENDED: '工具已被停用',
  CONSENT_REQUIRED: '先看看这个工具要用你的哪些数据',
} as const
