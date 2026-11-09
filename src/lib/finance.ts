import type { Account, FinanceSnapshot, ForecastEvent, Liability, NetWorthSnapshot, Stock, Transaction } from '../data/types'

export const twd = (value: number) => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(value)
export const dateToday = () => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export const signedAmount = (transaction: Transaction) => {
  if (transaction.kind === 'income' || transaction.kind === 'transfer_in') return transaction.amount
  return -transaction.amount
}

export const accountBalance = (account: Account, transactions: Transaction[]) => account.opening_balance + transactions.filter((transaction) => transaction.account_id === account.id).reduce((sum, transaction) => sum + signedAmount(transaction), 0)

export const monthsBetween = (startDate: string, endDate = dateToday()) => {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  return Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth())
}

export const paymentForRate = (principal: number, annualRateBps: number, termMonths: number) => {
  if (principal <= 0 || termMonths <= 0) return 0
  const monthlyRate = annualRateBps / 10000 / 12
  if (monthlyRate === 0) return Math.max(1, Math.round(principal / termMonths))
  const factor = (1 + monthlyRate) ** termMonths
  return Math.max(1, Math.round(principal * monthlyRate * factor / (factor - 1)))
}

export const rateForPayment = (principal: number, payment: number, termMonths: number): number | null => {
  if (principal <= 0 || payment <= 0 || termMonths <= 0 || payment < principal / termMonths) return null
  if (payment === principal / termMonths) return 0
  const paymentAtRate = (annualRate: number) => {
    const monthlyRate = annualRate / 10000 / 12
    const factor = (1 + monthlyRate) ** termMonths
    return principal * monthlyRate * factor / (factor - 1)
  }
  const maximumRateBps = 100000
  if (payment > paymentAtRate(maximumRateBps)) return null
  let low = 0
  let high = maximumRateBps
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const middle = (low + high) / 2
    if (paymentAtRate(middle) < payment) low = middle
    else high = middle
  }
  return Math.round((low + high) / 2)
}

export const monthlyPayment = (liability: Liability) => liability.monthly_payment

export const liabilityBalance = (liability: Liability, date = dateToday()) => {
  const dueDay = Math.min(Number(liability.start_date.slice(8)), new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate())
  const paidMonths = Math.min(liability.term_months, Math.max(0, monthsBetween(liability.start_date, date) - (Number(date.slice(8)) < dueDay ? 1 : 0)))
  const rate = liability.annual_rate_bps / 10000 / 12
  if (paidMonths >= liability.term_months) return 0
  if (rate === 0) return Math.max(0, liability.principal - liability.monthly_payment * paidMonths)
  const payment = monthlyPayment(liability)
  return Math.max(0, liability.principal * (1 + rate) ** paidMonths - payment * (((1 + rate) ** paidMonths - 1) / rate))
}

export const stockValue = (stock: Stock, date = dateToday()) => {
  const base = stock.valuation_amount
  const baseDate = stock.valuation_date
  const years = monthsBetween(baseDate, date) / 12
  return base * (1 + stock.annual_return_bps / 10000) ** years
}

export const isCreditCard = (account: Pick<Account, 'kind'>) => account.kind === 'credit_card'
// 信用卡餘額為負時是未繳欠款，計入負債；為正（溢繳、退款）時計入現金。
export const splitCardBalance = (balance: number) => ({ cash: Math.max(0, balance), debt: Math.max(0, -balance) })
export const creditCardDebt = (snapshot: Pick<FinanceSnapshot, 'accounts' | 'transactions'>) => snapshot.accounts.filter(isCreditCard).reduce((sum, account) => sum + splitCardBalance(accountBalance(account, snapshot.transactions)).debt, 0)
// 現金含非信用卡帳戶餘額及信用卡溢繳；信用卡欠款不扣現金，改計入負債。
export const cashBalance = (snapshot: Pick<FinanceSnapshot, 'accounts' | 'transactions'>) => snapshot.accounts.reduce((sum, account) => { const balance = accountBalance(account, snapshot.transactions); return sum + (isCreditCard(account) ? splitCardBalance(balance).cash : balance) }, 0)

export const financialTotals = (snapshot: FinanceSnapshot) => {
  const cash = cashBalance(snapshot)
  const cardDebt = creditCardDebt(snapshot)
  const stocks = snapshot.stocks.reduce((sum, stock) => sum + stockValue(stock), 0)
  const liabilities = snapshot.liabilities.reduce((sum, liability) => sum + liabilityBalance(liability), 0) + cardDebt
  return { cash, stocks, liabilities, cardDebt, assets: cash + stocks, netWorth: cash + stocks - liabilities }
}

