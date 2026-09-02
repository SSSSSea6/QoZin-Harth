<div align="center">

# 火塘 · Harth

**每个圈子都是一堆火：有人添柴就一直燃，没人添柴就安静熄灭。**

开源的圈子基础设施。任何真实的圈子都可以有自己的一堆火——拼车、二手、组队，先从一所学校点起。

[![CI](https://github.com/SSSSSea6/QoZin-Harth/actions/workflows/ci.yml/badge.svg)](https://github.com/SSSSSea6/QoZin-Harth/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-8957e5)](LICENSE)

</div>

## 为什么做这个

真实的圈子正在被淹没：想拼个车，要翻十个刷满广告的群；想送出一件闲置，找不到接手的人；想组个队，全靠运气碰。大平台面向所有人，却不属于任何一个圈子。

我们想让"圈子里的人互相搭把手"重新变得容易。做法是给每个真实的圈子——一所学校、一个社团、一个小区、一群同好——一个属于自己的小空间，和刚好够用的工具。

## 火塘的三个坚持

**圈会熄，也该熄。** 现实里的聚集有始有终，这里的圈也一样：沉寂的圈进入倒计时，任何成员添一把柴就续上；没人添柴，它就安静归档，不惊动任何人。留在你列表里的圈，都是燃着的。

**火堆旁没有主席台。** 上层圈只划定身份边界（比如"本校学生"），不管理下层圈。谁的圈活跃，谁就被更多人看见——排序代替权力。

**要什么，点什么。** 二手、拼车、组队是按圈启用的能力，不是塞给所有人的功能堆。每个圈只呈现它需要的东西。

你的数据怎么处理，写在 [PRIVACY.md](PRIVACY.md)，每一条都能在代码里核对。

## 走到哪了

- [x] 治理：AGPL-3.0 开源 + CLA
- [x] 骨架基座：Next.js 16 · Hono · Postgres
- [x] 圈子原语：创建 / 嵌套 / 双人圈
- [x] 讨论帖与回复、跨圈信息流
- [x] 第一个供需模板：二手（发布 → 应答 → 交接 → 互评）
- [x] 圈子生命周期：添柴与熄灭
- [x] 本地一键启动（见下）
- [x] 开发者 CLI：把你做的工具接进火塘
- [x] 工具市场：AI 审核上架、按圈安装、权限清单、独立源沙箱
- [ ] 工具的后端代码、定时任务与外部集成

第一个火塘在南京航空航天大学点燃，之后是更多学校、社区和任何真实的圈子。

## 本地启动

需要 Node.js ≥ 22.12 和 pnpm 10（`corepack enable`）。

```bash
pnpm install
cp .env.example .env
pnpm --filter api db:dev   # 内嵌 Postgres，数据在 ~/.harth
pnpm dev                   # web :3000，api :3001
```

数据库也可以用 `docker compose up -d db`。Linux 上请用 Docker，内嵌的 Postgres 二进制依赖老版 libicu。

`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`。浏览器测试 `pnpm e2e`，第一次先 `pnpm --filter e2e exec playwright install chromium`。测试默认自起内嵌 Postgres，也可以用 `HARTH_TEST_DATABASE_URL` 指定一个空库。

## 做一个工具

工具是跑在圈子页里的一个网页，通过 SDK 读写这个圈的数据；圈主装了它，成员就能用。

```bash
harth login --api https://你的火塘地址
harth init my-tool && cd my-tool
harth dev        # 在你的圈里实时预览
harth publish    # 上传，审核通过后上架
```

清单、权限、SDK 接口见 [packages/cli/README.md](packages/cli/README.md)。CLI 发布到 npm 前，先在仓库里 `pnpm --filter harth build`，用 `node packages/cli/dist/cli.js` 代替 `harth`。

## 一起围坐

现在还在打地基，参与方式从浅到深：

- **Star / Watch** 这个仓库，看着火慢慢生起来。
- 到 [Issues](../../issues) 聊聊你所在圈子的真实痛点——我们只做真的有人要的东西。
- 想给火塘做一个工具？开发者 CLI 一键接入是下一步，先到 Issues 说说你想做什么。
- 提交代码前签署一次 [CLA](CLA.md)：第一个 PR 里机器人会留言，按提示回复一句即可，之后不再打扰。

## 许可证

[AGPL-3.0](LICENSE)：自由使用、修改、部署；若基于本项目对外提供网络服务，须以同一许可证开源你的修改。「火塘」「Harth」名称与标识不在代码许可范围内。

---

**Harth**（火塘, *the fire pit at the heart of a traditional home, where people gather and the flame is kept alive*）is open-source, circle-scoped community infrastructure for any real-world circle: nested circles that host ride-sharing, second-hand exchange and team-forming, lit first at one university. Circles no one tends quietly archive themselves — every circle you see is a living one.
