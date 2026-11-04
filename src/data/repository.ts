import type { User } from '@supabase/supabase-js'
import { emptySnapshot, type Account, type Category, type FinanceSnapshot, type ForecastEvent, type InvestmentPlan, type Liability, type QuickTransaction, type RecurringRule, type Stock, type Transaction } from './types'
import { supabase } from './supabase'

type TableName = 'accounts' | 'categories' | 'transactions' | 'quick_transactions' | 'liabilities' | 'stocks' | 'recurring_rules' | 'investment_plans' | 'forecast_events'
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

const all = async <T>(table: TableName, order: string): Promise<T[]> => {
  const { data, error } = await client().from(table).select('*').order(order)
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
  async cachedUser(): Promise<User | null> {
    const { data } = await client().auth.getSession()
    return data.session?.user ?? null
  },
  async currentUser(): Promise<User | null> {
    const { data, error } = await client().auth.getUser()
    if (error?.name === 'AuthSessionMissingError') return null
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
  async signInWithPassword(email: string, password: string) {
    const { error } = await client().auth.signInWithPassword({ email, password })
    if (error) throw error
  },
  async setPassword(password: string) {
    const { error } = await client().auth.updateUser({ password })
    if (error) throw error
  },
  async signOut() {
    const { error } = await client().auth.signOut()
    if (error) throw error
  },
  async refreshSession() {
    const { data, error } = await client().auth.refreshSession()
    if (error) throw error
    return data.session
  },
  onAuthChange(callback: () => void) {
    return client().auth.onAuthStateChange(() => callback())
  },
}

export const financeRepository = {
  async snapshot(): Promise<FinanceSnapshot> {
    if (!supabase) return emptySnapshot
    const { error: categorySeedError } = await client().rpc('ensure_default_categories')
    if (categorySeedError) throw categorySeedError
    const [accounts, categories, transactions, quickTransactions, liabilities, stocks, recurringRules, investmentPlans, forecastEvents] = await Promise.all([
      active<Account>('accounts', 'sort_order'), all<Category>('categories', 'sort_order'), active<Transaction>('transactions', 'transaction_date'),
      active<QuickTransaction>('quick_transactions', 'created_at'),
      active<Liability>('liabilities', 'start_date'), active<Stock>('stocks', 'ticker'), active<RecurringRule>('recurring_rules', 'name'),
      active<InvestmentPlan>('investment_plans', 'name'),
      active<ForecastEvent>('forecast_events', 'event_date'),
    ])
    return { accounts, categories, transactions, quickTransactions, liabilities, stocks, recurringRules, investmentPlans, forecastEvents }
  },
  async saveAccount(value: Partial<Account> & Create<Account>) {
    if (value.id || value.sort_order !== undefined) return save<Account>('accounts', value)
    const { data, error } = await client().from('accounts').select('sort_order').is('deleted_at', null).order('sort_order', { ascending: false }).limit(1)
    if (error) throw error
    return save<Account>('accounts', { ...value, sort_order: (data?.[0]?.sort_order ?? -1) + 1 })
  },
  saveCategory: (value: Partial<Category> & Create<Category>) => save<Category>('categories', value),
  saveTransaction: (value: Partial<Transaction> & Create<Transaction>) => save<Transaction>('transactions', value),
  saveQuickTransaction: (value: Partial<QuickTransaction> & Create<QuickTransaction>) => save<QuickTransaction>('quick_transactions', value),
  async insertOfflineTransaction(value: Transaction) {
    const { error } = await client().from('transactions').insert({
      id: value.id,
      transaction_date: value.transaction_date,
      amount: value.amount,
      kind: value.kind,
      account_id: value.account_id,
      category_id: value.category_id,
      transfer_group_id: null,
      is_transfer_fee: false,
      note: value.note,
    } as never)
    if (error) throw error
  },
  saveLiability: (value: Partial<Liability> & Create<Liability>) => save<Liability>('liabilities', value),
  saveStock: (value: (Partial<Stock> & Pick<Stock, 'id'>) | Create<Stock>) => save<Stock>('stocks', value),
  saveRecurringRule: (value: Partial<RecurringRule> & Create<RecurringRule>) => save<RecurringRule>('recurring_rules', value),
  saveInvestmentPlan: (value: Partial<InvestmentPlan> & Create<InvestmentPlan>) => save<InvestmentPlan>('investment_plans', value),
  saveForecastEvent: (value: Partial<ForecastEvent> & Create<ForecastEvent>) => save<ForecastEvent>('forecast_events', value),
  async saveTransfer(input: { transactionDate: string; amount: number; fromAccountId: string; toAccountId: string; note: string; transferFee: number; feeCategoryId: string | null; groupId?: string }) {
    const groupId = input.groupId ?? crypto.randomUUID()
    const { error } = await client().rpc('save_transfer', {
      p_group_id: groupId,
      p_transaction_date: input.transactionDate,
      p_amount: input.amount,
      p_from_account_id: input.fromAccountId,
      p_to_account_id: input.toAccountId,
      p_note: input.note,
      p_transfer_fee: input.transferFee,
      p_fee_category_id: input.feeCategoryId,
    })
    if (error) throw error
  },
  async updateTransfer(groupId: string, input: { transactionDate: string; amount: number; fromAccountId: string; toAccountId: string; note: string; transferFee: number; feeCategoryId: string | null }) {
    await this.saveTransfer({ ...input, groupId })
  },
  async softDelete(table: TableName, id: string) {
    const { error } = await client().from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },
  async softDeleteCategory(id: string) {
    const { error } = await client().rpc('soft_delete_category', { target_id: id })
    if (error) throw error
  },
  async softDeleteTransfer(groupId: string) {
    const { error } = await client().from('transactions').update({ deleted_at: new Date().toISOString() }).eq('transfer_group_id', groupId)
    if (error) throw error
  },
}

export const pushRepository = {
  async activeSubscription() {
    const { data, error } = await client().from('push_subscriptions').select('*').is('deleted_at', null).maybeSingle()
    if (error) throw error
    return data
  },
  async saveSubscription(value: { endpoint: string; p256dh: string; auth: string; user_agent: string }) {
    const existing = await client().from('push_subscriptions').select('id').eq('endpoint', value.endpoint).is('deleted_at', null).maybeSingle()
    if (existing.error) throw existing.error
    let current = existing.data
    if (!current) {
      const active = await client().from('push_subscriptions').select('id').is('deleted_at', null).limit(1).maybeSingle()
      if (active.error) throw active.error
      current = active.data
    }
    const request = current
      ? client().from('push_subscriptions').update(value).eq('id', current.id)
      : client().from('push_subscriptions').insert(value)
    const { error } = await request
    if (error) throw error
  },
  async softDeleteSubscription(endpoint: string) {
    const { error } = await client().from('push_subscriptions').update({ deleted_at: new Date().toISOString() }).eq('endpoint', endpoint).is('deleted_at', null)
    if (error) throw error
  },
  async testPush() {
    const { data, error } = await client().functions.invoke('push-test', { body: {} })
    if (error) {
      const context = (error as Error & { context?: Response }).context
      let responseBody: { reason?: string; statusCode?: number } | undefined
      if (context) {
        try { responseBody = await context.clone().json() } catch { /* Keep the SDK's request error below. */ }
      }
      if (responseBody?.reason) throw new Error(pushFailureMessage(responseBody))
      throw new Error(error.message || '測試通知請求失敗。')
    }
    if (data?.reason !== 'sent') throw new Error(pushFailureMessage(data ?? { reason: 'push_failed' }))
  },
}

function pushFailureMessage(result: { reason?: string; statusCode?: number }) {
  if (result.reason === 'no_subscription') return '找不到有效訂閱，請先重新開啟每日通知。 (no_subscription)'
  if (result.reason === 'planned_zero') return '尚未設定推演。 (planned_zero)'
  if (result.reason === 'push_failed') return `推播傳送失敗${result.statusCode ? `（HTTP ${result.statusCode}）` : ''}。(push_failed)`
  return '測試通知失敗。'
}
