import { currentNetWorth, estimatedNetWorthAt, financialTotals, netWorthRowsToSave } from '../src/lib/finance.ts'

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
const base = { user_id: 'u', updated_at: '', deleted_at: null }
const snapshot = () => ({
  categories: [], quickTransactions: [], recurringRules: [], investmentPlans: [], forecastEvents: [], netWorthSnapshots: [] as any[],
  accounts: [
    { ...base, id: 'a1', created_at: '2026-08-01T02:00:00Z', name: '銀行', kind: 'bank', opening_balance: 100000, is_archived: false, sort_order: 0 },
    { ...base, id: 'a2', created_at: '2026-10-05T02:00:00Z', name: '現金', kind: 'cash', opening_balance: 5000, is_archived: false, sort_order: 1 },
  ],
  transactions: [
    { ...base, id: 't1', created_at: '', account_id: 'a1', kind: 'expense', amount: 20000, transaction_date: '2026-08-15' },
    { ...base, id: 't2', created_at: '', account_id: 'a1', kind: 'income', amount: 50000, transaction_date: '2026-09-05' },
    { ...base, id: 't3', created_at: '', account_id: 'a2', kind: 'expense', amount: 1000, transaction_date: '2026-11-02' },
  ],
  stocks: [{ ...base, id: 's1', created_at: '2026-09-10T02:00:00Z', ticker: '0050', valuation_amount: 200000, valuation_date: '2026-09-10', annual_return_bps: 0 }],
  liabilities: [{ ...base, id: 'l1', created_at: '', name: '分期', kind: 'installment', principal: 12000, annual_rate_bps: 0, monthly_payment: 1000, term_months: 12, start_date: '2026-09-01' }],
} as any)

// 推算：8 月底只有 a1（100000 − 20000），尚無股票與負債。
const aug = estimatedNetWorthAt(snapshot(), '2026-08-31')
assert(aug.cash === 80000 && aug.stocks === 0 && aug.liabilities === 0 && aug.net_worth === 80000, `August ${JSON.stringify(aug)}`)
// 9 月底：收入 50000、股票 200000、分期 12000（9/1 起算，9 月底尚未過第一期繳款日 10/1）。
const sep = estimatedNetWorthAt(snapshot(), '2026-09-30')
assert(sep.cash === 130000 && sep.stocks === 200000 && sep.liabilities === 12000 && sep.net_worth === 318000, `September ${JSON.stringify(sep)}`)
// 10 月底：a2 開立 +5000；分期已繳 1 期。
const oct = estimatedNetWorthAt(snapshot(), '2026-10-31')
assert(oct.cash === 135000 && oct.liabilities === 11000 && oct.net_worth === 324000, `October ${JSON.stringify(oct)}`)

// 本月實際值與總覽的 financialTotals 一致（各項四捨五入至整數元）。
const totals = financialTotals(snapshot())
const now = currentNetWorth(snapshot())
assert(now.cash === Math.round(totals.cash) && now.stocks === Math.round(totals.stocks) && now.liabilities === Math.round(totals.liabilities), 'Current month matches overview totals')
assert(Math.abs(now.net_worth - totals.netWorth) <= 1, 'Current net worth within rounding of overview')

// 首次執行：8～10 月推算＋11 月實際。
const first = netWorthRowsToSave(snapshot(), '2026-11-09')
assert(first.map((row) => `${row.snapshot_month}:${row.is_estimated}`).join(',') === '2026-08-01:true,2026-09-01:true,2026-10-01:true,2026-11-01:false', `First run ${JSON.stringify(first)}`)

// 已寫入且數字未變：不需要再寫入。
const stored = snapshot()
stored.netWorthSnapshots = first.map((row) => ({ ...base, id: row.snapshot_month, created_at: '', ...row }))
assert(netWorthRowsToSave(stored, '2026-11-20').length === 0, 'No writes when unchanged')

// 本月有新交易：只更新本月實際值。
const changed = snapshot()
changed.netWorthSnapshots = stored.netWorthSnapshots
changed.transactions.push({ ...base, id: 't4', created_at: '', account_id: 'a1', kind: 'expense', amount: 300, transaction_date: '2026-11-10' })
const update = netWorthRowsToSave(changed, '2026-11-10')
assert(update.length === 1 && update[0].snapshot_month === '2026-11-01' && !update[0].is_estimated, `Current month update ${JSON.stringify(update)}`)

// 跨月：11 月的實際紀錄保留不覆蓋，12 月新增實際值。
const december = netWorthRowsToSave(changed, '2026-12-01')
assert(december.length === 1 && december[0].snapshot_month === '2026-12-01', `Next month ${JSON.stringify(december)}`)

// 過去月份推算值有變（補記 9 月交易）：更新該推算月份及之後的推算月份，但不動實際紀錄。
const backdated = snapshot()
backdated.netWorthSnapshots = stored.netWorthSnapshots
backdated.transactions.push({ ...base, id: 't5', created_at: '', account_id: 'a1', kind: 'expense', amount: 700, transaction_date: '2026-09-20' })
const fix = netWorthRowsToSave(backdated, '2026-11-09')
assert(fix.map((row) => row.snapshot_month).join(',') === '2026-09-01,2026-10-01,2026-11-01' && fix.slice(0, 2).every((row) => row.is_estimated), `Backdated ${JSON.stringify(fix)}`)

// 沒有任何資料：只記錄本月。
const empty = { ...snapshot(), accounts: [], transactions: [], stocks: [], liabilities: [] }
const only = netWorthRowsToSave(empty, '2026-11-09')
assert(only.length === 1 && only[0].net_worth === 0, 'Empty data records current month only')

console.log('net worth snapshots passed: estimates by month, overview match, first run, unchanged, current update, month rollover, backdated fix, empty data')
