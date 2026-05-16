import * as Y from 'yjs'
import {
  IDB_NAME,
  IDB_VERSION,
  IDB_STORE_SNAPSHOTS,
  IDB_STORE_UPDATES,
  IDB_STORE_META,
  CLIENT_SQUASH_THRESHOLD,
} from '../constants'
import type { LocalDocMeta } from '../types'

interface SnapshotRow {
  docId: string
  bin: Uint8Array
  updatedAt: number
}
interface UpdateRow {
  docId: string
  seq: number
  bin: Uint8Array
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 本地 snapshot + updates 双表(设计文档 §5.3) */
export class IndexedDBDocStore {
  private db: IDBDatabase | null = null

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE_SNAPSHOTS)) {
          db.createObjectStore(IDB_STORE_SNAPSHOTS, { keyPath: 'docId' })
        }
        if (!db.objectStoreNames.contains(IDB_STORE_UPDATES)) {
          const us = db.createObjectStore(IDB_STORE_UPDATES, {
            keyPath: ['docId', 'seq'],
          })
          us.createIndex('docId', 'docId', { unique: false })
        }
        if (!db.objectStoreNames.contains(IDB_STORE_META)) {
          db.createObjectStore(IDB_STORE_META, { keyPath: 'docId' })
        }
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
  }

  private tx(stores: string[], mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) throw new Error('IndexedDBDocStore not opened')
    return this.db.transaction(stores, mode)
  }

  /** append 一条 update;若 updates 累积超阈值则惰性 squash */
  async appendUpdate(docId: string, bin: Uint8Array): Promise<void> {
    const tx = this.tx([IDB_STORE_UPDATES], 'readwrite')
    const us = tx.objectStore(IDB_STORE_UPDATES)
    const existing = (await reqToPromise(us.index('docId').getAll(docId))) as UpdateRow[]
    const seq = existing.length === 0 ? 0 : Math.max(...existing.map(r => r.seq)) + 1
    await reqToPromise(us.put({ docId, seq, bin } as UpdateRow))
    if (existing.length + 1 > CLIENT_SQUASH_THRESHOLD) {
      await this.squash(docId)
    }
  }

  /** 读 doc:snapshot + 所有 updates 合并 */
  async loadDoc(docId: string): Promise<Uint8Array | null> {
    const tx = this.tx([IDB_STORE_SNAPSHOTS, IDB_STORE_UPDATES], 'readonly')
    const snap = (await reqToPromise(tx.objectStore(IDB_STORE_SNAPSHOTS).get(docId))) as
      | SnapshotRow
      | undefined
    const updates = (await reqToPromise(
      tx.objectStore(IDB_STORE_UPDATES).index('docId').getAll(docId)
    )) as UpdateRow[]
    if (!snap && updates.length === 0) return null
    const parts: Uint8Array[] = []
    if (snap) parts.push(snap.bin)
    updates.sort((a, b) => a.seq - b.seq).forEach(u => parts.push(u.bin))
    return Y.mergeUpdates(parts)
  }

  /** squash:把 snapshot + 所有 updates 合并成新 snapshot,并清空 updates 表。 */
  async squash(docId: string): Promise<void> {
    const merged = await this.loadDoc(docId)
    if (!merged) return
    const tx = this.tx([IDB_STORE_SNAPSHOTS, IDB_STORE_UPDATES], 'readwrite')
    await reqToPromise(
      tx.objectStore(IDB_STORE_SNAPSHOTS).put({
        docId,
        bin: merged,
        updatedAt: Date.now(),
      } as SnapshotRow)
    )
    const us = tx.objectStore(IDB_STORE_UPDATES)
    const keys = (await reqToPromise(us.index('docId').getAllKeys(docId))) as IDBValidKey[]
    for (const key of keys) await reqToPromise(us.delete(key))
  }

  /** 写入(或覆盖)一条 meta */
  async putMeta(meta: LocalDocMeta): Promise<void> {
    const tx = this.tx([IDB_STORE_META], 'readwrite')
    await reqToPromise(tx.objectStore(IDB_STORE_META).put(meta))
  }

  /** 读一条 meta;不存在返回 null */
  async getMeta(docId: string): Promise<LocalDocMeta | null> {
    const tx = this.tx([IDB_STORE_META], 'readonly')
    const row = (await reqToPromise(tx.objectStore(IDB_STORE_META).get(docId))) as
      | LocalDocMeta
      | undefined
    return row ?? null
  }

  /** 读全部 meta */
  async getAllMeta(): Promise<LocalDocMeta[]> {
    const tx = this.tx([IDB_STORE_META], 'readonly')
    return (await reqToPromise(tx.objectStore(IDB_STORE_META).getAll())) as LocalDocMeta[]
  }

  /** 删除一条时间轴的 snapshot + updates + meta */
  async deleteDoc(docId: string): Promise<void> {
    const tx = this.tx([IDB_STORE_SNAPSHOTS, IDB_STORE_UPDATES, IDB_STORE_META], 'readwrite')
    await reqToPromise(tx.objectStore(IDB_STORE_SNAPSHOTS).delete(docId))
    await reqToPromise(tx.objectStore(IDB_STORE_META).delete(docId))
    const us = tx.objectStore(IDB_STORE_UPDATES)
    const keys = (await reqToPromise(us.index('docId').getAllKeys(docId))) as IDBValidKey[]
    for (const key of keys) await reqToPromise(us.delete(key))
  }

  /**
   * 把一条时间轴的全部本地数据从 oldId 改键到 newId。
   * 发布时 id 被服务端清洗变更后使用。
   *
   * 先写 newId、最后删 oldId:若中途崩溃,newId 数据已落盘,oldId 残留
   * 是无害孤儿(可后续清理),不会丢数据。
   */
  async rekey(oldId: string, newId: string): Promise<void> {
    if (oldId === newId) return
    const merged = await this.loadDoc(oldId)
    const meta = await this.getMeta(oldId)
    if (merged) {
      const tx = this.tx([IDB_STORE_SNAPSHOTS], 'readwrite')
      await reqToPromise(
        tx.objectStore(IDB_STORE_SNAPSHOTS).put({
          docId: newId,
          bin: merged,
          updatedAt: Date.now(),
        } as SnapshotRow)
      )
    }
    if (meta) await this.putMeta({ ...meta, docId: newId })
    await this.deleteDoc(oldId)
  }
}
