import { describe, it, expect } from 'vitest'
import { HTTPError } from 'ky'
import { unwrapApiError } from './unwrapApiError'

function makeHttpError(status: number, message: string): HTTPError {
  const err = Object.create(HTTPError.prototype) as HTTPError
  Object.defineProperty(err, 'response', { value: { status } })
  Object.defineProperty(err, 'message', { value: message, writable: true })
  return err
}

describe('unwrapApiError', () => {
  it('成功时透传返回值', async () => {
    await expect(unwrapApiError(async () => 42)).resolves.toBe(42)
  })

  it('HTTPError 默认转 new Error(err.message)', async () => {
    const p = unwrapApiError(async () => {
      throw makeHttpError(500, 'server exploded')
    })
    await expect(p).rejects.toThrow('server exploded')
    await expect(p).rejects.not.toBeInstanceOf(HTTPError)
  })

  it('非 HTTPError 原样 rethrow', async () => {
    const raw = new TypeError('network down')
    await expect(
      unwrapApiError(async () => {
        throw raw
      })
    ).rejects.toBe(raw)
  })

  it('onStatus 命中时返回替代值而不抛错', async () => {
    const result = await unwrapApiError<number[]>(
      async () => {
        throw makeHttpError(401, 'unauthorized')
      },
      { onStatus: { 401: () => [] } }
    )
    expect(result).toEqual([])
  })

  it('mapMessage 定制抛出的文案', async () => {
    const p = unwrapApiError(
      async () => {
        throw makeHttpError(404, 'ignored')
      },
      {
        mapMessage: err =>
          err.response.status === 404 ? 'NOT_FOUND' : `HTTP ${err.response.status}`,
      }
    )
    await expect(p).rejects.toThrow('NOT_FOUND')
  })

  it('rethrowOriginal 时保留原始 HTTPError', async () => {
    const raw = makeHttpError(500, 'boom')
    await expect(
      unwrapApiError(
        async () => {
          throw raw
        },
        { onStatus: { 404: () => null }, rethrowOriginal: true }
      )
    ).rejects.toBe(raw)
  })
})
