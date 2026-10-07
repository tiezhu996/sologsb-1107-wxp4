import { useEffect, useMemo, useState } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, Chip, Divider, Grid, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { RulerInput } from '../components/common/RulerInput'
import { useFiberStore } from '../stores/fiberStore'
import { usePulpStore } from '../stores/pulpStore'
import { useRunStore } from '../stores/runStore'
import { BLEACH_METHODS, COOK_AGENTS, FIBER_MATERIALS, type FiberBatchInput, type FiberMaterial, type CookAgent, type BleachMethod } from '../types/fiber-batch'
import { summarizePulpAccounts } from '../utils/pulp'

const emptyFiberForm: FiberBatchInput = {
  batchNo: '',
  material: '构皮',
  origin: '陕西洋县华阳镇',
  cookAgent: '石灰',
  cookHours: 8,
  bleachMethod: '日晒',
  beatingDegree: 32,
  operator: '罗青禾',
}

const LOW_STOCK_KG = 20

export default function FiberBatchList() {
  const fiberBatches = useFiberStore((state) => state.fiberBatches)
  const error = useFiberStore((state) => state.error)
  const loadFiberBatches = useFiberStore((state) => state.loadFiberBatches)
  const addFiberBatch = useFiberStore((state) => state.addFiberBatch)
  const updateBeatingDegree = useFiberStore((state) => state.updateBeatingDegree)
  const discontinueBatch = useFiberStore((state) => state.discontinueBatch)
  const runs = useRunStore((state) => state.sheetRuns)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const pulpFeeds = usePulpStore((state) => state.pulpFeeds)
  const pulpError = usePulpStore((state) => state.error)
  const loadPulpFeeds = usePulpStore((state) => state.loadPulpFeeds)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FiberBatchInput>(emptyFiberForm)
  const [stockKg, setStockKg] = useState(150)
  const [materialFilter, setMaterialFilter] = useState<FiberMaterial | '全部'>('全部')
  const [degreeLimit, setDegreeLimit] = useState(45)
  const [degreeDrafts, setDegreeDrafts] = useState<Record<number, number>>({})
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void loadFiberBatches()
    void loadRuns()
    void loadPulpFeeds()
  }, [loadFiberBatches, loadPulpFeeds, loadRuns])

  const accounts = useMemo(() => summarizePulpAccounts(pulpFeeds), [pulpFeeds])
  const vatFeedsByBatch = useMemo(() => {
    const map = new Map<number, typeof pulpFeeds>()
    for (const feed of pulpFeeds) {
      if (feed.kind !== '合槽') continue
      const list = map.get(feed.batchId) ?? []
      list.push(feed)
      map.set(feed.batchId, list)
    }
    return map
  }, [pulpFeeds])
  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  const filteredBatches = useMemo(
    () => fiberBatches.filter((batch) => (materialFilter === '全部' || batch.material === materialFilter) && batch.beatingDegree <= degreeLimit),
    [degreeLimit, fiberBatches, materialFilter],
  )
  const averageDegree = filteredBatches.length
    ? filteredBatches.reduce((sum, batch) => sum + batch.beatingDegree, 0) / filteredBatches.length
    : 0

  const updateForm = <K extends keyof FiberBatchInput,>(key: K, value: FiberBatchInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.batchNo.trim() || !form.origin.trim() || !form.operator.trim() || form.cookHours <= 0 || form.beatingDegree <= 0 || stockKg <= 0) return
    setSubmitting(true)
    const created = await addFiberBatch({ ...form, batchNo: form.batchNo.trim(), origin: form.origin.trim(), operator: form.operator.trim() }, stockKg)
    setSubmitting(false)
    if (created) {
      setForm(emptyFiberForm)
      setStockKg(150)
      setShowForm(false)
    }
  }

  const handleDiscontinue = async (id: number) => {
    setSubmitting(true)
    const done = await discontinueBatch(id)
    setSubmitting(false)
    if (done) setConfirmingId(null)
  }

  const errorMessage = error ?? pulpError

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">纤维料批台账</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>余量由投料记录汇总，按原料与打浆度横向比较，并回看料批进入各槽的投料明细。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => setShowForm((current) => !current)} data-testid="new-fiber">
          {showForm ? '收起登记' : '新建料批'}
        </Button>
      </Box>

      {errorMessage && <Alert severity="warning">{errorMessage}</Alert>}

      {showForm && (
        <Card data-testid="form-fiber" sx={{ borderColor: '#9eb096' }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h5" sx={{ mb: 2 }}>登记纤维料批</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}><TextField fullWidth label="批次编号" value={form.batchNo} onChange={(event) => updateForm('batchNo', event.target.value)} inputProps={{ 'data-testid': 'field-batchNo' }} /></Grid>
              <Grid item xs={6} md={2}>
                <TextField select fullWidth label="纤维原料" value={form.material} onChange={(event) => updateForm('material', event.target.value as FiberMaterial)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-material' } }}>
                  {FIBER_MATERIALS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={3}><TextField fullWidth label="采收地" value={form.origin} onChange={(event) => updateForm('origin', event.target.value)} inputProps={{ 'data-testid': 'field-origin' }} /></Grid>
              <Grid item xs={6} md={2}>
                <TextField select fullWidth label="蒸煮剂" value={form.cookAgent} onChange={(event) => updateForm('cookAgent', event.target.value as CookAgent)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-cookAgent' } }}>
                  {COOK_AGENTS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="蒸煮时长" value={form.cookHours} onChange={(event) => updateForm('cookHours', Number(event.target.value))} inputProps={{ min: 1, max: 24, step: 1, 'data-testid': 'field-cookHours' }} InputProps={{ endAdornment: '小时' }} /></Grid>
              <Grid item xs={6} md={3}>
                <TextField select fullWidth label="漂白方式" value={form.bleachMethod} onChange={(event) => updateForm('bleachMethod', event.target.value as BleachMethod)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-bleachMethod' } }}>
                  {BLEACH_METHODS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={5}>
                <RulerInput label="打浆度" value={form.beatingDegree} onChange={(value) => updateForm('beatingDegree', value)} unit="°SR" min={10} max={60} step={1} testId="field-beatingDegree" />
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="配浆入库量" value={stockKg} onChange={(event) => setStockKg(Number(event.target.value))} inputProps={{ min: 1, max: 2000, step: 1, 'data-testid': 'field-stockKg' }} InputProps={{ endAdornment: 'kg' }} /></Grid>
              <Grid item xs={12} md={4}><TextField fullWidth label="操作人" value={form.operator} onChange={(event) => updateForm('operator', event.target.value)} inputProps={{ 'data-testid': 'field-operator' }} /></Grid>
            </Grid>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2.5 }}>
              <Button onClick={() => setShowForm(false)}>取消</Button>
              <Button variant="contained" onClick={handleSubmit} disabled={submitting} data-testid="submit-fiber">保存料批</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'end' }}>
            <TextField select size="small" label="原料筛选" value={materialFilter} onChange={(event) => setMaterialFilter(event.target.value as FiberMaterial | '全部')} SelectProps={{ native: true }} sx={{ minWidth: 150 }}>
              <option value="全部">全部原料</option>
              {FIBER_MATERIALS.map((option) => <option key={option} value={option}>{option}</option>)}
            </TextField>
            <Box sx={{ width: 250 }}>
              <RulerInput label="打浆度上限" value={degreeLimit} onChange={setDegreeLimit} unit="°SR" min={10} max={60} step={1} compact />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: { md: 'auto' } }}>
              <Typography variant="body2" color="text.secondary">当前记录</Typography>
              <Typography variant="h5" data-testid="count-fiber">{filteredBatches.length}</Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Stack spacing={1.5}>
        {filteredBatches.map((batch) => {
          const batchId = batch.id ?? 0
          const account = accounts.get(batchId) ?? { stockedKg: 0, consumedKg: 0, remainingKg: 0 }
          const batchVatFeeds = vatFeedsByBatch.get(batchId) ?? []
          const discontinued = batch.status === '停用'
          const degreeDraft = degreeDrafts[batchId] ?? batch.beatingDegree
          return (
            <Accordion key={batch.id ?? batch.batchNo} data-testid="row-fiber" disableGutters sx={{ border: '1px solid #ddd2bd', borderRadius: '10px !important', '&::before': { display: 'none' }, opacity: discontinued ? 0.82 : 1 }}>
              <AccordionSummary expandIcon={<Box component="span" aria-hidden="true" sx={{ fontSize: 20, lineHeight: 1 }}>⌄</Box>}>
                <Grid container spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
                  <Grid item xs={12} sm={3} md={2}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography sx={{ fontWeight: 800 }}>{batch.batchNo}</Typography>
                      {discontinued && <Chip size="small" color="warning" label="停用" />}
                    </Box>
                    <Typography variant="caption" color="text.secondary">{batch.origin}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={2}><Chip label={batch.material} color={batch.material === '构皮' ? 'success' : 'default'} variant="outlined" /></Grid>
                  <Grid item xs={6} sm={3} md={2}><Typography variant="body2">{batch.cookAgent} · {batch.cookHours} 小时</Typography></Grid>
                  <Grid item xs={12} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ minWidth: 54 }}>{batch.beatingDegree}°SR</Typography>
                      <LinearProgress variant="determinate" value={batch.beatingDegree} color="success" sx={{ flex: 1, height: 8, borderRadius: 4 }} />
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <Typography variant="body2" color={account.remainingKg < LOW_STOCK_KG ? 'warning.dark' : 'text.secondary'} sx={{ fontWeight: account.remainingKg < LOW_STOCK_KG ? 700 : 400 }}>
                      余量 {account.remainingKg} kg · 引用 {batchVatFeeds.length} 次
                    </Typography>
                  </Grid>
                </Grid>
              </AccordionSummary>
              <AccordionDetails sx={{ bgcolor: '#faf6ec' }}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                  <Chip size="small" label={`入库 ${account.stockedKg} kg`} />
                  <Chip size="small" label={`已耗 ${account.consumedKg} kg`} />
                  <Chip size="small" color={account.remainingKg < LOW_STOCK_KG ? 'warning' : 'success'} variant="outlined" label={`余量 ${account.remainingKg} kg`} />
                  <Chip size="small" label={batch.beatingDegree >= 35 ? '细浆，适合薄页' : batch.beatingDegree >= 29 ? '中细浆，成纸兼顾韧性' : '粗浆，适合厚实纸页'} />
                </Box>
                <Grid container spacing={2} alignItems="flex-end" sx={{ mb: 1.5 }}>
                  <Grid item xs={12} md={5}>
                    <RulerInput
                      label="打浆度复测"
                      value={degreeDraft}
                      onChange={(value) => setDegreeDrafts((current) => ({ ...current, [batchId]: value }))}
                      unit="°SR"
                      min={10}
                      max={60}
                      step={1}
                      compact
                      disabled={discontinued}
                      testId={batch.id === undefined ? undefined : `row-beatingDegree-${batch.id}`}
                      helperText="复测只更新料批主数据，历史工序配方以投料记录快照为准，不会倒改"
                    />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={discontinued || degreeDraft === batch.beatingDegree}
                      onClick={() => void updateBeatingDegree(batchId, degreeDraft)}
                    >
                      保存复测
                    </Button>
                  </Grid>
                  <Grid item xs={6} md={5} sx={{ textAlign: { md: 'right' } }}>
                    {discontinued ? (
                      <Typography variant="caption" color="warning.dark">该料批已停用，仅冻结引用它的 {batchVatFeeds.length} 槽工序及其样本</Typography>
                    ) : confirmingId === batchId ? (
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                        <Button size="small" color="warning" variant="contained" disabled={submitting} onClick={() => void handleDiscontinue(batchId)} data-testid={`confirm-discontinue-${batchId}`}>
                          确认停用
                        </Button>
                        <Button size="small" onClick={() => setConfirmingId(null)}>再想想</Button>
                      </Box>
                    ) : (
                      <Button size="small" color="warning" variant="outlined" onClick={() => setConfirmingId(batchId)} data-testid={`discontinue-${batchId}`}>
                        停用该料批
                      </Button>
                    )}
                  </Grid>
                </Grid>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>引用本料批的抄纸工序</Typography>
                {batchVatFeeds.length ? (
                  <Table size="small">
                    <TableHead><TableRow><TableCell>工序号</TableCell><TableCell>日期</TableCell><TableCell>操作人</TableCell><TableCell align="right">投料占比</TableCell><TableCell align="right">分摊消耗</TableCell><TableCell align="right">实测间距</TableCell></TableRow></TableHead>
                    <TableBody>
                      {batchVatFeeds.map((feed) => {
                        const run = runById.get(feed.runId ?? 0)
                        return (
                          <TableRow key={feed.id ?? feed.feedNo} sx={{ bgcolor: run?.frozen ? '#eceae4' : undefined }}>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                {feed.runNo ?? run?.runNo ?? '未知工序'}
                                {run?.frozen && <Chip size="small" color="warning" variant="outlined" label="已冻结" />}
                              </Box>
                            </TableCell>
                            <TableCell>{run?.runDate ?? feed.createdAt.slice(0, 10)}</TableCell>
                            <TableCell>{run?.operator ?? '—'}</TableCell>
                            <TableCell align="right">{feed.sharePct}%（{feed.feedKg} kg）</TableCell>
                            <TableCell align="right">{feed.consumedKg} kg</TableCell>
                            <TableCell align="right">{run ? `${run.measuredGap.toFixed(2)} mm` : '—'}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <Typography color="text.secondary">该料批尚未关联抄纸工序。</Typography>
                )}
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="caption" color="text.secondary">蒸煮后需充分漂洗，再按目标纸性逐步打浆，避免纤维过度切断。</Typography>
              </AccordionDetails>
            </Accordion>
          )
        })}
        {filteredBatches.length === 0 && (
          <Card><CardContent sx={{ textAlign: 'center', py: 6 }}><Typography color="text.secondary">没有符合当前原料与打浆度范围的料批</Typography></CardContent></Card>
        )}
      </Stack>
    </Stack>
  )
}
