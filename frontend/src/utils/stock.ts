import Dexie from 'dexie'
import type { FiberBatch, FiberBatchInput, FiberBatchState } from '../types/fiber-batch'
import type { RunBatchLine, SheetRun } from '../types/sheet-run'
import type { StockLedgerEntry } from '../types/stock-ledger'
import { allocateConsumption } from './consumption'
import { db, plain, runUsesBatch, STOCK_LOCK_NAME } from './db'

/** 领料行：登记时只确定用哪批浆与投料比例，分摊消耗由系统统一计算 */
export interface RunDraftLine {
  batchId: number
  feedKg: number
}

export interface RunReservationInput {
  run: Omit<SheetRun, 'id' | 'schemaRev' | 'frozen' | 'batchId' | 'batchLines' | 'deviation'> & { deviation: number }
  draftLines: RunDraftLine[]
  /** 本槽总用纸量 kg（克重 × 帘框面积 × 叠高），由调用方据纸帘算得 */
  totalConsumptionKg: number
}

export class StockConflictError extends Error {}
export class StockInsufficientError extends Error {}
export class BatchInactiveError extends Error {}
export class MissingBatchError extends Error {}
export class EmptyRecipeError extends Error {}

type LockFn = <T>(name: string, callback: () => Promise<T>) => Promise<T>

const lockRequest: LockFn | undefined =
  typeof navigator !== 'undefined' && typeof (navigator as { locks?: { request: LockFn } }).locks?.request === 'function'
    ? (name, callback) => (navigator as { locks: { request: LockFn } }).locks.request(name, callback)
    : undefined

/** 不支持 Web Locks 的环境退化为本标签页内串行链 */
let localChain: Promise<unknown> = Promise.resolve()
async function withStockLock<T>(callback: () => Promise<T>): Promise<T> {
  if (lockRequest) return lockRequest(STOCK_LOCK_NAME, callback)
  const result = localChain.then(callback, callback)
  localChain = result.catch(() => undefined)
  return result
}

/** 由流水汇总各料批余量（入库 − 领用），余量永远不落在料批资料上 */
export function sumBalances(entries: Pick<StockLedgerEntry, 'batchId' | 'type' | 'amountKg'>[]): Map<number, number> {
  const balances = new Map<number, number>()
  for (const entry of entries) {
    const delta = entry.type === '入库' ? entry.amountKg : -entry.amountKg
    balances.set(entry.batchId, Number(((balances.get(entry.batchId) ?? 0) + delta).toFixed(3)))
  }
  return balances
}

function isRetryableAbort(error: unknown): boolean {
  // 其它标签页抢先提交导致版本错位，或 IndexedDB 瞬时中止，都值得整槽重试
  return error instanceof StockConflictError || (error instanceof Dexie.AbortError)
}

/**
 * 登记一槽工序并按分摊结果扣减多批浆。
 * - 跨标签页用 Web Locks 串行化：两个标签页同时领同一批浆，只有先拿到锁的一方可能成功；
 *   另一方拿到锁后读到的是扣减后的余量，余额不足即失败。
 * - 全部写入在同一个 Dexie 读写事务里：任一校验失败则整槽回退。
 * - clientToken 以工序号为幂等键：重复提交命中既有领用流水，直接返回原工序，不再扣料。
 */
export async function reserveRun(input: RunReservationInput, attempts = 3): Promise<{ run: SheetRun; duplicated: boolean }> {
  const validLines = input.draftLines.filter((line) => line.batchId > 0 && line.feedKg > 0)
  if (validLines.length === 0) throw new EmptyRecipeError('请至少登记一批浆的投料量')
  const duplicatedIds = new Set(validLines.map((line) => line.batchId))
  if (duplicatedIds.size !== validLines.length) throw new EmptyRecipeError('同一料批在一槽中只能登记一行，请合并投料量')

  return withStockLock(async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await reserveOnce(input, validLines)
      } catch (error) {
        if (isRetryableAbort(error) && attempt < attempts - 1) {
          lastError = error
          continue
        }
        throw error
      }
    }
    throw lastError
  })
}

