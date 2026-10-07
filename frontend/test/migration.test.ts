import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'

// 先按旧 v2 结构建库（旧单批字段 batchId，无 batchLines / 流水表）
interface LegacyBatch { id?: number; batchNo: string; material: string; beatingDegree: number; schemaRev: number }
interface LegacyMould { id?: number; mouldNo: string; frameW: number; frameH: number; state: string; schemaRev: number }
interface LegacyRun { id?: number; runNo: string; mouldId: number; batchId: number; runDate: string; operator: string; stripeDirection: string; dipCount: number; stackHeight: number; dryMethod: string; grammage: number; measuredGap: number; deviation: number; schemaRev: number }
interface LegacySample { id?: number; sampleNo: string; runId: number; sizeMm: number; stripeCount: number; evenness: string; archiveBin: string; schemaRev: number }

class LegacyDb extends Dexie {
  moulds!: Table<LegacyMould, number>
  fiberBatches!: Table<LegacyBatch, number>
  sheetRuns!: Table<LegacyRun, number>
  paperSamples!: Table<LegacySample, number>
  constructor() {
    super('gbpapermill-db')
    this.version(1).stores({
      moulds: '++id,&mouldNo,state',
      fiberBatches: '++id,&batchNo,material,beatingDegree',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount',
    })
    this.version(2).stores({
      moulds: '++id,&mouldNo,state,wireMaterial,schemaRev',
      fiberBatches: '++id,&batchNo,material,beatingDegree,schemaRev',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator,schemaRev',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount,schemaRev',
    })
  }
}

const legacy = new LegacyDb()
await legacy.moulds.bulkAdd([
  { id: 1, mouldNo: 'DL-01', frameW: 60, frameH: 90, state: '在用', schemaRev: 2 },
])
await legacy.fiberBatches.bulkAdd([
  { id: 1, batchNo: 'XW-2601', material: '构皮', beatingDegree: 32, schemaRev: 2 },
  { id: 2, batchNo: 'XW-2602', material: '桑皮', beatingDegree: 38, schemaRev: 2 },
])
// 克重 32、面积 0.6*0.9=0.54m²、叠高 42 → 32*0.54*42/1000 = 0.72576 kg
await legacy.sheetRuns.bulkAdd([
  { id: 1, runNo: 'CB-OLD-1', mouldId: 1, batchId: 1, runDate: '2026-09-01', operator: '罗', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 42, dryMethod: '火墙', grammage: 32, measuredGap: 1.08, deviation: -0.02, schemaRev: 2 },
  { id: 2, runNo: 'CB-OLD-2', mouldId: 1, batchId: 2, runDate: '2026-09-02', operator: '汪', stripeDirection: '竖帘纹', dipCount: 1, stackHeight: 10, dryMethod: '日晒', grammage: 20, measuredGap: 1.1, deviation: 0, schemaRev: 2 },
])
await legacy.paperSamples.bulkAdd([
  { id: 1, sampleNo: 'YZ-OLD', runId: 1, sizeMm: 210, stripeCount: 46, evenness: '均匀', archiveBin: '甲柜', schemaRev: 2 },
])
await dbDone()
async function dbDone() { await legacy.close() }

// 打开新版库，触发 v3 upgrade
const { db } = await import('../src/utils/db')
const runs = await db.sheetRuns.orderBy('id').toArray()
const batches = await db.fiberBatches.orderBy('id').toArray()
const samples = await db.paperSamples.toArray()
const stock = await db.stockLedger.orderBy('id').toArray()

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures += 1
}

check('旧工序补出 batchLines 单行', runs.length === 2 && runs.every((r) => Array.isArray(r.batchLines) && r.batchLines.length === 1))
const r1 = runs.find((r) => r.id === 1)!
check('旧工序分摊消耗=克重×面积×叠高', Math.abs(r1.batchLines[0].consumedKg - 0.726) < 0.001, `got ${r1.batchLines[0].consumedKg}`)
check('旧工序投料量回填=分摊量(单批1:1)', r1.batchLines[0].feedKg === r1.batchLines[0].consumedKg)
check('旧工序保留 batchId 留痕', r1.batchId === 1)
check('快照取原批号/原料', r1.batchLines[0].batchSnapshot.batchNo === 'XW-2601' && r1.batchLines[0].batchSnapshot.material === '构皮')
check('料批补状态与版本', batches.every((b) => b.state === '在用' && b.stockVersion === 0))
check('样本补 frozen=false', samples.every((s) => s.frozen === false))

const inbound = stock.filter((e) => e.type === '入库')
const outbound = stock.filter((e) => e.type === '领用')
check('每槽补一条领用流水', outbound.length === 2, `got ${outbound.length}`)
check('每个旧单批补一条来源入库', inbound.length === 2, `got ${inbound.length}`)
const { sumBalances } = await import('../src/utils/stock')
const balances = sumBalances(stock)
check('迁移后历史批余量为0', [...balances.values()].every((v) => Math.abs(v) < 1e-6), JSON.stringify([...balances.values()]))
check('入库来源标注旧数据迁移', inbound.every((e) => e.source?.includes('旧数据迁移')))

console.log(failures ? `\n${failures} FAILURES` : '\nALL MIGRATION TESTS PASSED')
process.exit(failures ? 1 : 0)
