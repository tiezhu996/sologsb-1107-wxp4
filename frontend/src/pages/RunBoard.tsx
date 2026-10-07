import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { ProcessTimeline, type ProcessStep } from '../components/common/ProcessTimeline'
import { RulerInput } from '../components/common/RulerInput'
import { useUnitConvert } from '../hooks/useUnitConvert'
import { useFiberStore } from '../stores/fiberStore'
import { useMouldStore } from '../stores/mouldStore'
import { usePulpStore } from '../stores/pulpStore'
import { useRunStore } from '../stores/runStore'
import { DRY_METHODS, STRIPE_DIRECTIONS, type DryMethod, type RunFeedInput, type SheetRunInput, type StripeDirection } from '../types/sheet-run'
import { allocateConsumption, frameAreaSqm, newRequestId, summarizePulpAccounts, vatConsumptionKg } from '../utils/pulp'
import { calculateDeviation, getGapConclusion, isGapOutOfTolerance } from '../utils/stripe'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const emptyRunForm: SheetRunInput = {
  runNo: '',
  mouldId: 1,
  runDate: todayIso(),
  operator: '罗青禾',
  stripeDirection: '竖帘纹',
  dipCount: 2,
  stackHeight: 42,
  dryMethod: '火墙',
  grammage: 32,
  measuredGap: 1.1,
  deviation: 0,
}

const emptyFeedDraft = (): RunFeedInput => ({ batchId: 0, feedKg: 5 })

const processSteps: ProcessStep[] = [
  { label: '浆料复核', detail: '核对料批打浆度与漂洗状态。', status: 'done' },
  { label: '帘床就位', detail: '确认纸帘方向与框架张力。', status: 'done' },
  { label: '入槽抄纸', detail: '按设定次数完成荡料与提帘。', status: 'active' },
  { label: '压榨定形', detail: '控制叠高后转火墙或日晒。', status: 'pending' },
  { label: '量纹偏差', detail: '实测间距并与纸帘标准值比较。', status: 'pending' },
]

