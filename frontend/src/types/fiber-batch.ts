export const FIBER_MATERIALS = ['构皮', '桑皮', '竹麻', '稻草'] as const
export type FiberMaterial = (typeof FIBER_MATERIALS)[number]

export const COOK_AGENTS = ['石灰', '纯碱'] as const
export type CookAgent = (typeof COOK_AGENTS)[number]

export const BLEACH_METHODS = ['日晒', '漂白粉'] as const
export type BleachMethod = (typeof BLEACH_METHODS)[number]

export const FIBER_BATCH_STATES = ['在用', '停用'] as const
export type FiberBatchState = (typeof FIBER_BATCH_STATES)[number]

export interface FiberBatch {
  id?: number
  batchNo: string
  material: FiberMaterial
  origin: string
  cookAgent: CookAgent
  cookHours: number
  bleachMethod: BleachMethod
  beatingDegree: number
  operator: string
  state: FiberBatchState
  /** 乐观并发版本号：每次跨表领浆成功后递增，用于多标签页抢占同一批浆 */
  stockVersion: number
  schemaRev?: number
}

export type FiberBatchInput = {
  batchNo: string
  material: FiberMaterial
  origin: string
  cookAgent: CookAgent
  cookHours: number
  bleachMethod: BleachMethod
  beatingDegree: number
  operator: string
  /** 建批首笔入库量（kg）；只在登记时写一笔流水，不挂在料批资料上 */
  initialAmountKg: number
}
