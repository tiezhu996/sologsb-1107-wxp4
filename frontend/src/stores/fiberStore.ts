import { create } from 'zustand'
import type { FiberBatch, FiberBatchInput } from '../types/fiber-batch'
import type { PulpFeed } from '../types/pulp-feed'
import { db, plain, SCHEMA_REV } from '../utils/db'
import { stockFeedNo } from '../utils/pulp'
import { usePulpStore } from './pulpStore'
import { useRunStore } from './runStore'
import { useSampleStore } from './sampleStore'

interface FiberStore {
  fiberBatches: FiberBatch[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadFiberBatches: () => Promise<void>
  refreshFiberBatches: () => Promise<void>
  addFiberBatch: (input: FiberBatchInput, stockKg: number) => Promise<FiberBatch | null>
  updateBeatingDegree: (id: number, beatingDegree: number) => Promise<void>
  discontinueBatch: (id: number) => Promise<boolean>
}

export const useFiberStore = create<FiberStore>((set, get) => ({
  fiberBatches: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadFiberBatches: async () => {
    if (get().loaded) return
    await get().refreshFiberBatches()
  },
  refreshFiberBatches: async () => {
    set({ isLoading: true, error: null })
    try {
      const fiberBatches = await db.fiberBatches.orderBy('batchNo').toArray()
      set({ fiberBatches, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '纤维料批读取失败，请检查浏览器存储权限' })
    }
  },
  addFiberBatch: async (input, stockKg) => {
    set({ error: null })
    try {
      const payload = plain({ ...input, status: '在用' as const })
      // 料批与首笔入库投料记录同事务写入，余量自始由投料记录汇总
      const created = await db.transaction('rw', [db.fiberBatches, db.pulpFeeds], async () => {
        const id = Number(await db.fiberBatches.add(payload))
        const batch: FiberBatch = { ...payload, id, schemaRev: SCHEMA_REV }
        const stockFeed: PulpFeed = {
          feedNo: stockFeedNo(batch.batchNo),
          kind: '入库',
          batchId: id,
          batchNo: batch.batchNo,
          material: batch.material,
          feedKg: stockKg,
          sharePct: 100,
          consumedKg: 0,
          createdAt: new Date().toISOString(),
          schemaRev: SCHEMA_REV,
        }
        await db.pulpFeeds.add(plain(stockFeed))
        return batch
      })
      set((state) => ({ fiberBatches: [created, ...state.fiberBatches] }))
      void usePulpStore.getState().refreshPulpFeeds()
      return created
    } catch {
      set({ error: '料批登记失败，请检查批次编号是否重复' })
      return null
    }
  },
  updateBeatingDegree: async (id, beatingDegree) => {
    // 仅更新料批主数据；历史工序的配方以投料记录快照为准，不会倒改
    try {
      await db.fiberBatches.update(id, { beatingDegree, schemaRev: SCHEMA_REV })
      set((state) => ({
        fiberBatches: state.fiberBatches.map((batch) => (batch.id === id ? { ...batch, beatingDegree, schemaRev: SCHEMA_REV } : batch)),
        error: null,
      }))
    } catch {
      set({ error: '打浆度复测保存失败' })
    }
  },
  discontinueBatch: async (id) => {
    set({ error: null })
    try {
      // 只冻结确实用到该批的工序，以及这些工序名下的成纸样本
      await db.transaction('rw', [db.fiberBatches, db.pulpFeeds, db.sheetRuns, db.paperSamples], async () => {
        await db.fiberBatches.update(id, { status: '停用' as const, schemaRev: SCHEMA_REV })
        const vatFeeds = await db.pulpFeeds.where('batchId').equals(id).toArray()
        const runIds = [...new Set(vatFeeds.filter((feed) => feed.kind === '合槽' && feed.runId !== undefined).map((feed) => feed.runId as number))]
        if (runIds.length > 0) {
          await db.sheetRuns.where('id').anyOf(runIds).modify({ frozen: true, schemaRev: SCHEMA_REV })
          await db.paperSamples.where('runId').anyOf(runIds).modify({ frozen: true, schemaRev: SCHEMA_REV })
        }
      })
      set((state) => ({
        fiberBatches: state.fiberBatches.map((batch) => (batch.id === id ? { ...batch, status: '停用' as const, schemaRev: SCHEMA_REV } : batch)),
      }))
      await Promise.all([useRunStore.getState().refreshRuns(), useSampleStore.getState().refreshSamples()])
      return true
    } catch {
      set({ error: '料批停用失败，请稍后重试' })
      return false
    }
  },
}))
