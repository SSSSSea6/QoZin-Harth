import { desc } from 'drizzle-orm'
import { db } from '../db'
import { contentRules, reports } from '../db/schema'
import { fail } from '../http'
import type { ReportTargetType } from '@harth/shared'

type Rule = { id: string; pattern: string; kind: 'reject' | 'flag'; note: string | null; createdAt: Date }

let cache: { at: number; rules: Rule[] } | null = null
const CACHE_MS = 30_000

export async function loadRules(): Promise<Rule[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rules
  const rules = await db.select().from(contentRules).orderBy(desc(contentRules.createdAt))
  cache = { at: Date.now(), rules }
  return rules
}

export function invalidateRules(): void {
  cache = null
}

function hit(rules: Rule[], texts: (string | null | undefined)[]): Rule | null {
  const haystack = texts.filter((t): t is string => typeof t === 'string' && t.length > 0).join('\n').toLowerCase()
  if (!haystack) return null
  return rules.find((rule) => haystack.includes(rule.pattern.toLowerCase())) ?? null
}

// 写入前：命中 reject 规则直接拒绝
export async function assertContentAllowed(...texts: (string | null | undefined)[]): Promise<void> {
  const rules = (await loadRules()).filter((r) => r.kind === 'reject')
  if (hit(rules, texts)) throw fail(400, 'CONTENT_REJECTED', '内容含有不允许的词')
}

// 写入后：命中 flag 规则自动生成一条举报，进同一个队列
export async function flagIfMatched(targetType: ReportTargetType, targetId: string, snapshot: string, ...texts: (string | null | undefined)[]): Promise<void> {
  const rules = (await loadRules()).filter((r) => r.kind === 'flag')
  const rule = hit(rules, texts)
  if (!rule) return
  await db
    .insert(reports)
    .values({ reporterId: null, targetType, targetId, reason: 'rule', detail: `命中规则「${rule.pattern}」`, snapshot: snapshot.slice(0, 200) })
    .onConflictDoNothing()
}
