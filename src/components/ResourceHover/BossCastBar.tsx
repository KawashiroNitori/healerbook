/** Boss 读条（FF14 样式）：金色外发光的直角进度条，白色填充在深色轨道上推进；
 *  事件名称右对齐叠在条上，文本上边缘与条上边缘对齐、向下悬垂出条外。
 *
 *  尺寸随悬浮窗宽度等比缩放（容器查询）：条长充满面板；
 *  字号 = 条长 / 14（14 个汉字占满全长）；条高 = 字号 / 2。 */
const FONT_SIZE = 'calc(100cqw / 14)'
const BAR_HEIGHT = 'calc(100cqw / 28)'

export default function BossCastBar({ name, fraction }: { name: string; fraction: number }) {
  const pct = Math.min(Math.max(fraction, 0), 1) * 100
  return (
    // 容器查询包装层：inline-size 包含使其宽度不反向影响 w-fit 面板的布局宽
    <div className="w-full [container-type:inline-size]">
      {/* min-h 容住比条高、向下悬垂的名称文本 */}
      <div className="relative" style={{ minHeight: FONT_SIZE }}>
        <div
          className="w-full border border-[#d8b45a]/80 bg-[#1c1410] p-px"
          style={{
            height: BAR_HEIGHT,
            boxShadow: '0 0 7px 1.5px rgba(252,211,77,0.55), inset 0 1px 2px rgba(0,0,0,0.8)',
          }}
        >
          <div
            className="h-full bg-gradient-to-b from-white to-[#cfc5a5]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className="absolute right-0 top-0 whitespace-nowrap font-medium leading-none text-white"
          style={{
            fontSize: FONT_SIZE,
            // 深棕描边（八向 1px）还原游戏内技能名的外描边字效
            textShadow:
              '-1px -1px 0 #4a2e12, 0 -1px 0 #4a2e12, 1px -1px 0 #4a2e12, 1px 0 0 #4a2e12, 1px 1px 0 #4a2e12, 0 1px 0 #4a2e12, -1px 1px 0 #4a2e12, -1px 0 0 #4a2e12',
          }}
        >
          {name}
        </span>
      </div>
    </div>
  )
}
