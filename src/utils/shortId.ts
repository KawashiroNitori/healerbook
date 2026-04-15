/**
 * 模块级单调 id 生成器，用于 Timeline 内部对象（DamageEvent / CastEvent / Annotation）
 * 的运行时 id。这些 id 不进入持久化格式，每次反序列化时重新生成。
 */
let counter = 0

export function nextShortId(): string {
  return `e${counter++}`
}

export function resetIdCounter(): void {
  counter = 0
}
