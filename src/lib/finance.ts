import type { Account, FinanceSnapshot, Liability, Stock, Transaction } from '../data/types'

export const twd = (value: number) => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(value)
export const dateToday = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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

export const financialTotals = (snapshot: FinanceSnapshot) => {
  const cash = snapshot.accounts.reduce((sum, account) => sum + accountBalance(account, snapshot.transactions), 0)
  const stocks = snapshot.stocks.reduce((sum, stock) => sum + stockValue(stock), 0)
  const liabilities = snapshot.liabilities.reduce((sum, liability) => sum + liabilityBalance(liability), 0)
  return { cash, stocks, liabilities, assets: cash + stocks, netWorth: cash + stocks - liabilities }
}

export type ForecastExpense = { name: string; amount: number }
export type ForecastMonth = { label: string; income: number; expenses: number; expenseItems: ForecastExpense[]; monthlyNet: number; cash: number; stocks: number; stockContribution: number; cumulativeReturn: number; liabilities: number; netWorth: number }

export const buildForecast = (snapshot: FinanceSnapshot): ForecastMonth[] => {
  const start = new Date(); start.setDate(1)
  let projectedCash = snapshot.accounts.reduce((sum, account) => sum + accountBalance(account, snapshot.transactions), 0)
  const stockValues = Object.fromEntries(snapshot.stocks.map((stock) => [stock.id, stockValue(stock)])) as Record<string, number>
  const initialStockValue = Object.values(stockValues).reduce((sum, value) => sum + value, 0)
  let cumulativeContribution = 0
  const activeStockIds = new Set(snapshot.stocks.map((stock) => stock.id))
  return Array.from({ length: 12 }, (_, index) => {
    const month = new Date(start.getFullYear(), start.getMonth() + index + 2, 0)
    const monthNumber = month.getMonth() + 1
    const monthKey = `${month.getFullYear()}-${String(monthNumber).padStart(2, '0')}`
    const monthEnd = `${monthKey}-${String(month.getDate()).padStart(2, '0')}`
    const today = dateToday()
    let income = 0
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
      else addExpense(`${event.name} · ${event.event_date.slice(5)}`, event.amount)
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
    return { label: `${month.getFullYear()}/${String(monthNumber).padStart(2, '0')}`, income, expenses, expenseItems, monthlyNet: income - expenses - stockContribution, cash, stocks, stockContribution, cumulativeReturn: stocks - initialStockValue - cumulativeContribution, liabilities, netWorth: cash + stocks - liabilities }
  })
}
