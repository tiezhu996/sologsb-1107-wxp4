import Dexie, { type Table } from 'dexie'
import type { FiberBatch } from '../types/fiber-batch'
import type { Mould } from '../types/mould'
import type { PaperSample } from '../types/paper-sample'
import type { RunBatchLine, SheetRun } from '../types/sheet-run'
import type { StockLedgerEntry } from '../types/stock-ledger'
import { allocateConsumption, calculateTotalConsumptionKg } from './consumption'
import { calculateDeviation, calculateMeshDensity } from './stripe'

export const SCHEMA_REV = 3
export const STOCK_LOCK_NAME = 'gbpapermill-fiber-stock'

export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function currentWeekDate(dayOffset: number): string {
  const date = new Date()
  const day = date.getDay()
  const mondayDistance = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + mondayDistance + dayOffset)
  return date.toISOString().slice(0, 10)
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

const seedMoulds: Mould[] = [
  { id: 1, mouldNo: 'DL-01', frameW: 60, frameH: 90, wireMaterial: '竹丝', wireDiameter: 0.3, stripeGap: 1.1, meshDensity: calculateMeshDensity(0.3, 1.1), weaver: '周守良', state: '在用', schemaRev: SCHEMA_REV },
  { id: 2, mouldNo: 'DL-02', frameW: 55, frameH: 82, wireMaterial: '铜丝', wireDiameter: 0.2, stripeGap: 0.85, meshDensity: calculateMeshDensity(0.2, 0.85), weaver: '沈云舟', state: '在用', schemaRev: SCHEMA_REV },
  { id: 3, mouldNo: 'DL-03', frameW: 72, frameH: 105, wireMaterial: '竹丝', wireDiameter: 0.28, stripeGap: 1.0, meshDensity: calculateMeshDensity(0.28, 1), weaver: '周守良', state: '在用', schemaRev: SCHEMA_REV },
  { id: 4, mouldNo: 'DL-04', frameW: 50, frameH: 76, wireMaterial: '马尾丝', wireDiameter: 0.32, stripeGap: 1.25, meshDensity: calculateMeshDensity(0.32, 1.25), weaver: '林砚秋', state: '待修补', schemaRev: SCHEMA_REV },
  { id: 5, mouldNo: 'DL-05', frameW: 65, frameH: 96, wireMaterial: '铜丝', wireDiameter: 0.18, stripeGap: 0.72, meshDensity: calculateMeshDensity(0.18, 0.72), weaver: '沈云舟', state: '退役', schemaRev: SCHEMA_REV },
]

const seedBatches: FiberBatch[] = [
  { id: 1, batchNo: 'XW-2601', material: '构皮', origin: '陕西洋县华阳镇', cookAgent: '石灰', cookHours: 9, bleachMethod: '日晒', beatingDegree: 32, operator: '罗青禾', state: '在用', stockVersion: 0, schemaRev: SCHEMA_REV },
  { id: 2, batchNo: 'XW-2602', material: '桑皮', origin: '安徽泾县小岭村', cookAgent: '纯碱', cookHours: 7, bleachMethod: '日晒', beatingDegree: 38, operator: '汪知远', state: '在用', stockVersion: 0, schemaRev: SCHEMA_REV },
  { id: 3, batchNo: 'XW-2603', material: '竹麻', origin: '四川夹江马村镇', cookAgent: '石灰', cookHours: 11, bleachMethod: '漂白粉', beatingDegree: 27, operator: '郭文山', state: '在用', stockVersion: 0, schemaRev: SCHEMA_REV },
  { id: 4, batchNo: 'XW-2604', material: '稻草', origin: '浙江富阳大源镇', cookAgent: '纯碱', cookHours: 6, bleachMethod: '日晒', beatingDegree: 24, operator: '蒋允中', state: '在用', stockVersion: 0, schemaRev: SCHEMA_REV },
  { id: 5, batchNo: 'XW-2605', material: '构皮', origin: '贵州丹寨石桥村', cookAgent: '石灰', cookHours: 8, bleachMethod: '漂白粉', beatingDegree: 35, operator: '罗青禾', state: '在用', stockVersion: 0, schemaRev: SCHEMA_REV },
]

/** 建批首笔入库量（kg） */
const seedInitialStock: Record<number, number> = { 1: 30, 2: 25, 3: 40, 4: 20, 5: 35 }

