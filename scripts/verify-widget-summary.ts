import { currentNetWorth } from '../src/lib/finance.ts'
import { widgetSummary } from '../supabase/functions/_shared/widget.ts'

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const month = today.slice(0, 7)
const [year, monthNumber] = month.split('-').map(Number)
const previous = new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 10)
const base = { user_id: 'u', created_at: '2025-01-01T00:00:00Z', updated_at: '', deleted_at: null }
const snapshot = {
  accounts: [{ ...base, id: 'a', name: '現金', kind: 'cash', opening_balance: 50000, is_archived: false }, { ...base, id: 'b', name: '銀行', kind: 'bank', opening_balance: 200000, is_archived: true }],
  transactions: [
    { ...base, id: 't1', account_id: 'a', kind: 'expense', amount: 320, transaction_date: today },
    { ...base, id: 't2', account_id: 'a', kind: 'expense', amount: 1500, transaction_date: `${month}-01` },
    { ...base, id: 't3', account_id: 'b', kind: 'income', amount: 40000, transaction_date: `${month}-01` },
    { ...base, id: 't4', account_id: 'b', kind: 'transfer_out', amount: 5000, transaction_date: `${month}-01` },
    { ...base, id: 't5', account_id: 'a', kind: 'transfer_in', amount: 5000, transaction_date: `${month}-01` },
    { ...base, id: 't6', account_id: 'a', kind: 'expense', amount: 999, transaction_date: '2024-12-31' },
  ],
  stocks: [{ ...base, id: 's', ticker: '0050', valuation_amount: 123457, valuation_date: '2025-03-15', annual_return_bps: 700 }],
  liabilities: [{ ...base, id: 'l', name: '車貸', principal: 300000, annual_rate_bps: 250, monthly_payment: 8700, term_months: 36, start_date: '2025-02-10' }],
  netWorthSnapshots: [{ ...base, id: 'n', snapshot_month: previous, cash: 0, stocks: 0, liabilities: 0, net_worth: 400000, is_estimated: false }],
  categories: [], quickTransactions: [], recurringRules: [], investmentPlans: [], forecastEvents: [],
} as any
const result = widgetSummary(snapshot, today)
const expected = currentNetWorth(snapshot).net_worth
assert(result.netWorth === expected, `淨資產 ${result.netWorth} 應等於 App ${expected}`)
assert(result.spentToday === 320, `今日已支出 ${result.spentToday}`)
assert(result.spentThisMonth === 1820, `本月已支出 ${result.spentThisMonth}`)
assert(result.netWorthChange === expected - 400000, '較上月增減')
assert(widgetSummary({ ...snapshot, netWorthSnapshots: [] }, today).netWorthChange === null, '無上月快照時為 null')
console.log('widget summary ok', result)
