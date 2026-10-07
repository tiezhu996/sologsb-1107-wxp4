import { create } from 'zustand'
import type { PulpFeed } from '../types/pulp-feed'
import type { RunFeedInput, SheetRun, SheetRunInput } from '../types/sheet-run'
import { db, plain, SCHEMA_REV, type GbPaperMillDatabase } from '../utils/db'
import { allocateConsumption, newRequestId, roundKg, summarizePulpAccounts, vatConsumptionKg, vatFeedNo, vatFeedPrefix } from '../utils/pulp'
import { calculateDeviation } from '../utils/stripe'
import { usePulpStore } from './pulpStore'

/** 业务校验失败：整槽回滚且不重试 */
export class VatRejectedError extends Error {}

const MAX_ATTEMPTS = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface RunStore {
  sheetRuns: SheetRun[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadRuns: () => Promise<void>
  refreshRuns: () => Promise<void>
  addRun: (input: SheetRunInput, feeds: RunFeedInput[], requestId?: string) => Promise<SheetRun | null>
  updateMeasuredGap: (id: number, measuredGap: number, standardGap: number) => Promise<void>
}

export const useRunStore = create<RunStore>((set, get) => ({
  sheetRuns: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadRuns: async () => {
    if (get().loaded) return
    await get().refreshRuns()
  },
  refreshRuns: async () => {
    set({ isLoading: true, error: null })
    try {
      const sheetRuns = await db.sheetRuns.orderBy('runDate').reverse().toArray()
      set({ sheetRuns, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '抄纸工序读取失败，请检查浏览器存储权限' })
    }
  },
  addRun: async (input, feeds, requestId = newRequestId()) => {
    set({ error: null })
    // 写入失败后整槽回退重试：同一 requestId 保证重试与重复提交不会再次扣料
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const created = await commitVat(input, feeds, requestId)
        set((state) => ({
          sheetRuns: state.sheetRuns.some((run) => run.id === created.id) ? state.sheetRuns : [created, ...state.sheetRuns],
        }))
        void usePulpStore.getState().refreshPulpFeeds()
        return created
      } catch (error) {
        if (error instanceof VatRejectedError) {
          set({ error: error.message })
          return null
        }
        if (attempt === MAX_ATTEMPTS) {
          set({ error: '工序登记失败，请检查工序编号是否重复或稍后重试' })
          return null
        }
        await sleep(120 * attempt)
      }
    }
    return null
  },
  updateMeasuredGap: async (id, measuredGap, standardGap) => {
    const deviation = calculateDeviation(measuredGap, standardGap)
    try {
      const run = await db.sheetRuns.get(id)
      if (run?.frozen) {
        set({ error: '该工序关联的料批已停用，记录已冻结，不能再改实测间距' })
        return
      }
      await db.sheetRuns.update(id, { measuredGap, deviation, schemaRev: SCHEMA_REV })
      set((state) => ({
        sheetRuns: state.sheetRuns.map((item) => (item.id === id ? { ...item, measuredGap, deviation, schemaRev: SCHEMA_REV } : item)),
        error: null,
      }))
    } catch {
      set({ error: '实测间距更新失败' })
    }
  },
}))

/**
 * 整槽原子写入：工序 + 多批投料记录同事务提交，任一步失败整槽回滚。
 * 余量在事务内由投料记录实时汇总，两个标签页同时领同一批浆时，
 * IndexedDB 串行化事务保证后到者看到最新余量，只有一方能成功。
 */
export async function commitVat(input: SheetRunInput, feeds: RunFeedInput[], requestId: string, database: GbPaperMillDatabase = db): Promise<SheetRun> {
  return database.transaction('rw', [database.sheetRuns, database.pulpFeeds, database.fiberBatches, database.moulds], async () => {
    // 幂等：同一 requestId 已提交过则直接返回原工序，不再扣料
    const existing = await database.pulpFeeds.where('feedNo').startsWith(vatFeedPrefix(requestId)).first()
    if (existing?.runId !== undefined) {
      const submitted = await database.sheetRuns.get(existing.runId)
      if (submitted) return submitted
    }

    if (feeds.length === 0) throw new VatRejectedError('请至少登记一批投料')
    const batchIds = [...new Set(feeds.map((feed) => feed.batchId))]
    if (batchIds.length !== feeds.length) throw new VatRejectedError('同一批浆在一槽中只能登记一行投料')
    if (feeds.some((feed) => !(feed.feedKg > 0))) throw new VatRejectedError('每批投料量需大于 0')

    const mould = await database.moulds.get(input.mouldId)
    if (!mould) throw new VatRejectedError('未找到所选纸帘，无法核算帘框面积')

    const batches = await database.fiberBatches.where('id').anyOf(batchIds).toArray()
    const batchById = new Map(batches.map((batch) => [batch.id ?? 0, batch]))
    for (const batchId of batchIds) {
      const batch = batchById.get(batchId)
      if (!batch) throw new VatRejectedError(`料批 ${batchId} 不存在`)
      if (batch.status === '停用') throw new VatRejectedError(`料批 ${batch.batchNo} 已停用，不能再领用`)
    }

    // 事务内汇总余量并校验各批分摊消耗
    const history = await database.pulpFeeds.where('batchId').anyOf(batchIds).toArray()
    const accounts = summarizePulpAccounts(history)
    const totalKg = vatConsumptionKg(input.grammage, mould.frameW, mould.frameH, input.stackHeight)
    const allocations = allocateConsumption(totalKg, feeds)
    for (const allocation of allocations) {
      const batch = batchById.get(allocation.batchId)
      const remaining = accounts.get(allocation.batchId)?.remainingKg ?? 0
      if (allocation.consumedKg > remaining) {
        throw new VatRejectedError(
          `料批 ${batch?.batchNo ?? allocation.batchId} 余量不足：本槽分摊 ${allocation.consumedKg} kg，余量仅 ${roundKg(remaining)} kg`,
        )
      }
    }

    const payload = plain({ ...input, frozen: false })
    const runId = Number(await database.sheetRuns.add(payload))
    const created: SheetRun = { ...payload, id: runId, schemaRev: SCHEMA_REV }
    const feedRecords: PulpFeed[] = allocations.map((allocation) => {
      const batch = batchById.get(allocation.batchId)
      return {
        feedNo: vatFeedNo(requestId, allocation.batchId),
        kind: '合槽',
        batchId: allocation.batchId,
        batchNo: batch?.batchNo ?? `批次${allocation.batchId}`,
        material: batch?.material ?? '构皮',
        runId,
        runNo: input.runNo,
        feedKg: allocation.feedKg,
        sharePct: allocation.sharePct,
        consumedKg: allocation.consumedKg,
        createdAt: new Date().toISOString(),
        schemaRev: SCHEMA_REV,
      }
    })
    await database.pulpFeeds.bulkAdd(plain(feedRecords))
    return created
  })
}
