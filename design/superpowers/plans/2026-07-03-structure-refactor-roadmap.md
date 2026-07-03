# 代码结构重构总路线图

> 本文档是**路线图**而非可执行 plan：固化分期、范围与依赖关系。
> 每一期动工前，为该期单独撰写可执行 plan（bite-sized task + TDD），
> 因为后期的设计细节依赖前期完成后的代码状态。
> 第一期的可执行 plan：`2026-07-03-refactor-phase1-quickwins.md`。

**背景**：2026-07-03 对全项目（约 4 万行）做了 5 个方向的结构分析
（Timeline 组件 / store / utils 计算引擎 / 其余组件与页面 / workers+api+collab）。
本路线图汇总其结论，按收益/风险比排期。

**总原则**：

- 每期独立可交付、可回归（`pnpm test:run` + `pnpm exec tsc --noEmit` + `pnpm lint` 全绿）。
- 行为修复与结构搬移分开提交；纯移动（目录重组）单独成期，不与逻辑改动混在同一批 diff。
- 项目内的正面样板作为参照：`editLock.ts`（纯逻辑）→ `useEditLock.ts`（喂 store）→
  `useEditorReadOnly.ts`（别名）的三层结构；`collab/syncProtocol.ts` 的纯编解码；
  `marqueeHitTest.ts` 的"纯逻辑外置 + 单测"。

---

## 第一期：立即修复 + 死代码清理（已有可执行 plan）

**范围**（详见 `2026-07-03-refactor-phase1-quickwins.md`）：

1. `/api/internal/do-lookup` 补 `requireSyncToken` 鉴权（安全）。
2. `timelineStore` 会话重置遗漏 `statistics`/`partyState`（切文档后旧副本统计残留）。
3. 框选与 PeerOverlay 的伤害卡片几何统一到 `computeDamageCardGeometry`
   （现状对带读条窗口的事件命中盒错位）。
4. 删除 workers 死代码：`timelineSchema.ts`（+测试）、`fflogs-proxy.test.ts` 假测试、
   `lang` 假参数链、wrangler 残迹。
5. 删除 `timelineStore` 死成员：`executeAction`/`updatePartyState`/`cleanupExpiredStatuses`/
   `zoomWithScrollPreservation`/`currentTime`。
6. 删除 `mitigationStore`，静态数据改模块常量 `ACTIONS` / `ACTIONS_BY_ID`。
7. CLAUDE.md「Workers 路由结构」与关键文件表同步到 Hono 现状；workers README 重写。

**验收**：全部测试/类型/ lint 绿；删除约 700+ 行；无行为变化（除 1-3 三处明确修复）。

## 第二期：前后端契约收敛 + workers 边界整形

**范围**：

- 新建 `src/types/apiContracts.ts`：各端点请求/响应类型唯一来源；
  消灭四对手写副本（`routes/my.ts` vs `timelineShareApi.ts` 的列表项、
  GET /:id 响应的三份手抄含 `RawSharedResponse`、Top100、encounter template）。
  顺带停止返回 D1 化石字段 `version`。
- `Top100Section.tsx:34-66` 的裸 fetch + 内联类型 → 抽 `src/api/top100.ts` 走 `apiClient`。
- 前端错误样板：`timelineShareApi.ts` 中 `HTTPError → new Error` 逐字重复 8 次 →
  抽 `unwrapApiError<T>()`；Worker 侧 `routes/fflogs.ts` 手写 try/catch 统一交给
  `index.ts` 的全局 `app.onError`。
- `requireAuth` / `tryReadAuth` 重复的 token 解析 → 抽 `readAuthFromHeader(c)`。
- editor 权限 SQL 三处散写（`routes/timelines.ts:118` / `routes/share.ts:88` /
  `durable/TimelineDoc.ts:172`）→ 抽 `src/workers/db/editors.ts` 数据访问层。
- `docStub` 从 `routes/timelines.ts` 移到 `durable/stub.ts`，消除路由间横向 import。
- `top100Sync.ts`（558 行杂物间）拆为 `kvKeys.ts` / `encounterStats.ts` /
  `encounterTemplate.ts` / 纯编排；`handleGetEncounterTemplate` 的 Response 组装
  收进 `routes/encounterTemplates.ts`。
- workers 双份测试基建归并：`timelines.test.ts`（手写 D1 mock）与
  `routes/timelines.workers.test.ts`（workers pool）以后者为准。

**依赖**：第一期完成（死代码先删干净）。

## 第三期：前端机械抽取（重复样板消除）

**范围**（全部是"抽函数/hook + 全局替换"型，低风险高收益）：

- **selector 化**（本期收益最大单项）：8 处无 selector 的整对象订阅
  （`Timeline/index.tsx:219`、`PropertyPanel.tsx:49`、`EditorToolbar.tsx:104`、
  `TimelineMinimap.tsx:54`、`AuthProvider.tsx:12` 等）改逐字段 selector / `useShallow`。
