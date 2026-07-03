import { tintStyle } from './resourceTint'

/** 金属框渐变：元素本身被 rotate-45，局部坐标的 to bottom right 视觉上即"上亮下暗"的受光斜面。
 *  亮态用香槟银（被宝石辉光洗亮的金属），暗态用暗青铜。 */
const FRAME_LIT = 'linear-gradient(to bottom right, #fffcf0 0%, #ddd4b8 45%, #93835c 100%)'
const FRAME_DIM = 'linear-gradient(to bottom right, #b2a37c 0%, #7b6c4a 45%, #3e3422 100%)'
/** 框外圈的深色描边（box-shadow 第一段），高不透明度保证旋转抗锯齿后轮廓依旧锐利。 */
const FRAME_OUTLINE = '0 0 0 1px rgba(10,7,4,0.9)'

/** 资源档位指示灯：金属包边的菱形宝石（FF14 仪表盘风格），亮 `lit` 个。
 *  双层结构——外层中性色金属斜面框，内层宝石；亮态宝石色调由 tint 主色驱动
 *  （渐变 / 发光经 color-mix 派生），暗态宝石恒为深色玻璃。 */
export default function LightPips({
  total,
  lit,
  tint,
}: {
  total: number
  lit: number
  tint?: string
}) {
  return (
    <div className="flex items-center gap-1.5" style={tintStyle(tint)}>
      {Array.from({ length: total }, (_, i) => {
        const isLit = i < lit
        return (
          <span
            key={i}
            className="h-3 w-3 rotate-45 p-[1.5px]"
            style={{
              background: isLit ? FRAME_LIT : FRAME_DIM,
              // 辉光完全由内层宝石发出（见下），外框自身不发光。
              boxShadow: FRAME_OUTLINE,
            }}
          >
            <span
              className="block h-full w-full"
              style={
                isLit
                  ? {
                      background:
                        'linear-gradient(to bottom right, var(--rt-pip-from), var(--rt-pip-to))',
                      // 外圈辉光：子元素 box-shadow 绘制在父元素背景之上，从宝石内芯
                      // 漫过金属框（还原游戏里"内芯发光把框染色"的效果）并溢出少许。
                      // spread 只给 0.5px：spread 是实心扩展，给大了会把金属框整个盖住；
                      // 靠 blur 渐隐让框透出自己的金属色。
                      // 内圈只留左上（视觉上方两条棱）白色镜面高光——不再画深色分隔线，
                      // 12px 小菱形上三层 1px 边会显得框过厚。
                      boxShadow:
                        '0 0 3.5px 0.5px var(--rt-pip-glow), inset 1.5px 1.5px 2px rgba(255,255,255,0.55)',
                    }
                  : {
                      background: 'linear-gradient(to bottom right, #39414b 0%, #14181d 100%)',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)',
                    }
              }
            />
          </span>
        )
      })}
    </div>
  )
}
