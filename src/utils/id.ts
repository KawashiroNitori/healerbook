import { customAlphabet } from 'nanoid'
import { ALPHANUMERIC_ALPHABET } from '@/utils/nanoidAlphabet'

/**
 * 生成纯字母数字 ID（21 位），用于时间轴 ID 等需要 URL 安全的场景
 */
export const generateId = customAlphabet(ALPHANUMERIC_ALPHABET, 21)
