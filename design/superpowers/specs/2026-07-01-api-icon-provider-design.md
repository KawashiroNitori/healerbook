# API / Icon Provider 抽象与自动回退设计

> 把分散的硬编码数据源域名收拢成两条独立 provider 链，各自支持「失败驱动自学习 + 运行时回退」（**全自动，无 UI 入口**）；**两条链均直连**（API 源已实测返回 CORS 头，无需代理）。

**日期**: 2026-07-01
**分支**: feat/api-provider
**状态**: 设计完成，待用户 review（design 阶段，**尚未进入 plan / 实现**）。

## 1. 背景与动机

当前项目把 FF14 游戏数据 API 与技能/状态图标的来源域名**硬编码分散**在多处：

- `src/api/xivapi.ts:6` — API 写死 `https://xivapi-v2.xivcdn.com/api`
- `src/api/xivapi.ts:62` `toIconPath()` — API 返回的 icon 写死 `https://v2.xivapi.com/api/asset?path=...&format=png`
- `src/utils/iconUtils.ts:10-11` — `cafemaker.wakingsands.com`（`/i/` 前缀）+ `assets.rpglogs.cn/img/ff/abilities/`（FFLogs 前缀）
- `src/utils/statusIconUtils.ts:21` — 状态 icon 写死 `cafemaker.wakingsands.com`

诉求：

1. **可用性容错** — 某源超时/失败/在某地区不可达时，自动回退到备用源。
2. **自学习首选（全自动，无 UI）** — 系统按「哪个源成功就记住它」自学习首选并持久化，**不向用户暴露任何选源入口**。

### 直连与可达性结论（已实测）

- **两条链均直连，无需任何代理**：两个 API 源均对跨域 GET 返回 `access-control-allow-origin: *`，且为无自定义头的 simple request（不触发预检）。现网 `src/api/xivapi.ts:94` 就是裸 `fetch()` 直连、无 proxy，线上 xivhealer.com 一直正常加载技能数据。
  ```
  curl -D- -o/dev/null -H 'Origin: https://xivhealer.com' \
    https://xivapi-v2.xivcdn.com/api/sheet/Action/16536   → 200, access-control-allow-origin: *
  curl ... https://v2.xivapi.com/api/sheet/Action/16536    → 200, access-control-allow-origin: *
  ```
- **真正要解决的是「地区可达性」**：`assets.rpglogs.cn`（国内 CDN）等域名暗示某些源在特定地区连不上/慢。这由**运行时回退 + 失败驱动自学习**解决，与代理无关。
- **icon 直连无碍**：`useKonvaImage.ts:25,64` 注释「移除 crossOrigin 设置，允许跨域图片但不导出 Canvas」。icon 走 `<img src>` 跨域显示本就正常；`src/` 无 canvas 导出功能（`ExportImage`/`toDataURL` 零命中）。
- **自学习机制参照 submodule**：`3rdparty/ff14-overlay-vue/src/utils/xivapi.ts` 采用**失败驱动的自学习**（非主动 ping/测速；全仓库无 `Promise.race`/`ping`/`latency` 用于选源）：顺序尝试 `[primarySite, 另一个]`（`:198`），API 成功后 `setPrimarySite`（`:271`），图片 onerror 换源且新源 onload 成功后 `setPrimarySite`（`:131`），首选持久化到 localStorage。

## 2. 核心决策

| 决策点            | 结论                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 切换粒度          | **API 链与 icon 链各自独立**，互不影响                                                                                                                                         |
| 首选机制          | **全自动失败驱动自学习 + 运行时回退**（无 UI，无显式选择）：首选恒为「learned 源」；运行时按序回退，**哪个源成功就把它写回 learned**（持久化）。用户不参与选源                 |
| 跨域方案          | **无需代理**：API 源已实测返回 `access-control-allow-origin: *`，两条链均直连                                                                                                  |
| API 源清单        | `[xivapi-v2.xivcdn.com, v2.xivapi.com]`，**直连**、互为 fallback                                                                                                               |
| API 默认 learned  | **`xivapi-v2.xivcdn.com`**（现网在用的源）                                                                                                                                     |
| Icon 源清单       | `[cafemaker.wakingsands.com, v2.xivapi.com/api/asset, assets.rpglogs.cn]`，**直连**、互为 fallback（`<img>` 跨域显示无碍，无导出需求）。含 rpglogs 国内 CDN 作为地区可达性兜底 |
| Icon 默认 learned | **`cafemaker`**                                                                                                                                                                |
| 规范 icon 标识    | **单个 `iconId: number`**，head 由 `completeIcon(iconId)` 推导（复用 submodule）                                                                                               |
| FFLogs 自带 icon  | 归一到 iconId：FFLogs `HHHHHH-FFFFFF.png` → 取尾段数字                                                                                                                         |
| 持久化            | 复用 `uiStore`（persist）：仅 `apiLearned`/`iconLearned`（自学习首选）。**无 `apiProvider`/`iconProvider` 显式选择字段**                                                       |
| 设置入口          | **无**。不向用户暴露任何选源 UI（不加 `Globe` 下拉 / RadioGroup）                                                                                                              |

