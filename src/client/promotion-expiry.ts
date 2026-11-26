import type { CopilotModel, ModelPromotion } from '../shared/contract.ts'

export function promotionActive(promotion: ModelPromotion, now = Date.now()): boolean {
  return promotion.endsAt === undefined || Date.parse(promotion.endsAt) > now
}

/** Refresh only at an expiry boundary; do not poll or let a far-future date overflow setTimeout. */
export function watchPromotionExpiry(models: readonly CopilotModel[], expired: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    const now = Date.now()
    const dates = models.flatMap(model => model.promotion?.endsAt ? [Date.parse(model.promotion.endsAt)] : []).filter(date => date > now)
    if (!dates.length) return
    timer = setTimeout(() => { expired(); schedule() }, Math.min(Math.min(...dates) - now, 2_147_483_647))
  }
  // A promotion may expire between render and passive-effect registration.
  expired()
  schedule()
  return () => { if (timer !== undefined) clearTimeout(timer) }
}
