/**
 * 执行器工具函数
 */

import { nanoid } from 'nanoid'

/**
 * 生成唯一 ID
 * @returns 唯一 ID 字符串
 */
export function generateId(): string {
  return nanoid()
}
