export const STRIPE_DIRECTIONS = ['竖帘纹', '横帘纹'] as const
export type StripeDirection = (typeof STRIPE_DIRECTIONS)[number]

export const DRY_METHODS = ['火墙', '日晒'] as const
export type DryMethod = (typeof DRY_METHODS)[number]

/** 一槽中某一批浆的投料登记 */
export interface RunFeedInput {
  batchId: number
  feedKg: number
}

export interface SheetRun {
  id?: number
  runNo: string
  mouldId: number
  runDate: string
  operator: string
  stripeDirection: StripeDirection
  dipCount: number
  stackHeight: number
  dryMethod: DryMethod
  grammage: number
  measuredGap: number
  deviation: number
  /** 关联料批停用后冻结，冻结工序不可再改实测间距 */
  frozen?: boolean
  schemaRev?: number
}

export type SheetRunInput = Omit<SheetRun, 'id' | 'schemaRev' | 'frozen'>
