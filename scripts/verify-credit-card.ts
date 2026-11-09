import { buildForecast, cardBillChanges, currentNetWorth, dailyBudget, estimatedNetWorthAt, financialTotals } from '../src/lib/finance.ts'
import { dailyBudget as edgeDailyBudget } from '../supabase/functions/_shared/budget.ts'

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
const base = { user_id: 'u', created_at: '2026-10-01T00:00:00Z', updated_at: '', deleted_at: null }
const tx = (id: string, account_id: string, kind: string, amount: number, transaction_date: string) => ({ ...base, id, account_id, kind, amount, transaction_date, category_id: null, transfer_group_id: kind.startsWith('transfer') ? 'g' + id : null, is_transfer_fee: false, note: '' })
const make = () => ({
  categories: [], quickTransactions: [], recurringRules: [], investmentPlans: [], stocks: [], liabilities: [], netWorthSnapshots: [], forecastEvents: [] as any[],
  accounts: [
    { ...base, id: 'bank', name: '銀行', kind: 'bank', opening_balance: 50000, is_archived: false, sort_order: 0, icon_key: null, currency: 'TWD' },
    { ...base, id: 'card', name: '玉山卡', kind: 'credit_card', opening_balance: 0, is_archived: false, sort_order: 1, icon_key: null, currency: 'TWD' },
  ],
  transactions: [tx('c1', 'card', 'expense', 14071, '2026-11-02'), tx('c2', 'card', 'expense', 929, '2026-11-05')] as any[],
} as any)

// 刷卡：欠款 15000 計入負債，現金不受影響；淨資產 = 50000 − 15000。
const swiped = financialTotals(make())
assert(swiped.cash === 50000 && swiped.cardDebt === 15000 && swiped.liabilities === 15000 && swiped.netWorth === 35000, `Swiped ${JSON.stringify(swiped)}`)

// 繳費：銀行轉帳 15000 到卡片，不算支出；現金減少、負債歸零、淨資產不變。
const paid = make()
paid.transactions.push(tx('p1', 'bank', 'transfer_out', 15000, '2026-11-08'), tx('p2', 'card', 'transfer_in', 15000, '2026-11-08'))
const paidTotals = financialTotals(paid)
assert(paidTotals.cash === 35000 && paidTotals.liabilities === 0 && paidTotals.netWorth === 35000, `Paid ${JSON.stringify(paidTotals)}`)
assert(dailyBudget(paid, '2026-11-09').spentBeforeToday === 15000, 'Card payment is not an expense; only swipes count')

// 溢繳：多轉 500，卡片 +500 計入現金。
const over = make()
over.transactions.push(tx('p1', 'bank', 'transfer_out', 15500, '2026-11-08'), tx('p2', 'card', 'transfer_in', 15500, '2026-11-08'))
const overTotals = financialTotals(over)
assert(overTotals.cash === 35000 && overTotals.liabilities === 0 && overTotals.netWorth === 35000, `Overpaid ${JSON.stringify(overTotals)}`)

// 淨資產快照（本月與推算）同樣拆分。
assert(currentNetWorth(make()).liabilities === 15000 && currentNetWorth(make()).cash === 50000, 'Snapshot splits card debt')
const oct = estimatedNetWorthAt(make(), '2026-10-31')
assert(oct.cash === 50000 && oct.liabilities === 0, `October estimate ${JSON.stringify(oct)}`)
const novEstimate = estimatedNetWorthAt(make(), '2026-11-30')
assert(novEstimate.cash === 50000 && novEstimate.liabilities === 15000 && novEstimate.net_worth === 35000, `November estimate ${JSON.stringify(novEstimate)}`)

// 帳單同步：無帳單時新增下月 1 日一筆。
const created = cardBillChanges(make(), [], '2026-11-09', 'NOW')
assert(created.length === 1 && created[0].amount === 15000 && created[0].event_date === '2026-12-01' && created[0].name === '玉山卡 帳單' && !created[0].id, `Create ${JSON.stringify(created)}`)
const bill = (extra: object) => ({ ...base, id: 'b1', name: '玉山卡 帳單', kind: 'expense', amount: 15000, event_date: '2026-12-01', account_id: 'card', auto_amount: true, ...extra }) as any
// 金額相同：不動。欠款變動：自動更新。
assert(cardBillChanges(make(), [bill({})], '2026-11-09').length === 0, 'Unchanged bill')
const more = make(); more.transactions.push(tx('c3', 'card', 'expense', 1000, '2026-11-09'))
const updated = cardBillChanges(more, [bill({})], '2026-11-09')
assert(updated.length === 1 && updated[0].id === 'b1' && updated[0].amount === 16000 && updated[0].deleted_at === undefined, `Update ${JSON.stringify(updated)}`)
// 使用者改過金額：不再自動更新。
assert(cardBillChanges(more, [bill({ auto_amount: false, amount: 12000 })], '2026-11-09').length === 0, 'Manual amount kept')
// 繳清：自動軟刪除；之後再刷卡：恢復同一筆。
const cleared = cardBillChanges(paid, [bill({})], '2026-11-09', 'NOW')
assert(cleared.length === 1 && cleared[0].deleted_at === 'NOW', `Auto remove ${JSON.stringify(cleared)}`)
const revived = cardBillChanges(make(), [bill({ deleted_at: 'NOW' })], '2026-11-09')
assert(revived.length === 1 && revived[0].id === 'b1' && revived[0].deleted_at === null && revived[0].amount === 15000, `Revive ${JSON.stringify(revived)}`)
// 使用者刪除：當月不再產生；下個月重新產生。
assert(cardBillChanges(make(), [bill({ deleted_at: 'NOW', auto_amount: false })], '2026-11-09').length === 0, 'User deletion respected')
const nextMonth = cardBillChanges(make(), [bill({ deleted_at: 'NOW', auto_amount: false })], '2026-12-02')
assert(nextMonth.length === 1 && nextMonth[0].event_date === '2027-01-01' && !nextMonth[0].id, `Next month recreate ${JSON.stringify(nextMonth)}`)

// 推演：起始現金不扣欠款，下月帳單扣現金；每日額度（前端與推播）都不含帳單。
const withBill = make()
withBill.forecastEvents = [bill({})]
withBill.recurringRules = [{ ...base, id: 'r', name: '房租', kind: 'expense', amount: 20000, category_id: null, interval_months: 1, day_of_month: 1, start_date: '2026-01-01', end_date: null, is_active: true }]
const forecast = buildForecast(withBill)[0]
assert(forecast.cardBills === 15000 && forecast.expenses === 35000, `Forecast bill ${JSON.stringify({ e: forecast.expenses, b: forecast.cardBills })}`)
const front = dailyBudget(withBill, '2026-11-09')
const edge = edgeDailyBudget(withBill, '2026-11-09')
assert(front.planned === 20000 && edge.planned === 20000, `Budget excludes card bill: front ${front.planned}, edge ${edge.planned}`)

console.log('credit card passed: swipe → debt, payment transfer not expense, overpay, snapshots, bill create/update/manual/clear/revive/user-delete/next-month, forecast & budget exclusion')