### 首选解析与自学习规则

```
// 首选恒为 learned；无显式选择、无 auto 分支
preferredApi(state)  = state.apiLearned
preferredIcon(state) = state.iconLearned

// 自学习：成功的源无条件写回 learned（持久化）
onApiSuccess(id):  if id !== state.apiLearned  → setApiLearned(id)
onIconSuccess(id): if id !== state.iconLearned → setIconLearned(id)
```

- 无显式锁定概念：唯一首选来源就是 learned。
- 运行时回退（API 顺序回退 / icon onerror 换源）后，成功源固化为 learned，下次直接命中。

> 备注：`v2.xivapi.com/api/asset?path=ui/icon/000000/000405.tex&format=png`、`assets.rpglogs.cn/img/ff/abilities/003000-003253.png` 均已实测 HTTP 200、公开、无需授权。

## 3. 架构

```
src/api/providers/
├── registry.ts        # provider 表 + 默认 learned
├── normalizeIcon.ts   # normalizeIcon(input) → iconId
├── iconProvider.ts    # buildIconUrl + handleIconError + handleIconLoad
└── apiProvider.ts     # requestWithFallback（返回 {data, provider}）
```

### 3.1 归一层

规范标识 = `iconId: number`。`completeIcon(iconId)`：`3253`→`003000/003253`，`405`→`000000/000405`。

```
normalizeIcon(input): number   // 取路径最后一段连续数字；无法解析→0
  '/i/003000/003253.png' → 3253 ; 'ui/icon/003000/003253.tex' → 3253
  '003000-003253.png' → 3253 ; 3253 → 3253
```

### 3.2 Icon Provider 链（直连 + onerror 回退 + 自学习）

```ts
ICON_PROVIDERS = [
  { id: 'cafemaker', build: id => `https://cafemaker.wakingsands.com/i/${completeIcon(id)}.png` },
  {
    id: 'xivapi-asset',
    build: id => `https://v2.xivapi.com/api/asset?path=ui/icon/${completeIcon(id)}.tex&format=png`,
  },
  // rpglogs 国内 CDN：从 iconId 重建 FFLogs 路径（completeIcon '003000/003253' → '003000-003253'）
  {
    id: 'rpglogs',
    build: id =>
      `https://assets.rpglogs.cn/img/ff/abilities/${completeIcon(id).replace('/', '-')}.png`,
  },
]
DEFAULT_ICON_PROVIDER = 'cafemaker'
```

- `buildIconUrl(input, provider = iconLearned)` → URL（无效输入→`EMPTY_IMAGE`）。
- `handleIconError(img)`：换下一个未试源；全试尽→`EMPTY_IMAGE`（基于 `img.dataset.iconId` / `tried`）。
- `handleIconLoad(img)`：图片加载成功时，若当前源 ≠ iconLearned → `onIconSuccess(当前源)`。React `<img>` 用 `onError`/`onLoad`；Konva 在 `img.onload`/`img.onerror` 里调用。
- 回退成功后固化 learned。

### 3.3 API Provider 链（直连 + 顺序回退 + 自学习）

```ts
API_PROVIDERS = [
  { id:'xivcdn',  base:'https://xivapi-v2.xivcdn.com/api' },
  { id:'xivapi',  base:'https://v2.xivapi.com/api' },
]
DEFAULT_API_PROVIDER = 'xivcdn'

