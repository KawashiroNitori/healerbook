# Peer 光标 / 拖动补间平滑设计

> 分支：`feat/smooth-cursor`
> 日期：2026-05-26

## 背景与问题

实时协作编辑器中，其他协作者（peer）的光标竖线（`cursorTime`）和拖动 ghost
（`dragging.time`）位置由 awareness 协议以 ~50ms 节流推送。当前渲染链路是「store
里 `peers` 变化 → React 重渲染 → 按时间标量 × `zoomLevel` 直接画」，到达即跳变，
没有任何插值，因此高频移动（尤其光标）观感卡顿、一跳一跳。

目标：为 peer 的移动元素加入逐帧补间，让显示位置平滑逼近最新目标值，降低卡顿感。

## 范围

补间作用于两个**时间标量**：

- `peer.cursorTime`（悬停光标竖线）
- `peer.dragging.time`（拖动 ghost，覆盖 `damage` / `annotation` / `cast` 三种 kind，
  它们都用同一个 `dragging.time` 定位）

**不在范围内**：

- `peer.selection`（选中高亮）——本质是离散跳转，不做补间。
- peer 出现/消失的淡入淡出动画。
- 本地用户自身光标（本地无延迟，无需平滑）。

## 现状关键事实

- Awareness 数据结构见 `src/collab/awarenessTypes.ts`（`AwarenessState` / `PeerState`）。
- store 投影：`src/store/timelineStore.ts` 的 `reprojectPeers` 把 awareness 状态投影成
  `peers: PeerState[]`。
- 渲染：`src/components/Timeline/PeerOverlay.tsx` 的 `PeerOverlayFixed` 与
  `PeerOverlayMain`，二者目前**各自独立** `useTimelineStore(s => s.peers)`。
  - 光标线：`Line points={[cx,0,cx,H]}`，`cx = peer.cursorTime * zoomLevel`。
  - 拖动 ghost：`ghostX = peer.dragging.time * zoomLevel`。
- 上行节流 ~50ms（`src/components/Timeline/index.tsx`）。
- 当前**无任何**补间 / `requestAnimationFrame` / tween / 缓动库引用。

## 架构与数据流

新增 hook `useSmoothedPeers(zoomLevel)`，内部订阅 `store.peers`、驱动 rAF 循环逐帧逼近，
返回平滑后的 `PeerState[]`。`PeerOverlayFixed` 与 `PeerOverlayMain` **各自内部调用**该 hook。

```
store.peers (到达即跳变)
   → useSmoothedPeers(): rAF 循环，逐帧逼近目标
   → smoothed peers (cursorTime / dragging.time 已平滑，其余字段透传)
   → 各 overlay 直接渲染
```

平滑后的数组形状与 `PeerState[]` 完全一致，只是 `cursorTime` 和 `dragging.time` 被替换
为平滑值；`clientId` / `user` / `selection` / `dragging` 的 `id` / `kind` / `playerId`
原样透传。

> **架构决定（与初版方案的偏差）**：初版设计是「在 `Timeline/index.tsx` 调用一次 hook、
> 把结果作 prop 下发」，意在只有单个 rAF 循环。但这会把每帧的 `setState` 放在
> `TimelineCanvas` 上，导致动画期间整棵子树（含未 `memo` 的 `SkillTracksCanvas` /
> `DamageEventTrack`）每帧重渲——这恰好违背代码库既定约定（本地十字光标用命令式
> 操作 Konva 节点来避免高频重渲）。因此改为**两个 overlay 各自调用 hook**：每帧
> `setState` 只重渲各自 overlay 及其 Konva 子树，不波及主画布。
>
> 代价是**两个独立 rAF 循环**（计算冗余、两份平滑态）。但同一帧内注册的多个 rAF
> 回调由浏览器以相同时间戳一并触发，两循环的 `dtMs` 与输入完全一致，平滑结果逐帧
> 等价、同时收敛同时停止，因此视觉上无不一致。以「重渲收敛到 overlay」换「单循环」
> 是更优权衡。

## 平滑算法（帧率无关指数逼近）

对每个 peer 的 `cursorTime` 与 `dragging.time` 各维护一个「当前显示值」。每帧推进：

