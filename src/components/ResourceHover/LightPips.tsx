/** 资源档位指示灯：发光的蓝色菱形宝石（FF14 仪表盘风格），亮 `lit` 个。
 *  暗色描边 + 外发光，保证在白底/深底都清晰可辨。 */
export default function LightPips({ total, lit }: { total: number; lit: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={
            i < lit
              ? 'h-3 w-3 rotate-45 rounded-[2px] border border-blue-900/70 bg-gradient-to-br from-sky-300 to-blue-600 shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_6px_1px_rgba(56,189,248,0.7)]'
              : 'h-3 w-3 rotate-45 rounded-[2px] border border-slate-500/70 bg-slate-300/50 shadow-[0_0_0_1px_rgba(0,0,0,0.15)]'
          }
        />
      ))}
    </div>
  )
}
