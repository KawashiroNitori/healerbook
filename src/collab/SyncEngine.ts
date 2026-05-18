import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { RemoteConnection, type ConnectionStatus } from './RemoteConnection'
import { Y_MAP, LOCAL_ORIGIN } from './constants'
import type { LocalDocMeta } from './types'

/** 构造连到该文档 DO 的 WebSocket URL */
function buildWsUrl(docId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/timelines/${docId}/connect`
}

/**
 * 同步引擎。持有 Y.Doc、本地 IndexedDB 持久化、UndoManager;
 * 已发布时间轴额外挂一个 RemoteConnection 作为 remote peer。
 */
export class SyncEngine {
  readonly docId: string
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly undoManager: Y.UndoManager
  private readonly store: IndexedDBDocStore
  private remote: RemoteConnection | null = null
  private pending: Promise<void> = Promise.resolve()
  private lastPersistError: unknown = null

  private constructor(docId: string, doc: Y.Doc, store: IndexedDBDocStore) {
    this.docId = docId
    this.doc = doc
    this.awareness = new Awareness(this.doc)
    this.store = store
    this.undoManager = new Y.UndoManager(
      [
        Y_MAP.meta,
        Y_MAP.damageEvents,
        Y_MAP.castEvents,
        Y_MAP.annotations,
        Y_MAP.composition,
        Y_MAP.statData,
      ].map(n => doc.getMap(n)),
      { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 400 }
    )
    this.doc.on('update', this.onUpdate)
  }

  /**
   * 打开一条时间轴。
   * @param seed 仅新建时传入(本地无持久化数据时用作初始 Y.Doc)
   */
  static async create(docId: string, seed?: Y.Doc): Promise<SyncEngine> {
    const store = new IndexedDBDocStore()
    await store.open()
    const persisted = await store.loadDoc(docId)
    const doc = new Y.Doc()
    if (persisted) {
      Y.applyUpdate(doc, persisted, 'persisted')
    } else if (seed) {
      const seedUpdate = Y.encodeStateAsUpdate(seed)
      Y.applyUpdate(doc, seedUpdate, 'persisted')
      await store.appendUpdate(docId, seedUpdate)
    }
    return new SyncEngine(docId, doc, store)
  }

  /** 挂上远端连接(发布 / editor 模式)。幂等。 */
  connectRemote(
    getAuthToken: () => Promise<string | null>,
    onStatus: (status: ConnectionStatus) => void,
    onEditRequest?: (count: number) => void,
    onRevoked?: () => void
  ): void {
    if (this.remote) return
    this.remote = new RemoteConnection(
      buildWsUrl(this.docId),
      this.doc,
      this.awareness,
      getAuthToken,
      onStatus,
      onEditRequest,
      onRevoked
    )
    this.remote.connect()
  }

  /** 是否已挂 remote */
  get hasRemote(): boolean {
    return this.remote !== null
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'persisted') return // 来自加载,无需再落盘
    this.pending = this.pending
      .then(() => this.store.appendUpdate(this.docId, update))
      .catch(err => {
        this.lastPersistError = err
        console.error('[collab] persist update failed', err)
      })
  }

  /** 等所有待持久化 update 落盘;期间有失败则抛最近一次错误。 */
  flush(): Promise<void> {
    return this.pending.then(() => {
      if (this.lastPersistError !== null) {
        const err = this.lastPersistError
        this.lastPersistError = null
        throw err
      }
    })
  }

  /** 写入本地元数据行 */
  saveMeta(meta: LocalDocMeta): Promise<void> {
    return this.store.putMeta(meta)
  }

  /** 读本地元数据行 */
  loadMeta(): Promise<LocalDocMeta | null> {
    return this.store.getMeta(this.docId)
  }

  destroy(): void {
    this.remote?.destroy()
    this.remote = null
    this.doc.off('update', this.onUpdate)
    this.undoManager.destroy()
    this.awareness.destroy()
  }
}
