import { useEffect, useMemo, useState } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, ButtonGroup, Card, CardContent, Chip, Divider, Grid, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { RulerInput } from '../components/common/RulerInput'
import { useFiberStore } from '../stores/fiberStore'
import { useRunStore } from '../stores/runStore'
import { BLEACH_METHODS, COOK_AGENTS, FIBER_BATCH_STATES, FIBER_MATERIALS, type FiberBatchInput, type FiberBatchState, type FiberMaterial, type CookAgent, type BleachMethod } from '../types/fiber-batch'
import { runUsesBatch } from '../utils/db'

const emptyFiberForm: FiberBatchInput = {
  batchNo: '',
  material: '构皮',
  origin: '陕西洋县华阳镇',
  cookAgent: '石灰',
  cookHours: 8,
  bleachMethod: '日晒',
  beatingDegree: 32,
  operator: '罗青禾',
  initialAmountKg: 30,
}

export default function FiberBatchList() {
  const fiberBatches = useFiberStore((state) => state.fiberBatches)
  const ledger = useFiberStore((state) => state.ledger)
  const balances = useFiberStore((state) => state.balances)
  const error = useFiberStore((state) => state.error)
  const loadFiberBatches = useFiberStore((state) => state.loadFiberBatches)
  const addFiberBatch = useFiberStore((state) => state.addFiberBatch)
  const setFiberBatchState = useFiberStore((state) => state.setFiberBatchState)
  const runs = useRunStore((state) => state.sheetRuns)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FiberBatchInput>(emptyFiberForm)
  const [materialFilter, setMaterialFilter] = useState<FiberMaterial | '全部'>('全部')
  const [degreeLimit, setDegreeLimit] = useState(45)
  const [stateFilter, setStateFilter] = useState<FiberBatchState | '全部'>('全部')
  const [submitting, setSubmitting] = useState(false)
  const [togglingId, setTogglingId] = useState<number | null>(null)

  useEffect(() => {
    void loadFiberBatches()
    void loadRuns()
  }, [loadFiberBatches, loadRuns])

  const ledgerByBatch = useMemo(() => {
    const map = new Map<number, typeof ledger>()
    for (const entry of ledger) {
      const list = map.get(entry.batchId) ?? []
      list.push(entry)
      map.set(entry.batchId, list)
    }
    return map
  }, [ledger])

  const filteredBatches = useMemo(
    () => fiberBatches.filter((batch) =>
      (materialFilter === '全部' || batch.material === materialFilter)
      && (stateFilter === '全部' || batch.state === stateFilter)
      && batch.beatingDegree <= degreeLimit),
    [degreeLimit, fiberBatches, materialFilter, stateFilter],
  )
  const averageDegree = filteredBatches.length
    ? filteredBatches.reduce((sum, batch) => sum + batch.beatingDegree, 0) / filteredBatches.length
    : 0

  const updateForm = <K extends keyof FiberBatchInput,>(key: K, value: FiberBatchInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.batchNo.trim() || !form.origin.trim() || !form.operator.trim() || form.cookHours <= 0 || form.beatingDegree <= 0 || form.initialAmountKg <= 0) return
    setSubmitting(true)
    const created = await addFiberBatch({ ...form, batchNo: form.batchNo.trim(), origin: form.origin.trim(), operator: form.operator.trim() })
    setSubmitting(false)
    if (created) {
      setForm(emptyFiberForm)
      setShowForm(false)
    }
  }

  const handleToggleState = async (batchId: number, nextState: FiberBatchState) => {
    setTogglingId(batchId)
    await setFiberBatchState(batchId, nextState)
    setTogglingId(null)
  }

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">纤维料批台账</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>余量由入库/领用流水汇总；停用料批只冻结确实用到它的工序与成纸样本，历史配方保留快照。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => setShowForm((current) => !current)} data-testid="new-fiber">
          {showForm ? '收起登记' : '新建料批'}
        </Button>
      </Box>

      {error && <Alert severity="warning" data-testid="fiber-error">{error}</Alert>}

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
              <Grid item xs={12} md={3}>
                <RulerInput label="打浆度" value={form.beatingDegree} onChange={(value) => updateForm('beatingDegree', value)} unit="°SR" min={10} max={60} step={1} testId="field-beatingDegree" />
              </Grid>
              <Grid item xs={6} md={3}><TextField fullWidth type="number" label="初始投料量" value={form.initialAmountKg} onChange={(event) => updateForm('initialAmountKg', Number(event.target.value))} inputProps={{ min: 0.1, step: 0.1, 'data-testid': 'field-initialAmount' }} InputProps={{ endAdornment: 'kg' }} helperText="建批首笔入库，作为余量起点" /></Grid>
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
            <TextField select size="small" label="状态筛选" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as FiberBatchState | '全部')} SelectProps={{ native: true }} sx={{ minWidth: 130 }} inputProps={{ 'data-testid': 'filter-state' }}>
              <option value="全部">全部状态</option>
              {FIBER_BATCH_STATES.map((option) => <option key={option} value={option}>{option}</option>)}
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
          const relatedRuns = runs.filter((run) => runUsesBatch(run, batch.id!))
          const frozenCount = relatedRuns.filter((run) => run.frozen).length
          const balance = balances.get(batch.id!) ?? 0
          const batchLedger = (ledgerByBatch.get(batch.id!) ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          const inbound = batchLedger.filter((entry) => entry.type === '入库').reduce((sum, entry) => sum + entry.amountKg, 0)
          const outbound = batchLedger.filter((entry) => entry.type === '领用').reduce((sum, entry) => sum + entry.amountKg, 0)
          return (
            <Accordion key={batch.id ?? batch.batchNo} data-testid="row-fiber" disableGutters sx={{ border: '1px solid #ddd2bd', borderRadius: '10px !important', '&::before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<Box component="span" aria-hidden="true" sx={{ fontSize: 20, lineHeight: 1 }}>⌄</Box>}>
                <Grid container spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
                  <Grid item xs={12} sm={3} md={2}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontWeight: 800 }}>{batch.batchNo}</Typography>
                      <Chip size="small" label={batch.state} color={batch.state === '停用' ? 'default' : 'success'} variant={batch.state === '停用' ? 'outlined' : 'filled'} data-testid={`state-chip-${batch.id}`} />
                    </Box>
                    <Typography variant="caption" color="text.secondary">{batch.origin}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={2}><Chip label={batch.material} color={batch.material === '构皮' ? 'success' : 'default'} variant="outlined" /></Grid>
                  <Grid item xs={6} sm={3} md={2}><Typography variant="body2">{batch.cookAgent} · {batch.cookHours} 小时</Typography></Grid>
                  <Grid item xs={12} sm={4} md={2}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ minWidth: 54 }}>{batch.beatingDegree}°SR</Typography>
                      <LinearProgress variant="determinate" value={batch.beatingDegree} color="success" sx={{ flex: 1, height: 8, borderRadius: 4 }} />
                    </Box>
                  </Grid>
                  <Grid item xs={8} md={2}>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: balance <= 0 ? 'text.secondary' : 'success.dark' }} data-testid={`balance-${batch.id}`}>余量 {balance.toFixed(2)} kg</Typography>
                    <Typography variant="caption" color="text.secondary">入 {inbound.toFixed(1)} / 领 {outbound.toFixed(1)}</Typography>
                  </Grid>
                  <Grid item xs={4} md={2} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ButtonGroup size="small" onClick={(event) => event.stopPropagation()}>
                      {batch.state === '在用' ? (
                        <Button
                          variant="outlined"
                          color="warning"
                          disabled={togglingId === batch.id}
                          onClick={() => void handleToggleState(batch.id!, '停用')}
                          data-testid={`deactivate-${batch.id}`}
                        >
                          停用
                        </Button>
                      ) : (
                        <Button
                          variant="outlined"
                          disabled={togglingId === batch.id}
                          onClick={() => void handleToggleState(batch.id!, '在用')}
                          data-testid={`activate-${batch.id}`}
                        >
                          启用
                        </Button>
                      )}
                    </ButtonGroup>
                  </Grid>
                </Grid>
              </AccordionSummary>
              <AccordionDetails sx={{ bgcolor: '#faf6ec' }}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                  <Chip size="small" label={`平均打浆度 ${averageDegree.toFixed(1)}°SR`} />
                  <Chip size="small" label={batch.beatingDegree >= 35 ? '细浆，适合薄页' : batch.beatingDegree >= 29 ? '中细浆，成纸兼顾韧性' : '粗浆，适合厚实纸页'} />
                  <Chip size="small" label={`引用 ${relatedRuns.length} 槽工序`} />
                  {frozenCount > 0 && <Chip size="small" color="warning" label={`停用后冻结 ${frozenCount} 槽工序及其成纸样本`} data-testid={`frozen-note-${batch.id}`} />}
                </Box>

                <Typography variant="subtitle2" sx={{ mb: 1 }}>投料记录（余量由流水汇总，改资料不影响历史配方）</Typography>
                {batchLedger.length ? (
                  <Table size="small" data-testid={`ledger-${batch.id}`}>
                    <TableHead><TableRow><TableCell>时间</TableCell><TableCell>类型</TableCell><TableCell>来源 / 工序</TableCell><TableCell align="right">数量 kg</TableCell><TableCell align="right">汇总余量 kg</TableCell></TableRow></TableHead>
                    <TableBody>
                      {batchLedger.map((entry, index) => {
                        const running = batchLedger
                          .slice(0, index + 1)
                          .reduce((sum, item) => sum + (item.type === '入库' ? item.amountKg : -item.amountKg), 0)
                        return (
                          <TableRow key={entry.id ?? entry.clientToken} data-testid={`ledger-row-${entry.id}`}>
                            <TableCell>{entry.createdAt.slice(0, 10)}</TableCell>
                            <TableCell><Chip size="small" label={entry.type} color={entry.type === '入库' ? 'success' : 'default'} variant="outlined" /></TableCell>
                            <TableCell>{entry.type === '入库' ? (entry.source ?? '入库') : `工序 ${entry.runNo ?? entry.runId ?? ''}`}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{entry.type === '入库' ? '+' : '−'}{entry.amountKg.toFixed(3)}</TableCell>
                            <TableCell align="right">{Number(running.toFixed(3))}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <Typography color="text.secondary">该料批暂无投料记录。</Typography>
                )}

                <Divider sx={{ my: 1.5 }} />
                <Typography variant="subtitle2" sx={{ mb: 1 }}>引用本料批的抄纸工序</Typography>
                {relatedRuns.length ? (
                  <Table size="small">
                    <TableHead><TableRow><TableCell>工序号</TableCell><TableCell>日期</TableCell><TableCell>操作人</TableCell><TableCell align="right">克重</TableCell><TableCell align="right">本批分摊 kg</TableCell><TableCell>状态</TableCell></TableRow></TableHead>
                    <TableBody>
                      {relatedRuns.map((run) => {
                        const line = run.batchLines?.find((item) => item.batchId === batch.id)
                        return (
                          <TableRow key={run.id ?? run.runNo}>
                            <TableCell>{run.runNo}</TableCell><TableCell>{run.runDate}</TableCell><TableCell>{run.operator}</TableCell>
                            <TableCell align="right">{run.grammage} 克/平方米</TableCell>
                            <TableCell align="right">{line?.consumedKg.toFixed(3) ?? '—'}</TableCell>
                            <TableCell>{run.frozen ? <Chip size="small" label="冻结" variant="outlined" /> : '正常'}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <Typography color="text.secondary">该料批尚未关联抄纸工序。</Typography>
                )}
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="caption" color="text.secondary">蒸煮后需充分漂洗，再按目标纸性逐步打浆，避免纤维过度切断；合槽时按各批投料量比例分摊本槽消耗。</Typography>
              </AccordionDetails>
            </Accordion>
          )
        })}
        {filteredBatches.length === 0 && (
          <Card><CardContent sx={{ textAlign: 'center', py: 6 }}><Typography color="text.secondary">没有符合当前原料、状态与打浆度范围的料批</Typography></CardContent></Card>
        )}
      </Stack>
    </Stack>
  )
}