- `getMultiplierForDamageType(performance, damageType)`：替换散落 7+ 处的三元链。
- `timelineToLocalInit(timeline)`：替换 3 处 14 字段透传（`EditorPage.tsx:231` 等）。
- `api/fflogsImport.ts` 的 `fetchFFLogsImport()` + `useFFLogsUrlInput` hook：
  合并两个导入 Dialog 的重复请求/剪贴板逻辑。
- `useCopyToClipboard()`：替换 3 处"复制成功 2 秒回弹"。
- 协议常量化：`STATUS_ABILITY_OFFSET = 1_000_000`（5 处裸数字）、
  `__cd__:` 前缀 helper（`isSynthCdResource`/`synthCdActionId`，14 处）、
  危险阈值 `DANGER_HP_PCT` 单源（`lethalDanger.ts` ↔ `autoMitigation/optimizer.ts`）。
- 时间格式化基元 `splitDeciseconds()`：统一 `formatters.ts` / `soumaExporter.ts` /
  `TimeRuler.tsx` 三份实现。
- ID 生成器合并（`utils/id.ts` / `utils/shortId.ts` / `executors/utils.ts` 同名不同实现）。
- `utils/castWindow.ts` 改名 `tableCellHitTest.ts`（与 `castWindowImport.ts` 概念撞名）。
- `utils/useKonvaImage.ts` 搬到 `src/hooks/`。
- `groupActionsByTrack()` + `buildTrackIndexMap()`：替换 4 处分组循环与 6 处归轨 findIndex。
- `PlayerMap` 类型上移 `types/fflogs.ts`（7 处逐字重复）。
- `ImportFFLogsDialog.tsx:157-293` 的 dev-only 客户端导入编排（135 行）下沉
  `devClientImport.ts`（保持 dynamic import 维持 DCE）。

**依赖**：无硬依赖，可与第二期并行；但应先于第五、六期（为拆分扫清地基）。

## 第四期：计算引擎拆分（utils 核心）

**范围**：

- 类型上移：`CalculationResult` / `HpSimulationSnapshot` / `SimulateInput` 等 →
  `src/types/calculation.ts`；`utils/placement/types.ts` 的纯类型 → `src/types/placement.ts`
  （消除 `types/mitigation.ts:131` 的 types→utils 反向依赖）。
- `MitigationCalculator` 假 class 改自由函数（无实例状态）。
- `simulate()`（530 行）拆 `src/utils/simulation/`：先抽最独立的
  `statusIntervalRecorder` → 再 `hpPipeline` → 最后 `timeAdvancer`，
  在 2926 行既有测试保护下逐步进行。
- status 时间窗口径统一：`isStatusActiveAt(status, t, boundary)` 显式命名
  闭区间/半开两种语义（现状 `mitigationCalculator` 与 `executors/healMath` 不一致）。
- `computeReferenceMaxHP` 与 `computeMaxHpMultiplier` 合并（谓词参数化）。
- `fflogsImporter.ts`：`parseDamageEvents` 300 行拆四步 + 9 位置参数改 `ImportContext`
  对象 + 6 个并行 Map 改中间类型 `ImportDetail` + 后处理显式 pipeline 数组。
- executor 工厂收敛到 `statusHelpers.addStatus`（互斥语义参数化）；
  `healMath` 改注入 `getMeta` 断开 statusRegistry 静态环。
- 资源模型：`resource/cdBar.ts` 与 `resource/legalIntervals.ts` 各自重演顺序回充时钟 →
  在 `compute.ts` 抽 amount 分段函数（transitions）供两者共用（该语义 CLAUDE.md
  明确标注易写错，必须单源）。
- `types/index.ts` barrel 半废弃 → 删除，统一 deep import（与现状一致）。

**依赖**：第三期的常量/类型抽取完成。

## 第五期：timelineStore 拆分

**范围**：

- 按领域拆 slice：presence（peers/connectionStatus）、viewport（zoom/scroll）、
  selection 独立；`engine + yDocProjection + 内容 mutation + undo` 保留为 docStore。
- 删除派生字段双份真相：`selectedEventId`/`selectedCastEventId`（由多选数组派生）；
  `timeline = yDocProjection ?? snapshot` 改在写入口内联计算，消灭 `recomputeTimeline()`。
- store 内业务逻辑下沉纯函数：`bulkMoveSelection` 的 clamp 联动、`bulkImport` 合并排序、
  `scheduleMetaWrite` 组装。
- 跨 store 写收敛：store 内 `toast.error` 移出、`useUIStore.setState` 裸写改具名 action、
  token provider 注入替代 `useAuthStore.getState()`。
