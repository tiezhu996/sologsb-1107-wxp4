import type { PulpFeed } from '../types/pulp-feed'
import type { RunFeedInput } from '../types/sheet-run'

export function roundKg(value: number): number {
  return Number(value.toFixed(3))
}

/** 帘框面积：frameW/frameH 单位为 cm，返回 m² */
export function frameAreaSqm(frameW: number, frameH: number): number {
  return (frameW * frameH) / 10000
}

/** 整槽理论消耗 kg = 克重(g/m²) × 帘框面积(m²) × 叠高(张) ÷ 1000 */
export function vatConsumptionKg(grammage: number, frameW: number, frameH: number, stackHeight: number): number {
  return roundKg((grammage * frameAreaSqm(frameW, frameH) * stackHeight) / 1000)
}

export interface FeedAllocation extends RunFeedInput {
  sharePct: number
  consumedKg: number
}

/**
 * 按各批投料量比例分摊整槽消耗。
 * 末批吸收四舍五入尾差，保证各批分摊合计等于整槽消耗。
 */
export function allocateConsumption(totalKg: number, feeds: RunFeedInput[]): FeedAllocation[] {
  const totalFeed = feeds.reduce((sum, feed) => sum + feed.feedKg, 0)
  if (totalKg <= 0 || totalFeed <= 0) {
    return feeds.map((feed) => ({ ...feed, sharePct: 0, consumedKg: 0 }))
  }
  let allocated = 0
  return feeds.map((feed, index) => {
    const isLast = index === feeds.length - 1
    const consumedKg = isLast ? roundKg(totalKg - allocated) : roundKg((totalKg * feed.feedKg) / totalFeed)
    allocated = roundKg(allocated + consumedKg)
    const sharePct = Number(((feed.feedKg / totalFeed) * 100).toFixed(1))
    return { batchId: feed.batchId, feedKg: feed.feedKg, sharePct, consumedKg }
  })
}

export interface PulpAccount {
  stockedKg: number
  consumedKg: number
  remainingKg: number
}

/** 余量由投料记录汇总：Σ入库量 − Σ合槽分摊消耗 */
export function summarizePulpAccounts(feeds: PulpFeed[]): Map<number, PulpAccount> {
  const accounts = new Map<number, PulpAccount>()
  for (const feed of feeds) {
    const account = accounts.get(feed.batchId) ?? { stockedKg: 0, consumedKg: 0, remainingKg: 0 }
    if (feed.kind === '入库') {
      account.stockedKg = roundKg(account.stockedKg + feed.feedKg)
    } else {
      account.consumedKg = roundKg(account.consumedKg + feed.consumedKg)
    }
    account.remainingKg = roundKg(account.stockedKg - account.consumedKg)
    accounts.set(feed.batchId, account)
  }
  return accounts
}

/** 一次整槽提交的幂等键：同一次提交（含自动重试）复用，重复提交不会再次扣料 */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function vatFeedPrefix(requestId: string): string {
  return `PF-${requestId}-`
}

export function vatFeedNo(requestId: string, batchId: number): string {
  return `${vatFeedPrefix(requestId)}${batchId}`
}

export function stockFeedNo(batchNo: string): string {
  return `PF-STOCK-${batchNo}`
}
