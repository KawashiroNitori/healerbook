/**
 * 执行器工具函数
 */

import { customAlphabet } from 'nanoid'
import { ALPHANUMERIC_ALPHABET } from '@/utils/nanoidAlphabet'

/** MitigationStatus.instanceId 生成器：纯运行时 diff key，不持久化，字符集与项目其余 id 统一 */
export const generateInstanceId = customAlphabet(ALPHANUMERIC_ALPHABET, 21)
