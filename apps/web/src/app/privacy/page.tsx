import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ReactMarkdown from 'react-markdown'
import { Panel } from '@/components/panel'

export const metadata = { title: '隐私说明 · 火塘' }
// 构建时读仓库根的 PRIVACY.md 渲染成静态页，运行时不再碰文件系统
export const dynamic = 'force-static'

export default async function PrivacyPage() {
  const markdown = await readFile(path.join(process.cwd(), '..', '..', 'PRIVACY.md'), 'utf8')
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Panel className="md:p-6">
        <article className="privacy text-[15px] leading-relaxed">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => (
                <a href={href} className="underline underline-offset-2 hover:text-foreground" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </Panel>
    </div>
  )
}