export const dailyBudget = (snapshot: FinanceSnapshot, today = dateToday()) => {
  const [year, month, day] = today.split('-').map(Number)
  const monthStart = `${today.slice(0, 7)}-01`
  const plannedRow = buildForecast(snapshot)[0]
  // 信用卡帳單是本月已計入支出的刷卡款，不重複列入每日額度。
  const planned = (plannedRow?.expenses ?? 0) - (plannedRow?.cardBills ?? 0) + (plannedRow?.stockContribution ?? 0)
  const expenses = snapshot.transactions.filter((transaction) => transaction.kind === 'expense' && !transaction.deleted_at)
  const spentBeforeToday = expenses.filter((transaction) => transaction.transaction_date >= monthStart && transaction.transaction_date < today).reduce((sum, transaction) => sum + transaction.amount, 0)
  const spentToday = expenses.filter((transaction) => transaction.transaction_date === today).reduce((sum, transaction) => sum + transaction.amount, 0)
  const remainingDays = new Date(year, month, 0).getDate() - day + 1
  return { planned, spentBeforeToday, spentToday, remainingDays, quota: Math.floor(Math.max(0, planned - spentBeforeToday) / remainingDays) }
}

export type ForecastExpense = { name: string; amount: number }
export type ForecastMonth = { label: string; income: number; expenses: number; cardBills: number; expenseItems: ForecastExpense[]; monthlyNet: number; cash: number; stocks: number; stockContribution: number; cumulativeReturn: number; liabilities: number; netWorth: number }

export const buildForecast = (snapshot: FinanceSnapshot): ForecastMonth[] => {
  const [todayYear, todayMonth] = dateToday().split('-').map(Number)
  const start = new Date(todayYear, todayMonth - 1, 1)
  // 起始現金不扣信用卡欠款；欠款由下月的信用卡帳單一次性支出扣除，避免重複計算。
  let projectedCash = cashBalance(snapshot)
  const stockValues = Object.fromEntries(snapshot.stocks.map((stock) => [stock.id, stockValue(stock)])) as Record<string, number>
  const initialStockValue = Object.values(stockValues).reduce((sum, value) => sum + value, 0)
  let cumulativeContribution = 0
  const activeStockIds = new Set(snapshot.stocks.map((stock) => stock.id))
  return Array.from({ length: 12 }, (_, index) => {
    // 第 0 天代表前一個月的最後一天，因此 index 0 是「下個月」的月底；推演從下個月開始，每日額度也使用這一列。
    const month = new Date(start.getFullYear(), start.getMonth() + index + 2, 0)
    const monthNumber = month.getMonth() + 1
    const monthKey = `${month.getFullYear()}-${String(monthNumber).padStart(2, '0')}`
    const monthEnd = `${monthKey}-${String(month.getDate()).padStart(2, '0')}`
    const today = dateToday()
    let income = 0
    let cardBills = 0
    let stockContribution = 0
    let loanPayments = 0
    const expenseItems: ForecastExpense[] = []
    const addExpense = (name: string, amount: number) => expenseItems.push({ name, amount })
    snapshot.recurringRules.filter((rule) => {
      const elapsed = monthsBetween(rule.start_date, monthEnd)
      return rule.is_active && rule.start_date <= monthEnd && (!rule.end_date || rule.end_date >= `${monthKey}-01`) && elapsed % rule.interval_months === 0
    }).forEach((rule) => {
      if (rule.kind === 'income') { projectedCash += rule.amount; income += rule.amount }
      if (rule.kind === 'expense') { projectedCash -= rule.amount; addExpense(rule.name, rule.amount) }
    })
    snapshot.forecastEvents.filter((event) => event.event_date.startsWith(monthKey) && event.event_date >= today).forEach((event) => {
      const signed = event.kind === 'income' ? event.amount : -event.amount
      projectedCash += signed
      if (event.kind === 'income') income += event.amount
      else if (event.account_id) cardBills += event.amount
      if (event.kind === 'expense') addExpense(`${event.name} · ${event.event_date.slice(5)}`, event.amount)
    })
    snapshot.liabilities.forEach((liability) => {
      const dueMonth = monthsBetween(liability.start_date, monthEnd)
      if (dueMonth < 1 || dueMonth > liability.term_months || liability.start_date > monthEnd) return
      const dueDay = Math.min(Number(liability.start_date.slice(8)), month.getDate())
      const dueDate = `${monthKey}-${String(dueDay).padStart(2, '0')}`
      if (dueDate < today) return
      const beforeDue = new Date(month.getFullYear(), month.getMonth(), dueDay - 1)
      const beforeDueDate = `${beforeDue.getFullYear()}-${String(beforeDue.getMonth() + 1).padStart(2, '0')}-${String(beforeDue.getDate()).padStart(2, '0')}`
      const outstanding = liabilityBalance(liability, beforeDueDate)
      if (outstanding <= 0) return
      const dueAmount = Math.min(liability.monthly_payment, Math.ceil(outstanding * (1 + liability.annual_rate_bps / 120000)))
      loanPayments += dueAmount
      addExpense(`${liability.name}月繳`, dueAmount)
    })
    snapshot.stocks.forEach((stock) => { stockValues[stock.id] = (stockValues[stock.id] ?? 0) * (1 + stock.annual_return_bps / 10000 / 12) })
    snapshot.investmentPlans.filter((plan) => activeStockIds.has(plan.stock_id) && plan.is_active && plan.start_date <= monthEnd && (!plan.end_date || plan.end_date >= `${monthKey}-01`)).forEach((plan) => { projectedCash -= plan.monthly_amount; stockValues[plan.stock_id] = (stockValues[plan.stock_id] ?? 0) + plan.monthly_amount; stockContribution += plan.monthly_amount })
    cumulativeContribution += stockContribution
    projectedCash -= loanPayments
    const cash = projectedCash
    const stocks = Object.values(stockValues).reduce((sum, value) => sum + value, 0)
    const liabilities = snapshot.liabilities.reduce((sum, liability) => sum + liabilityBalance(liability, monthEnd), 0)
    const expenses = expenseItems.reduce((sum, item) => sum + item.amount, 0)
    return { label: `${month.getFullYear()}/${String(monthNumber).padStart(2, '0')}`, income, expenses, cardBills, expenseItems, monthlyNet: income - expenses - stockContribution, cash, stocks, stockContribution, cumulativeReturn: stocks - initialStockValue - cumulativeContribution, liabilities, netWorth: cash + stocks - liabilities }
  })
}

