import type { FiberMaterial } from './fiber-batch'

export const FEED_KINDS = ['入库', '合槽'] as const
export type FeedKind = (typeof FEED_KINDS)[number]

/**
 * 投料记录：料批余量的唯一事实来源。
 * - 入库：配浆入库，feedKg 为入库量，consumedKg 恒为 0。
 * - 合槽：工序领料，feedKg 为登记的投料量，consumedKg 为按克重、
 *   帘框面积与叠高分摊后的消耗；批次编号与原料为登记时快照，
 *   之后修改料批资料不会倒改历史配方。
 */
export interface PulpFeed {
  id?: number
  feedNo: string
  kind: FeedKind
  batchId: number
  batchNo: string
  material: FiberMaterial
  runId?: number
  runNo?: string
  feedKg: number
  sharePct: number
  consumedKg: number
  createdAt: string
  schemaRev?: number
}

export type PulpFeedInput = Omit<PulpFeed, 'id' | 'schemaRev'>
