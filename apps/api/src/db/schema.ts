import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

// depth 1 身份圈、2 社群圈、3 行动圈，双人圈不计层级。
// hibernationDeadline 非空表示在休眠倒计时，archivedAt 非空表示已归档。
export const circles = pgTable(
  'circle',
  {
    id: id(),
    name: text('name').notNull(),
    visibility: text('visibility', { enum: ['public', 'private'] }).notNull(),
    isDm: boolean('is_dm').notNull().default(false),
    // 两人 userId 排序后拼接，同一对用户只有一个双人圈
    dmKey: text('dm_key'),
    depth: integer('depth'),
    isOfficial: boolean('is_official').notNull().default(false),
    inviteCode: text('invite_code'),
    dormancyDays: integer('dormancy_days'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    hibernationDeadline: timestamp('hibernation_deadline', {
      withTimezone: true,
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('circle_dm_key_uidx').on(t.dmKey),
    index('circle_lifecycle_idx').on(t.archivedAt, t.lastActivityAt),
  ],
)

// 一个圈可以有多个父圈
export const circleParents = pgTable(
  'circle_parent',
  {
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    parentId: text('parent_id')
      .notNull()
      .references(() => circles.id),
  },
  (t) => [
    primaryKey({ columns: [t.circleId, t.parentId] }),
    index('circle_parent_parent_idx').on(t.parentId),
  ],
)

export const memberships = pgTable(
  'membership',
  {
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role', { enum: ['owner', 'member'] })
      .notNull()
      .default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.circleId, t.userId] }),
    index('membership_user_idx').on(t.userId),
  ],
)

// 圈内启用的帖子模板
export const circleTemplates = pgTable(
  'circle_template',
  {
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    templateKey: text('template_key').notNull(),
    enabledBy: text('enabled_by')
      .notNull()
      .references(() => user.id),
    enabledAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.circleId, t.templateKey] })],
)

export const messages = pgTable(
  'message',
  {
    id: id(),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    content: text('content').notNull(),
    replyToId: text('reply_to_id'),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenModerationId: text('hidden_moderation_id'),
    createdAt: createdAt(),
  },
  (t) => [index('message_circle_created_idx').on(t.circleId, t.createdAt)],
)

// 状态：open、matched（作者选定应答）、completed（双方确认）、cancelled。
// 工具定时运行发的帖没有作者，只有 toolId。
export const posts = pgTable(
  'post',
  {
    id: id(),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    templateKey: text('template_key').notNull(),
    authorId: text('author_id').references(() => user.id),
    title: text('title').notNull(),
    fields: jsonb('fields').notNull().$type<Record<string, unknown>>(),
    status: text('status', {
      enum: ['open', 'matched', 'completed', 'cancelled'],
    })
      .notNull()
      .default('open'),
    matchedResponseId: text('matched_response_id'),
    toolId: text('tool_id'),
    authorConfirmedAt: timestamp('author_confirmed_at', { withTimezone: true }),
    responderConfirmedAt: timestamp('responder_confirmed_at', {
      withTimezone: true,
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenModerationId: text('hidden_moderation_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('post_circle_status_idx').on(t.circleId, t.status, t.createdAt),
    check('post_author_or_tool', sql`${t.authorId} IS NOT NULL OR ${t.toolId} IS NOT NULL`),
  ],
)

export const responses = pgTable(
  'response',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id),
    responderId: text('responder_id')
      .notNull()
      .references(() => user.id),
    message: text('message').notNull(),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenModerationId: text('hidden_moderation_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('response_post_responder_uidx').on(t.postId, t.responderId)],
)

// 成交后互评，信誉在查询时聚合
export const reviews = pgTable(
  'review',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => user.id),
    revieweeId: text('reviewee_id')
      .notNull()
      .references(() => user.id),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenModerationId: text('hidden_moderation_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_post_reviewer_uidx').on(t.postId, t.reviewerId),
    index('review_reviewee_idx').on(t.revieweeId),
  ],
)

export const comments = pgTable(
  'comment',
  {
    id: id(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    content: text('content').notNull(),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenModerationId: text('hidden_moderation_id'),
    createdAt: createdAt(),
  },
  (t) => [index('comment_post_created_idx').on(t.postId, t.createdAt)],
)

export const tools = pgTable('tool', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id),
  currentVersionId: text('current_version_id'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  createdAt: createdAt(),
})

// 状态：pending（待审）、approved、rejected；review 存自动检查与 AI 审核结果
export const toolVersions = pgTable(
  'tool_version',
  {
    id: id(),
    toolId: text('tool_id')
      .notNull()
      .references(() => tools.id),
    version: text('version').notNull(),
    manifest: jsonb('manifest').notNull().$type<Record<string, unknown>>(),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    review: jsonb('review').$type<Record<string, unknown>>(),
    backendHash: text('backend_hash'),
    packageBytes: integer('package_bytes').notNull().default(0),
    createdAt: createdAt(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('tool_version_tool_version_uidx').on(t.toolId, t.version)],
)

// versionId 与 schedules 是圈主确认过的版本与时间表快照，新版本有变化时要重新确认
export const circleTools = pgTable(
  'circle_tool',
  {
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    toolId: text('tool_id')
      .notNull()
      .references(() => tools.id),
    installedBy: text('installed_by')
      .notNull()
      .references(() => user.id),
    scopes: text('scopes').array().notNull(),
    versionId: text('version_id'),
    schedules: jsonb('schedules').notNull().$type<Record<string, unknown>[]>().default([]),
    installedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.circleId, t.toolId] })],
)

