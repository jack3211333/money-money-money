import { useMemo, useState, type FormEvent } from 'react'
import type { FinanceSnapshot, ForecastEvent } from './data/types'
import { financeRepository } from './data/repository'
import { buildForecast, dateToday, lastDayOfMonth, twd } from './lib/finance'
import './forecast.css'

type ForecastModal = 'forecastEvent' | 'recurring' | 'investment'

export function Forecast({ data, open, reload }: { data: FinanceSnapshot; open: (kind: ForecastModal, item?: unknown) => void; reload: () => Promise<void> }) {
  const rows = useMemo(() => buildForecast(data), [data])
  const maximum = Math.max(1, ...rows.map((row) => Math.max(0, row.netWorth)))
  const activePlans = data.investmentPlans.filter((plan) => data.stocks.some((stock) => stock.id === plan.stock_id))
  const remove = async (table: 'forecast_events' | 'recurring_rules' | 'investment_plans', id: string) => {
    const cardBill = table === 'forecast_events' && data.forecastEvents.find((item) => item.id === id)?.account_id
    if (!confirm(cardBill ? '確定要刪除這筆信用卡帳單嗎？本月不會再自動產生，下個月會重新產生。' : '確定要刪除嗎？')) return
    if (cardBill) await financeRepository.dismissCardBill(id)
    else await financeRepository.softDelete(table, id)
    await reload()
  }
  const columns = [
    { key: 'income', label: '收入' }, { key: 'expenses', label: '支出' }, { key: 'monthlyNet', label: '月淨額' },
    { key: 'cash', label: '現金' }, { key: 'stocks', label: '股票市值' }, { key: 'stockContribution', label: '股票投入' },
    { key: 'cumulativeReturn', label: '累計報酬' }, { key: 'liabilities', label: '負債' }, { key: 'netWorth', label: '淨資產' },
  ] as const
  const cell = (row: (typeof rows)[number], key: (typeof columns)[number]['key']) => key === 'expenses'
    ? <details className="expense-detail"><summary>{twd(row.expenses)}</summary><ul>{row.expenseItems.length ? row.expenseItems.map((item, index) => <li key={index}><span>{item.name}</span><b>{twd(item.amount)}</b></li>) : <li>本月無支出</li>}</ul></details>
    : twd(row[key])
  return <>
    <p className="muted">只供參考，不會建立真實交易。推演收支影響總現金，不指定個別帳戶。月淨額＝收入－支出－股票投入；累計報酬從目前股票市值起算，不含投入本金。</p>
    <div className="toolbar forecast-actions"><button className="secondary" onClick={() => open('forecastEvent')}>一次性收支</button><button className="secondary" onClick={() => open('recurring')}>固定收支</button><button className="secondary" onClick={() => open('investment')}>持續投入</button></div>
    <div className="chart">{rows.map((row) => <div key={row.label}><i style={{ height: `${Math.max(4, row.netWorth / maximum * 100)}%` }} /><small>{row.label.slice(5)}</small></div>)}</div>
    <div className="forecast-desktop forecast" role="table" aria-label="未來 12 個月推演"><div className="forecast-grid forecast-heading" role="row"><span>月份</span>{columns.map((column) => <span key={column.key}>{column.label}</span>)}</div>{rows.map((row) => <div className="forecast-grid" role="row" key={row.label}><b>{row.label}</b>{columns.map((column) => <span key={column.key}>{cell(row, column.key)}</span>)}</div>)}</div>
    <div className="forecast-mobile">{rows.map((row) => <details className="forecast-card" key={row.label}><summary><span><b>{row.label}</b><small>月淨額 {twd(row.monthlyNet)}</small></span><strong>{twd(row.netWorth)}</strong></summary><div className="forecast-card-grid">{columns.map((column) => <div key={column.key}><small>{column.label}</small>{column.key === 'expenses' ? cell(row, column.key) : <b>{cell(row, column.key)}</b>}</div>)}</div></details>)}</div>
    <section className="section"><header><h2>推演設定</h2></header><div className="list">
      {data.forecastEvents.map((item) => <div className="row" key={item.id}><span><b>{item.name}</b><small>{item.event_date} · {item.account_id ? `信用卡帳單${item.auto_amount ? '（金額自動更新）' : ''}` : `一次性${item.kind === 'income' ? '收入' : '支出'}`} · {twd(item.amount)}</small></span><button className="text" onClick={() => open('forecastEvent', item)}>編輯</button><button className="text danger" onClick={() => void remove('forecast_events', item.id)}>刪除</button></div>)}
      {data.recurringRules.map((item) => <div className="row" key={item.id}><span><b>{item.name}</b><small>固定{item.kind === 'income' ? '收入' : '支出'} · 每 {item.interval_months} 個月 · {twd(item.amount)}</small></span><button className="text" onClick={() => open('recurring', item)}>編輯</button><button className="text danger" onClick={() => void remove('recurring_rules', item.id)}>刪除</button></div>)}
      {activePlans.map((item) => <div className="row" key={item.id}><span><b>{item.name}</b><small>每月 {twd(item.monthly_amount)}</small></span><button className="text" onClick={() => open('investment', item)}>編輯</button><button className="text danger" onClick={() => void remove('investment_plans', item.id)}>刪除</button></div>)}
      {!data.forecastEvents.length && !data.recurringRules.length && !activePlans.length && <p className="empty">新增一次性收支、固定收支或持續投入。</p>}
    </div></section>
  </>
}

