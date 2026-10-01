import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backfill, normalizeIdentifier } from './backfill-i18n-translations.mjs'

const source = { a: { x: '源', y: '源', z: '源' }, b: '源' }

test('Crowdin empty or missing values fall back to base translations', () => {
  const { result, restored } = backfill(
    source,
    { a: { x: '', y: 'Crowdin' }, b: '' },
    { a: { x: 'base-x', y: 'base-y', z: 'base-z' }, b: 'base-b' }
  )
  assert.deepEqual(result, { a: { x: 'base-x', y: 'Crowdin', z: 'base-z' }, b: 'base-b' })
  assert.deepEqual(restored, ['a.x', 'a.z', 'b'])
})

test('explicit Crowdin translations win over base', () => {
  const { result, restored } = backfill(
    source,
    { a: { x: 'new', y: 'new', z: 'new' }, b: 'new' },
    {
      a: { x: 'old', y: 'old', z: 'old' },
      b: 'old',
    }
  )
  assert.deepEqual(result, { a: { x: 'new', y: 'new', z: 'new' }, b: 'new' })
  assert.deepEqual(restored, [])
})

test('keys removed from source are not restored; empty base stays empty', () => {
  const { result, restored } = backfill({ a: '源' }, { a: '' }, { a: '', gone: 'stale' })
  assert.deepEqual(result, { a: '' })
  assert.deepEqual(restored, [])
})

test('missing base file leaves download untouched', () => {
  const { result, restored } = backfill(source, { a: { x: '' }, b: '' }, undefined)
  assert.deepEqual(result, { a: { x: '' }, b: '' })
  assert.deepEqual(restored, [])
})

test('Crowdin identifiers normalize to dotted keys', () => {
  assert.equal(normalizeIdentifier('connection.retryHint'), 'connection.retryHint')
  assert.equal(normalizeIdentifier('connection -> retryHint'), 'connection.retryHint')
})