// 工具数据按 工具 × 圈 隔离；namespace 正式为空串、开发会话为 dev:<userId>；version 用于乐观并发
export const toolStorage = pgTable(
  'tool_storage',
  {
    toolId: text('tool_id')
      .notNull()
      .references(() => tools.id),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    namespace: text('namespace').notNull().default(''),
    key: text('key').notNull(),
    value: jsonb('value').notNull().$type<unknown>(),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.toolId, t.circleId, t.namespace, t.key] })],
)

export const toolDevSessions = pgTable('tool_dev_session', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id),
  circleId: text('circle_id')
    .notNull()
    .references(() => circles.id),
  toolId: text('tool_id')
    .notNull()
    .references(() => tools.id),
  url: text('url').notNull(),
  manifest: jsonb('manifest').notNull().$type<Record<string, unknown>>(),
  backend: text('backend'),
  backendHash: text('backend_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

// 每个安装 × 清单里的一条时间表；nextRunAt 从计划时间推进，不从完成时间算
export const toolSchedules = pgTable(
  'tool_schedule',
  {
    id: id(),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    toolId: text('tool_id')
      .notNull()
      .references(() => tools.id),
    name: text('name').notNull(),
    cron: text('cron').notNull(),
    action: text('action').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastScheduledFor: timestamp('last_scheduled_for', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tool_schedule_install_name_uidx').on(t.circleId, t.toolId, t.name),
    index('tool_schedule_due_idx').on(t.nextRunAt),
  ],
)

export const toolRuns = pgTable(
  'tool_run',
  {
    id: id(),
    toolId: text('tool_id')
      .notNull()
      .references(() => tools.id),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    versionId: text('version_id'),
    scheduleId: text('schedule_id'),
    environment: text('environment', { enum: ['prod', 'dev'] }).notNull(),
    trigger: text('trigger', { enum: ['call', 'schedule', 'manual'] }).notNull(),
    action: text('action').notNull(),
    input: jsonb('input').$type<unknown>(),
    userId: text('user_id').references(() => user.id),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    status: text('status', {
      enum: ['queued', 'running', 'ok', 'error', 'timeout', 'skipped', 'interrupted'],
    })
      .notNull()
      .default('queued'),
    errorCode: text('error_code'),
    error: text('error'),
    logs: text('logs'),
    result: jsonb('result').$type<unknown>(),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    // 准入时预留的燃料与账期，结束后按实际结算；fuelCharged 非空表示已结算
    fuelMonth: text('fuel_month'),
    fuelReserved: integer('fuel_reserved'),
    fuelCharged: integer('fuel_charged'),
  },
  (t) => [
    index('tool_run_install_created_idx').on(t.toolId, t.circleId, t.createdAt),
    index('tool_run_status_idx').on(t.status, t.createdAt),
    uniqueIndex('tool_run_occurrence_uidx').on(t.scheduleId, t.scheduledFor),
  ],
)

// 开发者资格：有行且未撤销才能发布；source 记来源，sourceRef 是邀请码或申请 id
export const developers = pgTable('developer', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id),
  source: text('source', { enum: ['invite', 'application', 'admin'] }).notNull(),
  sourceRef: text('source_ref'),
  grantedBy: text('granted_by').references(() => user.id),
  grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: text('revoked_by').references(() => user.id),
  revokeReason: text('revoke_reason'),
})

