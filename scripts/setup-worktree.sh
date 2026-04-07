#!/usr/bin/env bash
#
# setup-worktree.sh — 在 worktree 中快速初始化 submodule、环境文件和依赖
#
# 用法：
#   在 worktree 目录下执行：
#     bash /path/to/setup-worktree.sh
#
#   或指定主仓库路径：
#     MAIN_REPO=/path/to/healerbook bash setup-worktree.sh
#
set -euo pipefail

# --- 定位路径 ---

WORKTREE="$(pwd)"

# 检查当前目录是否是 worktree
GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null)"
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"

if [ "$GIT_COMMON_DIR" = "$GIT_DIR" ]; then
  echo "❌ 当前目录不是 worktree，请在 worktree 中执行此脚本"
  exit 1
fi

# 主仓库路径：优先 SUPERSET_ROOT_PATH，其次 MAIN_REPO，最后从 git common dir 推导
if [ -n "${SUPERSET_ROOT_PATH:-}" ]; then
  MAIN_REPO="$SUPERSET_ROOT_PATH"
elif [ -z "${MAIN_REPO:-}" ]; then
  MAIN_REPO="$(cd "$GIT_COMMON_DIR/.." && pwd)"
fi

MAIN_MODULES="$MAIN_REPO/.git/modules"
WT_GITDIR="$(git rev-parse --absolute-git-dir)"

echo "📁 Worktree:  $WORKTREE"
echo "📁 Main repo: $MAIN_REPO"
echo ""

# --- 1. 快速初始化 submodule（本地 clone，不走网络）---

init_submodule_local() {
  local sm_path="$1"          # submodule 在 worktree 中的相对路径
  local main_modules_dir="$2" # 主仓库中该 submodule 的 .git/modules 路径
  local dest_modules_dir="$3" # worktree gitdir 中的 modules 目标路径
  local parent_dir="${4:-}"          # 父 submodule 工作目录（嵌套时传入）

  local dest_workdir="$WORKTREE/$sm_path"
  local expected_commit
  if [ -n "$parent_dir" ]; then
    # 嵌套 submodule：从父 submodule 的 tree 中查找
    local sm_name
    sm_name="$(basename "$sm_path")"
    expected_commit="$(git -C "$parent_dir" ls-tree HEAD "$sm_name" | awk '{print $3}')"
  else
    # 顶层 submodule：从 worktree 根目录查找
    expected_commit="$(git -C "$WORKTREE" ls-tree HEAD "$sm_path" | awk '{print $3}')"
  fi

  if [ -z "$expected_commit" ]; then
    echo "  ⚠️  跳过 ${sm_path}（未在当前 commit 中注册）"
    return
  fi

  if [ -d "$dest_workdir/.git" ] || [ -f "$dest_workdir/.git" ]; then
    echo "  ✅ $sm_path 已存在，跳过"
    return
  fi

  if [ ! -d "$main_modules_dir" ]; then
    echo "  ⚠️  主仓库中 ${sm_path} 的 git 对象不存在，回退到远程 clone"
    git -C "$WORKTREE" submodule update --init -- "${sm_path}"
    return
  fi

  mkdir -p "$(dirname "$dest_modules_dir")"
  git clone --local --no-checkout \
    --separate-git-dir "$dest_modules_dir" \
    "$main_modules_dir" \
    "$dest_workdir" 2>&1 | sed 's/^/  /'

  git -C "$dest_workdir" checkout "$expected_commit" --quiet

  # 注册嵌套 submodule 的 URL 到 config（消除 git submodule status 的 - 前缀）
  git -C "$dest_workdir" submodule init --quiet 2>/dev/null || true

  echo "  ✅ $sm_path → $expected_commit"
}

echo "🔗 初始化 submodule（本地 clone）..."

# 外层: 3rdparty/ff14-overlay-vue
init_submodule_local \
  "3rdparty/ff14-overlay-vue" \
  "$MAIN_MODULES/3rdparty/ff14-overlay-vue" \
  "$WT_GITDIR/modules/3rdparty/ff14-overlay-vue"

# 嵌套: 3rdparty/ff14-overlay-vue/cactbot
init_submodule_local \
  "3rdparty/ff14-overlay-vue/cactbot" \
  "$MAIN_MODULES/3rdparty/ff14-overlay-vue/modules/cactbot" \
  "$WT_GITDIR/modules/3rdparty/ff14-overlay-vue/modules/cactbot" \
  "$WORKTREE/3rdparty/ff14-overlay-vue"

echo ""

# --- 2. 软链接环境文件 ---

echo "🔗 链接环境文件..."

for f in .dev.vars .env; do
  if [ -f "$MAIN_REPO/$f" ] && [ ! -e "$WORKTREE/$f" ]; then
    ln -s "$MAIN_REPO/$f" "$WORKTREE/$f"
    echo "  ✅ $f → $MAIN_REPO/$f"
  elif [ -e "$WORKTREE/$f" ]; then
    echo "  ⏭️  $f 已存在，跳过"
  else
    echo "  ⚠️  $MAIN_REPO/$f 不存在，跳过"
  fi
done

echo ""

# --- 3. 安装依赖 ---

echo "📦 安装依赖..."
pnpm install --prefer-offline
echo ""

echo "🎉 Worktree 初始化完成！"
