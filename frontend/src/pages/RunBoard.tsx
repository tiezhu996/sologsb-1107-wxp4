import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material'
import { ProcessTimeline, type ProcessStep } from '../components/common/ProcessTimeline'
import { RulerInput } from '../components/common/RulerInput'
import { useUnitConvert } from '../hooks/useUnitConvert'
import { useFiberStore } from '../stores/fiberStore'
import { useMouldStore } from '../stores/mouldStore'
import { useRunStore, type RunFormDraft } from '../stores/runStore'
import type { RunBatchLine } from '../types/sheet-run'
import { DRY_METHODS, STRIPE_DIRECTIONS, type DryMethod, type StripeDirection } from '../types/sheet-run'
import type { RunDraftLine } from '../utils/stock'
import { allocateConsumption, calculateTotalConsumptionKg } from '../utils/consumption'
import { calculateDeviation, getGapConclusion, isGapOutOfTolerance } from '../utils/stripe'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface RunFormState {
  runNo: string
  mouldId: number
  runDate: string
  operator: string
  stripeDirection: StripeDirection
  dipCount: number
  stackHeight: number
  dryMethod: DryMethod
  grammage: number
  measuredGap: number
  draftLines: RunDraftLine[]
}

function createEmptyForm(defaultMouldId: number, defaultBatchId: number): RunFormState {
  return {
    runNo: '',
    mouldId: defaultMouldId,
    runDate: todayIso(),
    operator: '罗青禾',
    stripeDirection: '竖帘纹',
    dipCount: 2,
    stackHeight: 42,
    dryMethod: '火墙',
    grammage: 32,
    measuredGap: 1.1,
    draftLines: [{ batchId: defaultBatchId, feedKg: 10 }],
  }
}

const processSteps: ProcessStep[] = [
  { label: '浆料复核', detail: '核对各料批打浆度、状态与合槽投料比例。', status: 'done' },
  { label: '帘床就位', detail: '确认纸帘方向与框架张力。', status: 'done' },
  { label: '入槽抄纸', detail: '按设定次数完成荡料与提帘。', status: 'active' },
  { label: '压榨定形', detail: '控制叠高后转火墙或日晒。', status: 'pending' },
  { label: '量纹偏差', detail: '实测间距并与纸帘标准值比较。', status: 'pending' },
]

