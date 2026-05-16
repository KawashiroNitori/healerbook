import * as Y from 'yjs'
import {
  IDB_NAME,
  IDB_STORE_SNAPSHOTS,
  IDB_STORE_UPDATES,
  CLIENT_SQUASH_THRESHOLD,
} from '../constants'

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
      const req = indexedDB.open(IDB_NAME, 1)
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

  /** squash:snapshot + updates → 新 snapshot,清空 updates(Task 8 完善) */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async squash(_docId: string): Promise<void> {
    // Task 8 实现
  }
}
