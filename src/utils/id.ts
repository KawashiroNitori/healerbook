import { customAlphabet } from 'nanoid'

/**
 * 生成纯字母数字 ID（21 位），用于时间轴 ID 等需要 URL 安全的场景
 */
export const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)