// 邀请码：ownerId 是持有者（空＝管理员发的），createdBy 是生成它的人
export const developerInvites = pgTable(
  'developer_invite',
  {
    code: text('code').primaryKey(),
    ownerId: text('owner_id').references(() => user.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    usedBy: text('used_by').references(() => user.id),
    usedAt: timestamp('used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('developer_invite_owner_idx').on(t.ownerId, t.createdAt),
    check('developer_invite_used_pair', sql`(${t.usedBy} IS NULL) = (${t.usedAt} IS NULL)`),
  ],
)

export const developerApplications = pgTable(
  'developer_application',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    message: text('message').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    note: text('note'),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by').references(() => user.id),
  },
  (t) => [
    uniqueIndex('developer_application_pending_uidx').on(t.userId).where(sql`${t.status} = 'pending'`),
    index('developer_application_status_idx').on(t.status, t.createdAt),
    index('developer_application_user_idx').on(t.userId, t.createdAt),
  ],
)

// 燃料账户：按工具所有者按账期一行，准入靠这一行的原子更新；数字是内部单位（1 燃料 = 100）
export const fuelAccounts = pgTable(
  'fuel_account',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    month: text('month').notNull(),
    used: bigint('used', { mode: 'number' }).notNull().default(0),
    reserved: bigint('reserved', { mode: 'number' }).notNull().default(0),
    rateVersion: integer('rate_version').notNull(),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
    holdingBilledOn: text('holding_billed_on'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.month] }),
    check('fuel_account_nonneg', sql`${t.used} >= 0 AND ${t.reserved} >= 0`),
  ],
)

// 用量明细：按工具按天，月汇总与近 7 天统计都从这里来，不受运行记录修剪影响
export const toolUsage = pgTable(
  'tool_usage',
  {
    toolId: text('tool_id')
      .notNull()
      .references(() => tools.id),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    day: text('day').notNull(),
    runs: integer('runs').notNull().default(0),
    ok: integer('ok').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    runMs: bigint('run_ms', { mode: 'number' }).notNull().default(0),
    posts: integer('posts').notNull().default(0),
    storageWrites: integer('storage_writes').notNull().default(0),
    storageWriteBytes: bigint('storage_write_bytes', { mode: 'number' }).notNull().default(0),
    units: bigint('units', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.toolId, t.day] }),
    index('tool_usage_owner_day_idx').on(t.ownerId, t.day),
  ],
)

// 发码记录：手机号、账号、来源 IP 三个维度的限额都从这里数，7 天后清理
export const smsSends = pgTable(
  'sms_send',
  {
    id: id(),
    phone: text('phone').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sms_send_phone_idx').on(t.phone, t.createdAt),
    index('sms_send_user_idx').on(t.userId, t.createdAt),
    index('sms_send_ip_idx').on(t.ip, t.createdAt),
  ],
)

// 一行是当前状态：禁言到 until，封禁到解除；历史在处置记录里
export const userRestrictions = pgTable(
  'user_restriction',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id),
    kind: text('kind', { enum: ['mute', 'ban'] }).notNull(),
    until: timestamp('until', { withTimezone: true }),
    reason: text('reason').notNull(),
    moderationId: text('moderation_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('user_restriction_kind', sql`${t.kind} IN ('mute', 'ban')`),
    check('user_restriction_mute_until', sql`${t.kind} <> 'mute' OR ${t.until} IS NOT NULL`),
  ],
)

