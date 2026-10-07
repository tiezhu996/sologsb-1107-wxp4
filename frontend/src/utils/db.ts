import Dexie, { type Table } from 'dexie'
import type { FiberBatch } from '../types/fiber-batch'
import type { Mould } from '../types/mould'
import type { PaperSample } from '../types/paper-sample'
import type { PulpFeed } from '../types/pulp-feed'
import type { RunFeedInput, SheetRun } from '../types/sheet-run'
import { allocateConsumption, roundKg, vatConsumptionKg } from './pulp'
import { calculateDeviation, calculateMeshDensity } from './stripe'

export const SCHEMA_REV = 3

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
  { id: 1, batchNo: 'XW-2601', material: '构皮', origin: '陕西洋县华阳镇', cookAgent: '石灰', cookHours: 9, bleachMethod: '日晒', beatingDegree: 32, operator: '罗青禾', status: '在用', schemaRev: SCHEMA_REV },
  { id: 2, batchNo: 'XW-2602', material: '桑皮', origin: '安徽泾县小岭村', cookAgent: '纯碱', cookHours: 7, bleachMethod: '日晒', beatingDegree: 38, operator: '汪知远', status: '在用', schemaRev: SCHEMA_REV },
  { id: 3, batchNo: 'XW-2603', material: '竹麻', origin: '四川夹江马村镇', cookAgent: '石灰', cookHours: 11, bleachMethod: '漂白粉', beatingDegree: 27, operator: '郭文山', status: '在用', schemaRev: SCHEMA_REV },
  { id: 4, batchNo: 'XW-2604', material: '稻草', origin: '浙江富阳大源镇', cookAgent: '纯碱', cookHours: 6, bleachMethod: '日晒', beatingDegree: 24, operator: '蒋允中', status: '在用', schemaRev: SCHEMA_REV },
  { id: 5, batchNo: 'XW-2605', material: '构皮', origin: '贵州丹寨石桥村', cookAgent: '石灰', cookHours: 8, bleachMethod: '漂白粉', beatingDegree: 35, operator: '罗青禾', status: '在用', schemaRev: SCHEMA_REV },
]

const gap1 = 1.1
const gap2 = 0.85
const gap3 = 1.0
const gap4 = 0.72
const seedRuns: SheetRun[] = [
  { id: 1, runNo: 'CB-260701', mouldId: 1, runDate: currentWeekDate(0), operator: '罗青禾', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 42, dryMethod: '火墙', grammage: 32, measuredGap: 1.08, deviation: calculateDeviation(1.08, gap1), frozen: false, schemaRev: SCHEMA_REV },
  { id: 2, runNo: 'CB-260702', mouldId: 2, runDate: currentWeekDate(1), operator: '汪知远', stripeDirection: '竖帘纹', dipCount: 1, stackHeight: 36, dryMethod: '火墙', grammage: 29, measuredGap: 0.84, deviation: calculateDeviation(0.84, gap2), frozen: false, schemaRev: SCHEMA_REV },
  { id: 3, runNo: 'CB-260703', mouldId: 3, runDate: currentWeekDate(2), operator: '郭文山', stripeDirection: '横帘纹', dipCount: 2, stackHeight: 48, dryMethod: '日晒', grammage: 41, measuredGap: 1.03, deviation: calculateDeviation(1.03, gap3), frozen: false, schemaRev: SCHEMA_REV },
  { id: 4, runNo: 'CB-260704', mouldId: 1, runDate: daysAgo(3), operator: '罗青禾', stripeDirection: '竖帘纹', dipCount: 3, stackHeight: 55, dryMethod: '火墙', grammage: 36, measuredGap: 1.36, deviation: calculateDeviation(1.36, gap1), frozen: false, schemaRev: SCHEMA_REV },
  { id: 5, runNo: 'CB-260705', mouldId: 2, runDate: daysAgo(6), operator: '蒋允中', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 44, dryMethod: '日晒', grammage: 46, measuredGap: 0.82, deviation: calculateDeviation(0.82, gap2), frozen: false, schemaRev: SCHEMA_REV },
  { id: 6, runNo: 'CB-260706', mouldId: 3, runDate: daysAgo(10), operator: '汪知远', stripeDirection: '竖帘纹', dipCount: 1, stackHeight: 31, dryMethod: '火墙', grammage: 27, measuredGap: 0.94, deviation: calculateDeviation(0.94, gap3), frozen: false, schemaRev: SCHEMA_REV },
  { id: 7, runNo: 'CB-260707', mouldId: 4, runDate: daysAgo(17), operator: '林砚秋', stripeDirection: '横帘纹', dipCount: 2, stackHeight: 39, dryMethod: '日晒', grammage: 34, measuredGap: 1.5, deviation: calculateDeviation(1.5, 1.25), frozen: false, schemaRev: SCHEMA_REV },
  { id: 8, runNo: 'CB-260708', mouldId: 5, runDate: daysAgo(24), operator: '郭文山', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 46, dryMethod: '火墙', grammage: 44, measuredGap: 0.71, deviation: calculateDeviation(0.71, gap4), frozen: false, schemaRev: SCHEMA_REV },
]