export default function RunBoard() {
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const addRun = useRunStore((state) => state.addRun)
  const updateMeasuredGap = useRunStore((state) => state.updateMeasuredGap)
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const batches = useFiberStore((state) => state.fiberBatches)
  const batchError = useFiberStore((state) => state.error)
  const loadBatches = useFiberStore((state) => state.loadFiberBatches)
  const pulpFeeds = usePulpStore((state) => state.pulpFeeds)
  const pulpError = usePulpStore((state) => state.error)
  const loadPulpFeeds = usePulpStore((state) => state.loadPulpFeeds)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<SheetRunInput>(emptyRunForm)
  const [feedDrafts, setFeedDrafts] = useState<RunFeedInput[]>([emptyFeedDraft()])
  const [requestId, setRequestId] = useState(() => newRequestId())
  const [dateFilter, setDateFilter] = useState('')
  const [mouldFilter, setMouldFilter] = useState('全部')
  const [draftGaps, setDraftGaps] = useState<Record<number, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const { formatGrammage, cmToMm } = useUnitConvert()

  useEffect(() => {
    void loadRuns()
    void loadMoulds()
    void loadBatches()
    void loadPulpFeeds()
  }, [loadBatches, loadMoulds, loadPulpFeeds, loadRuns])

  const mouldById = useMemo(() => new Map(moulds.map((mould) => [mould.id, mould])), [moulds])
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches])
  const activeBatches = useMemo(() => batches.filter((batch) => batch.status === '在用'), [batches])
  const accounts = useMemo(() => summarizePulpAccounts(pulpFeeds), [pulpFeeds])
  const feedsByRunId = useMemo(() => {
    const map = new Map<number, typeof pulpFeeds>()
    for (const feed of pulpFeeds) {
      if (feed.kind !== '合槽' || feed.runId === undefined) continue
      const list = map.get(feed.runId) ?? []
      list.push(feed)
      map.set(feed.runId, list)
    }
    return map
  }, [pulpFeeds])
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
  const vatTotalKg = vatConsumptionKg(form.grammage, selectedMould?.frameW ?? 0, selectedMould?.frameH ?? 0, form.stackHeight)
  const allocations = useMemo(() => allocateConsumption(vatTotalKg, feedDrafts.filter((draft) => draft.batchId > 0 && draft.feedKg > 0)), [feedDrafts, vatTotalKg])
  const totalFeedKg = feedDrafts.reduce((sum, draft) => sum + (draft.feedKg > 0 ? draft.feedKg : 0), 0)
  const latestRun = runs[0]

  const updateForm = <K extends keyof SheetRunInput,>(key: K, value: SheetRunInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateFeedDraft = (index: number, patch: Partial<RunFeedInput>) => {
    setFeedDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)))
  }

  const handleMouldChange = (mouldId: number) => {
    setForm((current) => {
      const mould = mouldById.get(mouldId)
      const standardGap = mould?.stripeGap ?? current.measuredGap
      return { ...current, mouldId, measuredGap: standardGap, deviation: calculateDeviation(standardGap, standardGap) }
    })
  }

  const toggleForm = () => {
    setShowForm((current) => {
      if (!current) setRequestId(newRequestId())
      return !current
    })
  }

  const handleSubmit = async () => {
    if (!form.runNo.trim() || !form.operator.trim() || form.measuredGap <= 0 || form.grammage <= 0) return
    const drafts = feedDrafts.filter((draft) => draft.batchId > 0 && draft.feedKg > 0)
    if (drafts.length === 0) return
    setSubmitting(true)
    const created = await addRun({ ...form, runNo: form.runNo.trim(), operator: form.operator.trim(), deviation: formDeviation }, drafts, requestId)
    setSubmitting(false)
    if (created) {
      setForm(emptyRunForm)
      setFeedDrafts([emptyFeedDraft()])
      setRequestId(newRequestId())
      setShowForm(false)
    }
  }

  const error = runError ?? mouldError ?? batchError ?? pulpError

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">抄纸工序记录台</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>关联纸帘与多批浆料，按克重、帘框面积与叠高分摊消耗，并在行内复测帘纹间距。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={toggleForm} data-testid="new-run">
          {showForm ? '收起登记' : '新建工序'}
        </Button>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}

      {showForm && (
        <Card data-testid="form-run" sx={{ borderColor: '#9eb096' }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
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
              <Grid item xs={12} md={4}>
                <RulerInput label="实测帘纹间距" value={form.measuredGap} onChange={(value) => updateForm('measuredGap', value)} min={0.1} max={5} step={0.01} testId="field-measuredGap" helperText={`${getGapConclusion(formDeviation)}，允许偏差 ±0.2 mm`} />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2.5 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
              <Box>
                <Typography variant="h6">合槽投料</Typography>
                <Typography variant="caption" color="text.secondary">
                  整槽理论消耗 {vatTotalKg} kg（{form.grammage} g/m² × 帘框 {frameAreaSqm(selectedMould?.frameW ?? 0, selectedMould?.frameH ?? 0).toFixed(3)} m² × 叠高 {form.stackHeight} 张），按各批投料量比例分摊。
                </Typography>
              </Box>
              <Button size="small" variant="outlined" disabled={feedDrafts.length >= activeBatches.length} onClick={() => setFeedDrafts((current) => [...current, emptyFeedDraft()])} data-testid="add-feed">
                添加一批
              </Button>
            </Box>
            <Stack spacing={1.5}>
              {feedDrafts.map((draft, index) => {
                const allocation = allocations.find((item) => item.batchId === draft.batchId && draft.feedKg > 0)
                const remaining = accounts.get(draft.batchId)?.remainingKg
                const short = allocation !== undefined && remaining !== undefined && allocation.consumedKg > remaining
                return (
                  <Grid container spacing={1.5} alignItems="center" key={index}>
                    <Grid item xs={12} sm={5} md={4}>
                      <TextField select fullWidth size="small" label={`料批 ${index + 1}`} value={draft.batchId} onChange={(event) => updateFeedDraft(index, { batchId: Number(event.target.value) })} SelectProps={{ native: true, inputProps: { 'data-testid': `field-feedBatch-${index}` } }}>
                        <option value={0}>选择料批</option>
                        {activeBatches.map((batch) => (
                          <option key={batch.id} value={batch.id} disabled={feedDrafts.some((other, position) => position !== index && other.batchId === batch.id)}>
                            {batch.batchNo} · {batch.material} · 余 {accounts.get(batch.id ?? 0)?.remainingKg ?? 0} kg
                          </option>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid item xs={6} sm={3} md={2}>
                      <TextField fullWidth size="small" type="number" label="投料量" value={draft.feedKg} onChange={(event) => updateFeedDraft(index, { feedKg: Number(event.target.value) })} inputProps={{ min: 0.5, max: 500, step: 0.5, 'data-testid': `field-feedKg-${index}` }} InputProps={{ endAdornment: 'kg' }} />
                    </Grid>
                    <Grid item xs={12} sm={4} md={5}>
                      <Typography variant="body2" color={short ? 'error' : 'text.secondary'}>
                        {draft.batchId > 0 && allocation
                          ? `占比 ${allocation.sharePct}% · 分摊消耗 ${allocation.consumedKg} kg · 余量 ${remaining ?? 0} kg${short ? '（不足）' : ''}`
                          : '选择料批并填写投料量后自动分摊'}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={1} sx={{ textAlign: { md: 'right' } }}>
                      <Button size="small" color="inherit" disabled={feedDrafts.length <= 1} onClick={() => setFeedDrafts((current) => current.filter((_, position) => position !== index))}>
                        移除
                      </Button>
                    </Grid>
                  </Grid>
                )
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              合计投料 {totalFeedKg} kg · 提交后整槽原子写入，重复提交不会再次扣料
            </Typography>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2.5 }}>
              <Button onClick={() => setShowForm(false)}>取消</Button>
              <Button variant="contained" onClick={handleSubmit} disabled={submitting} data-testid="submit-run">保存工序</Button>
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
                    {latestRun.frozen && <Chip size="small" color="warning" label="已冻结" />}
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
        <Table sx={{ minWidth: 1080 }}>
          <TableHead>
            <TableRow>
              <TableCell>工序 / 日期</TableCell>
              <TableCell>纸帘与投料</TableCell>
              <TableCell>抄纸参数</TableCell>
              <TableCell align="right">克重</TableCell>
              <TableCell>实测间距与偏差</TableCell>
              <TableCell align="right">保存实测</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredRuns.map((run) => {
              const mould = mouldById.get(run.mouldId)
              const runFeeds = (run.id === undefined ? [] : feedsByRunId.get(run.id) ?? []).slice().sort((a, b) => b.sharePct - a.sharePct)
              const draftGap = run.id === undefined ? run.measuredGap : draftGaps[run.id] ?? run.measuredGap
              const draftDeviation = calculateDeviation(draftGap, mould?.stripeGap ?? draftGap)
              const exceeded = isGapOutOfTolerance(draftDeviation)
              return (
                <TableRow key={run.id ?? run.runNo} data-testid="row-run" hover sx={{ bgcolor: run.frozen ? '#eceae4' : exceeded ? '#fff7d9' : undefined }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography sx={{ fontWeight: 750 }}>{run.runNo}</Typography>
                      {run.frozen && <Chip size="small" color="warning" variant="outlined" label="已冻结" />}
                    </Box>
                    <Typography variant="caption" color="text.secondary">{run.runDate} · {run.operator}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{mould?.mouldNo ?? '未关联纸帘'}</Typography>
                    {runFeeds.length > 0 ? runFeeds.map((feed) => (
                      <Typography key={feed.id ?? feed.feedNo} variant="caption" color="text.secondary" display="block">
                        {feed.batchNo} · {feed.material} · {feed.sharePct}% · 耗 {feed.consumedKg} kg
                      </Typography>
                    )) : (
                      <Typography variant="caption" color="text.secondary">未关联料批</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{run.stripeDirection} · 荡料 {run.dipCount} 次</Typography>
                    <Typography variant="caption" color="text.secondary">叠高 {run.stackHeight} 张 · {run.dryMethod} · 帘框 {cmToMm(mould?.frameW ?? 0)} × {cmToMm(mould?.frameH ?? 0)} mm</Typography>
                  </TableCell>
                  <TableCell align="right">{run.grammage} g/m²</TableCell>
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
                      helperText={<Typography component="span" variant="caption" color={exceeded ? 'warning.dark' : 'text.secondary'}>{run.frozen ? '料批已停用，记录冻结' : exceeded ? '超差：' : '合格：'}{run.frozen ? '' : `${getGapConclusion(draftDeviation)}（${draftDeviation > 0 ? '+' : ''}${draftDeviation.toFixed(2)} mm）`}</Typography>}
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