interface SeedRunSpec {
  id: number
  runNo: string
  mouldId: number
  /** 合槽投料：[料批 id, 投料量 kg]；旧槽按单批 1:1 补 */
  feeds: Array<[number, number]>
  runDate: string
  operator: string
  stripeDirection: '竖帘纹' | '横帘纹'
  dipCount: number
  stackHeight: number
  dryMethod: '火墙' | '日晒'
  grammage: number
  measuredGap: number
}

const gapById: Record<number, number> = { 1: 1.1, 2: 0.85, 3: 1.0, 4: 1.25, 5: 0.72 }

const seedRunSpecs: SeedRunSpec[] = [
  { id: 1, runNo: 'CB-260701', mouldId: 1, feeds: [[1, 8], [2, 4]], runDate: currentWeekDate(0), operator: '罗青禾', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 42, dryMethod: '火墙', grammage: 32, measuredGap: 1.08 },
  { id: 2, runNo: 'CB-260702', mouldId: 2, feeds: [[2, 7], [5, 3]], runDate: currentWeekDate(1), operator: '汪知远', stripeDirection: '竖帘纹', dipCount: 1, stackHeight: 36, dryMethod: '火墙', grammage: 29, measuredGap: 0.84 },
  { id: 3, runNo: 'CB-260703', mouldId: 3, feeds: [[3, 14]], runDate: currentWeekDate(2), operator: '郭文山', stripeDirection: '横帘纹', dipCount: 2, stackHeight: 48, dryMethod: '日晒', grammage: 41, measuredGap: 1.03 },
  { id: 4, runNo: 'CB-260704', mouldId: 1, feeds: [[5, 11]], runDate: daysAgo(3), operator: '罗青禾', stripeDirection: '竖帘纹', dipCount: 3, stackHeight: 55, dryMethod: '火墙', grammage: 36, measuredGap: 1.36 },
  { id: 5, runNo: 'CB-260705', mouldId: 2, feeds: [[4, 9]], runDate: daysAgo(6), operator: '蒋允中', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 44, dryMethod: '日晒', grammage: 46, measuredGap: 0.82 },
  { id: 6, runNo: 'CB-260706', mouldId: 3, feeds: [[2, 8]], runDate: daysAgo(10), operator: '汪知远', stripeDirection: '竖帘纹', dipCount: 1, stackHeight: 31, dryMethod: '火墙', grammage: 27, measuredGap: 0.94 },
  { id: 7, runNo: 'CB-260707', mouldId: 4, feeds: [[1, 7]], runDate: daysAgo(17), operator: '林砚秋', stripeDirection: '横帘纹', dipCount: 2, stackHeight: 39, dryMethod: '日晒', grammage: 34, measuredGap: 1.5 },
  { id: 8, runNo: 'CB-260708', mouldId: 5, feeds: [[3, 13]], runDate: daysAgo(24), operator: '郭文山', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 46, dryMethod: '火墙', grammage: 44, measuredGap: 0.71 },
]