```
factor = 1 - exp(-dt / TAU)        // dt 为本帧与上帧的时间差（来自 rAF 时间戳，秒或毫秒统一）
cur = cur + (target - cur) * factor
```

- 使用 `exp(-dt / TAU)` 而非固定系数，保证 30 / 60 / 120 Hz 下收敛手感一致（帧率无关）。
- `TAU`（时间常数）初定约 **80ms**，可调；越小越「跟手」、越大越「顺滑」。
- 仅平滑时间标量；其余字段原样透传。

## 边界处理

| 场景                                             | 行为                                                          |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `cursorTime`：`null → 有值`                      | **直接吸附**到目标，不从旧值插值（避免「从 0 飞入」）         |
| `cursorTime`：`有值 → null`                      | 直接丢弃该 peer 光标显示态，不补间淡出                        |
| `dragging`：`null → 有值`                        | **直接吸附**到起始位置                                        |
| `dragging.id` 变化（换了拖动对象）               | **直接吸附**到新对象起始位置                                  |
| 超大跳变（像素距离 > 阈值，如换屏 / 远距离滚动） | **直接吸附**，避免长时间「滑行」                              |
| 显示值与目标差 < epsilon                         | 吸附到目标并标记 `settled`                                    |
| 全部 peer `settled`                              | **停止 rAF 循环**，进入 idle 不再触发重渲染；新数据到达再唤醒 |

注：超大跳变阈值以**像素**为单位判断（`|Δtime| * zoomLevel > THRESHOLD`），因为卡顿/滑行
是视觉像素现象；epsilon 同理建议折算到像素或取足够小的时间值。

## 模块拆分与可测试性

- **`src/utils/peerCursorSmoothing.ts`**（纯逻辑，不依赖 React / rAF）：
  - `stepValue(cur, target, dt, tau)`：单标量一帧推进。
  - 吸附判定（null↔值、dragging.id 切换、超大跳变）与收敛 `settled` 判定。
  - 「上一帧平滑态 + 当前 store peers + dt → 新平滑态 + 是否仍在动」的纯推进函数。
  - 平滑态的数据结构：按 `clientId` 索引，记录每个标量的当前显示值与上次目标（用于
    检测 dragging.id 切换 / null 转换）。
- **`src/components/Timeline/useSmoothedPeers.ts`**（薄 hook 包装）：
  - 订阅 `store.peers`。
  - 用 layout effect 同步最新 `peers` / `zoomLevel` 到 ref，供 rAF 循环读取（规避
    渲染期写 ref 的 lint 规则 `react-hooks/refs`）。
  - 驱动 `requestAnimationFrame`：仅在「仍在动」时持续调度，settled 后停止；effect
    内用闭包标志 `cancelled` 断开旧实例的 tick 递归链，消除竞态。
  - 调用纯逻辑推进，用 `useState` 触发重渲染。
  - 组件卸载 / peers 清空时 `cancelAnimationFrame` 并清理。
  - 返回 `PeerState[]`（平滑后）。由各 overlay 内部调用（见上「架构决定」）。

## 测试（TDD）

针对 `peerCursorSmoothing.ts` 纯函数写 Vitest（同目录 `*.test.ts`）：

- `stepValue` 单调收敛：多帧推进后逐步逼近且不超调。
- 帧率无关性：相同总时长下，不同 `dt` 切分累积逼近结果近似一致。
- `null → 值` 吸附：首帧即等于目标。
- `值 → null`：显示态清除。
- `dragging.id` 切换：吸附到新目标而非从旧位置滑入。
- 超大跳变：超过像素阈值时吸附。
- 收敛 `settled`：差值小于 epsilon 时判定 settled 并吸附；全部 settled 时报告「不再动」。

hook 本身依赖 rAF，不强求单测；其正确性由纯逻辑测试 + 手动验证覆盖。

## 验收

- peer 光标竖线与拖动 ghost 在 ~50ms 推送间隔内平滑移动，无明显跳变。
- 无新出现的怪象：不从 0 飞入、不残留消失的光标、换拖动对象不滑入。
- 空闲（所有 peer 静止）时无持续重渲染（rAF 停止）。
- `pnpm test:run`、`pnpm lint`、`pnpm exec tsc --noEmit` 通过。
