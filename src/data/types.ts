export type AccountKind = 'cash' | 'bank' | 'stored_value'
export type CategoryDirection = 'income' | 'expense'
export type TransactionKind = 'income' | 'expense' | 'transfer_in' | 'transfer_out'
export type LiabilityKind = 'loan' | 'installment'
export type RecurringKind = 'income' | 'expense'

export type BaseRecord = { id: string; user_id: string; created_at: string; updated_at: string; deleted_at: string | null }
export type Account = BaseRecord & { name: string; kind: AccountKind; icon_key: string | null; opening_balance: number; currency: 'TWD'; is_archived: boolean; sort_order: number }
export type Category = BaseRecord & { name: string; direction: CategoryDirection; color: string; icon_key: string; parent_id: string | null; sort_order: number }
export type Transaction = BaseRecord & { transaction_date: string; amount: number; kind: TransactionKind; account_id: string; category_id: string | null; transfer_group_id: string | null; is_transfer_fee: boolean; note: string }
export type QuickTransaction = BaseRecord & { kind: 'income' | 'expense'; amount: number; account_id: string; category_id: string | null; note: string }
export type Liability = BaseRecord & { name: string; kind: LiabilityKind; principal: number; annual_rate_bps: number; monthly_payment: number; term_months: number; start_date: string }
export type Stock = BaseRecord & { account_id: string | null; ticker: string; annual_return_bps: number; valuation_amount: number; valuation_date: string }
export type RecurringRule = BaseRecord & { name: string; kind: RecurringKind; amount: number; category_id: string | null; interval_months: number; day_of_month: number; start_date: string; end_date: string | null; is_active: boolean }
export type InvestmentPlan = BaseRecord & { name: string; stock_id: string; monthly_amount: number; day_of_month: number; start_date: string; end_date: string | null; is_active: boolean }
export type ForecastEvent = BaseRecord & { name: string; kind: 'income' | 'expense'; amount: number; event_date: string }

export type FinanceSnapshot = { accounts: Account[]; categories: Category[]; transactions: Transaction[]; quickTransactions: QuickTransaction[]; liabilities: Liability[]; stocks: Stock[]; recurringRules: RecurringRule[]; investmentPlans: InvestmentPlan[]; forecastEvents: ForecastEvent[] }
export const emptySnapshot: FinanceSnapshot = { accounts: [], categories: [], transactions: [], quickTransactions: [], liabilities: [], stocks: [], recurringRules: [], investmentPlans: [], forecastEvents: [] }
