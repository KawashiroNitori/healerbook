#!/usr/bin/env node
//
// pull-encounter-kv.mjs — 把生产环境某个 encounter 的 KV 数据拉取到本地开发环境
//
// 从生产 KV namespace 读取指定 encounter 的若干 key，写入本地 miniflare
// （`wrangler dev` 使用的 .wrangler/state 本地 KV），供本地开发调试。
//
// 用法：
//   node scripts/pull-encounter-kv.mjs <encounterId> [--keys=template,statistics,top100,samples]
//   pnpm kv:pull-encounter <encounterId> [--keys=...]
//
// 示例：
//   node scripts/pull-encounter-kv.mjs 1085                      # 拉取全部 4 类 key
//   node scripts/pull-encounter-kv.mjs 1085 --keys=top100        # 只拉 top100
//   node scripts/pull-encounter-kv.mjs 1085 --keys=template,statistics
//
// 前置条件：已 `wrangler login`（或配置 CLOUDFLARE_API_TOKEN），且对生产 KV 有读权限。
//

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WRANGLER_TOML = join(REPO_ROOT, "wrangler.toml");

// key 类型 → 实际 KV key 名（由 src/workers/top100Sync.ts 的 *KVKey 函数定义）
const KEY_BUILDERS = {
  template: (id) => `encounter-template:${id}`, // 伤害时间轴（模板事件）
  statistics: (id) => `statistics:encounter:${id}`, // 数值 / 统计
  top100: (id) => `top100:encounter:${id}`, // TOP100 小队方案
  samples: (id) => `statistics-samples:encounter:${id}`, // 原始统计样本
};
const ALL_KINDS = Object.keys(KEY_BUILDERS);

// --- 解析参数 ---

const args = process.argv.slice(2);
const positionals = args.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...rest] = a.replace(/^--/, "").split("=");
      return [k, rest.join("=")];
    })
);

const encounterId = positionals[0];
if (!encounterId || !/^\d+$/.test(encounterId)) {
  console.error("❌ 缺少或非法的 encounterId（应为数字）");
  console.error("用法：node scripts/pull-encounter-kv.mjs <encounterId> [--keys=template,statistics,top100,samples]");
  process.exit(1);
}

const kinds = flags.keys ? flags.keys.split(",").map((s) => s.trim()).filter(Boolean) : ALL_KINDS;
const unknown = kinds.filter((k) => !KEY_BUILDERS[k]);
if (unknown.length > 0) {
  console.error(`❌ 未知的 key 类型：${unknown.join(", ")}`);
  console.error(`   可选：${ALL_KINDS.join(", ")}`);
  process.exit(1);
}

// --- 从 wrangler.toml 解析生产 / 本地 healerbook KV namespace id ---

function parseNamespaceIds(toml) {
  // 逐个扫描 [[...kv_namespaces]] 块，取 binding="healerbook" 的 id。
  // 顶层块（无 env. 前缀）= 本地/默认；env.production 块 = 生产。
  const lines = toml.split(/\r?\n/);
  let prod = null;
  let local = null;
  let inBlock = false;
  let isProd = false;
  let binding = null;
  let id = null;

  const flush = () => {
    if (inBlock && binding === "healerbook" && id) {
      if (isProd) prod = id;
      else if (!local) local = id; // 第一个出现的非 prod 块视为默认/本地
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^\[\[(.*kv_namespaces)\]\]$/);
    if (m) {
      flush();
      inBlock = true;
      isProd = m[1].includes("env.production");
      binding = null;
      id = null;
      continue;
    }
    if (line.startsWith("[")) {
      // 进入其它（非 kv_namespaces）表，结束当前块
      flush();
      inBlock = false;
      continue;
    }
    if (!inBlock) continue;
    const bm = line.match(/^binding\s*=\s*"([^"]+)"/);
    if (bm) binding = bm[1];
    const im = line.match(/^id\s*=\s*"([^"]+)"/);
    if (im) id = im[1];
  }
  flush();
  return { prod, local };
}

const { prod: PROD_NS, local: LOCAL_NS } = parseNamespaceIds(readFileSync(WRANGLER_TOML, "utf-8"));
if (!PROD_NS || !LOCAL_NS) {
  console.error("❌ 无法从 wrangler.toml 解析 healerbook 的生产 / 本地 KV namespace id");
  console.error(`   prod=${PROD_NS} local=${LOCAL_NS}`);
  process.exit(1);
}

// --- 执行拉取 ---

function wrangler(argv, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...argv], {
    cwd: REPO_ROOT,
    encoding: capture ? "utf-8" : "utf-8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    env: { ...process.env, CI: "1" },
  });
}

const tmp = mkdtempSync(join(tmpdir(), "kv-pull-"));
console.log(`📦 encounter ${encounterId} — 生产 ns=${PROD_NS} → 本地 ns=${LOCAL_NS}`);
console.log(`   拉取 key 类型：${kinds.join(", ")}\n`);

let ok = 0;
let failed = 0;
for (const kind of kinds) {
  const key = KEY_BUILDERS[kind](encounterId);
  const file = join(tmp, `${kind}.json`);
  try {
    // 1) 从生产远端读取
    const value = wrangler(
      ["kv", "key", "get", key, "--namespace-id", PROD_NS, "--remote", "--text"],
      { capture: true }
    );
    if (!value || value.trim().length === 0) {
      console.warn(`⚠️  ${kind} (${key}) 生产无数据，跳过`);
      failed++;
      continue;
    }
    writeFileSync(file, value);
    // 2) 写入本地（不带 --remote 即写本地 miniflare state）
    wrangler(["kv", "key", "put", key, "--path", file, "--namespace-id", LOCAL_NS]);
    console.log(`✅ ${kind} (${key}) — ${Buffer.byteLength(value)} bytes`);
    ok++;
  } catch (err) {
    console.error(`❌ ${kind} (${key}) 失败：${err.message?.split("\n")[0] ?? err}`);
    failed++;
  }
}

console.log(`\n完成：成功 ${ok} / 失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