/** 各槽投料：首槽构皮、桑皮按比例合槽，其余单批 */
const seedRunFeeds: Record<number, RunFeedInput[]> = {
  1: [{ batchId: 1, feedKg: 5 }, { batchId: 2, feedKg: 3 }],
  2: [{ batchId: 2, feedKg: 4 }],
  3: [{ batchId: 3, feedKg: 6 }],
  4: [{ batchId: 5, feedKg: 5 }],
  5: [{ batchId: 4, feedKg: 4 }],
  6: [{ batchId: 2, feedKg: 3 }],
  7: [{ batchId: 1, feedKg: 4 }],
  8: [{ batchId: 3, feedKg: 6 }],
}

const seedSamples: PaperSample[] = [
  { id: 1, sampleNo: 'YZ-01', runId: 1, sizeMm: 210, stripeCount: 46, evenness: '均匀', archiveBin: '甲柜-03', frozen: false, schemaRev: SCHEMA_REV },
  { id: 2, sampleNo: 'YZ-02', runId: 2, sizeMm: 180, stripeCount: 52, evenness: '略花', archiveBin: '甲柜-07', frozen: false, schemaRev: SCHEMA_REV },
  { id: 3, sampleNo: 'YZ-03', runId: 3, sizeMm: 240, stripeCount: 39, evenness: '花', archiveBin: '乙柜-02', frozen: false, schemaRev: SCHEMA_REV },
  { id: 4, sampleNo: 'YZ-04', runId: 4, sizeMm: 210, stripeCount: 31, evenness: '略花', archiveBin: '乙柜-05', frozen: false, schemaRev: SCHEMA_REV },
  { id: 5, sampleNo: 'YZ-05', runId: 5, sizeMm: 200, stripeCount: 48, evenness: '均匀', archiveBin: '甲柜-11', frozen: false, schemaRev: SCHEMA_REV },
  { id: 6, sampleNo: 'YZ-06', runId: 6, sizeMm: 260, stripeCount: 57, evenness: '均匀', archiveBin: '丙柜-01', frozen: false, schemaRev: SCHEMA_REV },
]

interface VatFeedContext {
  mouldById: Map<number, Mould>
  batchById: Map<number, FiberBatch>
  feedNoFor: (runId: number, batchId: number) => string
}

/** 由工序 + 投料清单生成合槽投料记录（批次编号与原料取登记时快照） */
function buildVatFeeds(run: SheetRun, feeds: RunFeedInput[], context: VatFeedContext): PulpFeed[] {
  const mould = context.mouldById.get(run.mouldId)
  const totalKg = vatConsumptionKg(run.grammage, mould?.frameW ?? 0, mould?.frameH ?? 0, run.stackHeight)
  const runId = run.id ?? 0
  return allocateConsumption(totalKg, feeds).map((allocation) => {
    const batch = context.batchById.get(allocation.batchId)
    return {
      feedNo: context.feedNoFor(runId, allocation.batchId),
      kind: '合槽' as const,
      batchId: allocation.batchId,
      batchNo: batch?.batchNo ?? `批次${allocation.batchId}`,
      material: batch?.material ?? '构皮',
      runId,
      runNo: run.runNo,
      feedKg: allocation.feedKg,
      sharePct: allocation.sharePct,
      consumedKg: allocation.consumedKg,
      createdAt: run.runDate,
      schemaRev: SCHEMA_REV,
    }
  })
}