function buildSeedData(): { runs: SheetRun[]; stock: StockLedgerEntry[] } {
  const mouldById = new Map(seedMoulds.map((mould) => [mould.id, mould]))
  const batchById = new Map(seedBatches.map((batch) => [batch.id!, batch]))
  const nowIso = new Date().toISOString()
  const runs: SheetRun[] = []
  const stock: StockLedgerEntry[] = []

  for (const batch of seedBatches) {
    stock.push({
      batchId: batch.id!,
      batchNo: batch.batchNo,
      material: batch.material,
      type: '入库',
      amountKg: seedInitialStock[batch.id!] ?? 0,
      source: '建批初始投料',
      clientToken: `seed-in:${batch.id}`,
      createdAt: nowIso,
      schemaRev: SCHEMA_REV,
    })
  }

  for (const spec of seedRunSpecs) {
    const mould = mouldById.get(spec.mouldId)!
    const totalKg = calculateTotalConsumptionKg({ grammage: spec.grammage, frameW: mould.frameW, frameH: mould.frameH, stackHeight: spec.stackHeight })
    const lines: RunBatchLine[] = allocateConsumption(
      spec.feeds.map(([batchId, feedKg]) => {
        const batch = batchById.get(batchId)!
        return { batchId, feedKg, batchSnapshot: { batchNo: batch.batchNo, material: batch.material } }
      }),
      totalKg,
    )
    runs.push({
      id: spec.id,
      runNo: spec.runNo,
      mouldId: spec.mouldId,
      batchId: spec.feeds.length === 1 ? spec.feeds[0][0] : undefined,
      batchLines: lines,
      runDate: spec.runDate,
      operator: spec.operator,
      stripeDirection: spec.stripeDirection,
      dipCount: spec.dipCount,
      stackHeight: spec.stackHeight,
      dryMethod: spec.dryMethod,
      grammage: spec.grammage,
      measuredGap: spec.measuredGap,
      deviation: calculateDeviation(spec.measuredGap, gapById[spec.mouldId]),
      frozen: false,
      schemaRev: SCHEMA_REV,
    })
    for (const line of lines) {
      stock.push({
        batchId: line.batchId,
        batchNo: line.batchSnapshot.batchNo,
        material: line.batchSnapshot.material,
        type: '领用',
        amountKg: line.consumedKg,
        runId: spec.id,
        runNo: spec.runNo,
        clientToken: `seed-run:${spec.id}:${line.batchId}`,
        createdAt: nowIso,
        schemaRev: SCHEMA_REV,
      })
    }
  }
  return { runs, stock }
}

const seedData = buildSeedData()

const seedSamples: PaperSample[] = [
  { id: 1, sampleNo: 'YZ-01', runId: 1, sizeMm: 210, stripeCount: 46, evenness: '均匀', archiveBin: '甲柜-03', frozen: false, schemaRev: SCHEMA_REV },
  { id: 2, sampleNo: 'YZ-02', runId: 2, sizeMm: 180, stripeCount: 52, evenness: '略花', archiveBin: '甲柜-07', frozen: false, schemaRev: SCHEMA_REV },
  { id: 3, sampleNo: 'YZ-03', runId: 3, sizeMm: 240, stripeCount: 39, evenness: '花', archiveBin: '乙柜-02', frozen: false, schemaRev: SCHEMA_REV },
  { id: 4, sampleNo: 'YZ-04', runId: 4, sizeMm: 210, stripeCount: 31, evenness: '略花', archiveBin: '乙柜-05', frozen: false, schemaRev: SCHEMA_REV },
  { id: 5, sampleNo: 'YZ-05', runId: 5, sizeMm: 200, stripeCount: 48, evenness: '均匀', archiveBin: '甲柜-11', frozen: false, schemaRev: SCHEMA_REV },
  { id: 6, sampleNo: 'YZ-06', runId: 6, sizeMm: 260, stripeCount: 57, evenness: '均匀', archiveBin: '丙柜-01', frozen: false, schemaRev: SCHEMA_REV },
]

/** 判断工序是否确实用到某批浆（兼容旧单批字段与多批明细） */
export function runUsesBatch(run: SheetRun, batchId: number): boolean {
  if (run.batchLines?.some((line) => line.batchId === batchId)) return true
  return run.batchId === batchId
}

class GbPaperMillDatabase extends Dexie {
  moulds!: Table<Mould, number>
  fiberBatches!: Table<FiberBatch, number>
  sheetRuns!: Table<SheetRun, number>
  paperSamples!: Table<PaperSample, number>
  stockLedger!: Table<StockLedgerEntry, number>

