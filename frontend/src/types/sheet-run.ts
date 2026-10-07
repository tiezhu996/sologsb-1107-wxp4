import type { FiberMaterial } from './fiber-batch'

export const STRIPE_DIRECTIONS = ['竖帘纹', '横帘纹'] as const
export type StripeDirection = (typeof STRIPE_DIRECTIONS)[number]

export const DRY_METHODS = ['火墙', '日晒'] as const
export type DryMethod = (typeof DRY_METHODS)[number]

/**
 * 一槽工序的一个投料来源。
 * 一槽可合多批浆（如构皮、桑皮按比例合槽），故以多行登记。
 * batchSnapshot 为登记当时的料批摘要：料批资料事后改动不会倒改历史配方。
 */
export interface RunBatchLine {
  batchId: number
  /** 合槽投料量（kg），多批浆之间按各自投料量比例分摊本槽纸浆消耗 */
  feedKg: number
  /** 登记当时快照，供历史配方与停用后留痕展示 */
  batchSnapshot: {
    batchNo: string
    material: FiberMaterial
  }
  /** 该行实际分摊到的浆料消耗（kg），由克重 × 帘框面积 × 叠高按比例算得 */
  consumedKg: number
}

export interface SheetRun {
  id?: number
  runNo: string
  mouldId: number
  /** @deprecated 旧单批字段，仅供旧数据读取与迁移留痕；新数据统一看 batchLines */
  batchId?: number
  /** 一槽多批浆的投料明细 */
  batchLines: RunBatchLine[]
  runDate: string
  operator: string
  stripeDirection: StripeDirection
  dipCount: number
  stackHeight: number
  dryMethod: DryMethod
  grammage: number
  measuredGap: number
  deviation: number
  /** 停用联动：本槽任一批料停用后冻结，锁定成纸样本，只保留只读 */
  frozen?: boolean
  schemaRev?: number
}

export type SheetRunInput = Omit<SheetRun, 'id' | 'schemaRev' | 'frozen' | 'batchId'>
