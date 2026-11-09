import { useMemo, useState } from 'react'
import type { NetWorthSnapshot } from './data/types'
import { twd } from './lib/finance'

type Range = 'recent12' | 'all'

const compact = new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 })
const monthLabel = (month: string) => `${month.slice(0, 4)}/${month.slice(5, 7)}`
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${twd(Math.abs(value))}`

const W = 320
const H = 168
const PAD = { top: 14, right: 12, bottom: 24, left: 46 }

export function NetWorthTrend({ snapshots }: { snapshots: NetWorthSnapshot[] }) {
  const [range, setRange] = useState<Range>('recent12')
  const sorted = useMemo(() => [...snapshots].sort((a, b) => a.snapshot_month.localeCompare(b.snapshot_month)), [snapshots])
  const rows = range === 'all' ? sorted : sorted.slice(-12)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const selected = rows.find((row) => row.snapshot_month === selectedMonth) ?? rows[rows.length - 1]
  const previousOf = (row: NetWorthSnapshot) => sorted[sorted.findIndex((item) => item.snapshot_month === row.snapshot_month) - 1]

  const chart = useMemo(() => {
    if (!rows.length) return null
    const values = rows.map((row) => row.net_worth)
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (min === max) { const margin = Math.max(1000, Math.abs(max) * 0.1); min -= margin; max += margin }
    const span = max - min
    min -= span * 0.08
    max += span * 0.08
    const x = (index: number) => rows.length === 1 ? (PAD.left + W - PAD.right) / 2 : PAD.left + index / (rows.length - 1) * (W - PAD.left - PAD.right)
    const y = (value: number) => PAD.top + (max - value) / (max - min) * (H - PAD.top - PAD.bottom)
    const points = rows.map((row, index) => ({ row, x: x(index), y: y(row.net_worth) }))
    const ticks = [max, (max + min) / 2, min]
    return { points, ticks, y, zero: min < 0 && max > 0 ? y(0) : null }
  }, [rows])

  const labelEvery = Math.max(1, Math.ceil(rows.length / 4))
  return <section className="section report-card net-worth-card">
    <header><h2>淨資產走勢</h2><div className="range-actions"><button type="button" className={range === 'recent12' ? 'secondary selected-range' : 'secondary'} onClick={() => setRange('recent12')}>近 12 個月</button><button type="button" className={range === 'all' ? 'secondary selected-range' : 'secondary'} onClick={() => setRange('all')}>全部</button></div></header>
    {!chart || !selected ? <p className="empty report-empty">連線開啟 App 後會自動記錄本月淨資產。</p> : <>
      <svg className="net-worth-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`淨資產走勢，共 ${rows.length} 個月`}>
        {chart.ticks.map((value) => <g key={value}><line className="net-worth-grid" x1={PAD.left} x2={W - PAD.right} y1={chart.y(value)} y2={chart.y(value)} /><text className="net-worth-axis" x={PAD.left - 6} y={chart.y(value) + 3} textAnchor="end">{compact.format(Math.round(value))}</text></g>)}
        {chart.zero !== null && <line className="net-worth-zero" x1={PAD.left} x2={W - PAD.right} y1={chart.zero} y2={chart.zero} />}
        {chart.points.length > 1 && <polyline className="net-worth-line" points={chart.points.map((point) => `${point.x},${point.y}`).join(' ')} />}
        {chart.points.map((point, index) => (index % labelEvery === 0 || index === chart.points.length - 1) && <text key={`label-${point.row.snapshot_month}`} className="net-worth-axis" x={point.x} y={H - 6} textAnchor="middle">{point.row.snapshot_month.slice(2, 7).replace('-', '/')}</text>)}
        {chart.points.map((point) => { const active = point.row.snapshot_month === selected.snapshot_month; return <g key={point.row.snapshot_month} role="button" tabIndex={0} aria-label={`${monthLabel(point.row.snapshot_month)} 淨資產 ${twd(point.row.net_worth)}${point.row.is_estimated ? '（推算）' : ''}`} onClick={() => setSelectedMonth(point.row.snapshot_month)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedMonth(point.row.snapshot_month) }}><circle className="net-worth-hit" cx={point.x} cy={point.y} r={12} /><circle className={`net-worth-point${point.row.is_estimated ? ' estimated' : ''}${active ? ' active' : ''}`} cx={point.x} cy={point.y} r={active ? 5 : 3.5} /></g> })}
      </svg>
      <div className="net-worth-legend"><span><i className="dot" />實際記錄</span><span><i className="dot estimated" />推算</span></div>
      <NetWorthDetail row={selected} previous={previousOf(selected)} />
      <div className="net-worth-table">{[...rows].reverse().map((row) => { const previous = previousOf(row); const change = previous ? row.net_worth - previous.net_worth : null; return <button type="button" key={row.snapshot_month} className={row.snapshot_month === selected.snapshot_month ? 'net-worth-row active' : 'net-worth-row'} onClick={() => setSelectedMonth(row.snapshot_month)}><span>{monthLabel(row.snapshot_month)}{row.is_estimated && <small>推算</small>}</span><b>{twd(row.net_worth)}</b><em className={change === null ? '' : change < 0 ? 'down' : 'up'}>{change === null ? '—' : signed(change)}</em></button> })}</div>
    </>}
  </section>
}

function NetWorthDetail({ row, previous }: { row: NetWorthSnapshot; previous?: NetWorthSnapshot }) {
  const change = previous ? row.net_worth - previous.net_worth : null
  return <div className="net-worth-detail">
    <div><small>{monthLabel(row.snapshot_month)} 淨資產{row.is_estimated ? '（推算）' : ''}</small><strong>{twd(row.net_worth)}</strong>{change !== null && <em className={change < 0 ? 'down' : 'up'}>較上月 {signed(change)}</em>}</div>
    <dl><div><dt>現金</dt><dd>{twd(row.cash)}</dd></div><div><dt>股票</dt><dd>{twd(row.stocks)}</dd></div><div><dt>負債</dt><dd>{twd(row.liabilities)}</dd></div></dl>
    {row.is_estimated && <p>推算值：現金與負債依交易與攤還公式還原；股票沒有歷史股價，以目前估值基準估算。</p>}
  </div>
}