// ── 淨資產月快照 ──
// 本月以總覽相同的 financialTotals 記錄實際值；過去月份若沒有實際紀錄，依當月月底推算（is_estimated）。
// 推算：現金與負債可由交易與攤還公式精確還原；股票沒有歷史股價，只能以目前估值基準估算。
export type NetWorthValues = Pick<NetWorthSnapshot, 'cash' | 'stocks' | 'liabilities' | 'net_worth'>
export type NetWorthRow = NetWorthValues & Pick<NetWorthSnapshot, 'snapshot_month' | 'is_estimated'>

const NET_WORTH_MAX_MONTHS = 120
const roundedValues = (cash: number, stocks: number, liabilities: number): NetWorthValues => {
  const values = { cash: Math.round(cash), stocks: Math.max(0, Math.round(stocks)), liabilities: Math.max(0, Math.round(liabilities)) }
  return { ...values, net_worth: values.cash + values.stocks - values.liabilities }
}
const taipeiDate = (timestamp: string) => timestamp ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp)) : '0000-01-01'
export const lastDayOfMonth = (month: string) => {
  const [year, value] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(year, value, 0)).getUTCDate()).padStart(2, '0')}`
}
const addMonths = (month: string, offset: number) => {
  const [year, value] = month.split('-').map(Number)
  const next = new Date(Date.UTC(year, value - 1 + offset, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

export const currentNetWorth = (snapshot: FinanceSnapshot): NetWorthValues => {
  const totals = financialTotals(snapshot)
  return roundedValues(totals.cash, totals.stocks, totals.liabilities)
}

export const estimatedNetWorthAt = (snapshot: FinanceSnapshot, date: string): NetWorthValues => {
  const cardIds = new Set(snapshot.accounts.filter(isCreditCard).map((account) => account.id))
  const openings = snapshot.accounts.filter((account) => !cardIds.has(account.id) && taipeiDate(account.created_at) <= date).reduce((sum, account) => sum + account.opening_balance, 0)
  const movements = snapshot.transactions.filter((transaction) => !cardIds.has(transaction.account_id) && transaction.transaction_date <= date).reduce((sum, transaction) => sum + signedAmount(transaction), 0)
  const cards = snapshot.accounts.filter(isCreditCard).map((account) => splitCardBalance(snapshot.transactions.filter((transaction) => transaction.account_id === account.id && transaction.transaction_date <= date).reduce((sum, transaction) => sum + signedAmount(transaction), 0)))
  const cardCash = cards.reduce((sum, card) => sum + card.cash, 0)
  const cardDebt = cards.reduce((sum, card) => sum + card.debt, 0)
  const stocks = snapshot.stocks.filter((stock) => taipeiDate(stock.created_at) <= date).reduce((sum, stock) => sum + stockValue(stock, date), 0)
  const liabilities = snapshot.liabilities.filter((liability) => liability.start_date <= date).reduce((sum, liability) => sum + liabilityBalance(liability, date), 0)
  return roundedValues(openings + movements + cardCash, stocks, liabilities + cardDebt)
}

const sameValues = (a: NetWorthValues, b: NetWorthValues) => a.cash === b.cash && a.stocks === b.stocks && a.liabilities === b.liabilities && a.net_worth === b.net_worth

// 回傳需要寫入的列：本月實際值有變動時更新；過去月份沒有實際紀錄者補上推算值（推算值有變動時也會更新）。
export const netWorthRowsToSave = (snapshot: FinanceSnapshot, today = dateToday()): NetWorthRow[] => {
  const currentMonth = today.slice(0, 7)
  const existing = new Map(snapshot.netWorthSnapshots.map((row) => [row.snapshot_month.slice(0, 7), row]))
  const starts = [
    ...snapshot.transactions.map((transaction) => transaction.transaction_date.slice(0, 7)),
    ...snapshot.accounts.map((account) => taipeiDate(account.created_at).slice(0, 7)),
  ].filter((month) => month >= '1900-01' && month <= currentMonth).sort()
  let month = starts[0] && starts[0] > addMonths(currentMonth, -NET_WORTH_MAX_MONTHS) ? starts[0] : addMonths(currentMonth, -NET_WORTH_MAX_MONTHS)
  if (!starts.length) month = currentMonth
  const rows: NetWorthRow[] = []
  for (; month < currentMonth; month = addMonths(month, 1)) {
    const saved = existing.get(month)
    if (saved && !saved.is_estimated) continue
    const values = estimatedNetWorthAt(snapshot, lastDayOfMonth(month))
    if (!saved || !sameValues(saved, values)) rows.push({ snapshot_month: `${month}-01`, is_estimated: true, ...values })
  }
  const saved = existing.get(currentMonth)
  const values = currentNetWorth(snapshot)
  if (!saved || saved.is_estimated || !sameValues(saved, values)) rows.push({ snapshot_month: `${currentMonth}-01`, is_estimated: false, ...values })
  return rows
}

// ── 信用卡帳單（推演的下月一次性支出）──
// 每張有欠款的信用卡，在下個月 1 日維持一筆連結帳戶的一次性支出：
// - auto_amount=true 時金額跟著目前欠款更新；使用者改過金額後 auto_amount=false，不再自動更新。
// - 欠款歸零時自動軟刪除（保留 auto_amount=true，之後有欠款會恢復）。
// - 使用者刪除者為 auto_amount=false 且已刪除：該月不再產生，下個月重新產生。
export type CardBillChange = { id?: string; account_id: string; name?: string; amount: number; event_date?: string; deleted_at?: string | null }
export const nextMonthRange = (today = dateToday()) => {
  const month = addMonths(today.slice(0, 7), 1)
  return { start: `${month}-01`, end: lastDayOfMonth(month) }
}
export const cardBillChanges = (snapshot: Pick<FinanceSnapshot, 'accounts' | 'transactions'>, linkedEvents: ForecastEvent[], today = dateToday(), now = new Date().toISOString()): CardBillChange[] => {
  const { start, end } = nextMonthRange(today)
  const changes: CardBillChange[] = []
  for (const account of snapshot.accounts.filter(isCreditCard)) {
    const debt = splitCardBalance(accountBalance(account, snapshot.transactions)).debt
    const events = linkedEvents.filter((event) => event.account_id === account.id && event.event_date >= start && event.event_date <= end)
    const active = events.find((event) => !event.deleted_at)
    if (active) {
      if (!active.auto_amount) continue
      if (debt <= 0) changes.push({ id: active.id, account_id: account.id, amount: active.amount, deleted_at: now })
      else if (active.amount !== debt) changes.push({ id: active.id, account_id: account.id, amount: debt })
      continue
    }
    if (debt <= 0 || events.some((event) => !event.auto_amount)) continue
    const revivable = events.find((event) => event.auto_amount)
    if (revivable) changes.push({ id: revivable.id, account_id: account.id, amount: debt, deleted_at: null })
    else changes.push({ account_id: account.id, name: `${account.name} 帳單`, amount: debt, event_date: start })
  }
  return changes
}
