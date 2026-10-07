export const EVENNESS_LEVELS = ['均匀', '略花', '花'] as const
export type EvennessLevel = (typeof EVENNESS_LEVELS)[number]

export interface PaperSample {
  id?: number
  sampleNo: string
  runId: number
  sizeMm: number
  stripeCount: number
  evenness: EvennessLevel
  archiveBin: string
  /** 关联料批停用后随工序一并冻结 */
  frozen?: boolean
  schemaRev?: number
}

export type PaperSampleInput = Omit<PaperSample, 'id' | 'schemaRev' | 'frozen'>
