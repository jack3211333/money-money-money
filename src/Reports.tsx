import { useMemo, useState } from 'react'
import type { Category, FinanceSnapshot, Transaction } from './data/types'
import { dateToday, twd } from './lib/finance'

type RangeMode = 'month' | 'recent3' | 'recent12' | 'custom'
type Breakdown = { id: string; name: string; color: string; amount: number }

const dateAtMonthStart = (offset: number) => {
  const now = new Date()
  return `${new Date(now.getFullYear(), now.getMonth() + offset, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() + offset, 1).getMonth() + 1).padStart(2, '0')}-01`
}

const monthEnd = (month: string) => {
  const [year, value] = month.split('-').map(Number)
  return `${month}-${String(new Date(year, value, 0).getDate()).padStart(2, '0')}`
}

const categoryPath = (category: Category | undefined, categories: Category[]) => {
  if (!category) return '未分類'
  const parent = category.parent_id ? categories.find((item) => item.id === category.parent_id) : undefined
  return parent ? `${parent.name} › ${category.name}` : category.name
}

const rootCategory = (category: Category | undefined, categories: Category[]) => category?.parent_id ? categories.find((item) => item.id === category.parent_id) : category

const rangeLabel = (mode: RangeMode, month: string, start: string, end: string) => {
  if (mode === 'month') return `${month.replace('-', ' 年 ')} 月`
  if (mode === 'recent3') return '近三個月'
  if (mode === 'recent12') return '近十二個月'
  return `${start} 至 ${end}`
}

const pathForSlice = (start: number, end: number) => {
  const point = (angle: number) => {
    const radians = (angle - 90) * Math.PI / 180
    return `${50 + 40 * Math.cos(radians)} ${50 + 40 * Math.sin(radians)}`
  }
  return `M 50 50 L ${point(start)} A 40 40 0 ${end - start > 180 ? 1 : 0} 1 ${point(end)} Z`
}

function PieChart({ items, selectedId, select }: { items: Breakdown[]; selectedId?: string; select?: (id: string) => void }) {
  const total = items.reduce((sum, item) => sum + item.amount, 0)
  if (!total) return <p className="empty report-empty">這個範圍沒有可統計的資料。</p>
  if (items.length === 1) return <svg className="pie" viewBox="0 0 100 100" aria-label={`${items[0].name} 100%`}><circle cx="50" cy="50" r="40" fill={items[0].color} /></svg>
  let angle = 0
  return <svg className="pie" viewBox="0 0 100 100" aria-label="分類圓餅圖">{items.map((item) => {
    const next = angle + item.amount / total * 360
    const path = pathForSlice(angle, next)
    angle = next
    const active = selectedId === item.id
    return <path key={item.id} d={path} fill={item.color} className={active ? 'pie-slice active' : 'pie-slice'} role={select ? 'button' : undefined} tabIndex={select ? 0 : undefined} aria-label={`${item.name} ${twd(item.amount)}`} onClick={() => select?.(item.id)} onKeyDown={(event) => { if (select && (event.key === 'Enter' || event.key === ' ')) select(item.id) }} />
  })}</svg>
}

function BreakdownPanel({ title, items, selectedId, select }: { title: string; items: Breakdown[]; selectedId?: string; select?: (id: string) => void }) {
  const total = items.reduce((sum, item) => sum + item.amount, 0)
  return <section className="section report-card"><header><h2>{title}</h2><small>{total ? twd(total) : '—'}</small></header><div className="report-pie-content"><PieChart items={items} selectedId={selectedId} select={select} /><div className="report-legend">{items.map((item) => <button type="button" className={selectedId === item.id ? 'report-legend-item active' : 'report-legend-item'} key={item.id} onClick={() => select?.(item.id)}><i style={{ background: item.color }} /><span>{item.name}</span><b>{twd(item.amount)}</b></button>)}{!items.length && <p className="empty">沒有資料。</p>}</div></div></section>
}

