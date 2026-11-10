import { type Debt, liabilityBalance, monthsBetween, taipeiToday } from './budget.ts'

// 與前端 src/lib/finance.ts 的 financialTotals／currentNetWorth 相同算法，供 iPhone 小工具使用。
type Account = { id: string; opening_balance: number }
type Tx = { account_id: string; transaction_date: string; amount: number; kind: string }
type Stock = { valuation_amount: number; valuation_date: string; annual_return_bps: number }
type MonthSnapshot = { snapshot_month: string; net_worth: number }
export type WidgetSnapshot = { accounts: Account[]; transactions: Tx[]; stocks: Stock[]; liabilities: Debt[]; netWorthSnapshots: MonthSnapshot[] }

const signedAmount = (transaction: Tx) => transaction.kind === 'income' || transaction.kind === 'transfer_in' ? transaction.amount : -transaction.amount
const stockValue = (stock: Stock, date: string) => stock.valuation_amount * (1 + stock.annual_return_bps / 10000) ** (monthsBetween(stock.valuation_date, date) / 12)
const previousMonthStart = (today: string) => {
  const [year, month] = today.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 2, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export const widgetSummary = (snapshot: WidgetSnapshot, today = taipeiToday()) => {
  const cash = Math.round(snapshot.accounts.reduce((sum, account) => sum + account.opening_balance + snapshot.transactions.filter((transaction) => transaction.account_id === account.id).reduce((total, transaction) => total + signedAmount(transaction), 0), 0))
  const stocks = Math.max(0, Math.round(snapshot.stocks.reduce((sum, stock) => sum + stockValue(stock, today), 0)))
  const liabilities = Math.max(0, Math.round(snapshot.liabilities.reduce((sum, debt) => sum + liabilityBalance(debt, today), 0)))
  const netWorth = cash + stocks - liabilities
  const expenses = snapshot.transactions.filter((transaction) => transaction.kind === 'expense')
  const spentToday = expenses.filter((transaction) => transaction.transaction_date === today).reduce((sum, transaction) => sum + transaction.amount, 0)
  const spentThisMonth = expenses.filter((transaction) => transaction.transaction_date.startsWith(today.slice(0, 7))).reduce((sum, transaction) => sum + transaction.amount, 0)
  const previous = snapshot.netWorthSnapshots.find((row) => row.snapshot_month.slice(0, 10) === previousMonthStart(today))
  return { date: today, spentToday, spentThisMonth, netWorth, netWorthChange: previous ? netWorth - previous.net_worth : null }
}
