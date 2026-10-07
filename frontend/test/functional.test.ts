import 'fake-indexeddb/auto'
import { db } from '../src/utils/db'
import { reserveRun, setBatchState, sumBalances, StockInsufficientError, EmptyRecipeError, BatchInactiveError } from '../src/utils/stock'
import type { FiberBatch } from '../src/types/fiber-batch'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures += 1
}

await db.open()
// 种子数据：料批1(构皮) 入库30；料批2(桑皮) 入库25；工序1 用料批1（纸帘1，0.54m²，42张，32g）
const batch1 = (await db.fiberBatches.get(1)) as FiberBatch
const ledger1 = await db.stockLedger.where('batchId').equals(1).toArray()
const seedConsumed1 = ledger1.filter((e) => e.type === '领用').reduce((s, e) => s + e.amountKg, 0)
const bal1AfterSeed = 30 - seedConsumed1
check('种子余料=入库-领用', Math.abs((sumBalances(ledger1).get(1) ?? NaN) - bal1AfterSeed) < 1e-6, `bal=${(sumBalances(ledger1).get(1) ?? NaN).toFixed(3)}`)

// 一槽合两批浆：构皮(1)投20kg、桑皮(2)投30kg；纸帘1 0.54m²，叠高100，克重100 → 总耗 5.4kg
const base = {
  runNo: 'CB-MULTI-1', mouldId: 1, runDate: '2026-10-07', operator: '测试工',
  stripeDirection: '竖帘纹' as const, dipCount: 2, stackHeight: 100, dryMethod: '火墙' as const,
  grammage: 100, measuredGap: 1.1, deviation: 0,
}
const res = await reserveRun({ run: base, draftLines: [{ batchId: 1, feedKg: 20 }, { batchId: 2, feedKg: 30 }], totalConsumptionKg: 5.4 })
check('多批合槽登记成功', res.run.batchLines.length === 2)
const l1 = res.run.batchLines.find((l) => l.batchId === 1)!
const l2 = res.run.batchLines.find((l) => l.batchId === 2)!
check('按投料比例分摊 2:3', Math.abs(l1.consumedKg - 2.16) < 0.001 && Math.abs(l2.consumedKg - 3.24) < 0.001, `${l1.consumedKg}/${l2.consumedKg}`)
check('各行之和=总消耗', Math.abs(l1.consumedKg + l2.consumedKg - 5.4) < 0.001)

const stockAll = await db.stockLedger.toArray()
const multiOut = stockAll.filter((e) => e.runNo === 'CB-MULTI-1')
check('本槽写两条领用流水', multiOut.length === 2 && multiOut.every((e) => e.type === '领用'))
check('流水带快照批号/原料', multiOut.every((e) => ['XW-2601', 'XW-2602'].includes(e.batchNo)))

// 幂等：同工序号再提交，不再次扣料
const stockCountBefore = (await db.stockLedger.toArray()).length
const balBatch2Before = sumBalances(await db.stockLedger.where('batchId').equals(2).toArray()).get(2)!
const dup = await reserveRun({ run: base, draftLines: [{ batchId: 1, feedKg: 20 }, { batchId: 2, feedKg: 30 }], totalConsumptionKg: 5.4 })
const stockCountAfter = (await db.stockLedger.toArray()).length
const balBatch2After = sumBalances(await db.stockLedger.where('batchId').equals(2).toArray()).get(2)!
check('重复提交标记 duplicated', dup.duplicated === true)
check('重复提交不新增流水', stockCountBefore === stockCountAfter)
check('重复提交不再次扣料', Math.abs(balBatch2Before - balBatch2After) < 1e-9)

