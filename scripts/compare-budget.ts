import { buildForecast, dateToday, dailyBudget } from '../src/lib/finance.ts'
import { dailyBudget as edgeDailyBudget } from '../supabase/functions/_shared/budget.ts'

const today = dateToday()
const [year, month] = today.split('-').map(Number)
const nextMonth = month === 12 ? 1 : month + 1
const nextYear = month === 12 ? year + 1 : year
const nextKey = `${nextYear}-${String(nextMonth).padStart(2, '0')}`
const previousMonthDate = new Date(year, month - 2, 15)
const snapshot = {
  accounts: [], categories: [], transactions: [], quickTransactions: [],
  recurringRules: [{ id: 'rule', user_id: 'user', created_at: '', updated_at: '', deleted_at: null, name: '固定支出', kind: 'expense', amount: 12000, category_id: null, interval_months: 1, day_of_month: 5, start_date: '2026-01-05', end_date: null, is_active: true }],
  forecastEvents: [{ id: 'event', user_id: 'user', created_at: '', updated_at: '', deleted_at: null, name: '年度保費', kind: 'expense', amount: 6500, event_date: `${nextKey}-12` }],
  liabilities: [{ id: 'debt', user_id: 'user', created_at: '', updated_at: '', deleted_at: null, name: '貸款', kind: 'loan', principal: 500000, annual_rate_bps: 360, monthly_payment: 9000, term_months: 120, start_date: `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}-15` }],
  stocks: [{ id: 'stock', user_id: 'user', created_at: '', updated_at: '', deleted_at: null, ticker: 'TEST', account_id: null, shares: null, annual_return_bps: 500, valuation_amount: 100000, valuation_date: today }],
  investmentPlans: [{ id: 'plan', user_id: 'user', created_at: '', updated_at: '', deleted_at: null, name: '每月投入', stock_id: 'stock', monthly_amount: 3000, day_of_month: 5, start_date: '2026-01-05', end_date: null, is_active: true }],
} as any
const frontend = buildForecast(snapshot)[0]
const edge = edgeDailyBudget(snapshot, today)
const frontendPlanned = frontend.expenses + frontend.stockContribution
const frontendBudget = dailyBudget(snapshot, today)
if (frontendPlanned !== edge.planned || frontendBudget.planned !== edge.planned) throw new Error(`Mismatch: frontend forecast ${frontendPlanned}, frontend budget ${frontendBudget.planned}, edge ${edge.planned}`)
console.log(JSON.stringify({ frontendPlanned, frontendBudgetPlanned: frontendBudget.planned, edgePlanned: edge.planned, matched: true }))
