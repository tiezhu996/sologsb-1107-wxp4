import { create } from 'zustand'
import type { RunBatchLine, SheetRun } from '../types/sheet-run'
import { db } from '../utils/db'
import { calculateDeviation } from '../utils/stripe'
import {
  BatchInactiveError,
  EmptyRecipeError,
  MissingBatchError,
  reserveRun,
  StockInsufficientError,
  type RunDraftLine,
} from '../utils/stock'

export interface RunFormDraft {
  runNo: string
  mouldId: number
  runDate: string
  operator: string
  stripeDirection: SheetRun['stripeDirection']
  dipCount: number
  stackHeight: number
  dryMethod: SheetRun['dryMethod']
  grammage: number
  measuredGap: number
  deviation: number
  draftLines: RunDraftLine[]
}

interface RunStore {
  sheetRuns: SheetRun[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  notice: string | null
  loadRuns: () => Promise<void>
  addRun: (draft: RunFormDraft, totalConsumptionKg: number) => Promise<SheetRun | null>
  updateMeasuredGap: (id: number, measuredGap: number, standardGap: number) => Promise<void>
  setRuns: (runs: SheetRun[]) => void
  clearNotice: () => void
}

export const useRunStore = create<RunStore>((set, get) => ({
  sheetRuns: [],
  isLoading: false,
  loaded: false,
  error: null,
  notice: null,
  loadRuns: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const sheetRuns = await db.sheetRuns.orderBy('runDate').reverse().toArray()
      set({ sheetRuns, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '抄纸工序读取失败，请检查浏览器存储权限' })
    }
  },
  addRun: async (draft, totalConsumptionKg) => {
    set({ error: null, notice: null })
    const { draftLines, deviation, ...runFields } = draft
    try {
      const result = await reserveRun({ run: { ...runFields, deviation }, draftLines, totalConsumptionKg })
      set((state) => ({
        sheetRuns: [result.run, ...state.sheetRuns.filter((item) => item.id !== result.run.id)],
        notice: result.duplicated ? '该工序已登记过，重复提交未再次扣料' : null,
      }))
      return result.run
    } catch (error) {
      const message =
        error instanceof StockInsufficientError ||
        error instanceof BatchInactiveError ||
        error instanceof MissingBatchError ||
        error instanceof EmptyRecipeError
          ? error.message
          : error instanceof Error && /runNo|uniqueness|ConstraintError/i.test(error.message)
            ? '工序登记失败，请检查工序编号是否重复'
            : '工序登记失败，整槽已回退，请稍后重试'
      set({ error: message })
      return null
    }
  },
  updateMeasuredGap: async (id, measuredGap, standardGap) => {
    const deviation = calculateDeviation(measuredGap, standardGap)
    try {
      await db.sheetRuns.update(id, { measuredGap, deviation, schemaRev: 3 })
      set((state) => ({
        sheetRuns: state.sheetRuns.map((run) => (run.id === id ? { ...run, measuredGap, deviation, schemaRev: 3 } : run)),
        error: null,
      }))
    } catch {
      set({ error: '实测间距更新失败' })
    }
  },
  setRuns: (runs) => set({ sheetRuns: [...runs].sort((a, b) => b.runDate.localeCompare(a.runDate)) }),
  clearNotice: () => set({ notice: null }),
}))

export type { RunBatchLine }