// 余额不足：构造一槽需要远超市面余量的分摊（料批4 稻草仅20，且种子已扣）
const bal4 = sumBalances(await db.stockLedger.where('batchId').equals(4).toArray()).get(4)!
let insufficient = false
try {
  await reserveRun({
    run: { ...base, runNo: 'CB-FAIL-1', grammage: 400, stackHeight: 100 },
    draftLines: [{ batchId: 4, feedKg: 100 }],
    totalConsumptionKg: 21.6,
  })
} catch (e) {
  insufficient = e instanceof StockInsufficientError
}
check('余量不足抛错并整槽回退', insufficient, `余额 ${bal4.toFixed(2)}`)
const failedRun = await db.sheetRuns.where('runNo').equals('CB-FAIL-1').first()
check('回退后无工序残留', !failedRun)
const failedLedger = (await db.stockLedger.toArray()).filter((e) => e.runNo === 'CB-FAIL-1')
check('回退后无领用流水残留', failedLedger.length === 0)

// 空配方
let emptyErr = false
try {
  await reserveRun({ run: { ...base, runNo: 'CB-FAIL-2' }, draftLines: [], totalConsumptionKg: 1 })
} catch { emptyErr = true }
check('空配方被拒绝', emptyErr)

// 同一料批两行
let dupLine = false
try {
  await reserveRun({ run: { ...base, runNo: 'CB-FAIL-3' }, draftLines: [{ batchId: 1, feedKg: 5 }, { batchId: 1, feedKg: 3 }], totalConsumptionKg: 1 })
} catch (e) { dupLine = e instanceof EmptyRecipeError }
check('同批多行被拒绝', dupLine)

// 停用冻结：停用料批2（桑皮），只冻结含它的工序（种子工序2、6 与多批工序），样本随工序
await setBatchState(2, '停用')
const b2 = await db.fiberBatches.get(2)
check('料批状态=停用', b2?.state === '停用')
const runsAfter = await db.sheetRuns.toArray()
const uses2 = runsAfter.filter((r) => r.batchLines?.some((l) => l.batchId === 2))
const notUses2 = runsAfter.filter((r) => !(r.batchLines ?? []).some((l) => l.batchId === 2))
check('只冻结确实用到料批2的工序', uses2.length >= 2 && uses2.every((r) => r.frozen === true), `uses=${uses2.length}`)
check('未用料批2的工序不冻结', notUses2.every((r) => r.frozen === false))
const samplesAfter = await db.paperSamples.toArray()
const samplesOfFrozen = samplesAfter.filter((s) => uses2.some((r) => r.id === s.runId))
check('冻结工序的样本一并冻结', samplesOfFrozen.length >= 1 && samplesOfFrozen.every((s) => s.frozen === true), `n=${samplesOfFrozen.length}`)
check('非冻结工序样本不冻结', samplesAfter.filter((s) => !uses2.some((r) => r.id === s.runId)).every((s) => s.frozen === false))

// 停用批不能再领浆
let inactiveErr = false
try {
  await reserveRun({ run: { ...base, runNo: 'CB-FAIL-4' }, draftLines: [{ batchId: 2, feedKg: 1 }], totalConsumptionKg: 0.1 })
} catch (e) { inactiveErr = e instanceof BatchInactiveError }
check('停用批领浆被拒', inactiveErr)

// 重新启用后冻结解除
await setBatchState(2, '在用')
const runsRe = await db.sheetRuns.toArray()
check('重新启用后相关工序解冻', runsRe.filter((r) => (r.batchLines ?? []).some((l) => l.batchId === 2)).every((r) => r.frozen === false))
const samplesRe = await db.paperSamples.toArray()
check('重新启用后样本解冻', samplesRe.every((s) => s.frozen === false))

// 改料批资料不倒改历史配方快照
await db.fiberBatches.update(1, { batchNo: 'XW-RENAMED', material: '桑皮' })
const savedRun = await db.sheetRuns.get(res.run.id!)
const snap = savedRun!.batchLines.find((l) => l.batchId === 1)!.batchSnapshot
check('改料批资料不影响历史配方快照', snap.batchNo === 'XW-2601' && snap.material === '构皮', JSON.stringify(snap))

console.log(failures ? `\n${failures} FAILURES` : '\nALL FUNCTIONAL TESTS PASSED')
process.exit(failures ? 1 : 0)
