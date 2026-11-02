// 把 dist/ 的建置產物部署到 GitHub Pages 倉庫（cas617/metro）。
//
// 用法：
//   npm run deploy                 先建置，確認後推到 pages 倉庫
//   npm run deploy -- --yes        略過「有未提交修改」的確認
//   npm run deploy -- --skip-build 直接部署目前的 dist/（不重新建置）
//
// 原始碼倉庫：chienan0617/metro（origin）
// 頁面倉庫：  cas617/metro（pages），只放建置產物

import { execFileSync, execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const PAGES_REPO = "https://github.com/cas617/metro.git";
const PAGES_BRANCH = "main";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const skipConfirm = args.includes("--yes") || args.includes("-y");
const skipBuild = args.includes("--skip-build");

const git = (cwd, gitArgs, opts = {}) =>
  execFileSync("git", gitArgs, { cwd, stdio: "inherit", ...opts });

const gitOut = (cwd, gitArgs) =>
  execFileSync("git", gitArgs, { cwd, encoding: "utf8" }).trim();

// 1. 有未提交的原始碼修改時先提醒（dist/ 是建置產物，不算）
const dirty = gitOut(root, [
  "status",
  "--porcelain",
  "--untracked-files=no",
  "--",
  ".",
  ":(exclude)dist",
]);

if (dirty) {
  console.log("\n以下原始碼修改還沒提交：\n");
  console.log(dirty.split("\n").map((line) => `  ${line}`).join("\n"));
  console.log("\n部署後頁面會包含這些未提交的內容。");
  if (!skipConfirm) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("仍要繼續嗎？(y/N) ");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("已取消。");
      process.exit(0);
    }
  }
}

// 2. 建置
if (!skipBuild) {
  console.log("\n建置中…\n");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

const dist = path.join(root, "dist");
if (!existsSync(path.join(dist, "index.html"))) {
  console.error("找不到 dist/index.html，請先執行 npm run build。");
  process.exit(1);
}

// 3. 準備暫存目錄，沿用 pages 倉庫既有的歷史
const staging = mkdtempSync(path.join(tmpdir(), "metro-pages-"));
const cleanup = () => rmSync(staging, { recursive: true, force: true });

try {
  try {
    git(staging, ["clone", "--depth", "1", "--branch", PAGES_BRANCH, PAGES_REPO, "."], {
      stdio: "ignore",
    });
  } catch {
    // 遠端還是空的就從頭開始
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    git(staging, ["init", "-b", PAGES_BRANCH]);
    git(staging, ["remote", "add", "origin", PAGES_REPO]);
  }

  // 4. 清空舊內容（保留 .git），換成新的建置產物
  for (const entry of readdirSync(staging)) {
    if (entry === ".git") continue;
    rmSync(path.join(staging, entry), { recursive: true, force: true });
  }
  cpSync(dist, staging, { recursive: true });
  writeFileSync(path.join(staging, ".nojekyll"), "");

  git(staging, ["add", "-A"]);

  const changed = gitOut(staging, ["status", "--porcelain"]);
  if (!changed) {
    console.log("\n建置產物與頁面倉庫相同，不需要部署。");
    process.exit(0);
  }

  const sha = gitOut(root, ["rev-parse", "--short", "HEAD"]);
  const subject = gitOut(root, ["log", "-1", "--format=%s"]);
  git(staging, ["commit", "-m", `deploy: ${sha} ${subject}`]);

  console.log(`\n推送到 ${PAGES_REPO} …\n`);
  git(staging, ["push", "origin", `HEAD:${PAGES_BRANCH}`]);

  console.log("\n完成：https://cas617.github.io/metro/");
} finally {
  cleanup();
}
