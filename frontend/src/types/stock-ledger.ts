import type { FiberMaterial } from './fiber-batch'

export const STOCK_TXN_TYPES = ['入库', '领用'] as const
export type StockTxnType = (typeof STOCK_TXN_TYPES)[number]

/**
 * 料批余量流水。余量永远由流水汇总得出（入库为正、领用为负），
 * 不在料批资料上存余量字段，因此改料批资料不会影响历史来源记录。
 */
export interface StockLedgerEntry {
  id?: number
  batchId: number
  /** 登记时料批号快照，便于停用后流水仍可辨识 */
  batchNo: string
  material: FiberMaterial
  type: StockTxnType
  /** 数量（kg），恒为正；方向由 type 表达 */
  amountKg: number
  /** 入库时记录来源批次说明；领用为空（来源在工序配方上） */
  source?: string
  /** 领用对应工序；入库为空 */
  runId?: number
  runNo?: string
  /** 领用流水的幂等键：同一工序的重复提交不会再次扣料 */
  clientToken: string
  createdAt: string
  schemaRev?: number
}
