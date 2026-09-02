import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // 工作区包以源码形式引入
  transpilePackages: ["@harth/shared"],
  // 浏览器测试用 .next/e2e，不和 next dev、正式构建互相覆盖
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // standalone 产物在 monorepo 下要指定追踪根目录
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};

export default nextConfig;
