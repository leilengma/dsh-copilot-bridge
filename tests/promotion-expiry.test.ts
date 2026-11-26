import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promotionActive, watchPromotionExpiry } from '../src/client/promotion-expiry.ts'

const start = Date.parse('2026-11-26T12:00:00Z')

test('discount badges expire on an open page and their timer is removed on unmount', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start })
  const first = { discountPercent: 50, endsAt: new Date(start + 100).toISOString() }
  const second = { discountPercent: 20, endsAt: new Date(start + 200).toISOString() }
  let renders = 0
  const stop = watchPromotionExpiry([{ id: 'a', name: 'a', promotion: first }, { id: 'b', name: 'b', promotion: second }], () => { renders++ })
  assert.equal(promotionActive(first), true)
  assert.equal(renders, 1, 'reconcile once when installing the watcher')
  context.mock.timers.tick(100)
  assert.equal(renders, 2)
  assert.equal(promotionActive(first), false)
  assert.equal(promotionActive(second), true)
  stop()
  context.mock.timers.tick(100)
  assert.equal(renders, 2, 'a disposed table must not be notified')
  assert.equal(promotionActive(second), false)
  assert.equal(promotionActive({ discountPercent: 10 }), true)
  assert.equal(promotionActive({ discountPercent: 10, endsAt: 'bad-date' }), false)
})

test('expiry between render and effect registration is reconciled immediately', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start })
  const promotion = { discountPercent: 50, endsAt: new Date(start + 100).toISOString() }
  let badgeVisible = promotionActive(promotion)
  assert.equal(badgeVisible, true)
  context.mock.timers.tick(100)
  const stop = watchPromotionExpiry([{ id: 'a', name: 'a', promotion }], () => { badgeVisible = promotionActive(promotion) })
  assert.equal(badgeVisible, false)
  stop()
})

test('far-future promotions do not overflow the timer into a hot loop', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start })
  const promotion = { discountPercent: 50, endsAt: new Date(start + 3_000_000_000).toISOString() }
  let renders = 0
  const stop = watchPromotionExpiry([{ id: 'a', name: 'a', promotion }], () => { renders++ })
  context.mock.timers.tick(1000)
  assert.equal(renders, 1, 'only the initial reconciliation, no overflow callbacks')
  stop()
})