function TrendChart({ rows }: { rows: { label: string; income: number; expense: number }[] }) {
  const peak = Math.max(1, ...rows.flatMap((item) => [item.income, item.expense]))
  if (!rows.some((item) => item.income || item.expense)) return <p className="empty report-empty">這個範圍沒有收支趨勢。</p>
  return <div className="report-trend">{rows.map((item) => <div className="report-trend-item" key={item.label}><div className="report-trend-bars" title={`${item.label}：收入 ${twd(item.income)}，支出 ${twd(item.expense)}`}><i className="trend-income" style={{ height: `${Math.max(item.income ? 5 : 0, item.income / peak * 100)}%` }} /><i className="trend-expense" style={{ height: `${Math.max(item.expense ? 5 : 0, item.expense / peak * 100)}%` }} /></div><small>{item.label}</small></div>)}</div>
}

export function Reports({ data }: { data: FinanceSnapshot }) {
  const today = dateToday()
  const [mode, setMode] = useState<RangeMode>('month')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [customStart, setCustomStart] = useState(dateAtMonthStart(0))
  const [customEnd, setCustomEnd] = useState(today)
  const [expenseRootId, setExpenseRootId] = useState<string | null>(null)
  const { start, end } = useMemo(() => {
    if (mode === 'recent3') return { start: dateAtMonthStart(-2), end: today }
    if (mode === 'recent12') return { start: dateAtMonthStart(-11), end: today }
    if (mode === 'custom') return customStart <= customEnd ? { start: customStart, end: customEnd } : { start: customEnd, end: customStart }
    return { start: `${month}-01`, end: monthEnd(month) }
  }, [customEnd, customStart, mode, month, today])
  const transactions = useMemo(() => data.transactions.filter((item) => item.transaction_date >= start && item.transaction_date <= end && (item.kind === 'income' || item.kind === 'expense')), [data.transactions, end, start])
  const totals = useMemo(() => transactions.reduce((all, item) => ({ income: all.income + (item.kind === 'income' ? item.amount : 0), expense: all.expense + (item.kind === 'expense' ? item.amount : 0) }), { income: 0, expense: 0 }), [transactions])
  const expenseRoots = useMemo(() => summarize(transactions.filter((item) => item.kind === 'expense'), data.categories, 'root'), [data.categories, transactions])
  const incomeRoots = useMemo(() => summarize(transactions.filter((item) => item.kind === 'income'), data.categories, 'root'), [data.categories, transactions])
  const selectedExpense = expenseRoots.find((item) => item.id === expenseRootId)
  const expenseChildren = useMemo(() => expenseRootId ? summarize(transactions.filter((item) => item.kind === 'expense'), data.categories, 'child', expenseRootId) : [], [data.categories, expenseRootId, transactions])
  const topExpenses = useMemo(() => transactions.filter((item) => item.kind === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5), [transactions])
  const trend = useMemo(() => makeTrend(transactions, start, end), [end, start, transactions])
  const chooseMode = (next: RangeMode) => { setMode(next); setExpenseRootId(null) }
  return <>
    <section className="report-controls"><div className="range-actions"><button type="button" className={mode === 'month' && month === today.slice(0, 7) ? 'secondary selected-range' : 'secondary'} onClick={() => { setMonth(today.slice(0, 7)); chooseMode('month') }}>本月</button><button type="button" className={mode === 'recent3' ? 'secondary selected-range' : 'secondary'} onClick={() => chooseMode('recent3')}>近三月</button><button type="button" className={mode === 'recent12' ? 'secondary selected-range' : 'secondary'} onClick={() => chooseMode('recent12')}>近十二月</button></div><div className="report-period-inputs"><label>整月<select value={month} onChange={(event) => { setMonth(event.target.value); chooseMode('month') }}>{monthOptions(today).map((item) => <option value={item} key={item}>{item.replace('-', ' 年 ')} 月</option>)}</select></label><label>自訂起日<input type="date" value={customStart} onChange={(event) => { setCustomStart(event.target.value || today); chooseMode('custom') }} /></label><label>自訂迄日<input type="date" min={customStart} value={customEnd} onChange={(event) => { setCustomEnd(event.target.value || customStart); chooseMode('custom') }} /></label></div><small className="report-period-label">目前範圍：{rangeLabel(mode, month, start, end)}</small>
    </section>
    <div className="metrics transaction-metrics report-metrics"><Metric title="總支出" value={twd(totals.expense)} /><Metric title="總收入" value={twd(totals.income)} /><Metric title="淨收入" value={twd(totals.income - totals.expense)} /></div>
    <section className="section report-card"><header><h2>{start.slice(0, 7) === end.slice(0, 7) ? '每日收支趨勢' : '每月收支趨勢'}</h2><small>收入／支出</small></header><TrendChart rows={trend} /></section>
    <BreakdownPanel title="支出分類" items={expenseRoots} selectedId={expenseRootId ?? undefined} select={(id) => setExpenseRootId((current) => current === id ? null : id)} />
    {selectedExpense && <BreakdownPanel title={`${selectedExpense.name}的小分類`} items={expenseChildren} />}
    <BreakdownPanel title="收入分類" items={incomeRoots} />
    <section className="section report-card"><header><h2>單筆支出 Top 5</h2><small>{rangeLabel(mode, month, start, end)}</small></header><div className="list">{topExpenses.map((item, index) => <article className="report-top-expense" key={item.id}><b>{index + 1}</b><span><strong>{item.note || categoryPath(data.categories.find((category) => category.id === item.category_id), data.categories)}</strong><small>{item.transaction_date} · {categoryPath(data.categories.find((category) => category.id === item.category_id), data.categories)}</small></span><em>{twd(item.amount)}</em></article>)}{!topExpenses.length && <Empty />}</div></section>
  </>
}

