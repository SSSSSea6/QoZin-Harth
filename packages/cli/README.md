# harth

火塘的开发者命令行。一个工具就是一个网页，跑在圈子页里，通过 SDK 读写这个圈的数据。

## 三条命令

```bash
harth login --api https://你的火塘地址   # 终端给一个验证码，浏览器里确认
harth init my-tool && cd my-tool         # 生成 harth.json 和 index.html
harth dev                                # 本地起服务，在你的圈里实时预览
harth publish                            # 打包上传，进入审核
harth status                             # 看审核结果
```

`harth dev` 会让你选一个圈，然后打开一个只有你能看到的入口；改文件刷新即可。

## harth.json

```json
{
  "slug": "my-tool",
  "name": "我的工具",
  "version": "0.1.0",
  "description": "一句话说明它做什么",
  "entry": "index.html",
  "permissions": ["user.profile", "storage"],
  "actions": []
}
```

| 字段 | 说明 |
| --- | --- |
| `slug` | 小写字母、数字、连字符，3–32 位，全站唯一，发布后不能改 |
| `version` | 形如 `1.0.0`，每次发布必须递增 |
| `entry` | 入口 HTML，默认 `index.html` |
| `permissions` | 需要的能力，见下表；圈主安装时会看到这份清单 |
| `actions` | 预留给可被机器调用的动作，现在留空 |

权限：

| 值 | 能做什么 |
| --- | --- |
| `user.profile` | 当前用户的 id 和昵称 |
| `storage` | 在这个圈里保存工具自己的数据 |
| `circle.read` | 圈子名称和成员数 |
| `members.read` | 成员列表 |
| `posts.read` | 圈内帖子 |
| `posts.write` | 以工具的名义发讨论帖 |

## SDK

页面里引入 `<script src="/_harth/sdk.js"></script>` 得到全局 `harth`；用打包器的话 `npm i @qozin/harth-sdk` 后 `import { harth } from '@qozin/harth-sdk'`。

```js
const ctx = await harth.connect()   // { user, circle, scopes, tool }

await harth.storage.get('key')                 // { key, value, version } 或 null
await harth.storage.set('key', value)          // 可加 { expectedVersion } 做乐观并发
await harth.storage.delete('key')
await harth.storage.list('prefix')

await harth.members()                          // 需要 members.read
await harth.circleInfo()                       // 需要 circle.read
await harth.posts.list()                       // 需要 posts.read
await harth.posts.create({ title, body })      // 需要 posts.write
```

数据按「工具 × 圈」隔离：同一个工具装在两个圈里，数据互不可见；圈主卸载即清空。单个值最大 64 KB，每个圈最多 1000 个键。

## 审核

上传后先做自动检查（文件类型、包大小 5 MB 以内、不能引用站外资源），再由 AI 审核代码与权限声明是否相符。通过即上架，圈主可以在工具市场安装；未通过会在 `harth status` 里看到原因，改完升版本号重新发布。

工具页面带有 CSP，运行时不能加载站外脚本、样式、字体或图片；需要的资源一起打进包里。
