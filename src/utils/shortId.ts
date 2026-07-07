import { customAlphabet } from 'nanoid'
import { ALPHANUMERIC_ALPHABET } from '@/utils/nanoidAlphabet'

/**
 * Timeline 内部对象（DamageEvent / CastEvent / Annotation）的运行时 id。
 *
 * 10 位纯字母数字 nanoid。这些 id 不进入 V2 持久化格式，反序列化时重新生成；
 * 在协作 Y.Doc 里它们作为 Y.Map 的 key 共享，故必须全局唯一——随机 nanoid
 * 保证多客户端并发新增不撞键（旧的自增计数器 / `Date.now()` 方案会撞）。
 */
export const generateObjectId = customAlphabet(ALPHANUMERIC_ALPHABET, 10)