/** 按已耗补入库记录，使旧数据余量有合理起点 */
function buildStockFeeds(batches: FiberBatch[], vatFeeds: PulpFeed[], feedNoFor: (batchId: number) => string): PulpFeed[] {
  const consumedByBatch = new Map<number, number>()
  for (const feed of vatFeeds) {
    consumedByBatch.set(feed.batchId, roundKg((consumedByBatch.get(feed.batchId) ?? 0) + feed.consumedKg))
  }
  return batches.map((batch) => {
    const batchId = batch.id ?? 0
    const consumed = consumedByBatch.get(batchId) ?? 0
    return {
      feedNo: feedNoFor(batchId),
      kind: '入库' as const,
      batchId,
      batchNo: batch.batchNo,
      material: batch.material,
      feedKg: Number((consumed + 150).toFixed(1)),
      sharePct: 100,
      consumedKg: 0,
      createdAt: daysAgo(30),
      schemaRev: SCHEMA_REV,
    }
  })
}

export class GbPaperMillDatabase extends Dexie {
  moulds!: Table<Mould, number>
  fiberBatches!: Table<FiberBatch, number>
  sheetRuns!: Table<SheetRun, number>
  paperSamples!: Table<PaperSample, number>
  pulpFeeds!: Table<PulpFeed, number>

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
      fiberBatches: '++id,&batchNo,material,beatingDegree,status,schemaRev',
      sheetRuns: '++id,&runNo,mouldId,runDate,operator,schemaRev',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount,schemaRev',
      pulpFeeds: '++id,&feedNo,kind,batchId,runId,schemaRev',
    }).upgrade(async (transaction) => {
      const mouldTable = transaction.table('moulds')
      const batchTable = transaction.table('fiberBatches')
      const runTable = transaction.table('sheetRuns')
      const sampleTable = transaction.table('paperSamples')
      const feedTable = transaction.table('pulpFeeds')

      const moulds = (await mouldTable.toArray()) as Mould[]
      const batches = (await batchTable.toArray()) as FiberBatch[]
      const context: VatFeedContext = {
        mouldById: new Map(moulds.map((mould) => [mould.id ?? 0, mould])),
        batchById: new Map(batches.map((batch) => [batch.id ?? 0, batch])),
        feedNoFor: (runId, batchId) => `PF-MIG-${runId}-${batchId}`,
      }

      // 旧数据按原单批补来源记录：每条旧工序补一条 100% 合槽投料记录
      const legacyRuns = (await runTable.toArray()) as Array<SheetRun & { batchId?: number }>
      const migratedVatFeeds: PulpFeed[] = []
      for (const run of legacyRuns) {
        if (typeof run.batchId === 'number') {
          migratedVatFeeds.push(...buildVatFeeds(run, [{ batchId: run.batchId, feedKg: 1 }], context))
        }
      }
      const stockFeeds = buildStockFeeds(batches, migratedVatFeeds, (batchId) => `PF-MIG-STOCK-${batchId}`)
      await feedTable.bulkAdd(plain([...stockFeeds, ...migratedVatFeeds]))

      await batchTable.toCollection().modify((value: Record<string, unknown>) => {
        value.status = value.status ?? '在用'
        value.schemaRev = SCHEMA_REV
      })
      await runTable.toCollection().modify((value: Record<string, unknown>) => {
        delete value.batchId
        value.frozen = false
        value.schemaRev = SCHEMA_REV
      })
      await sampleTable.toCollection().modify((value: Record<string, unknown>) => {
        value.frozen = false
        value.schemaRev = SCHEMA_REV
      })
      await mouldTable.toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = SCHEMA_REV
      })
    })
    this.on('populate', () => this.seed())
  }

  private async seed(): Promise<void> {
    await this.moulds.bulkAdd(plain(seedMoulds))
    await this.fiberBatches.bulkAdd(plain(seedBatches))
    await this.sheetRuns.bulkAdd(plain(seedRuns))
    await this.paperSamples.bulkAdd(plain(seedSamples))
    const context: VatFeedContext = {
      mouldById: new Map(seedMoulds.map((mould) => [mould.id ?? 0, mould])),
      batchById: new Map(seedBatches.map((batch) => [batch.id ?? 0, batch])),
      feedNoFor: (runId, batchId) => `PF-SEED-${runId}-${batchId}`,
    }
    const vatFeeds = seedRuns.flatMap((run) => buildVatFeeds(run, seedRunFeeds[run.id ?? 0] ?? [], context))
    const stockFeeds = buildStockFeeds(seedBatches, vatFeeds, (batchId) => `PF-SEED-STOCK-${batchId}`)
    await this.pulpFeeds.bulkAdd(plain([...stockFeeds, ...vatFeeds]))
  }
}

export const db = new GbPaperMillDatabase()
