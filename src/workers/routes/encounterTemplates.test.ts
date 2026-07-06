import { describe, it, expect } from 'vitest'
import { encounterTemplatesRoutes } from './encounterTemplates'
import { getEncounterTemplateKVKey } from '../kvKeys'
import type { EncounterTemplate } from '../encounterTemplate'
import type { Env } from '../env'

// 轻量 in-memory KV mock（只覆盖 get/put/delete）
function createMockKV(): KVNamespace & { _store: Map<string, string> } {
  const store = new Map<string, string>()
  const kv = {
    _store: store,
    async get(key: string, type?: 'json' | 'text') {
      const val = store.get(key)
      if (val === undefined) return null
      return type === 'json' ? JSON.parse(val) : val
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null }
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null }
    },
  } as unknown as KVNamespace & { _store: Map<string, string> }
  return kv
}

function makeEnv(kv: KVNamespace): Env {
  return {
    healerbook: kv,
    healerbook_timelines: {} as D1Database,
    TIMELINE_DOC: {} as DurableObjectNamespace,
    healerbook_snapshots: {} as KVNamespace,
  }
}

describe('GET /encounter-templates/:encounterId', () => {
  it('encounterId 非数字 → 400', async () => {
    const kv = createMockKV()
    const res = await encounterTemplatesRoutes.request('https://app/abc', undefined, makeEnv(kv))
    expect(res.status).toBe(400)
  })

  it('KV 无数据 → 返回空事件列表', async () => {
    const kv = createMockKV()
    const res = await encounterTemplatesRoutes.request('https://app/9999', undefined, makeEnv(kv))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      events: unknown[]
      updatedAt: string | null
      templateSourceDurationMs: number | null
      kill: boolean
    }
    expect(body.events).toEqual([])
    expect(body.updatedAt).toBeNull()
    expect(body.templateSourceDurationMs).toBeNull()
    expect(body.kill).toBe(false)
  })

  it('KV 有数据 → 返回 events（裁剪 abilityId）+ updatedAt + kill', async () => {
    const kv = createMockKV()
    const template: EncounterTemplate = {
      encounterId: 1234,
      events: [
        {
          id: 'e1',
          name: '死刑',
          time: 10,
          damage: 80000,
          type: 'tankbuster',
          damageType: 'physical',
          abilityId: 40000,
        },
      ],
      templateSourceDurationMs: 500_000,
      kill: true,
      updatedAt: '2026-04-14T00:00:00.000Z',
    }
    await kv.put(getEncounterTemplateKVKey(1234), JSON.stringify(template))

    const res = await encounterTemplatesRoutes.request('https://app/1234', undefined, makeEnv(kv))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      events: Array<{ id: string; abilityId?: number }>
      updatedAt: string | null
      templateSourceDurationMs: number | null
      kill: boolean
    }
    expect(body.events).toHaveLength(1)
    expect(body.events[0].id).toBe('e1')
    expect(body.events[0].abilityId).toBeUndefined()
    expect(body.updatedAt).toBe('2026-04-14T00:00:00.000Z')
    expect(body.templateSourceDurationMs).toBe(500_000)
    expect(body.kill).toBe(true)
  })

  it('KV 旧数据无 kill 字段 → 默认返回 false', async () => {
    const kv = createMockKV()
    await kv.put(
      getEncounterTemplateKVKey(1235),
      JSON.stringify({
        encounterId: 1235,
        events: [],
        templateSourceDurationMs: 100_000,
        updatedAt: '2026-04-14T00:00:00.000Z',
      })
    )
    const res = await encounterTemplatesRoutes.request('https://app/1235', undefined, makeEnv(kv))
    const body = (await res.json()) as { kill: boolean }
    expect(body.kill).toBe(false)
  })
})