export function ForecastEventDialog({ item, close, done }: { item: ForecastEvent | null; close: () => void; done: () => Promise<void> }) {
  const [name, setName] = useState(item?.name ?? '')
  const [kind, setKind] = useState<'income' | 'expense'>(item?.kind ?? 'expense')
  const [amount, setAmount] = useState(String(item?.amount ?? ''))
  const [eventDate, setEventDate] = useState(item?.event_date ?? dateToday())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cardBill = Boolean(item?.account_id)
  const billMonth = item?.event_date.slice(0, 7) ?? ''
  const billMonthEnd = billMonth ? lastDayOfMonth(billMonth) : ''
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) { setError('請輸入有效的整數金額。'); return }
    setBusy(true); setError('')
    try {
      await financeRepository.saveForecastEvent({ ...(item ? { id: item.id } : {}), name: name.trim(), kind: cardBill ? 'expense' : kind, amount: Number(amount), event_date: eventDate, account_id: item?.account_id ?? null, auto_amount: cardBill ? Boolean(item?.auto_amount) && Number(amount) === item?.amount : true })
      await done()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '儲存失敗') }
    finally { setBusy(false) }
  }
  return <div className="backdrop"><section className="dialog"><header><h2>{cardBill ? '編輯信用卡帳單' : item ? '編輯一次性收支' : '新增一次性收支'}</h2><button className="icon" onClick={close}>×</button></header><form className="form" onSubmit={(event) => void submit(event)}>
    <label>項目名稱<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="旅遊、獎金…" /></label>
    {!cardBill && <label>類型<select value={kind} onChange={(event) => setKind(event.target.value as 'income' | 'expense')}><option value="expense">支出</option><option value="income">收入</option></select></label>}
    <label>金額（TWD）<input required inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} /></label>
    <label>日期<input required type="date" min={cardBill ? `${billMonth}-01` : item?.event_date && item.event_date < dateToday() ? item.event_date : dateToday()} max={cardBill ? billMonthEnd : undefined} value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
    {cardBill ? <small>信用卡帳單：依目前欠款自動產生，不列入每日額度。修改金額後將以你填寫的金額為準、不再自動更新；日期限當月內。</small> : <small>只影響推演，不會新增真實交易。推演顯示未來 12 個月，過去日期不會再次計入。</small>}
    {error && <p className="notice error">{error}</p>}<footer className="footer"><button type="button" className="secondary" onClick={close}>取消</button><button className="primary" disabled={busy}>{busy ? '儲存中…' : '儲存'}</button></footer>
  </form></section></div>
}
