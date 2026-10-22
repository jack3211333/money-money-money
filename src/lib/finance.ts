import type { Account, FinanceSnapshot, Liability, Stock, Transaction } from '../data/types'

export const twd = (value: number) => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(value)
export const dateToday = () => new Date().toISOString().slice(0, 10)

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

export const monthlyPayment = (liability: Liability) => {
  const rate = liability.annual_rate_bps / 10000 / 12
  if (rate === 0) return liability.principal / liability.term_months
  return liability.principal * (rate * (1 + rate) ** liability.term_months) / ((1 + rate) ** liability.term_months - 1)
}

export const liabilityBalance = (liability: Liability, date = dateToday()) => {
  const paidMonths = Math.min(liability.term_months, monthsBetween(liability.start_date, date))
  const rate = liability.annual_rate_bps / 10000 / 12
  if (paidMonths >= liability.term_months) return 0
  if (rate === 0) return Math.max(0, liability.principal * (1 - paidMonths / liability.term_months))
  const payment = monthlyPayment(liability)
  return Math.max(0, liability.principal * (1 + rate) ** paidMonths - payment * (((1 + rate) ** paidMonths - 1) / rate))
}

export const stockValue = (stock: Stock, date = dateToday()) => {
  const base = stock.valuation_amount ?? stock.total_cost
  const baseDate = stock.valuation_date ?? stock.created_at.slice(0, 10)
  const years = monthsBetween(baseDate, date) / 12
  return base * (1 + stock.annual_return_bps / 10000) ** years
}

export const financialTotals = (snapshot: FinanceSnapshot) => {
  const cash = snapshot.accounts.filter((account) => account.kind !== 'stock').reduce((sum, account) => sum + accountBalance(account, snapshot.transactions), 0)
  const stocks = snapshot.stocks.reduce((sum, stock) => sum + stockValue(stock), 0)
  const liabilities = snapshot.liabilities.reduce((sum, liability) => sum + liabilityBalance(liability), 0)
  return { cash, stocks, liabilities, assets: cash + stocks, netWorth: cash + stocks - liabilities }
}

export type ForecastMonth = { label: string; assets: number; cash: number; stocks: number; liabilities: number; netWorth: number; accounts: Record<string, number> }

export const buildForecast = (snapshot: FinanceSnapshot): ForecastMonth[] => {
  const start = new Date(); start.setDate(1)
  const balances = Object.fromEntries(snapshot.accounts.filter((account) => account.kind !== 'stock').map((account) => [account.id, accountBalance(account, snapshot.transactions)])) as Record<string, number>
  const stockValues = Object.fromEntries(snapshot.stocks.map((stock) => [stock.id, stockValue(stock)])) as Record<string, number>
  return Array.from({ length: 12 }, (_, index) => {
    const month = new Date(start.getFullYear(), start.getMonth() + index + 1, 0)
    const monthNumber = month.getMonth() + 1
    snapshot.recurringRules.filter((rule) => rule.is_active && month >= new Date(`${rule.start_date}T00:00:00`) && (!rule.end_date || month <= new Date(`${rule.end_date}T23:59:59`)) && ((index + 1) % rule.interval_months === 0)).forEach((rule) => {
      if (rule.kind === 'income') balances[rule.account_id] = (balances[rule.account_id] ?? 0) + rule.amount
      if (rule.kind === 'expense') balances[rule.account_id] = (balances[rule.account_id] ?? 0) - rule.amount
      if (rule.kind === 'transfer' && rule.target_account_id) { balances[rule.account_id] = (balances[rule.account_id] ?? 0) - rule.amount; balances[rule.target_account_id] = (balances[rule.target_account_id] ?? 0) + rule.amount }
    })
    snapshot.stocks.forEach((stock) => { stockValues[stock.id] = (stockValues[stock.id] ?? 0) * (1 + stock.annual_return_bps / 10000 / 12) })
    snapshot.investmentPlans.filter((plan) => plan.is_active && month >= new Date(`${plan.start_date}T00:00:00`) && (!plan.end_date || month <= new Date(`${plan.end_date}T23:59:59`))).forEach((plan) => { balances[plan.funding_account_id] = (balances[plan.funding_account_id] ?? 0) - plan.monthly_amount; stockValues[plan.stock_id] = (stockValues[plan.stock_id] ?? 0) + plan.monthly_amount })
    const cash = Object.values(balances).reduce((sum, value) => sum + value, 0)
    const stocks = Object.values(stockValues).reduce((sum, value) => sum + value, 0)
    const date = month.toISOString().slice(0, 10)
    const liabilities = snapshot.liabilities.reduce((sum, liability) => sum + liabilityBalance(liability, date), 0)
    return { label: `${month.getFullYear()}/${String(monthNumber).padStart(2, '0')}`, cash, stocks, liabilities, assets: cash + stocks, netWorth: cash + stocks - liabilities, accounts: { ...balances } }
  })
}
