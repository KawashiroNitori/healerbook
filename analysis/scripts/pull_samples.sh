#!/usr/bin/env bash
#
# 从 Cloudflare KV 拉取 statistics-samples 数据到 analysis/data/
#
# 用法：
#   ./pull_samples.sh                   # 拉所有已存在的 encounter 样本
#   ./pull_samples.sh 93 97             # 只拉指定的 encounter id
#   ./pull_samples.sh --local 93        # 拉开发环境 KV（默认生产）
#
# 依赖：wrangler（项目根目录已安装）、jq

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANALYSIS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$ANALYSIS_DIR/.." && pwd)"
DATA_DIR="$ANALYSIS_DIR/data"

PROD_KV_ID="4d48c91437374775b166165a05d56839"
DEV_KV_ID="b2d47d0e3be342248906a82ea3a540d5"

REMOTE_FLAG="--remote"
KV_ID="$PROD_KV_ID"
ENV_LABEL="prod"

# 解析参数
encounters=()
for arg in "$@"; do
  case "$arg" in
    --local)
      REMOTE_FLAG=""
      KV_ID="$DEV_KV_ID"
      ENV_LABEL="local"
      ;;
    --help|-h)
      sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      encounters+=("$arg")
      ;;
  esac
done

mkdir -p "$DATA_DIR"
cd "$PROJECT_ROOT"  # wrangler 需要在项目根目录执行

# 若未指定 encounter，自动列出所有已存在的样本键
if [ ${#encounters[@]} -eq 0 ]; then
  echo "[pull] 未指定 encounter，列出 $ENV_LABEL KV 中所有样本键..."
  # shellcheck disable=SC2086
  keys_json=$(pnpm exec wrangler kv key list $REMOTE_FLAG \
    --namespace-id="$KV_ID" \
    --prefix="statistics-samples:encounter:" 2>/dev/null)
  mapfile -t keys < <(echo "$keys_json" | jq -r '.[].name')
  for key in "${keys[@]}"; do
    encounters+=("${key##*:}")
  done
  echo "[pull] 发现 ${#encounters[@]} 个 encounter"
fi

if [ ${#encounters[@]} -eq 0 ]; then
  echo "[pull] KV 中没有样本数据，退出" >&2
  exit 1
fi

# 逐个拉取
for id in "${encounters[@]}"; do
  out="$DATA_DIR/samples-$id.json"
  echo "[pull] $ENV_LABEL/encounter:$id -> $(basename "$out")"
  # shellcheck disable=SC2086
  pnpm exec wrangler kv key get $REMOTE_FLAG \
    --namespace-id="$KV_ID" \
    "statistics-samples:encounter:$id" \
    > "$out"
done

echo "[pull] 完成，输出目录: $DATA_DIR"
ls -lh "$DATA_DIR"/*.json 2>/dev/null || true
