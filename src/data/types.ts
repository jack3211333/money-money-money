export type AccountKind = 'cash' | 'bank' | 'stock'
export type CategoryDirection = 'income' | 'expense'
export type TransactionKind = 'income' | 'expense' | 'transfer_in' | 'transfer_out'
export type LiabilityKind = 'loan' | 'installment'
export type RecurringKind = 'income' | 'expense' | 'transfer'

export type BaseRecord = { id: string; user_id: string; created_at: string; updated_at: string; deleted_at: string | null }
export type Account = BaseRecord & { name: string; kind: AccountKind; opening_balance: number; currency: 'TWD'; is_archived: boolean }
export type Category = BaseRecord & { name: string; direction: CategoryDirection; color: string; icon_key: string; parent_id: string | null; sort_order: number }
export type Transaction = BaseRecord & { transaction_date: string; amount: number; kind: TransactionKind; account_id: string; category_id: string | null; transfer_group_id: string | null; note: string }
export type Liability = BaseRecord & { name: string; kind: LiabilityKind; principal: number; annual_rate_bps: number; term_months: number; start_date: string }
export type Stock = BaseRecord & { account_id: string; ticker: string; shares: number; total_cost: number; annual_return_bps: number; valuation_amount: number | null; valuation_date: string | null }
export type RecurringRule = BaseRecord & { name: string; kind: RecurringKind; amount: number; account_id: string; target_account_id: string | null; category_id: string | null; interval_months: number; day_of_month: number; start_date: string; end_date: string | null; is_active: boolean }
export type InvestmentPlan = BaseRecord & { name: string; stock_id: string; funding_account_id: string; monthly_amount: number; day_of_month: number; start_date: string; end_date: string | null; is_active: boolean }

export type FinanceSnapshot = { accounts: Account[]; categories: Category[]; transactions: Transaction[]; liabilities: Liability[]; stocks: Stock[]; recurringRules: RecurringRule[]; investmentPlans: InvestmentPlan[] }
export const emptySnapshot: FinanceSnapshot = { accounts: [], categories: [], transactions: [], liabilities: [], stocks: [], recurringRules: [], investmentPlans: [] }