function Metric({ title, value }: { title: string; value: string }) { return <div className="metric"><small>{title}</small><b>{value}</b></div> }
function Empty() { return <p className="empty">這個範圍沒有支出資料。</p> }

function summarize(transactions: Transaction[], categories: Category[], level: 'root' | 'child', rootId?: string): Breakdown[] {
  const values = new Map<string, Breakdown>()
  transactions.forEach((transaction) => {
    const category = categories.find((item) => item.id === transaction.category_id)
    const root = rootCategory(category, categories)
    if (level === 'child' && root?.id !== rootId) return
    const current = level === 'root' ? root : category
    const id = current?.id ?? 'uncategorized'
    const name = current?.name ?? '未分類'
    const existing = values.get(id) ?? { id, name: level === 'child' && current?.id === rootId ? '未細分' : name, color: current?.color ?? '#73808e', amount: 0 }
    existing.amount += transaction.amount
    values.set(id, existing)
  })
  return [...values.values()].sort((a, b) => b.amount - a.amount)
}

function makeTrend(transactions: Transaction[], start: string, end: string) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  const values = new Map<string, { label: string; income: number; expense: number }>()
  const cursor = new Date(`${start}T12:00:00`)
  const last = new Date(`${end}T12:00:00`)
  while (cursor <= last) {
    const key = sameMonth ? `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}` : `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    if (!values.has(key)) values.set(key, { label: sameMonth ? key.slice(8) : key.slice(2).replace('-', '/'), income: 0, expense: 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  transactions.forEach((item) => {
    const key = sameMonth ? item.transaction_date : item.transaction_date.slice(0, 7)
    const bucket = values.get(key)
    if (bucket) {
      if (item.kind === 'income') bucket.income += item.amount
      if (item.kind === 'expense') bucket.expense += item.amount
    }
  })
  return [...values.values()]
}

function monthOptions(today: string) {
  const result: string[] = []
  const current = new Date(`${today.slice(0, 7)}-01T12:00:00`)
  for (let offset = 0; offset < 36; offset += 1) {
    const value = new Date(current.getFullYear(), current.getMonth() - offset, 1)
    result.push(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}