async function reserveOnce(input: RunReservationInput, validLines: RunDraftLine[]): Promise<{ run: SheetRun; duplicated: boolean }> {
  const { run, totalConsumptionKg } = input
  const clientToken = `run:${run.runNo}`
  const nowIso = new Date().toISOString()

  return db.transaction('rw', db.sheetRuns, db.fiberBatches, db.paperSamples, db.stockLedger, async () => {
    // 幂等：同一工序号已有领用流水，视为重复提交，原样返回且不再扣料
    const existingLedger = await db.stockLedger.where('clientToken').equals(clientToken).first()
    if (existingLedger) {
      const existingRun = await db.sheetRuns.where('runNo').equals(run.runNo).first()
      if (existingRun) return { run: existingRun, duplicated: true }
    }

    const batchIds = validLines.map((line) => line.batchId)
    const batches = await db.fiberBatches.where('id').anyOf(batchIds).toArray()
    const batchById = new Map(batches.map((batch) => [batch.id!, batch]))

    const missingId = batchIds.find((id) => !batchById.has(id))
    if (missingId != null) throw new MissingBatchError(`料批 ${missingId} 不存在，请刷新后重试`)
    const inactive = batches.find((batch) => batch.state === '停用')
    if (inactive) throw new BatchInactiveError(`料批 ${inactive.batchNo}（${inactive.material}）已停用，不能再领浆`)

    // 事务内重算余量，避免使用标签页内可能过期的缓存
    const ledgerEntries = await db.stockLedger.where('batchId').anyOf(batchIds).toArray()
    const balances = sumBalances(ledgerEntries)

    const batchLines: RunBatchLine[] = allocateConsumption(
      validLines.map((line) => {
        const batch = batchById.get(line.batchId)!
        return { batchId: line.batchId, feedKg: line.feedKg, batchSnapshot: { batchNo: batch.batchNo, material: batch.material } }
      }),
      totalConsumptionKg,
    )

    for (const line of batchLines) {
      const available = balances.get(line.batchId) ?? 0
      if (line.consumedKg > available + 1e-6) {
        const batch = batchById.get(line.batchId)!
        throw new StockInsufficientError(`料批 ${batch.batchNo}（${batch.material}）余量仅 ${available.toFixed(3)} kg，本槽需分摊 ${line.consumedKg.toFixed(3)} kg`)
      }
    }

    const runId = await db.sheetRuns.add(plain({ ...run, batchLines, frozen: false, schemaRev: 3 }))
    const created: SheetRun = { ...run, batchLines, frozen: false, schemaRev: 3, id: Number(runId) }

    await db.stockLedger.bulkAdd(
      plain(
        batchLines.map<Omit<StockLedgerEntry, 'id'>>((line) => ({
          batchId: line.batchId,
          batchNo: line.batchSnapshot.batchNo,
          material: line.batchSnapshot.material,
          type: '领用',
          amountKg: line.consumedKg,
          runId: Number(runId),
          runNo: run.runNo,
          clientToken,
          createdAt: nowIso,
          schemaRev: 3,
        })),
      ),
    )

    // 成功扣料后推进各料批版本号；版本号由锁内最后一次读取兜底校验
    await Promise.all(
      batches.map(async (batch) => {
        const updated = await db.fiberBatches.update(batch.id!, {
          stockVersion: batch.stockVersion + 1,
        })
        if (updated === 0) throw new StockConflictError(`料批 ${batch.batchNo} 刚被其它标签页改动，请重试`)
      }),
    )

    return { run: created, duplicated: false }
  })
}

/** 登记料批并写建批首笔入库流水（余量由流水汇总，资料本身不存余量） */
export async function createFiberBatch(input: FiberBatchInput): Promise<FiberBatch> {
  return withStockLock(async () =>
    db.transaction('rw', db.fiberBatches, db.stockLedger, async () => {
      const id = Number(await db.fiberBatches.add(plain({
        batchNo: input.batchNo,
        material: input.material,
        origin: input.origin,
        cookAgent: input.cookAgent,
        cookHours: input.cookHours,
        bleachMethod: input.bleachMethod,
        beatingDegree: input.beatingDegree,
        operator: input.operator,
        state: '在用',
        stockVersion: 0,
        schemaRev: 3,
      })))
      if (input.initialAmountKg > 0) {
        await db.stockLedger.add(plain({
          batchId: id,
          batchNo: input.batchNo,
          material: input.material,
          type: '入库',
          amountKg: input.initialAmountKg,
          source: '建批初始投料',
          clientToken: `in:batch:${id}`,
          createdAt: new Date().toISOString(),
          schemaRev: 3,
        }))
      }
      return {
        batchNo: input.batchNo,
        material: input.material,
        origin: input.origin,
        cookAgent: input.cookAgent,
        cookHours: input.cookHours,
        bleachMethod: input.bleachMethod,
        beatingDegree: input.beatingDegree,
        operator: input.operator,
        state: '在用',
        stockVersion: 0,
        schemaRev: 3,
        id,
      }
    }),
  )
}

/**
 * 停用/启用料批，并重新计算受影响工序与成纸样本的冻结状态。
 * 只冻结确实用到该料批的工序；样本随其工序冻结。
 */
export async function setBatchState(batchId: number, state: FiberBatchState): Promise<void> {
  await withStockLock(async () =>
    db.transaction('rw', db.fiberBatches, db.sheetRuns, db.paperSamples, async () => {
      const batch = await db.fiberBatches.get(batchId)
      if (!batch) return
      await db.fiberBatches.update(batchId, { state, schemaRev: 3 })

      const [allBatches, allRuns] = await Promise.all([db.fiberBatches.toArray(), db.sheetRuns.toArray()])
      const inactiveIds = new Set(allBatches.filter((item) => item.state === '停用').map((item) => item.id!))
      const affected = allRuns.filter((item) => runUsesBatch(item, batchId))
      if (affected.length === 0) return

      const nextRuns = affected.map((item) => ({
        ...item,
        frozen: item.batchLines?.some((line) => inactiveIds.has(line.batchId)) ?? false,
        schemaRev: 3,
      }))
      await db.sheetRuns.bulkPut(plain(nextRuns))

      const frozenRunIds = nextRuns.filter((item) => item.frozen).map((item) => item.id!)
      const affectedRunIds = nextRuns.map((item) => item.id!)
      const samples = await db.paperSamples.where('runId').anyOf(affectedRunIds).toArray()
      const nextSamples = samples.map((sample) => ({
        ...sample,
        frozen: frozenRunIds.includes(sample.runId),
        schemaRev: 3,
      }))
      if (nextSamples.length) await db.paperSamples.bulkPut(plain(nextSamples))
    }),
  )
}
