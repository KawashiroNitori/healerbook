import * as Y from 'yjs'
import { generateId } from '@/utils/id'
import { buildYDoc } from './docSchema'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import type { TimelineContent, LocalDocMeta } from './types'

/**
 * 新建一条本地(未发布)时间轴。
 * 生成 id → buildYDoc → 写 IndexedDB snapshot + meta 行 → 返回 id。
 */
export async function createLocalTimeline(content: TimelineContent): Promise<string> {
  const docId = generateId()
  const doc = buildYDoc(content)

  const store = new IndexedDBDocStore()
  await store.open()
  await store.appendUpdate(docId, Y.encodeStateAsUpdate(doc))

  const now = Math.floor(Date.now() / 1000)
  const meta: LocalDocMeta = {
    docId,
    name: content.name,
    encounterId: content.encounter?.id ?? 0,
    createdAt: content.createdAt ?? now,
    updatedAt: now,
    composition: content.composition ?? null,
    published: false,
  }
  if (content.fflogsSource) meta.fflogsSource = content.fflogsSource
  await store.putMeta(meta)

  return docId
}