export const REPORT_TARGETS = ['post', 'comment', 'response', 'review', 'message', 'user', 'tool', 'circle'] as const
export const MODERATION_ACTIONS = ['hide', 'restore', 'mute', 'unmute', 'ban', 'unban', 'tool_suspend', 'tool_restore'] as const

// 举报：同人同目标只能有一条待处理；规则命中的自动举报 reporter 为空
export const reports = pgTable(
  'report',
  {
    id: id(),
    reporterId: text('reporter_id').references(() => user.id),
    targetType: text('target_type', { enum: REPORT_TARGETS }).notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason', { enum: ['spam', 'abuse', 'illegal', 'privacy', 'rule', 'other'] }).notNull(),
    detail: text('detail'),
    status: text('status', { enum: ['pending', 'handled', 'dismissed'] })
      .notNull()
      .default('pending'),
    snapshot: text('snapshot'),
    handledBy: text('handled_by').references(() => user.id),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    moderationId: text('moderation_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('report_pending_uidx')
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`${t.status} = 'pending' AND ${t.reporterId} IS NOT NULL`),
    uniqueIndex('report_rule_pending_uidx')
      .on(t.targetType, t.targetId)
      .where(sql`${t.status} = 'pending' AND ${t.reporterId} IS NULL`),
    index('report_status_idx').on(t.status, t.createdAt, t.id),
    index('report_reporter_idx').on(t.reporterId, t.createdAt, t.id),
    check('report_status', sql`${t.status} IN ('pending', 'handled', 'dismissed')`),
  ],
)

export const userBlocks = pgTable(
  'user_block',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => user.id),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('user_block_blocked_idx').on(t.blockedId, t.blockerId),
    check('user_block_not_self', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
)

// 处置的审计记录，只增不改；撤销是再写一条并指向原记录
export const moderations = pgTable(
  'moderation',
  {
    id: id(),
    action: text('action', { enum: MODERATION_ACTIONS }).notNull(),
    targetType: text('target_type', { enum: REPORT_TARGETS }).notNull(),
    targetId: text('target_id').notNull(),
    subjectUserId: text('subject_user_id').references(() => user.id),
    reportId: text('report_id'),
    reason: text('reason').notNull(),
    until: timestamp('until', { withTimezone: true }),
    by: text('by')
      .notNull()
      .references(() => user.id),
    reversalOf: text('reversal_of'),
    createdAt: createdAt(),
  },
  (t) => [
    index('moderation_target_idx').on(t.targetType, t.targetId, t.createdAt, t.id),
    index('moderation_subject_idx').on(t.subjectUserId, t.createdAt, t.id),
    check('moderation_action', sql`${t.action} IN ('hide', 'restore', 'mute', 'unmute', 'ban', 'unban', 'tool_suspend', 'tool_restore')`),
  ],
)

export const appeals = pgTable(
  'appeal',
  {
    id: id(),
    moderationId: text('moderation_id').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    text: text('text').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    decidedBy: text('decided_by').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('appeal_status_idx').on(t.status, t.createdAt, t.id),
    check('appeal_status', sql`${t.status} IN ('pending', 'accepted', 'rejected')`),
  ],
)

// 内容规则：reject 直接拒绝，flag 自动进举报队列
export const contentRules = pgTable(
  'content_rule',
  {
    id: id(),
    pattern: text('pattern').notNull(),
    kind: text('kind', { enum: ['reject', 'flag'] }).notNull(),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [check('content_rule_kind', sql`${t.kind} IN ('reject', 'flag')`)],
)

// 封禁期间同号不能重新绑定：只存号码指纹，解封或到期即删
export const bannedPhones = pgTable('banned_phone', {
  phoneHmac: text('phone_hmac').primaryKey(),
  moderationId: text('moderation_id').notNull(),
  until: timestamp('until', { withTimezone: true }),
  createdAt: createdAt(),
})

// 成员对某个圈里某个工具的数据授权：记排序后的权限全文，新增权限要重新问
export const toolConsents = pgTable(
  'tool_consent',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    toolId: text('tool_id')
      .notNull()
      .references(() => tools.id),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    scopes: text('scopes').array().notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.toolId, t.circleId] }),
    index('tool_consent_tool_circle_idx').on(t.toolId, t.circleId),
  ],
)
