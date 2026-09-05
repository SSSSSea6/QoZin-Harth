import { TOOL_REVIEW_TEXT_BUDGET, TOOL_SCOPES } from '@harth/shared'
import { z } from 'zod'
import { env } from '../env'
import { textFiles, type ToolPackage } from './package'

export const aiVerdictSchema = z.object({
  verdict: z.enum(['approve', 'reject', 'manual']),
  summary: z.string().max(500),
  issues: z.array(z.string().max(300)).max(20).default([]),
  usefulness: z.number().int().min(1).max(5),
})

export type AiVerdict = z.infer<typeof aiVerdictSchema>

const SYSTEM = `你是火塘工具市场的审核员。火塘是圈子平台，工具是运行在圈子页 iframe 里的前端页面，通过 @qozin/harth-sdk 访问平台接口，能力由 harth.json 的 permissions 声明。
工具可以带一个后端文件（清单 backend），默认导出的对象里每个键是一个动作，在平台沙箱里运行，只能用参数里的 harth 访问同一套平台接口，没有网络、文件和 Node API。前端用 harth.call 调用动作；清单 schedules 声明的动作会按 cron 定时以工具身份运行，定时发的帖没有作者、显示为工具。
审核只看代码与清单，回答严格用 JSON：{"verdict":"approve"|"reject"|"manual","summary":"...","issues":["..."],"usefulness":1-5}。
必须 reject 的情况：把用户或圈子数据发到站外、加载站外脚本或资源、诱导输入密码/验证码/支付信息、明显的恶意或欺骗、清单声明的权限与代码实际用途明显不符、代码基本不能工作、定时任务只是刷屏或骚扰（频繁发无意义的帖）。
拿不准的 manual。其余 approve。
usefulness 表示工具对一个真实圈子有多实用（1 无用/烂大街的玩具，5 解决明确的真实需求），只作参考不决定 verdict。
summary 用中文，一两句话说明这个工具做什么、定时任务做什么、有没有问题。`

export async function aiReview(pkg: ToolPackage): Promise<AiVerdict | null> {
  const review = env.REVIEW
  if (!review) return null

  const files = textFiles(pkg, TOOL_REVIEW_TEXT_BUDGET)
  const permissions = pkg.manifest.permissions
    .map((p) => `${p}（${TOOL_SCOPES[p]}）`)
    .join('、')
  const schedules = pkg.manifest.schedules.map((s) => `${s.name}：${s.cron} → ${s.action}`).join('；')
  const user = [
    `清单：${JSON.stringify(pkg.manifest)}`,
    `声明的权限：${permissions || '无'}`,
    `定时任务：${schedules || '无'}`,
    ...files.map((f) => `--- ${f.name} ---\n${f.text}`),
  ].join('\n\n')

  const res = await fetch(`${review.apiUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${review.apiKey}`,
    },
    body: JSON.stringify({
      model: review.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`审核模型请求失败：${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error('审核模型没有返回内容')
  return aiVerdictSchema.parse(JSON.parse(content))
}
