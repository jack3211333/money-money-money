import type { User } from '@supabase/supabase-js'
import { emptySnapshot, type Account, type Category, type FinanceSnapshot, type InvestmentPlan, type Liability, type RecurringRule, type Stock, type Transaction } from './types'
import { supabase } from './supabase'

type TableName = 'accounts' | 'categories' | 'transactions' | 'liabilities' | 'stocks' | 'recurring_rules' | 'investment_plans'
type Create<T> = Omit<T, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'>

const client = () => {
  if (!supabase) throw new Error('尚未設定 Supabase。請依 README 建立 .env 後重新啟動。')
  return supabase
}

const active = async <T>(table: TableName, order: string): Promise<T[]> => {
  const { data, error } = await client().from(table).select('*').is('deleted_at', null).order(order)
  if (error) throw error
  return data as T[]
}

const save = async <T extends { id: string }>(table: TableName, value: Partial<T> & Record<string, unknown>): Promise<T> => {
  const { id, ...changes } = value
  const request = id
    ? client().from(table).update(changes as never).eq('id', id).select().single()
    : client().from(table).insert(changes as never).select().single()
  const { data, error } = await request
  if (error) throw error
  return data as T
}

export const authRepository = {
  async currentUser(): Promise<User | null> {
    const { data, error } = await client().auth.getUser()
    if (error) throw error
    return data.user
  },
  async sendMagicLink(email: string) {
    const { error } = await client().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw error
  },
  async signOut() {
    const { error } = await client().auth.signOut()
    if (error) throw error
  },
  onAuthChange(callback: () => void) {
    return client().auth.onAuthStateChange(() => callback())
  },
}

export const financeRepository = {
  async snapshot(): Promise<FinanceSnapshot> {
    if (!supabase) return emptySnapshot
    const [accounts, categories, transactions, liabilities, stocks, recurringRules, investmentPlans] = await Promise.all([
      active<Account>('accounts', 'name'), active<Category>('categories', 'sort_order'), active<Transaction>('transactions', 'transaction_date'),
      active<Liability>('liabilities', 'start_date'), active<Stock>('stocks', 'ticker'), active<RecurringRule>('recurring_rules', 'name'),
      active<InvestmentPlan>('investment_plans', 'name'),
    ])
    return { accounts, categories, transactions, liabilities, stocks, recurringRules, investmentPlans }
  },
  saveAccount: (value: Partial<Account> & Create<Account>) => save<Account>('accounts', value),
  saveCategory: (value: Partial<Category> & Create<Category>) => save<Category>('categories', value),
  saveTransaction: (value: Partial<Transaction> & Create<Transaction>) => save<Transaction>('transactions', value),
  saveLiability: (value: Partial<Liability> & Create<Liability>) => save<Liability>('liabilities', value),
  saveStock: (value: Partial<Stock> & Create<Stock>) => save<Stock>('stocks', value),
  saveRecurringRule: (value: Partial<RecurringRule> & Create<RecurringRule>) => save<RecurringRule>('recurring_rules', value),
  saveInvestmentPlan: (value: Partial<InvestmentPlan> & Create<InvestmentPlan>) => save<InvestmentPlan>('investment_plans', value),
  async saveTransfer(input: { transactionDate: string; amount: number; fromAccountId: string; toAccountId: string; note: string; groupId?: string }) {
    const groupId = input.groupId ?? crypto.randomUUID()
    const rows = [
      { transaction_date: input.transactionDate, amount: input.amount, kind: 'transfer_out', account_id: input.fromAccountId, transfer_group_id: groupId, category_id: null, note: input.note },
      { transaction_date: input.transactionDate, amount: input.amount, kind: 'transfer_in', account_id: input.toAccountId, transfer_group_id: groupId, category_id: null, note: input.note },
    ]
    const { error } = await client().from('transactions').insert(rows)
    if (error) throw error
  },
  async updateTransfer(groupId: string, input: { transactionDate: string; amount: number; fromAccountId: string; toAccountId: string; note: string }) {
    const { error: deleteError } = await client().from('transactions').update({ deleted_at: new Date().toISOString() }).eq('transfer_group_id', groupId).is('deleted_at', null)
    if (deleteError) throw deleteError
    await this.saveTransfer({ ...input, groupId })
  },
  async softDelete(table: TableName, id: string) {
    const { error } = await client().from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },
  async softDeleteTransfer(groupId: string) {
    const { error } = await client().from('transactions').update({ deleted_at: new Date().toISOString() }).eq('transfer_group_id', groupId)
    if (error) throw error
  },
}
