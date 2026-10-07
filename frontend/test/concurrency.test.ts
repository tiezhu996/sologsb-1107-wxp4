import 'fake-indexeddb/auto'
import { db } from '../src/utils/db'
import { reserveRun, StockInsufficientError } from '../src/utils/stock'

// --- 用排他队列 polyfill Web Locks（浏览器里 navigator.locks 同名锁跨标签页互斥）---
let chain: Promise<unknown> = Promise.resolve()
const locksApi = {
  request(_name: string, _options: unknown, callback?: () => Promise<unknown>) {
    const fn = typeof _options === 'function' ? _options : callback!
    const run = chain.then(fn, fn)
    chain = run.catch(() => undefined)
    return run
  },
}
;(globalThis as { navigator?: unknown }).navigator = { locks: locksApi } as unknown

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures += 1
}

await db.open()
// 备料：清空，料批1只放 0.50kg
await db.stockLedger.clear()
await db.sheetRuns.clear()
const now = new Date().toISOString()
await db.stockLedger.add({
  batchId: 1, batchNo: 'XW-2601', material: '构皮', type: '入库',
  amountKg: 0.5, source: '并发备料', clientToken: 'race-seed', createdAt: now, schemaRev: 3,
})

const mkRun = (runNo: string) => ({
  runNo, mouldId: 1, runDate: '2026-10-07', operator: '竞', stripeDirection: '竖帘纹' as const,
  dipCount: 2, stackHeight: 10, dryMethod: '火墙' as const, grammage: 20, measuredGap: 1.1, deviation: 0,
})

// 两页“同时”提交，各需 0.50kg，库存仅 0.50kg
const results = await Promise.allSettled([
  reserveRun({ run: mkRun('CB-TAB-A'), draftLines: [{ batchId: 1, feedKg: 1 }], totalConsumptionKg: 0.5 }),
  reserveRun({ run: mkRun('CB-TAB-B'), draftLines: [{ batchId: 1, feedKg: 1 }], totalConsumptionKg: 0.5 }),
])
const fulfilled = results.filter((r) => r.status === 'fulfilled')
const rejected = results.filter((r) => r.status === 'rejected')
check('两页争抢恰好一方成功', fulfilled.length === 1, `fulfilled=${fulfilled.length}`)
check('另一方失败', rejected.length === 1, `rejected=${rejected.length}`)
const rejectedReason = rejected[0]?.status === 'rejected' ? rejected[0].reason : undefined
check('失败方为余量不足', rejectedReason instanceof StockInsufficientError, String(rejectedReason))

// 成功方扣料，库存归零，只一槽一流水
const balanceEntries = await db.stockLedger.where('batchId').equals(1).toArray()
const bal = balanceEntries.reduce((s, e) => s + (e.type === '入库' ? e.amountKg : -e.amountKg), 0)
check('抢占后库存归零（未被双扣）', Math.abs(bal) < 1e-9, `bal=${bal}`)
const allRuns = await db.sheetRuns.toArray()
const runCount = allRuns.filter((r) => r.batchLines?.some((l) => l.batchId === 1))
check('只成功一槽工序', runCount.length === 1 && ['CB-TAB-A', 'CB-TAB-B'].includes(runCount[0].runNo), runCount.map((r) => r.runNo).join(','))
const runLedger = (await db.stockLedger.toArray()).filter((e) => e.type === '领用')
check('成功槽只一条领用流水', runLedger.length === 1)

// 失败后整槽可重试：补料后用“失败方”的新工序号重试应成功
await db.stockLedger.add({
  batchId: 1, batchNo: 'XW-2601', material: '构皮', type: '入库',
  amountKg: 1.0, source: '补料重试', clientToken: 'race-refill', createdAt: now, schemaRev: 3,
})
const retry = await reserveRun({ run: mkRun('CB-TAB-RETRY'), draftLines: [{ batchId: 1, feedKg: 1 }], totalConsumptionKg: 0.5 })
check('整槽回退后可重试成功', Boolean(retry.run) && !retry.duplicated)

// 同页双击（相同工序号）幂等：连发两次，只扣一次
const before = (await db.stockLedger.where('batchId').equals(1).toArray()).reduce((s, e) => s + (e.type === '入库' ? e.amountKg : -e.amountKg), 0)
const [d1, d2] = await Promise.all([
  reserveRun({ run: mkRun('CB-DBL'), draftLines: [{ batchId: 1, feedKg: 1 }], totalConsumptionKg: 0.5 }),
  reserveRun({ run: mkRun('CB-DBL'), draftLines: [{ batchId: 1, feedKg: 1 }], totalConsumptionKg: 0.5 }),
])
const after = (await db.stockLedger.where('batchId').equals(1).toArray()).reduce((s, e) => s + (e.type === '入库' ? e.amountKg : -e.amountKg), 0)
check('双击第一次成功', d1.duplicated === false)
check('双击第二次识别为重复不再扣料', d2.duplicated === true)
check('双击只扣一份料', Math.abs((before - after) - 0.5) < 1e-9, `before=${before} after=${after}`)
const dblLedger = (await db.stockLedger.toArray()).filter((e) => e.runNo === 'CB-DBL')
check('双击只留一条领用流水', dblLedger.length === 1)

console.log(failures ? `\n${failures} FAILURES` : '\nALL CONCURRENCY TESTS PASSED')
process.exit(failures ? 1 : 0)
