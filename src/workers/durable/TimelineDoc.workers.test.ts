import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

describe('TimelineDoc WebSocket 接入', () => {
  it('/connect 返回 101 并升级为 WebSocket', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-conn-1')
    const stub = env.TIMELINE_DOC.get(id)
    const res = await stub.fetch('https://do/connect', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(101)
    expect(res.webSocket).toBeTruthy()
  })

  it('非 /connect 路径返回 400', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-conn-2')
    const stub = env.TIMELINE_DOC.get(id)
    const res = await stub.fetch('https://do/other')
    expect(res.status).toBe(400)
  })
})
