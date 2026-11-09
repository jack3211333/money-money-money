export type Row = { id: string; user_id?: string; deleted_at?: string | null }
export type Tx = Row & { transaction_date: string; amount: number; kind: string }
export type Rule = Row & { name: string; kind: 'income' | 'expense'; amount: number; interval_months: number; start_date: string; end_date: string | null; is_active: boolean }
export type Event = Row & { name: string; kind: 'income' | 'expense'; amount: number; event_date: string; account_id?: string | null }
export type Debt = Row & { name: string; principal: number; annual_rate_bps: number; monthly_payment: number; term_months: number; start_date: string }
export type Stock = Row & { id: string; valuation_amount: number; valuation_date: string; annual_return_bps: number }
export type Plan = Row & { stock_id: string; monthly_amount: number; start_date: string; end_date: string | null; is_active: boolean }
export type BudgetSnapshot = { transactions: Tx[]; recurringRules: Rule[]; forecastEvents: Event[]; liabilities: Debt[]; stocks: Stock[]; investmentPlans: Plan[] }
export const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const dateAt = (date: string) => new Date(`${date}T00:00:00Z`)
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
const monthsBetween = (start: string, end: string) => { const a = dateAt(start); const b = dateAt(end); return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth()) }
const liabilityBalance = (debt: Debt, date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  const dueDay = Math.min(Number(debt.start_date.slice(8)), new Date(Date.UTC(year, month, 0)).getUTCDate())
  const paidMonths = Math.min(debt.term_months, Math.max(0, monthsBetween(debt.start_date, date) - (day < dueDay ? 1 : 0)))
  const rate = debt.annual_rate_bps / 10000 / 12
  if (paidMonths >= debt.term_months) return 0
  if (!rate) return Math.max(0, debt.principal - debt.monthly_payment * paidMonths)
  return Math.max(0, debt.principal * (1 + rate) ** paidMonths - debt.monthly_payment * (((1 + rate) ** paidMonths - 1) / rate))
}
export const forecastFirstMonth = (snapshot: BudgetSnapshot, today = taipeiToday()) => {
  const [year, month] = today.split('-').map(Number)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const key = `${nextYear}-${String(nextMonth).padStart(2, '0')}`
  const end = monthEnd(nextYear, nextMonth - 1)
  let expenses = 0
  let stockContribution = 0
  for (const rule of snapshot.recurringRules) {
    const elapsed = monthsBetween(rule.start_date, end)
    if (rule.is_active && rule.start_date <= end && (!rule.end_date || rule.end_date >= `${key}-01`) && elapsed % rule.interval_months === 0 && rule.kind === 'expense') expenses += rule.amount
  }
  // 信用卡帳單（account_id 連結）是本月已計入支出的刷卡款，不列入每日額度。
  for (const event of snapshot.forecastEvents) if (event.event_date.startsWith(key) && event.event_date >= today && event.kind === 'expense' && !event.account_id) expenses += event.amount
  for (const debt of snapshot.liabilities) {
    const dueMonth = monthsBetween(debt.start_date, end)
    if (dueMonth < 1 || dueMonth > debt.term_months || debt.start_date > end) continue
    const dueDay = Math.min(Number(debt.start_date.slice(8)), Number(end.slice(8)))
    const dueDate = `${key}-${String(dueDay).padStart(2, '0')}`
    if (dueDate < today) continue
    const beforeDate = new Date(Date.UTC(nextYear, nextMonth - 1, dueDay - 1)).toISOString().slice(0, 10)
    const outstanding = liabilityBalance(debt, beforeDate)
    if (outstanding > 0) expenses += Math.min(debt.monthly_payment, Math.ceil(outstanding * (1 + debt.annual_rate_bps / 120000)))
  }
  const activeStocks = new Set(snapshot.stocks.filter((stock) => !stock.deleted_at).map((stock) => stock.id))
  for (const plan of snapshot.investmentPlans) if (activeStocks.has(plan.stock_id) && plan.is_active && plan.start_date <= end && (!plan.end_date || plan.end_date >= `${key}-01`)) stockContribution += plan.monthly_amount
  return { expenses, stockContribution }
}
export const dailyBudget = (snapshot: BudgetSnapshot, today = taipeiToday()) => {
  const [year, month, day] = today.split('-').map(Number)
  const monthStart = `${today.slice(0, 7)}-01`
  const plannedRow = forecastFirstMonth(snapshot, today)
  const expenses = snapshot.transactions.filter((transaction) => transaction.kind === 'expense' && !transaction.deleted_at)
  const spentBeforeToday = expenses.filter((transaction) => transaction.transaction_date >= monthStart && transaction.transaction_date < today).reduce((sum, transaction) => sum + transaction.amount, 0)
  const spentToday = expenses.filter((transaction) => transaction.transaction_date === today).reduce((sum, transaction) => sum + transaction.amount, 0)
  const remainingDays = new Date(Date.UTC(year, month, 0)).getUTCDate() - day + 1
  return { planned: plannedRow.expenses + plannedRow.stockContribution, spentBeforeToday, spentToday, remainingDays, quota: Math.floor(Math.max(0, plannedRow.expenses + plannedRow.stockContribution - spentBeforeToday) / remainingDays) }
}
