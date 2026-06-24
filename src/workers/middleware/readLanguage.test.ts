import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { readLanguage } from './readLanguage'

function makeApp() {
  const app = new Hono<AppEnv>()
  app.use('*', readLanguage)
  app.get('/x', c => c.json({ lang: c.get('lang') }))
  return app
}

describe('readLanguage middleware', () => {
  it('parses Accept-Language into AppLanguage', async () => {
    const res = await makeApp().request('/x', { headers: { 'Accept-Language': 'en-US' } })
    expect(await res.json()).toEqual({ lang: 'en' })
  })
  it('falls back to default when header missing', async () => {
    const res = await makeApp().request('/x')
    expect(await res.json()).toEqual({ lang: 'zh-CN' })
  })
})
