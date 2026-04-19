#!/usr/bin/env node
//
// setup-worktree.mjs — 在 worktree 中快速初始化 submodule、环境文件和依赖
//
// 用法：
//   在 worktree 目录下执行：
//     node /path/to/setup-worktree.mjs
//
//   或指定主仓库路径：
//     MAIN_REPO=/path/to/healerbook node setup-worktree.mjs
//

import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, symlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// 让所有子进程（wrangler / pnpm 等）走非交互模式，避免交互式提示阻塞脚本
process.env.CI = "1";

function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

// Windows 下 execSync 走 cmd.exe，会把单引号当普通字符透传。对于带 shell 元字符
// （`$()`、`|` 等）且不想被外层 shell 解析的 git 命令，用 execFileSync 以数组形式传参，
// 完全绕过外层 shell。
function gitArgs(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function run(cmd, cwd, options = {}) {
  execSync(cmd, { cwd, stdio: "inherit", ...options });
}

// --- 定位路径 ---

const WORKTREE = process.cwd();

let gitCommonDir, gitDir;
try {
  gitCommonDir = resolve(git("rev-parse --git-common-dir", WORKTREE));
  gitDir = resolve(git("rev-parse --git-dir", WORKTREE));
} catch {
  console.error("❌ 当前目录不是 git 仓库");
  process.exit(1);
}

if (gitCommonDir === gitDir) {
  console.error("❌ 当前目录不是 worktree，请在 worktree 中执行此脚本");
  process.exit(1);
}

const MAIN_REPO = resolve(
  process.env.SUPERSET_ROOT_PATH || process.env.MAIN_REPO || join(gitCommonDir, ".."),
);
const MAIN_MODULES = join(MAIN_REPO, ".git", "modules");
const WT_GITDIR = resolve(git("rev-parse --absolute-git-dir", WORKTREE));

console.log(`📁 Worktree:  ${WORKTREE}`);
console.log(`📁 Main repo: ${MAIN_REPO}`);
console.log();

// --- 1. 快速初始化 submodule（本地 clone，不走网络）---

function initSubmoduleLocal(smPath, mainModulesDir, destModulesDir, parentDir) {
  const destWorkdir = join(WORKTREE, smPath);

  let expectedCommit;
  try {
    const lsTreeCwd = parentDir || WORKTREE;
    const lookupName = parentDir ? basename(smPath) : smPath;
    const output = git(`ls-tree HEAD "${lookupName}"`, lsTreeCwd);
    expectedCommit = output.split(/\s+/)[2];
  } catch {
    expectedCommit = "";
  }

  if (!expectedCommit) {
    console.log(`  ⚠️  跳过 ${smPath}（未在当前 commit 中注册）`);
    return;
  }

  // 检查 submodule 是否已存在（.git 文件或目录）
  const dotGit = join(destWorkdir, ".git");
  if (existsSync(dotGit)) {
    console.log(`  ✅ ${smPath} 已存在，跳过`);
    return;
  }

  if (!existsSync(mainModulesDir)) {
    console.log(`  ⚠️  主仓库中 ${smPath} 的 git 对象不存在，回退到远程 clone`);
    run(`git submodule update --init -- "${smPath}"`, WORKTREE);
    return;
  }

  mkdirSync(dirname(destModulesDir), { recursive: true });

  run(
    `git clone --local --no-checkout --separate-git-dir "${destModulesDir}" "${mainModulesDir}" "${destWorkdir}"`,
    WORKTREE,
  );
  git(`checkout ${expectedCommit} --quiet`, destWorkdir);

  // 注册嵌套 submodule
  try {
    git("submodule init --quiet", destWorkdir);
  } catch {
    // 没有嵌套 submodule 时忽略
  }

  console.log(`  ✅ ${smPath} → ${expectedCommit}`);
}

console.log("🔗 初始化 submodule（本地 clone）...");

// 从主仓库动态遍历所有 submodule（含嵌套），按层级顺序处理
let submoduleList = "";
try {
  submoduleList = gitArgs(
    [
      "submodule",
      "foreach",
      "--quiet",
      "--recursive",
      'echo "$displaypath|$(git rev-parse --git-dir)|$toplevel"',
    ],
    MAIN_REPO,
  );
} catch {
  // 没有 submodule
}

if (submoduleList) {
  for (const line of submoduleList.split("\n").filter(Boolean)) {
    const [smDisplayPath, mainGitDir, smToplevel] = line.split("|");

    // 将主仓库的 modules 路径映射到 worktree 的 modules 路径
    const mainGitPrefix = join(MAIN_REPO, ".git") + (process.platform === "win32" ? "\\" : "/");
    const relativeModules = resolve(mainGitDir).replace(mainGitPrefix, "");
    const destModulesDir = join(WT_GITDIR, relativeModules);

    // 确定父目录（用于 git ls-tree 查找期望的 commit）
    const relativeToplevel = resolve(smToplevel).replace(resolve(MAIN_REPO), "");
    const parentDir = relativeToplevel ? join(WORKTREE, relativeToplevel) : "";

    initSubmoduleLocal(smDisplayPath, resolve(mainGitDir), destModulesDir, parentDir);
  }
}

console.log();

// --- 2. 链接环境文件 ---

console.log("🔗 链接环境文件...");

for (const f of [".dev.vars", ".env"]) {
  const source = join(MAIN_REPO, f);
  const target = join(WORKTREE, f);

  if (existsSync(target)) {
    console.log(`  ⏭️  ${f} 已存在，跳过`);
  } else if (existsSync(source)) {
    const isDir = statSync(source).isDirectory();
    let linked = false;
    try {
      symlinkSync(source, target, isDir ? "junction" : "file");
      linked = true;
    } catch {
      // Windows 无权限创建符号链接时回退到复制
    }
    if (linked) {
      console.log(`  ✅ ${f} → ${source}（symlink）`);
    } else {
      if (isDir) {
        cpSync(source, target, { recursive: true });
      } else {
        copyFileSync(source, target);
      }
      console.log(`  ✅ ${f} ← ${source}（copied）`);
    }
  } else {
    console.log(`  ⚠️  ${source} 不存在，跳过`);
  }
}

console.log();

// --- 3. 安装依赖 ---

console.log("📦 安装依赖...");
run("pnpm install --prefer-offline", WORKTREE);
console.log();

// --- 4. 初始化 D1 本地数据库 ---

console.log("🗄️ 初始化 D1 本地数据库...");
try {
  run("pnpm exec wrangler d1 migrations apply healerbook_timelines --local", WORKTREE);
  console.log("  ✅ D1 migrations 已应用");
} catch {
  console.log("  ⚠️  D1 migrations 应用失败，可手动执行：pnpm exec wrangler d1 migrations apply healerbook_timelines --local");
}
console.log();

console.log("🎉 Worktree 初始化完成！");
