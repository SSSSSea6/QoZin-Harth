import {
  boolean,
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
    createdAt: createdAt(),
  },
  (t) => [index('message_circle_created_idx').on(t.circleId, t.createdAt)],
)

// 状态：open、matched（作者选定应答）、completed（双方确认）、cancelled
export const posts = pgTable(
  'post',
  {
    id: id(),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    templateKey: text('template_key').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
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
    createdAt: createdAt(),
  },
  (t) => [index('post_circle_status_idx').on(t.circleId, t.status, t.createdAt)],
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
    createdAt: createdAt(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('tool_version_tool_version_uidx').on(t.toolId, t.version)],
)

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
    requests: integer('requests').notNull().default(0),
    installedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.circleId, t.toolId] })],
)

// 工具数据按 工具 × 圈 隔离；version 用于乐观并发
export const toolStorage = pgTable(
  'tool_storage',
  {
    toolId: text('tool_id')
      .notNull()
      .references(() => tools.id),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull().$type<unknown>(),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.toolId, t.circleId, t.key] })],
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
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})
