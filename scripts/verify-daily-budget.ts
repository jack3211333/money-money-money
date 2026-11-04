import { dailyBudget } from '../src/lib/finance.ts'

const blank = () => ({
  accounts: [], categories: [], transactions: [], quickTransactions: [], liabilities: [], stocks: [], investmentPlans: [], forecastEvents: [],
  recurringRules: [{ id: 'monthly', user_id: 'u', created_at: '', updated_at: '', deleted_at: null, name: '月支出', kind: 'expense', amount: 10000, category_id: null, interval_months: 1, day_of_month: 1, start_date: '2026-01-01', end_date: null, is_active: true }],
} as any)
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
const atMonthStart = dailyBudget(blank(), '2026-01-01')
assert(atMonthStart.remainingDays === 31 && atMonthStart.quota === Math.floor(10000 / 31), 'Month start')
const atMonthEnd = dailyBudget(blank(), '2026-01-31')
assert(atMonthEnd.remainingDays === 1 && atMonthEnd.quota === 10000, 'Month end')
const overspentData = blank()
overspentData.transactions = [{ id: 'past', transaction_date: '2026-06-01', amount: 11000, kind: 'expense', deleted_at: null }]
const overspent = dailyBudget(overspentData, '2026-06-02')
assert(overspent.quota === 0 && overspent.spentBeforeToday === 11000, 'Already overspent')
const zero = blank()
zero.recurringRules = []
const noPlan = dailyBudget(zero, '2026-06-02')
assert(noPlan.planned === 0 && noPlan.quota === 0, 'No forecast configured')
assert(dailyBudget(blank(), '2024-02-01').remainingDays === 29 && dailyBudget(blank(), '2026-02-01').remainingDays === 28, 'February leap and common years')
console.log('dailyBudget boundaries passed: month start, month end, overspent, zero planned, leap/common February')