export default function RunBoard() {
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const runNotice = useRunStore((state) => state.notice)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const addRun = useRunStore((state) => state.addRun)
  const clearNotice = useRunStore((state) => state.clearNotice)
  const updateMeasuredGap = useRunStore((state) => state.updateMeasuredGap)
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const batches = useFiberStore((state) => state.fiberBatches)
  const balances = useFiberStore((state) => state.balances)
  const batchError = useFiberStore((state) => state.error)
  const loadBatches = useFiberStore((state) => state.loadFiberBatches)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<RunFormState>(() => createEmptyForm(1, 1))
  const [dateFilter, setDateFilter] = useState('')
  const [mouldFilter, setMouldFilter] = useState('全部')
  const [draftGaps, setDraftGaps] = useState<Record<number, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const { formatGrammage, cmToMm } = useUnitConvert()

  useEffect(() => {
    void loadRuns()
    void loadMoulds()
    void loadBatches()
  }, [loadBatches, loadMoulds, loadRuns])

  const mouldById = useMemo(() => new Map(moulds.map((mould) => [mould.id, mould])), [moulds])
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches])
  const selectableBatches = useMemo(() => batches.filter((batch) => batch.state !== '停用'), [batches])

  const filteredRuns = useMemo(
    () => runs.filter((run) => {
      const mould = mouldById.get(run.mouldId)
      const matchesDate = !dateFilter || run.runDate === dateFilter
      const matchesMould = mouldFilter === '全部' || mould?.mouldNo === mouldFilter
      return matchesDate && matchesMould
    }),
    [dateFilter, mouldById, mouldFilter, runs],
  )
  const selectedMould = mouldById.get(form.mouldId) ?? moulds[0]
  const formDeviation = calculateDeviation(form.measuredGap, selectedMould?.stripeGap ?? form.measuredGap)
  const latestRun = runs[0]

  // 表单内实时分摊：克重 × 帘框面积 × 叠高，按各行投料量比例摊到各批浆
  const formTotalKg = useMemo(() => {
    if (!selectedMould) return 0
    return calculateTotalConsumptionKg({ grammage: form.grammage, frameW: selectedMould.frameW, frameH: selectedMould.frameH, stackHeight: form.stackHeight })
  }, [form.grammage, form.stackHeight, selectedMould])
  const formAllocation = useMemo(
    () => allocateConsumption(
      form.draftLines
        .filter((line) => line.batchId > 0 && line.feedKg > 0)
        .map((line) => {
          const batch = batchById.get(line.batchId)
          return { batchId: line.batchId, feedKg: line.feedKg, batchSnapshot: { batchNo: batch?.batchNo ?? '', material: batch?.material ?? '构皮' } }
        }),
      formTotalKg,
    ),
    [batchById, form.draftLines, formTotalKg],
  )

  const recipeProblems = useMemo(() => {
    const problems: string[] = []
    const valid = form.draftLines.filter((line) => line.batchId > 0)
    if (valid.length === 0 || valid.every((line) => line.feedKg <= 0)) problems.push('请至少填写一批浆的投料量')
    const ids = valid.map((line) => line.batchId)
    if (new Set(ids).size !== ids.length) problems.push('同一料批在一槽中只能登记一行')
    for (const line of formAllocation) {
      const batch = batchById.get(line.batchId)
      if (batch?.state === '停用') problems.push(`料批 ${batch.batchNo} 已停用`)
      const available = balances.get(line.batchId) ?? 0
      if (line.consumedKg > available + 1e-6) problems.push(`${line.batchSnapshot.batchNo} 余量 ${available.toFixed(2)} kg，不足分摊 ${line.consumedKg.toFixed(2)} kg`)
    }
    return problems
  }, [balances, batchById, form.draftLines, formAllocation])

  const updateForm = <K extends keyof RunFormState,>(key: K, value: RunFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateDraftLine = (index: number, patch: Partial<RunDraftLine>) => {
    setForm((current) => ({
      ...current,
      draftLines: current.draftLines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  }

  const addDraftLine = () => {
    const remaining = selectableBatches.find((batch) => !form.draftLines.some((line) => line.batchId === batch.id))
    setForm((current) => ({ ...current, draftLines: [...current.draftLines, { batchId: remaining?.id ?? selectableBatches[0]?.id ?? 0, feedKg: 10 }] }))
  }

  const removeDraftLine = (index: number) => {
    setForm((current) => ({ ...current, draftLines: current.draftLines.filter((_, i) => i !== index) }))
  }

  const handleMouldChange = (mouldId: number) => {
    setForm((current) => {
      const mould = mouldById.get(mouldId)
      const standardGap = mould?.stripeGap ?? current.measuredGap
      return { ...current, mouldId, measuredGap: standardGap }
    })
  }

  const handleSubmit = async () => {
    if (!form.runNo.trim() || !form.operator.trim() || form.measuredGap <= 0 || form.grammage <= 0 || recipeProblems.length) return
    clearNotice()
    const draft: RunFormDraft = {
      runNo: form.runNo.trim(),
      mouldId: form.mouldId,
      runDate: form.runDate,
      operator: form.operator.trim(),
      stripeDirection: form.stripeDirection,
      dipCount: form.dipCount,
      stackHeight: form.stackHeight,
      dryMethod: form.dryMethod,
      grammage: form.grammage,
      measuredGap: form.measuredGap,
      deviation: formDeviation,
      draftLines: form.draftLines.filter((line) => line.batchId > 0 && line.feedKg > 0),
    }
    setSubmitting(true)
    const created = await addRun(draft, formTotalKg)
    setSubmitting(false)
    if (created) {
      setForm(createEmptyForm(form.mouldId, selectableBatches[0]?.id ?? 1))
      setShowForm(false)
    }
  }

  const error = runError ?? mouldError ?? batchError

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">抄纸工序记录台</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>一槽可合多批浆登记投料比例，按克重、帘框面积与叠高自动分摊消耗，并在行内复测帘纹间距。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => setShowForm((current) => !current)} data-testid="new-run">
          {showForm ? '收起登记' : '新建工序'}
        </Button>
      </Box>

      {error && <Alert severity="warning" data-testid="run-error">{error}</Alert>}
      {runNotice && <Alert severity="info" onClose={clearNotice}>{runNotice}</Alert>}

      {showForm && (
        <Card data-testid="form-run" sx={{ borderColor: '#9eb096' }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Typography variant="h5">登记抄纸工序</Typography>
              <Chip color={isGapOutOfTolerance(formDeviation) ? 'warning' : 'success'} label={`偏差 ${formDeviation > 0 ? '+' : ''}${formDeviation.toFixed(2)} mm`} />
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}><TextField fullWidth label="工序编号" value={form.runNo} onChange={(event) => updateForm('runNo', event.target.value)} inputProps={{ 'data-testid': 'field-runNo' }} /></Grid>
              <Grid item xs={6} md={2.5}>
                <TextField select fullWidth label="纸帘" value={form.mouldId} onChange={(event) => handleMouldChange(Number(event.target.value))} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-mouldId' } }}>
                  {!moulds.some((mould) => mould.id === form.mouldId) && <option value={form.mouldId}>纸帘数据载入中</option>}
                  {moulds.filter((mould) => mould.state !== '退役').map((mould) => <option key={mould.id} value={mould.id}>{mould.mouldNo} · {mould.stripeGap} mm</option>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={2}><TextField fullWidth type="date" label="抄纸日期" value={form.runDate} onChange={(event) => updateForm('runDate', event.target.value)} InputLabelProps={{ shrink: true }} inputProps={{ 'data-testid': 'field-runDate' }} /></Grid>
              <Grid item xs={12} md={2}><TextField fullWidth label="操作人" value={form.operator} onChange={(event) => updateForm('operator', event.target.value)} inputProps={{ 'data-testid': 'field-operator' }} /></Grid>
              <Grid item xs={6} md={2}>
                <TextField select fullWidth label="帘纹方向" value={form.stripeDirection} onChange={(event) => updateForm('stripeDirection', event.target.value as StripeDirection)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-stripeDirection' } }}>
                  {STRIPE_DIRECTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="荡料次数" value={form.dipCount} onChange={(event) => updateForm('dipCount', Number(event.target.value))} inputProps={{ min: 1, max: 8, step: 1, 'data-testid': 'field-dipCount' }} /></Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="叠高" value={form.stackHeight} onChange={(event) => updateForm('stackHeight', Number(event.target.value))} inputProps={{ min: 10, max: 120, step: 1, 'data-testid': 'field-stackHeight' }} InputProps={{ endAdornment: '张' }} /></Grid>
              <Grid item xs={6} md={2}>
                <TextField select fullWidth label="干燥方式" value={form.dryMethod} onChange={(event) => updateForm('dryMethod', event.target.value as DryMethod)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-dryMethod' } }}>
                  {DRY_METHODS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="克重" value={form.grammage} onChange={(event) => updateForm('grammage', Number(event.target.value))} inputProps={{ min: 10, max: 200, step: 1, 'data-testid': 'field-grammage' }} InputProps={{ endAdornment: 'g/m²' }} /></Grid>
              <Grid item xs={6} md={2}>
                <Box sx={{ border: '1px dashed #b9a98a', borderRadius: 1, px: 1.5, py: 0.75, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Typography variant="caption" color="text.secondary">本槽总用纸量</Typography>
                  <Typography sx={{ fontWeight: 700 }} data-testid="field-totalConsumption">{formTotalKg.toFixed(3)} kg</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={4}>
                <RulerInput label="实测帘纹间距" value={form.measuredGap} onChange={(value) => updateForm('measuredGap', value)} min={0.1} max={5} step={0.01} testId="field-measuredGap" helperText={`${getGapConclusion(formDeviation)}，允许偏差 ±0.2 mm`} />
              </Grid>
            </Grid>

            <Box sx={{ mt: 2.5, border: '1px solid #e0d6c2', borderRadius: 1.5, overflow: 'hidden' }} data-testid="form-batchLines">
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.25, bgcolor: '#f4efe3' }}>
                <Typography variant="subtitle2">合槽投料明细（构皮、桑皮等可按比例同行登记）</Typography>
                <Button size="small" onClick={addDraftLine} data-testid="add-batchLine">添加一批浆</Button>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>料批</TableCell>
                    <TableCell sx={{ width: 170 }}>投料量 kg</TableCell>
                    <TableCell align="right">分摊消耗 kg</TableCell>
                    <TableCell align="right">当前余量 kg</TableCell>
                    <TableCell align="right" sx={{ width: 60 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {form.draftLines.map((line, index) => {
                    const allocation = formAllocation.find((item) => item.batchId === line.batchId && item.feedKg === line.feedKg)
                    const batch = batchById.get(line.batchId)
                    const available = balances.get(line.batchId) ?? 0
                    const insufficient = allocation ? allocation.consumedKg > available + 1e-6 : false
                    return (
                      <TableRow key={index} data-testid={`row-batchLine-${index}`}>
                        <TableCell>
                          <TextField select fullWidth size="small" value={line.batchId} onChange={(event) => updateDraftLine(index, { batchId: Number(event.target.value) })} SelectProps={{ native: true, inputProps: { 'data-testid': `field-lineBatch-${index}` } }}>
                            {!batches.some((batchItem) => batchItem.id === line.batchId) && <option value={line.batchId}>料批载入中</option>}
                            {batches.map((batchItem) => (
                              <option key={batchItem.id} value={batchItem.id} disabled={batchItem.state === '停用'}>
                                {batchItem.batchNo} · {batchItem.material}{batchItem.state === '停用' ? '（已停用）' : ''}
                              </option>
                            ))}
                          </TextField>
                        </TableCell>
                        <TableCell>
                          <TextField fullWidth size="small" type="number" value={line.feedKg} onChange={(event) => updateDraftLine(index, { feedKg: Number(event.target.value) })} inputProps={{ min: 0, step: 0.1, 'data-testid': `field-feedKg-${index}` }} />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }} data-testid={`field-allocated-${index}`}>{allocation?.consumedKg.toFixed(3) ?? '—'}</TableCell>
                        <TableCell align="right" sx={{ color: insufficient ? 'warning.dark' : batch?.state === '停用' ? 'text.disabled' : 'text.primary' }} data-testid={`field-balance-${index}`}>
                          {batch ? available.toFixed(2) : '—'}
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title={form.draftLines.length <= 1 ? '一槽至少保留一批浆' : '移除该行'}>
                            <span>
                              <IconButton size="small" disabled={form.draftLines.length <= 1} onClick={() => removeDraftLine(index)} data-testid={`remove-batchLine-${index}`}>×</IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
            {recipeProblems.length > 0 && (
              <Box sx={{ mt: 1.5 }} data-testid="recipe-problems">
                {recipeProblems.map((problem) => <Alert key={problem} severity="warning" sx={{ mb: 0.5 }}>{problem}</Alert>)}
              </Box>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2.5 }}>
              <Button onClick={() => setShowForm(false)}>取消</Button>
              <Button variant="contained" onClick={handleSubmit} disabled={submitting || recipeProblems.length > 0} data-testid="submit-run">保存工序</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>最近一槽的工序进程</Typography>
              {latestRun ? (
                <>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                    <Chip size="small" label={latestRun.runNo} />
                    <Chip size="small" variant="outlined" label={formatGrammage(latestRun.grammage)} />
                    {latestRun.frozen && <Chip size="small" color="default" variant="outlined" label="已冻结" />}
                  </Box>
                  <ProcessTimeline steps={processSteps} compact />
                </>
              ) : (
                <Typography color="text.secondary">等待工序数据。</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={8}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
              <Grid container spacing={1.5} alignItems="center">
                <Grid item xs={12} sm={5} md={4}><TextField fullWidth size="small" type="date" label="按日期筛选" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} InputLabelProps={{ shrink: true }} /></Grid>
                <Grid item xs={8} sm={5} md={4}>
                  <TextField select fullWidth size="small" label="按帘号筛选" value={mouldFilter} onChange={(event) => setMouldFilter(event.target.value)} SelectProps={{ native: true }}>
                    <option value="全部">全部纸帘</option>
                    {moulds.map((mould) => <option key={mould.id} value={mould.mouldNo}>{mould.mouldNo}</option>)}
                  </TextField>
                </Grid>
                <Grid item xs={4} md={2}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">记录数</Typography>
                    <Typography variant="h5" data-testid="count-run">{filteredRuns.length}</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={2}><Button fullWidth variant="outlined" onClick={() => { setDateFilter(''); setMouldFilter('全部') }}>重置</Button></Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <TableContainer component={Card}>
        <Table sx={{ minWidth: 1120 }}>
          <TableHead>
            <TableRow>
              <TableCell>工序 / 日期</TableCell>
              <TableCell>纸帘与合槽料批</TableCell>
              <TableCell>抄纸参数</TableCell>
              <TableCell align="right">克重 / 消耗</TableCell>
              <TableCell>实测间距与偏差</TableCell>
              <TableCell align="right">保存实测</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredRuns.map((run) => {
              const mould = mouldById.get(run.mouldId)
              const lines: RunBatchLine[] = run.batchLines ?? []
              const draftGap = run.id === undefined ? run.measuredGap : draftGaps[run.id] ?? run.measuredGap
              const draftDeviation = calculateDeviation(draftGap, mould?.stripeGap ?? draftGap)
              const exceeded = isGapOutOfTolerance(draftDeviation)
              const totalConsumed = lines.reduce((sum, line) => sum + line.consumedKg, 0)
              return (
                <TableRow key={run.id ?? run.runNo} data-testid="row-run" hover sx={{ bgcolor: run.frozen ? '#f1f1f1' : exceeded ? '#fff7d9' : undefined }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontWeight: 750 }}>{run.runNo}</Typography>
                      {run.frozen && <Chip size="small" label="冻结" variant="outlined" data-testid={`frozen-run-${run.id}`} />}
                    </Box>
                    <Typography variant="caption" color="text.secondary">{run.runDate} · {run.operator}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{mould?.mouldNo ?? '未关联纸帘'}</Typography>
                    {lines.length ? (
                      <Stack spacing={0.25}>
                        {lines.map((line) => {
                          const current = batchById.get(line.batchId)
                          return (
                            <Typography key={line.batchId} variant="caption" color="text.secondary" data-testid={`run-line-${run.id}-${line.batchId}`}>
                              {line.batchSnapshot.batchNo} · {line.batchSnapshot.material}
                              {current && current.batchNo !== line.batchSnapshot.batchNo ? '（批号已改，保留登记配方）' : ''}
                              {` · 投 ${line.feedKg.toFixed(2)} / 摊 ${line.consumedKg.toFixed(3)} kg`}
                              {current?.state === '停用' ? ' · 料批停用' : ''}
                            </Typography>
                          )
                        })}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">未关联料批</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{run.stripeDirection} · 荡料 {run.dipCount} 次</Typography>
                    <Typography variant="caption" color="text.secondary">叠高 {run.stackHeight} 张 · {run.dryMethod} · 帘框 {cmToMm(mould?.frameW ?? 0)} × {cmToMm(mould?.frameH ?? 0)} mm</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">{run.grammage} g/m²</Typography>
                    <Typography variant="caption" color="text.secondary">{totalConsumed.toFixed(3)} kg</Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 270 }}>
                    <RulerInput
                      label="帘纹间距"
                      value={draftGap}
                      onChange={(value) => {
                        if (run.id !== undefined) setDraftGaps((current) => ({ ...current, [run.id as number]: value }))
                      }}
                      min={0.1}
                      max={5}
                      step={0.01}
                      disabled={run.frozen}
                      testId={run.id === undefined ? undefined : `row-measuredGap-${run.id}`}
                      helperText={<Typography component="span" variant="caption" color={exceeded ? 'warning.dark' : 'text.secondary'}>{exceeded ? '超差：' : '合格：'}{getGapConclusion(draftDeviation)}（{draftDeviation > 0 ? '+' : ''}{draftDeviation.toFixed(2)} mm）{run.frozen ? ' · 已冻结' : ''}</Typography>}
                      compact
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant={exceeded ? 'contained' : 'outlined'}
                      color={exceeded ? 'warning' : 'primary'}
                      disabled={run.id === undefined || run.frozen || draftGap === run.measuredGap}
                      onClick={() => {
                        if (run.id !== undefined) void updateMeasuredGap(run.id, draftGap, mould?.stripeGap ?? draftGap)
                      }}
                    >
                      {run.frozen ? '已冻结' : draftGap === run.measuredGap ? '已记录' : '保存实测'}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredRuns.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5 }}>没有符合日期与帘号条件的工序</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  )
}
