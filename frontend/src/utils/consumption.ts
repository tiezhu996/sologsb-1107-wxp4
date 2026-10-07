import type { RunBatchLine } from '../types/sheet-run'

export interface AllocationInput {
  /** 克重 g/m² */
  grammage: number
  /** 帘框宽（cm） */
  frameW: number
  /** 帘框高（cm） */
  frameH: number
  /** 叠高（张） */
  stackHeight: number
}

/**
 * 本槽总用纸量（kg）。
 * 单张面积（cm² → m²）× 叠高 = 总面积；克重（g/m²）× 面积 = 克，再换算 kg。
 */
export function calculateTotalConsumptionKg({ grammage, frameW, frameH, stackHeight }: AllocationInput): number {
  const areaM2 = (frameW * frameH) / 10000
  return Number(((grammage * areaM2 * stackHeight) / 1000).toFixed(3))
}

/**
 * 按各行投料量比例，把本槽总消耗分摊到各批浆。
 * 最后一行承担四舍五入残差，保证各行之和等于总消耗。
 */
export function allocateConsumption(lines: Array<Pick<RunBatchLine, 'batchId' | 'feedKg' | 'batchSnapshot'>>, totalKg: number): RunBatchLine[] {
  const totalFeed = lines.reduce((sum, line) => sum + (Number.isFinite(line.feedKg) ? line.feedKg : 0), 0)
  if (totalFeed <= 0) {
    return lines.map((line) => ({ ...line, consumedKg: 0 }))
  }
  let assigned = 0
  return lines.map((line, index) => {
    const consumedKg = index === lines.length - 1
      ? Number((totalKg - assigned).toFixed(3))
      : Number(((totalKg * line.feedKg) / totalFeed).toFixed(3))
    assigned += consumedKg
    return { ...line, consumedKg }
  })
}