requestWithFallback(path, preferred = apiLearned) → { data, provider }
  ordered = [preferred, 其余...]
  for p in ordered:
    fetch(p.base + path, {signal: 6s timeout, cache:'force-cache'})
    ok → return { data: json, provider: p.id }
    !ok/超时/网络错误 → continue
  全失败 → throw
```

- `getActionById` 拿到 `{data, provider}` 后：`onApiSuccess(provider)`（升级 learned）；外层保持 `catch→null`。
- 直连即可，源返回 `access-control-allow-origin: *`，无需同源代理。

### 3.4 uiStore 持久化字段

```ts
apiLearned: ApiProviderId // 失败驱动自学习首选，默认 'xivcdn'
iconLearned: IconProviderId // 失败驱动自学习首选，默认 'cafemaker'
setApiLearned / setIconLearned
// 无显式选择字段、无 UI setter、无 resolve helper（首选恒 = learned）
```

## 4. 改动清单

**新增**：`src/api/providers/{registry,normalizeIcon,iconProvider,apiProvider}.ts` + 测试。

**改造**：

- `src/store/uiStore.ts` — 2 个字段（`apiLearned`/`iconLearned`）+ 2 个 setter（`setApiLearned`/`setIconLearned`）
- `src/api/xivapi.ts` — `getActionById` 走 `requestWithFallback` + `onApiSuccess`；`toIconPath` 返回原始路径
- `src/utils/iconUtils.ts` — `getIconUrl` 用 `buildIconUrl(input, iconLearned)`（签名不变）
- `src/utils/statusIconUtils.ts` — 用 `buildIconUrl`
- `src/utils/useKonvaImage.ts` — img 挂 `onerror=handleIconError`、`onload=handleIconLoad`，设 `dataset.iconId`
- `src/components/ActionTooltip.tsx` 等 `<img>` — `onError=handleIconError`、`onLoad=handleIconLoad`、`data-icon-id`

> **不改造** `src/components/EditorToolbar.tsx`（不加任何选源 UI）、`src/workers/`（不需要代理）。

## 5. 数据流

```
Icon:  input → normalizeIcon → iconId → buildIconUrl(iconId, iconLearned)（直连）
         → <img> onLoad(handleIconLoad: 升级 iconLearned)
              onError(handleIconError: 换源→占位图)

API:   getActionById → requestWithFallback(path, apiLearned)（直连）
         → 首选 xivcdn → 6s超时/失败 → 下一源 v2.xivapi.com
         → 成功 {data,provider} → onApiSuccess(升级 apiLearned)
         → 全失败 throw → catch→null
```

## 6. 测试计划

- `normalizeIcon`：各格式 + 异常
- `buildIconUrl`：cafemaker 直链 / xivapi-asset query 型 / rpglogs（`003000/003253`→`003000-003253.png`）
- `handleIconError`：换源顺序 + 试尽占位；`handleIconLoad`：成功源升级 learned（与当前 learned 相同则不写）
- `requestWithFallback`：首选成功返回 `{data,provider}`；回退；全失败抛错
- `uiStore`：`apiLearned`/`iconLearned` 2 字段持久化、`setApiLearned`/`setIconLearned` 生效

## 7. 非目标（YAGNI）

- **主动 ping / 测速选源**（future，用户认可是好点子但本期不做；本期仅失败驱动自学习）。
- **不引入任何 Worker / 同源代理**（API 源已实测支持跨域，代理多余）。
- 不为 icon 做代理（`<img>` 跨域无碍、无导出需求）；不恢复 canvas 导出。
- **不向用户暴露任何选源 UI**（不加工具栏下拉、不加设置面板、无显式 provider 字段）；选源全自动。

## 8. 已解决的关键问题

1. **API 是否走 proxy** → 否，实测两个源均返回 `access-control-allow-origin: *`，直连可用（现网即裸 `fetch()`）。
2. **icon 是否走 proxy** → 否（`<img>` 跨域显示不受 CORS 限制；无 canvas 导出）。
3. **submodule 是否主动 ping** → 否，是失败驱动自学习升级（证据见第 1 节）。
4. **crossOrigin 现状** → 已移除、无导出，改动不影响导出。

---

**说明**：本文档为 **design**，尚未进入 **plan** 阶段。经 review 通过后进入 writing-plans。