- 删除 `AuthContext`/`AuthProvider`/`useAuth` 三层包装，消费方直接 `useAuthStore(selector)`。
- `filterStore`：selector 里调 getter 的隐式引用稳定契约 → 改 `resolvePreset()` 纯函数派生。
- `useEncounterStatistics` 双系统搬运（react-query ↔ store）单一宿主化。
- `tooltipStore` 的 timer id 移出响应式 state。
- 权限表达收敛：`shareRole` 四字段对象收进 store（消除 `EditorPage` 三处手动同步
  与 `EditorToolbar` 的 interface 重复）；`editLock` 补 UI 可见性派生
  （`canImport`/`isViewer` 等），替换组件里散落的 `sessionRole`/`isReplayMode` 组合判断。

**依赖**：第三期 selector 化完成（拆分时订阅面已收窄，行为回归好判断）。

## 第六期：Timeline 组件 controller 化拆分

**核心思路**（详见 2026-07-03 会话讨论）：把隐式闭包上下文改造成
**引用稳定、可命令式读取的对象**；事件处理器从"定义时捕获"改成"触发时读取"。
状态按读取时机分三类：高频瞬态 → controller（纯 TS + subscribe）；
渲染状态 → per-instance vanilla zustand store（handler 用 `getState()`）；
派生布局 → 纯函数。`index.tsx` 退化为约 200 行组合根。

**范围与顺序**：

1. `scrollController`（纯 TS，可单测）：合并三份滚动事实来源
   （`scrollLeft` state / `clampedScrollRef` / `visualScrollTopRef`），
   现有 `handleDirectScroll` 的 Konva 同步原样变成第一个订阅者；
   `panZoomRefs` 12 个 ref 捆绑包消失。**风险最高，需手工回归拖动/缩放/框选/协作 ghost。**
2. per-instance UI store：选中/hover/contextMenu/pendingPaste 等渲染状态迁入，
   `buildMarqueeObjectsRef` 渲染期写 ref 的 hack 正规化为 `getState()`。
3. 纯函数外提（低风险，可先做）：泳道分配、`formatDamageEventText`（115 行）、
   空转区间计算、几何盒模型全量收进 `cardGeometry.ts`/`timelineGeometry.ts`
   （含 `DamageEventTrack` 的 CARD_HEIGHT=28 口径修正）。
4. hooks 拆分：`useGroupDrag` / `useMarqueeSelection` / `useAnnotationInteraction` /
   `useTimelineHotkeys` / `useTimelineClipboardActions` / `useEdgeAutoScroll`，
   签名统一为 `useXxx(ctx, layout)`（ctx 只装稳定引用）。
5. 组件层：`PeerOverlayFixed`/`PeerOverlayMain` 镜像重复合并（`PeerGhostRect`）；
   `SkillTracksCanvas`/`DamageEventTrack` 收敛 props 后加 `memo`，
   装饰节点补 `listening={false}`；注释回调 7 件套收敛为 `annotationHandlers` 对象。
6. 删除 `displayActionOverrides` 空占位管道（贯穿三层恒为空 Map）。
7. `PropertyPanel`（897 行）拆分 + 与 `PlayerDamageDetails` 的减伤展示合并共享组件
   （`StatusIconList` / `MitigationBreakdownBar`，分桶计算抽纯函数）；
   `EditorToolbar` 的 `ToolbarMenuButton` 抽取；`EditorPage` 的 `useOpenTimeline` hook。

**依赖**：第三期（几何/常量 helper 就绪）+ 第五期（viewport slice 就绪，
scrollController 与 store 的边界清晰）。

## 第七期：收尾（纯移动 + 杂项）

- `src/utils/` 50 文件按域建子目录：`fflogs/` / `simulation/` / `serialization/` / `view/`
  （纯移动，单独 PR）。
- `TimelineDoc` 内部分层（传输/会话 vs 存储/flush）。
- Dialog 关闭重置策略统一（条件渲染卸载）；`Callout` / `ActionIconToggle` 共享 UI 组件。
- `TimelineTable`：`useDragToPan` / `useSyncScrollProgress` 抽取；
  `handleCellToggle` 内嵌的 cast 放置/移除规则下沉 placement engine 或 store action。
- `ActionTooltip` 的 setInterval + window 全局变量 hack 改 floating-ui / Radix。
- `TimelineMinimap` 主题色旁路与 pattern 重建修正。

**依赖**：前六期完成（目录重组最后做，避免搬移与逻辑改动互相污染 diff）。

---

## 里程碑与验证

| 期  | 规模估计           | 关键回归手段                                                         |
| --- | ------------------ | -------------------------------------------------------------------- |
| 1   | 小（1-2 个工作日） | 全量测试 + 手工验证框选/切文档                                       |
| 2   | 中                 | workers pool 测试 + 前端类型编译期约束                               |
| 3   | 中                 | 全量测试（机械替换，tsc 兜底）                                       |
| 4   | 大                 | 2926 行 calculator 测试 + 2477 行 importer 测试全绿等价              |
| 5   | 大                 | 1140 行 store 测试迁移 + 协作场景手工回归                            |
| 6   | 最大               | 分步手工回归（拖动/缩放/框选/注释/协作 ghost）+ 新增 controller 单测 |
| 7   | 小                 | tsc + 全量测试（纯移动）                                             |
