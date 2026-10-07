import { create } from 'zustand'
import type { FiberBatch, FiberBatchInput, FiberBatchState } from '../types/fiber-batch'
import type { StockLedgerEntry } from '../types/stock-ledger'
import { db, plain } from '../utils/db'
import { createFiberBatch, setBatchState, sumBalances } from '../utils/stock'
import { useRunStore } from './runStore'
import { useSampleStore } from './sampleStore'

interface FiberStore {
  fiberBatches: FiberBatch[]
  ledger: StockLedgerEntry[]
  balances: Map<number, number>
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadFiberBatches: () => Promise<void>
  addFiberBatch: (input: FiberBatchInput) => Promise<FiberBatch | null>
  setFiberBatchState: (id: number, state: FiberBatchState) => Promise<boolean>
  refreshStock: () => Promise<void>
}

export const useFiberStore = create<FiberStore>((set, get) => ({
  fiberBatches: [],
  ledger: [],
  balances: new Map(),
  isLoading: false,
  loaded: false,
  error: null,
  loadFiberBatches: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const [fiberBatches, ledger] = await Promise.all([
        db.fiberBatches.orderBy('batchNo').toArray(),
        db.stockLedger.toArray(),
      ])
      set({ fiberBatches, ledger, balances: sumBalances(ledger), isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '纤维料批读取失败，请检查浏览器存储权限' })
    }
  },
  addFiberBatch: async (input) => {
    set({ error: null })
    try {
      const created = await createFiberBatch(plain(input))
      const ledgerEntry: StockLedgerEntry = {
        batchId: created.id!,
        batchNo: created.batchNo,
        material: created.material,
        type: '入库',
        amountKg: input.initialAmountKg,
        source: '建批初始投料',
        clientToken: `in:batch:${created.id}`,
        createdAt: new Date().toISOString(),
        schemaRev: 3,
      }
      const ledger = input.initialAmountKg > 0 ? [...get().ledger, ledgerEntry] : get().ledger
      set((state) => ({
        fiberBatches: [created, ...state.fiberBatches],
        ledger,
        balances: sumBalances(ledger),
      }))
      return created
    } catch (error) {
      const message = error instanceof Error && /uniqueness|ConstraintError/i.test(error.message)
        ? '料批登记失败，请检查批次编号是否重复'
        : error instanceof Error
          ? error.message
          : '料批登记失败，请检查批次编号是否重复'
      set({ error: message })
      return null
    }
  },
  setFiberBatchState: async (id, nextState) => {
    set({ error: null })
    try {
      await setBatchState(id, nextState)
      const [fiberBatches, sheetRuns, paperSamples] = await Promise.all([
        db.fiberBatches.toArray(),
        db.sheetRuns.toArray(),
        db.paperSamples.toArray(),
      ])
      // 停用联动会改动工序与样本冻结态，同步刷新本页与关联 store 缓存
      useRunStore.getState().setRuns(sheetRuns)
      useSampleStore.getState().setSamples(paperSamples)
      set({ fiberBatches })
      return true
    } catch {
      set({ error: '料批状态更新失败，请稍后重试' })
      return false
    }
  },
  refreshStock: async () => {
    const ledger = await db.stockLedger.toArray()
    set({ ledger, balances: sumBalances(ledger) })
  },
}))