  constructor() {
    super('gbpapermill-db')
    this.version(1).stores({
      moulds: '++id,&mouldNo,state,wireMaterial',
      fiberBatches: '++id,&batchNo,material,beatingDegree',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount',
    })
    this.version(2).stores({
      moulds: '++id,&mouldNo,state,wireMaterial,schemaRev',
      fiberBatches: '++id,&batchNo,material,beatingDegree,schemaRev',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator,schemaRev',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount,schemaRev',
    }).upgrade(async (transaction) => {
      await transaction.table('moulds').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = 2
      })
      await transaction.table('fiberBatches').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = 2
      })
      await transaction.table('sheetRuns').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = 2
      })
      await transaction.table('paperSamples').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = 2
      })
    })
    this.version(3).stores({
      moulds: '++id,&mouldNo,state,wireMaterial,schemaRev',
      fiberBatches: '++id,&batchNo,material,beatingDegree,state,schemaRev',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator,frozen,schemaRev',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount,frozen,schemaRev',
      stockLedger: '++id,batchId,runId,clientToken,type,schemaRev',
    }).upgrade(async (transaction) => {
      const batchRows = await transaction.table<FiberBatch, number>('fiberBatches').toArray()
      const mouldRows = await transaction.table<Mould, number>('moulds').toArray()
      const legacyRuns = await transaction.table<SheetRun, number>('sheetRuns').toArray()
      const batchMap = new Map(batchRows.map((batch) => [batch.id, batch]))
      const mouldMap = new Map(mouldRows.map((mould) => [mould.id, mould]))
      const nowIso = new Date().toISOString()

      // 料批增加状态与乐观版本号
      await transaction.table('fiberBatches').toCollection().modify((batch: Record<string, unknown>) => {
        batch.state = '在用'
        batch.stockVersion = 0
        batch.schemaRev = SCHEMA_REV
      })

      // 旧工序按原单批补多批明细，并据克重 × 帘框面积 × 叠高补回该行消耗
      const inboundByBatch = new Map<number, number>()
      const stockRows: Array<Omit<StockLedgerEntry, 'id'>> = []
      const migratedRuns: SheetRun[] = []
      for (const run of legacyRuns) {
        const migrated: SheetRun = { ...run, frozen: false, schemaRev: SCHEMA_REV }
        const legacyBatchId = run.batchId
        if (legacyBatchId != null && !Array.isArray(run.batchLines)) {
          const batch = batchMap.get(legacyBatchId)
          const mould = mouldMap.get(run.mouldId)
          const consumedKg = mould
            ? calculateTotalConsumptionKg({ grammage: run.grammage, frameW: mould.frameW, frameH: mould.frameH, stackHeight: run.stackHeight })
            : 0
          migrated.batchLines = [{
            batchId: legacyBatchId,
            // 旧单批槽按 1:1 补：投料量即其分摊到的全部消耗
            feedKg: consumedKg,
            batchSnapshot: { batchNo: batch?.batchNo ?? '历史料批', material: batch?.material ?? '构皮' },
            consumedKg,
          }]
          inboundByBatch.set(legacyBatchId, (inboundByBatch.get(legacyBatchId) ?? 0) + consumedKg)
          stockRows.push({
            batchId: legacyBatchId,
            batchNo: batch?.batchNo ?? '历史料批',
            material: batch?.material ?? '构皮',
            type: '领用',
            amountKg: consumedKg,
            runId: run.id,
            runNo: run.runNo,
            clientToken: `legacy-run:${run.id}:${legacyBatchId}`,
            createdAt: nowIso,
            schemaRev: SCHEMA_REV,
          })
        } else if (!Array.isArray(migrated.batchLines)) {
          migrated.batchLines = []
        }
        migratedRuns.push(migrated)
      }
      await transaction.table<SheetRun, number>('sheetRuns').bulkPut(migratedRuns)

      // 旧数据按原单批补来源（入库）记录，入库量等于历史领用汇总，迁移后余量恰为 0
      for (const [batchId, amountKg] of inboundByBatch) {
        const batch = batchMap.get(batchId)
        stockRows.push({
          batchId,
          batchNo: batch?.batchNo ?? '历史料批',
          material: batch?.material ?? '构皮',
          type: '入库',
          amountKg: Number(amountKg.toFixed(3)),
          source: '旧数据迁移：按原单批补来源记录',
          clientToken: `legacy-in:${batchId}`,
          createdAt: nowIso,
          schemaRev: SCHEMA_REV,
        })
      }
      if (stockRows.length) {
        await transaction.table('stockLedger').bulkAdd(stockRows)
      }

      await transaction.table('paperSamples').toCollection().modify((sample: Record<string, unknown>) => {
        sample.frozen = false
        sample.schemaRev = SCHEMA_REV
      })
    })
    this.on('populate', () => this.seed())
  }

  private async seed(): Promise<void> {
    await this.moulds.bulkAdd(plain(seedMoulds))
    await this.fiberBatches.bulkAdd(plain(seedBatches))
    await this.sheetRuns.bulkAdd(plain(seedData.runs))
    await this.paperSamples.bulkAdd(plain(seedSamples))
    await this.stockLedger.bulkAdd(plain(seedData.stock))
  }
}

export const db = new GbPaperMillDatabase()
