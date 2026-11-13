// @ts-nocheck -- Supabase rows are runtime-validated by Postgres; UI forms use dynamic fields.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import './App.css'
import './category.css'
import './account.css'
import { Forecast, ForecastEventDialog } from './Forecast'
import { Reports } from './Reports'
import { AccountIcon, accountIconOptions } from './accountIcons'
import { CategoryIcon, categoryIconOptions } from './categoryIcons'
import { authRepository, financeRepository, pushRepository } from './data/repository'
import { offlineStore, type FailedTransaction, type PendingTransaction } from './data/offline'
import { isSupabaseConfigured } from './data/supabase'
import { emptySnapshot, type Account, type Category, type CategoryDirection, type FinanceSnapshot, type ForecastEvent, type Liability, type QuickTransaction, type Stock, type Transaction } from './data/types'
import { accountBalance, dailyBudget, netWorthRowsToSave, dateToday, financialTotals, liabilityBalance, paymentForRate, rateForPayment, stockValue, twd } from './lib/finance'

type Page = 'home' | 'transactions' | 'reports' | 'assets' | 'forecast' | 'settings'
type Modal = 'transaction' | 'quickTransactions' | 'account' | 'category' | 'liability' | 'stock' | 'recurring' | 'investment' | 'forecastEvent' | null
type TransferEdit = Transaction & { targetAccountId?: string; defaultDate?: string }
type CategoryDialogTarget = { item?: Category; parentId?: string; direction?: CategoryDirection }
const accountKinds: Record<Account['kind'], string> = { cash: '現金', bank: '銀行', stored_value: '儲值卡' }

export default function App() {
  const [user, setUser] = useState<User | null>(null); const [data, setData] = useState<FinanceSnapshot>(emptySnapshot)
  const [page, setPage] = useState<Page>('home'); const [modal, setModal] = useState<Modal>(null); const [editing, setEditing] = useState<unknown>(null); const [message, setMessage] = useState(''); const [selectedTransactionDate, setSelectedTransactionDate] = useState(dateToday()); const [online, setOnline] = useState(navigator.onLine); const [syncRequest, setSyncRequest] = useState(0); const [pending, setPending] = useState<PendingTransaction[]>([]); const [failed, setFailed] = useState<FailedTransaction[]>([]); const [showNotifications, setShowNotifications] = useState(false)
  const [launchNewTransaction, setLaunchNewTransaction] = useState(() => new URLSearchParams(window.location.search).get('action') === 'new-transaction')
  const refreshLocal = async (current = user) => { if (!current) return; const [pendingRows, failedRows] = await Promise.all([offlineStore.pending(current.id), offlineStore.failed(current.id)]); setPending(pendingRows); setFailed(failedRows) }
  const mergePending = (snapshot: FinanceSnapshot, rows: PendingTransaction[]): FinanceSnapshot => ({ ...emptySnapshot, ...snapshot, quickTransactions: snapshot.quickTransactions ?? [], transactions: [...snapshot.transactions, ...rows.map((row) => ({ ...row, created_at: row.queued_at, updated_at: row.queued_at, deleted_at: null }))] })
  const recordNetWorth = async (snapshot: FinanceSnapshot) => {
    if (!user) return
    try {
      const rows = netWorthRowsToSave(snapshot)
      if (!rows.length) return
      const saved = await financeRepository.upsertNetWorthSnapshots(rows.map((row) => ({ ...row, user_id: user.id })))
      const months = new Set(saved.map((row) => row.snapshot_month))
      const netWorthSnapshots = [...snapshot.netWorthSnapshots.filter((row) => !months.has(row.snapshot_month)), ...saved].sort((a, b) => a.snapshot_month.localeCompare(b.snapshot_month))
      await offlineStore.saveSnapshot(user.id, { ...snapshot, netWorthSnapshots })
      setData((current) => ({ ...current, netWorthSnapshots }))
    } catch (error) { console.warn('淨資產快照寫入失敗', error) }
  }
  const reload = async () => { if (!user) return; try { const snapshot = await financeRepository.snapshot(); await offlineStore.saveSnapshot(user.id, snapshot); const rows = await offlineStore.pending(user.id); setPending(rows); setData(mergePending(snapshot, rows)); setMessage(''); if (!rows.length) void recordNetWorth(snapshot) } catch (error) { const cached = await offlineStore.snapshot(user.id); const rows = await offlineStore.pending(user.id); setPending(rows); if (cached) setData(mergePending(cached, rows)); setMessage('目前離線，顯示最後同步資料。') } }
  const sync = async () => {
    if (!user || !navigator.onLine) return
    const work = async () => {
      const rows = await offlineStore.pending(user.id)
      if (!rows.length) return
      let snapshot: FinanceSnapshot
      try { snapshot = await financeRepository.snapshot() } catch { return }
      for (const row of rows) {
        const account = snapshot.accounts.find((item) => item.id === row.account_id && !item.is_archived)
        const category = row.category_id ? snapshot.categories.find((item) => item.id === row.category_id && !item.deleted_at) : true
        if (!account) { await offlineStore.fail(row, '帳戶已刪除或封存。'); continue }
        if (!category) { await offlineStore.fail(row, '分類已刪除。'); continue }
        try { await financeRepository.insertOfflineTransaction({ ...row, created_at: row.queued_at, updated_at: row.queued_at, deleted_at: null }) }
        catch (error: any) {
          const code = error?.code as string | undefined
          if (code === '23503') { await offlineStore.fail(row, '相關帳戶或分類已不存在。'); continue }
          if (code === '23514' || code?.startsWith('22')) { await offlineStore.fail(row, '交易資料不符合資料庫規則。'); continue }
          if (error?.status === 400) { await offlineStore.fail(row, '交易資料無法寫入。'); continue }
          if (error?.status === 401) { try { await authRepository.refreshSession() } catch {} }
          continue
        }
        try {
          snapshot = await financeRepository.snapshot()
          if (snapshot.transactions.some((item) => item.id === row.id)) await offlineStore.removePending(user.id, row.id)
        } catch { return }
      }
      const latest = await offlineStore.pending(user.id); await offlineStore.saveSnapshot(user.id, snapshot); setPending(latest); setData(mergePending(snapshot, latest)); setFailed(await offlineStore.failed(user.id))
    }
    const locks = (navigator as any).locks
    if (locks?.request) await locks.request('money-money-money-sync', work); else await work()
  }
  useEffect(() => { if (!isSupabaseConfigured) return; void offlineStore.persist(); authRepository.cachedUser().then(async (current) => { setUser(current); if (!current) return; const cached = await offlineStore.snapshot(current.id); const rows = await offlineStore.pending(current.id); if (cached) setData(mergePending(cached, rows)); await refreshLocal(current) }); const { data: subscription } = authRepository.onAuthChange(() => void authRepository.cachedUser().then((current) => setUser(current))); const onOnline = () => { setOnline(true); setSyncRequest((value) => value + 1) }; const onOffline = () => setOnline(false); const onVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine) setSyncRequest((value) => value + 1) }; window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); document.addEventListener('visibilitychange', onVisible); return () => { subscription.subscription.unsubscribe(); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); document.removeEventListener('visibilitychange', onVisible) } }, [])
  useEffect(() => { if (user && online) { void reload(); void sync() } }, [user, online, syncRequest])
  useEffect(() => { if (user && online && 'Notification' in window && Notification.permission === 'granted' && import.meta.env.VITE_VAPID_PUBLIC_KEY) void syncPushSubscription(undefined, false).catch((error) => setMessage(error instanceof Error ? error.message : '推播訂閱同步失敗。')) }, [user, online])
  useEffect(() => {
    if (!user || !launchNewTransaction) return
    setEditing(null)
    setModal('transaction')
    setLaunchNewTransaction(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('action')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [user, launchNewTransaction])
  const open = (kind: Modal, item?: unknown) => { if (!online && (kind !== 'transaction' || Boolean((item as TransferEdit | undefined)?.id))) { setMessage(kind === 'quickTransactions' ? '離線時無法管理快速交易。' : '離線時只可新增單筆收入或支出。'); return } setEditing(item ?? null); setModal(kind) }
  const done = async () => { setModal(null); setEditing(null); await reload() }
  const queueTransaction = async (value: Omit<PendingTransaction, 'id' | 'user_id' | 'queued_at'>) => { if (!user) return; const row: PendingTransaction = { ...value, id: crypto.randomUUID(), user_id: user.id, queued_at: new Date().toISOString(), account_name: data.accounts.find((item) => item.id === value.account_id)?.name, category_name: value.category_id ? categoryName(data.categories.find((item) => item.id === value.category_id)!, data.categories) : undefined }; await offlineStore.addPending(row); const rows = [...await offlineStore.pending(user.id)]; setPending(rows); setData((current) => mergePending({ ...current, transactions: current.transactions.filter((item) => !pending.some((old) => old.id === item.id)) }, rows)); setMessage('已儲存到本機，恢復連線後會自動同步。') }
  const removePending = async (id: string) => { if (!user || !confirm('這筆交易尚未寫入雲端，只會從本機刪除，確定刪除嗎？')) return; await offlineStore.removePending(user.id, id); await refreshLocal(); setData((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== id) })) }
  const removeFailed = async (id: string) => { if (!user || !confirm('這筆交易尚未寫入雲端，只會從本機刪除，確定刪除嗎？')) return; await offlineStore.removeFailed(user.id, id); await refreshLocal() }
  if (!isSupabaseConfigured) return <Setup />
  if (!user) return <Login />
  const unread = failed.filter((item) => !item.read).length
  const logout = async () => { if (pending.length && !confirm('還有未同步交易。登出後資料會保留在這台裝置，重新登入同帳號後才會同步，確定登出嗎？')) return; await authRepository.signOut(); setData(emptySnapshot); setUser(null) }
  const openNotifications = async () => { setShowNotifications(true); if (user) { await offlineStore.markFailedRead(user.id); await refreshLocal() } }
  return <main className="shell">
    <header className="top"><div><small>MONEY MONEY MONEY</small><h1>{({ home: '總覽', transactions: '交易', reports: '報表', assets: '資產與負債', forecast: '未來推演', settings: '設定' })[page]}</h1></div><div className="top-actions"><button className="icon notification-button" onClick={() => void openNotifications()} aria-label="同步通知">♢{unread > 0 && <b>{unread}</b>}</button><button className="icon" onClick={() => setPage('settings')}>⚙</button></div></header>
    {!online && <p className="notice offline">離線中：僅可新增收入或支出。</p>}{pending.length > 0 && <p className="notice pending">含未同步 {pending.length} 筆；iPhone 需開啟 App 才會同步。</p>}{message && <p className="notice error">{message}</p>}
    <section className="content">{page === 'home' && <Home data={data} open={open} goToAssets={() => setPage('assets')} />}{page === 'transactions' && <Transactions data={data} open={open} selectedDate={selectedTransactionDate} setSelectedDate={setSelectedTransactionDate} pendingIds={new Set(pending.map((item) => item.id))} removePending={removePending} />}{page === 'reports' && <Reports data={data} />}{page === 'assets' && <Assets data={data} open={open} reload={reload} online={online} onMessage={setMessage} />}{page === 'forecast' && <Forecast data={data} open={open} reload={reload} />}{page === 'settings' && <Settings data={data} open={open} reload={reload} logout={logout} user={user} online={online} />}</section>
    <nav><Nav page={page} value="home" label="總覽" icon="●" set={setPage} /><Nav page={page} value="transactions" label="交易" icon="≡" set={setPage} /><button className="add" onClick={() => open('transaction', { defaultDate: page === 'transactions' ? selectedTransactionDate : dateToday() })}>＋<span>新增</span></button><Nav page={page} value="reports" label="報表" icon="◔" set={setPage} /><Nav page={page} value="forecast" label="推演" icon="↗" set={setPage} /></nav>
    {showNotifications && <Notifications items={failed} close={() => setShowNotifications(false)} remove={removeFailed} />}
    {modal === 'transaction' && <TransactionDialog data={data} item={editing as TransferEdit | null} close={() => setModal(null)} done={done} offline={!online} queue={queueTransaction} />}
    {modal === 'quickTransactions' && <QuickTransactionsDialog data={data} close={() => setModal(null)} reload={reload} />}
    {modal === 'account' && <AccountDialog item={editing as Account | null} close={() => setModal(null)} done={done} />}{modal === 'category' && <CategoryDialog data={data} target={editing as CategoryDialogTarget | null} close={() => setModal(null)} done={done} />}{modal === 'liability' && <LiabilityDialog item={editing as Liability | null} close={() => setModal(null)} done={done} />}{modal === 'stock' && <StockDialog item={editing as Stock | null} close={() => setModal(null)} done={done} />}{modal === 'recurring' && <RecurringDialog data={data} item={editing as any} close={() => setModal(null)} done={done} />}{modal === 'investment' && <InvestmentDialog data={data} item={editing as any} close={() => setModal(null)} done={done} />}{modal === 'forecastEvent' && <ForecastEventDialog item={editing as ForecastEvent | null} close={() => setModal(null)} done={done} />}
  </main>
}

function Setup() { return <main className="center"><section className="login"><b className="logo">¥</b><h1>連接你的帳本</h1><p>網站已準備好，尚未連接 Supabase 雲端資料庫。</p><ol><li>依 README 建立 Supabase 專案。</li><li>將 <code>.env.example</code> 複製為 <code>.env</code>。</li><li>自行填入網址和 Publishable key，重新啟動。</li></ol><small>金鑰不會儲存在程式碼或 Git。</small></section></main> }
function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await authRepository.signInWithPassword(email, password) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '登入失敗') }
    finally { setBusy(false) }
  }
  const magic = async () => {
    if (!email) { setError('請先輸入 Email。'); return }
    setBusy(true); setError('')
    try { await authRepository.sendMagicLink(email); setMessage('已寄出登入連結，請查看信箱。登入後到設定頁建立密碼。') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '寄送失敗；請稍後再試。') }
    finally { setBusy(false) }
  }
  return <main className="center"><form className="login" onSubmit={submit}><b className="logo">¥</b><h1>你的財務，自己掌握</h1><p>使用同一個 Email 和密碼登入。</p><label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><label>密碼<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="notice error">{error}</p>}{message && <p className="notice success">{message}</p>}<button className="primary wide" disabled={busy}>{busy ? '處理中…' : '登入'}</button><button type="button" className="secondary wide" disabled={busy} onClick={() => void magic()}>尚未設定密碼？寄一次登入連結</button></form></main>
}
function Nav({ page, value, label, icon, set }: { page: Page; value: Page; label: string; icon: string; set: (page: Page) => void }) { return <button className={page === value ? 'nav active' : 'nav'} onClick={() => set(value)}><b>{icon}</b><span>{label}</span></button> }
function activeCategories(categories: Category[]) { return categories.filter((category) => !category.deleted_at) }
function categoryName(category: Category, categories: Category[]) { const parent = category.parent_id ? categories.find((item) => item.id === category.parent_id) : undefined; return parent ? `${parent.name} › ${category.name}` : category.name }
function Home({ data, open, goToAssets }: { data: FinanceSnapshot; open: (m: Modal) => void; goToAssets: () => void }) { const totals = useMemo(() => financialTotals(data), [data]); const budget = useMemo(() => dailyBudget(data), [data]); const currentMonth = dateToday().slice(0, 7); const flow = data.transactions.filter((t) => t.transaction_date.startsWith(currentMonth)).reduce((all, t) => ({ income: all.income + (t.kind === 'income' ? t.amount : 0), expense: all.expense + (t.kind === 'expense' ? t.amount : 0) }), { income: 0, expense: 0 }); return <><section className="hero"><span>淨資產</span><strong>{twd(totals.netWorth)}</strong><small>資產 {twd(totals.assets)}　負債 {twd(totals.liabilities)}</small><button className="hero-action" onClick={goToAssets}>查看資產與負債</button></section><div className="metrics"><Metric title="本月收入" value={twd(flow.income)} /><Metric title="本月支出" value={twd(flow.expense)} /><Metric title="本月預計支出" value={twd(budget.planned)} /><Metric title="本日可支出額度" value={twd(budget.quota)} detail={`今日已支出 ${twd(budget.spentToday)}`} /></div><Section title="帳戶餘額" action="管理" click={() => open('account')}><div className="list">{data.accounts.filter((a) => !a.is_archived).map((a) => <div className="row" key={a.id}><AccountIcon iconKey={a.icon_key} /><span><b>{a.name}</b><small>{accountKinds[a.kind]}</small></span><strong>{twd(accountBalance(a, data.transactions))}</strong></div>)}{!data.accounts.length && <Empty text="先新增帳戶。" />}</div></Section></> }
function Metric({ title, value, detail }: { title: string; value: string; detail?: string }) { return <div className="metric"><small>{title}</small><b>{value}</b>{detail && <small>{detail}</small>}</div> }
class PushFlowError extends Error {
  stage: string
  constructor(stage: string, cause: unknown) {
    const code = (cause as { code?: string } | null)?.code
    super(`${stage}：${safePushError(cause)}${code ? ` (${code})` : ''}`)
    this.stage = stage
  }
}
const safePushError = (cause: unknown) => {
  const text = cause instanceof Error ? cause.message : String(cause)
  return text.replace(/https?:\/\/\S+/gi, '[已隱藏]').replace(/[A-Za-z0-9_-]{32,}/g, '[已隱藏]').slice(0, 220)
}
const applicationServerKey = (value: string) => {
  const base64 = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const decoded = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  if (decoded.length !== 65 || decoded[0] !== 4) throw new Error('VAPID public key 格式無效')
  return decoded
}
async function syncPushSubscription(onProgress?: (progress: { user?: string; write?: string; verification?: string }) => void, subscribeIfMissing = true) {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
  if (!key) throw new PushFlowError('VAPID 設定失敗', new Error('尚未設定公開 VAPID key'))
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new PushFlowError('訂閱失敗', new Error('此瀏覽器不支援 Web Push'))
  let registration: ServiceWorkerRegistration
  try { registration = await navigator.serviceWorker.ready } catch (error) { throw new PushFlowError('Service Worker 準備失敗', error) }
  let subscription: PushSubscription | null
  try { subscription = await registration.pushManager.getSubscription() } catch (error) { throw new PushFlowError('讀取訂閱失敗', error) }
  if (!subscription) {
    if (!subscribeIfMissing) return null
    let serverKey: Uint8Array
    try { serverKey = applicationServerKey(key) } catch (error) { throw new PushFlowError('訂閱失敗', error) }
    try { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey }) }
    catch (error) { throw new PushFlowError('訂閱失敗', error) }
  }
  let json: PushSubscriptionJSON
  try { json = subscription.toJSON() } catch (error) { throw new PushFlowError('讀取訂閱資料失敗', error) }
  if (!subscription.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new PushFlowError('讀取訂閱資料失敗', new Error('瀏覽器未提供必要的推播欄位'))
  try { return await pushRepository.saveSubscription({ endpoint: subscription.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent }, onProgress) }
  catch (error) { throw new PushFlowError((error as { stage?: string })?.stage === 'verification' ? '驗證失敗' : (error as { stage?: string })?.stage === 'user' ? '登入驗證失敗' : '寫入失敗', error) }
}
function Transactions({ data, open, selectedDate, setSelectedDate, pendingIds, removePending }: { data: FinanceSnapshot; open: (m: Modal, item?: unknown) => void; selectedDate: string; setSelectedDate: (date: string) => void; pendingIds: Set<string>; removePending: (id: string) => Promise<void> }) {
  const [search, setSearch] = useState('')
  const [rangeMode, setRangeMode] = useState<'day' | 'month' | 'custom'>('day')
  const [customStart, setCustomStart] = useState(dateToday())
  const [customEnd, setCustomEnd] = useState(dateToday())
  const monthStart = `${selectedDate.slice(0, 7)}-01`
  const monthEnd = new Date(Number(selectedDate.slice(0, 4)), Number(selectedDate.slice(5, 7)), 0).toISOString().slice(0, 10)
  const rangeStart = rangeMode === 'month' ? monthStart : rangeMode === 'custom' ? customStart : selectedDate
  const rangeEnd = rangeMode === 'month' ? monthEnd : rangeMode === 'custom' ? customEnd : selectedDate
  const inRange = (date: string) => date >= rangeStart && date <= rangeEnd
  const defaultDate = inRange(dateToday()) ? dateToday() : rangeStart
  const periodLabel = rangeMode === 'month' ? `${selectedDate.slice(0, 7)} 全月` : rangeMode === 'custom' ? `${rangeStart} 至 ${rangeEnd}` : `${selectedDate}`
  const feeByGroup = new Map(data.transactions.filter((t) => t.is_transfer_fee && t.transfer_group_id).map((t) => [t.transfer_group_id!, t]))
  const rows = data.transactions.filter((t) => t.kind !== 'transfer_in' && !t.is_transfer_fee && inRange(t.transaction_date)).filter((t) => {
    const fee = t.transfer_group_id ? feeByGroup.get(t.transfer_group_id) : undefined
    const category = data.categories.find((c) => c.id === t.category_id)
    const feeCategory = fee ? data.categories.find((c) => c.id === fee.category_id) : undefined
    const haystack = [category ? categoryName(category, data.categories) : '', feeCategory ? categoryName(feeCategory, data.categories) : '', t.note, fee?.note ?? ''].join(' ').toLocaleLowerCase()
    return haystack.includes(search.trim().toLocaleLowerCase())
  })
  const totals = data.transactions.filter((t) => inRange(t.transaction_date) && (t.kind === 'income' || t.kind === 'expense')).reduce((all, t) => ({ income: all.income + (t.kind === 'income' ? t.amount : 0), expense: all.expense + (t.kind === 'expense' ? t.amount : 0) }), { income: 0, expense: 0 })
  const setToday = () => { const today = dateToday(); setSelectedDate(today); setRangeMode('day'); setCustomStart(today); setCustomEnd(today) }
  return <><div className="transaction-range"><div className="range-actions"><button type="button" className={rangeMode === 'day' && selectedDate === dateToday() ? 'secondary selected-range' : 'secondary'} onClick={setToday}>今天</button><button type="button" className={rangeMode === 'month' ? 'secondary selected-range' : 'secondary'} onClick={() => setRangeMode('month')}>整月</button></div><div className="transaction-filters"><label>選定日期<input type="date" value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value || dateToday()); setRangeMode('day') }} /></label><label>自訂起日<input type="date" value={customStart} onChange={(event) => { setCustomStart(event.target.value || dateToday()); setRangeMode('custom') }} /></label><label>自訂迄日<input type="date" min={customStart} value={customEnd} onChange={(event) => { setCustomEnd(event.target.value || customStart); setRangeMode('custom') }} /></label><label>搜尋分類或備註<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="大分類、小分類、備註" /></label></div></div><div className="metrics transaction-metrics"><Metric title="總支出" value={twd(totals.expense)} /><Metric title="總收入" value={twd(totals.income)} /><Metric title="淨收入" value={twd(totals.income - totals.expense)} /></div><div className="toolbar"><small>{periodLabel} 的交易</small><div className="toolbar-actions"><button type="button" className="secondary" onClick={() => open('quickTransactions')}>編輯快速交易</button><button className="primary" onClick={() => open('transaction', { defaultDate })}>新增交易</button></div></div><div className="list">{rows.map((t) => { const peer = t.transfer_group_id ? data.transactions.find((x) => x.transfer_group_id === t.transfer_group_id && x.kind === 'transfer_in') : undefined; const fee = t.transfer_group_id ? feeByGroup.get(t.transfer_group_id) : undefined; const account = data.accounts.find((a) => a.id === t.account_id); const category = data.categories.find((c) => c.id === t.category_id); const categoryPath = category ? categoryName(category, data.categories) : ''; const isPending = pendingIds.has(t.id); return <article className="transaction" key={t.id}><span className="category-badge" style={{ color: category?.color ?? (t.kind === 'income' ? '#72e3bc' : '#f4b873') }}><CategoryIcon iconKey={category?.icon_key ?? 'tag'} /></span><span className="transaction-info"><b>{t.note || categoryPath || (t.kind.startsWith('transfer') ? '轉帳' : t.kind === 'income' ? '收入' : '支出')}</b><small className="transaction-detail">{t.transaction_date} · {account && <><AccountIcon iconKey={account.icon_key} size={22} /><span className="transaction-account-name">{account.name}</span></>}{t.note && categoryPath ? ` · ${categoryPath}` : ''}{isPending ? ' · 待同步' : ''}{fee ? ` · 手續費 ${twd(fee.amount)}` : ''}</small></span><strong className={t.kind === 'income' ? 'positive' : ''}>{t.kind === 'income' ? '+' : t.kind === 'expense' ? '-' : ''}{twd(t.amount)}</strong>{isPending ? <button className="text danger" onClick={() => void removePending(t.id)}>刪除</button> : <button className="text" onClick={() => open('transaction', { ...t, targetAccountId: peer?.account_id, transferFee: fee?.amount ?? 0 })}>編輯</button>}</article> })}{!rows.length && <Empty text="這個範圍沒有符合條件的交易。" />}</div></>
}
const pad2 = (value: number) => String(value).padStart(2, '0')
function stockUpdateLabel(stock: Stock) {
  if (!stock.price_updated_at) return '市值更新時間：尚未記錄'
  const time = new Date(stock.price_updated_at)
  const day = `${time.getFullYear()}-${pad2(time.getMonth() + 1)}-${pad2(time.getDate())}`
  const label = `市值更新時間：${day} ${pad2(time.getHours())}:${pad2(time.getMinutes())}`
  return stock.valuation_date === day ? label : `${label}（收盤 ${stock.valuation_date.slice(5).replace('-', '/')}）`
}
function Assets({ data, open, reload, online, onMessage }: { data: FinanceSnapshot; open: (m: Modal, item?: unknown) => void; reload: () => Promise<void>; online: boolean; onMessage: (message: string) => void }) {
  const [updatingStocks, setUpdatingStocks] = useState(false)
  const remove = async (table: 'liabilities' | 'stocks', id: string) => { if (confirm('確定要刪除嗎？')) { await financeRepository.softDelete(table, id); await reload() } }
  const updateStockPrices = async () => {
    if (!online || !navigator.onLine) { onMessage('目前離線，無法更新股票收盤價。'); return }
    const stocksToUpdate = data.stocks.filter((stock) => typeof stock.shares === 'number')
    if (!stocksToUpdate.length) { onMessage('請先編輯股票並填寫股數，再更新收盤價。'); return }
    setUpdatingStocks(true)
    onMessage('')
    try {
      const tickers = [...new Set(stocksToUpdate.map((stock) => stock.ticker.trim().toUpperCase()))]
      const response = await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(','))}`, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`報價服務回應 ${response.status}`)
      const payload = await response.json() as { prices?: Record<string, { close?: unknown; date?: unknown }>; missing?: string[] }
      if (!payload.prices || typeof payload.prices !== 'object') throw new Error('報價服務回傳格式無效。')
      const unavailable = new Set(payload.missing ?? [])
      const updated: string[] = []
      const failed: string[] = []
      for (const stock of stocksToUpdate) {
        const ticker = stock.ticker.trim().toUpperCase()
        const close = Number(payload.prices[ticker]?.close)
        if (unavailable.has(ticker) || !Number.isFinite(close) || close <= 0) { unavailable.add(ticker); continue }
        try {
          const quoteDate = String(payload.prices[ticker]?.date ?? '')
          await financeRepository.saveStock({ id: stock.id, valuation_amount: Math.round((stock.shares ?? 0) * close), valuation_date: /^\d{4}-\d{2}-\d{2}$/.test(quoteDate) && quoteDate <= dateToday() ? quoteDate : dateToday(), price_updated_at: new Date().toISOString() })
          updated.push(ticker)
        } catch {
          failed.push(ticker)
        }
      }
      const missing = [...new Set([...unavailable].filter((ticker) => stocksToUpdate.some((stock) => stock.ticker.trim().toUpperCase() === ticker)))]
      const summary = [updated.length ? `已更新 ${updated.length} 檔：${updated.join('、')}` : '', missing.length ? `查無有效收盤價：${missing.join('、')}` : '', failed.length ? `儲存失敗：${failed.join('、')}` : ''].filter(Boolean).join('；')
      if (updated.length) await reload()
      onMessage(summary || '沒有可更新的股票。')
    } catch {
      onMessage('無法取得收盤價，請確認網路連線及 /api/quote 服務。')
    } finally {
      setUpdatingStocks(false)
    }
  }
  return <><Section title="負債" action="新增" click={() => open('liability')}><div className="list">{data.liabilities.map((item) => <div className="row" key={item.id}><span><b>{item.name}</b><small>{item.kind === 'loan' ? `貸款 · 年利率 ${item.annual_rate_bps / 100}%` : '分期／零卡'} · 月繳 ${twd(item.monthly_payment)}</small></span><strong>{twd(liabilityBalance(item))}</strong><button className="text" onClick={() => open('liability', item)}>編輯</button><button className="text danger" onClick={() => void remove('liabilities', item.id)}>刪除</button></div>)}{!data.liabilities.length && <Empty text="沒有未清償負債。" />}</div></Section><Section title="股票" action="新增" click={() => open('stock')}><div className="toolbar-actions"><button type="button" className="secondary" disabled={updatingStocks} onClick={() => void updateStockPrices()}>{updatingStocks ? '更新中…' : '更新股價'}</button><small>交易日 18:00 自動更新已填股數的股票</small></div><div className="list">{data.stocks.map((item) => <div className="row stock-row" key={item.id}><span><b>{item.ticker}</b><small>年化 {item.annual_return_bps / 100}%</small></span><strong>{twd(stockValue(item))}</strong><button className="text" onClick={() => open('stock', item)}>編輯</button><button className="text danger" onClick={() => void remove('stocks', item.id)}>刪除</button><small className="stock-updated">{stockUpdateLabel(item)}</small></div>)}{!data.stocks.length && <Empty text="新增股票並輸入目前市值。" />}</div></Section></>
}
function Settings({ data, open, reload, logout, user, online }: { data: FinanceSnapshot; open: (m: Modal, item?: unknown) => void; reload: () => Promise<void>; logout: () => Promise<void>; user: User | null; online: boolean }) {
  const moveAccount = async (index: number, offset: -1 | 1) => {
    const otherIndex = index + offset
    const current = data.accounts[index]
    const other = data.accounts[otherIndex]
    if (!current || !other) return
    await financeRepository.saveAccount({ id: current.id, sort_order: other.sort_order })
    await financeRepository.saveAccount({ id: other.id, sort_order: current.sort_order })
    await reload()
  }
  const removeAccount = async (id: string) => { if (confirm('確定要刪除嗎？')) { await financeRepository.softDelete('accounts', id); await reload() } }
  const removeCategory = async (item: Category) => { const children = activeCategories(data.categories).filter((c) => c.parent_id === item.id).length; const wording = children ? `這會同時刪除 ${children} 個小分類，確定嗎？` : '確定要刪除這個分類嗎？'; if (confirm(wording)) { await financeRepository.softDeleteCategory(item.id); await reload() } }
  return <><PushSettings user={user} online={online} /><Section title="帳戶" action="新增" click={() => open('account')}><div className="list">{data.accounts.map((item, index) => <div className="row" key={item.id}><AccountIcon iconKey={item.icon_key} /><span><b>{item.name}</b><small>{accountKinds[item.kind]} {item.is_archived ? '· 已封存' : ''}</small></span><button className="text" disabled={index === 0} aria-label={`將${item.name}上移`} onClick={() => void moveAccount(index, -1)}>上移</button><button className="text" disabled={index === data.accounts.length - 1} aria-label={`將${item.name}下移`} onClick={() => void moveAccount(index, 1)}>下移</button><button className="text" onClick={() => open('account', item)}>編輯</button><button className="text danger" onClick={() => void removeAccount(item.id)}>刪除</button></div>)}</div></Section>{(['income', 'expense'] as CategoryDirection[]).map((direction) => <CategorySettings key={direction} direction={direction} categories={data.categories} open={open} remove={removeCategory} />)}<ExcelReportExport data={data} user={user} /><Section title="CSV 匯出"><div className="exports">{(['transactions', 'accounts', 'liabilities', 'stocks', 'netWorthSnapshots'] as const).map((key) => <button className="secondary" key={key} onClick={() => downloadCsv(key, data)}>{({ transactions: '交易', accounts: '帳戶', liabilities: '負債', stocks: '股票', netWorthSnapshots: '淨資產紀錄' })[key]}</button>)}</div></Section><PasswordSettings /><button className="signout" onClick={() => void logout()}>登出</button></>
}

function PushSettings({ user, online }: { user: User | null; online: boolean }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [synced, setSynced] = useState(false)
  const [diagnostics, setDiagnostics] = useState({ user: user ? '存在（App session）' : '不存在', write: '尚未執行', verification: '尚未執行' })
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
  const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const denied = supported && Notification.permission === 'denied'
  const enabled = supported && Notification.permission === 'granted'
  const unavailable = !supported || !standalone
  const onProgress = (progress: { user?: string; write?: string; verification?: string }) => setDiagnostics((current) => ({ ...current, ...progress }))
  const failSync = (error: unknown) => {
    const stage = (error as { stage?: string } | null)?.stage ?? ''
    const detail = error instanceof Error ? error.message : safePushError(error)
    setDiagnostics((current) => ({
      ...current,
      ...(stage.includes('登入') ? { user: `失敗：${detail}` } : {}),
      ...(stage === '寫入失敗' ? { write: `失敗：${detail}` } : {}),
      ...(stage === '驗證失敗' ? { verification: `失敗：${detail}` } : {}),
    }))
    setSynced(false)
    setMessage(detail)
  }
  useEffect(() => {
    if (!user || !online || !enabled || !standalone || synced || busy) return
    let active = true
    setBusy(true)
    void syncPushSubscription(onProgress, false).then((result) => {
      if (active && result) { setSynced(true); setMessage('通知已開啟。') }
      else if (active) onProgress({ write: '尚未建立本機訂閱', verification: '尚未執行' })
    }).catch((error) => { if (active) failSync(error) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [user, online, enabled, standalone])
  const enable = async () => {
    setBusy(true); setMessage(''); setSynced(false)
    setDiagnostics({ user: user ? '存在（App session；將向 Supabase 核對）' : '不存在', write: '尚未執行', verification: '尚未執行' })
    if (!user) { setDiagnostics((value) => ({ ...value, user: '不存在' })); setMessage('登入使用者不存在，請重新登入。'); setBusy(false); return }
    if (!online || !navigator.onLine) { setDiagnostics((value) => ({ ...value, write: '失敗：目前離線 (OFFLINE)' })); setMessage('寫入失敗：目前離線，推播訂閱不會暫存，請連線後重試。 (OFFLINE)'); setBusy(false); return }
    let permission: NotificationPermission
    try { permission = await Notification.requestPermission() } catch (error) { setMessage(`權限請求失敗：${safePushError(error)}`); setBusy(false); return }
    if (permission !== 'granted') { setMessage('通知權限未開啟。請到 iPhone 設定允許此 App 傳送通知。'); setBusy(false); return }
    try {
      await syncPushSubscription(onProgress)
      setSynced(true)
      setMessage('通知已開啟。')
    } catch (error) { failSync(error) } finally { setBusy(false) }
  }
  const disable = async () => { setBusy(true); setMessage(''); try { const registration = await navigator.serviceWorker.ready; const subscription = await registration.pushManager.getSubscription(); if (subscription) { await pushRepository.softDeleteSubscription(subscription.endpoint); await subscription.unsubscribe() } setSynced(false); setDiagnostics((current) => ({ ...current, write: '已軟刪除訂閱', verification: '已關閉' })); setMessage('每日通知已關閉。') } catch (error) { setDiagnostics((current) => ({ ...current, write: `失敗：${safePushError(error)}` })); setMessage(error instanceof Error ? error.message : '關閉通知失敗。') } finally { setBusy(false) } }
  const sendTest = async () => { setBusy(true); setMessage(''); try { await pushRepository.testPush(); setMessage('已送出測試通知。') } catch (error) { setMessage(error instanceof Error ? error.message : '測試通知失敗。') } finally { setBusy(false) } }
  return <Section title="每日通知"><div className="form"><p className="muted">固定於台灣時間 06:00 與 23:00 傳送；iOS 推播可能延遲數秒至數分鐘，專注模式可能攔截通知。</p>{unavailable && <p className="notice">iPhone 需 iOS 16.4 以上並從主畫面開啟。</p>}{denied && <p className="notice">通知權限已拒絕。請到 iPhone 設定中允許此 App 傳送通知，再回來開啟。</p>}{!unavailable && !denied && <div className="exports">{!synced ? <button className="primary" disabled={busy || !online || !import.meta.env.VITE_VAPID_PUBLIC_KEY} onClick={() => void enable()}>{busy ? '確認訂閱中…' : '開啟每日通知'}</button> : <><button className="secondary" disabled={busy} onClick={() => void disable()}>關閉通知</button><button className="secondary" disabled={busy} onClick={() => void sendTest()}>傳送測試通知</button></>}</div>}{!online && <small>目前離線；推播訂閱需直接寫入 Supabase，不能離線暫存。</small>}{!import.meta.env.VITE_VAPID_PUBLIC_KEY && !unavailable && !denied && <small>尚未設定公開 VAPID key；設定後即可開啟通知。</small>}<div className="push-diagnostics"><small>診斷：登入使用者 {diagnostics.user}</small><small>Supabase 寫入 {diagnostics.write}</small><small>endpoint 讀回驗證 {diagnostics.verification}</small></div>{message && <p className="notice">{message}</p>}</div></Section>
}

function CategorySettings({ direction, categories, open, remove }: { direction: CategoryDirection; categories: Category[]; open: (m: Modal, item?: unknown) => void; remove: (item: Category) => Promise<void> }) {
  const current = activeCategories(categories)
  const roots = current.filter((category) => category.direction === direction && !category.parent_id)
  const rootLimit = direction === 'expense' ? 20 : 15
  const childLimit = 20
  return <section className="section">
    <header><h2>{direction === 'income' ? '收入分類' : '支出分類'}</h2><button className="text category-add" disabled={roots.length >= rootLimit} onClick={() => open('category', { direction })}>新增大分類 {roots.length}/{rootLimit}</button></header>
    <div className="category-groups">{roots.map((root) => {
      const children = current.filter((category) => category.parent_id === root.id)
      return <article className="category-group" key={root.id}>
        <header><span className="category-badge large" style={{ color: root.color }}><CategoryIcon iconKey={root.icon_key} size={22} /></span><span><b>{root.name}</b><small>{direction === 'income' ? '僅使用大分類' : `${children.length} / ${childLimit} 個小分類`}</small></span><button className="text" onClick={() => open('category', { item: root })}>編輯</button><button className="text danger" onClick={() => void remove(root)}>刪除</button></header>
        {direction === 'expense' && <div className="subcategories">{children.map((child) => <div className="subcategory" key={child.id}><span className="category-badge" style={{ color: child.color }}><CategoryIcon iconKey={child.icon_key} size={18} /></span><b>{child.name}</b><button className="text" onClick={() => open('category', { item: child })}>編輯</button><button className="text danger" onClick={() => void remove(child)}>刪除</button></div>)}<button className="add-subcategory" disabled={children.length >= childLimit} onClick={() => open('category', { parentId: root.id, direction })}>{children.length >= childLimit ? '已達 20 個上限' : `＋ 新增小分類 ${children.length}/${childLimit}`}</button></div>}
      </article>
    })}{!roots.length && <Empty text={`尚無${direction === 'income' ? '收入' : '支出'}大分類。`} />}</div>
  </section>
}
function PasswordSettings() { const [password, setPassword] = useState(''); const [again, setAgain] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const submit = async (event: FormEvent) => { event.preventDefault(); if (password !== again) { setMessage('兩次密碼不一致。'); return } setBusy(true); try { await authRepository.setPassword(password); setPassword(''); setAgain(''); setMessage('密碼已設定，可以用同一個 Email 在手機登入。') } catch (cause) { setMessage(cause instanceof Error ? cause.message : '設定失敗') } finally { setBusy(false) } }; return <Section title="設定登入密碼"><form className="form" onSubmit={submit}><p className="muted">請在目前已登入的電腦上設定一次，手機即可用相同帳號登入。</p><label>新密碼<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>再輸入一次<input required minLength={8} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>{message && <p className="notice">{message}</p>}<button className="primary" disabled={busy}>{busy ? '設定中…' : '設定密碼'}</button></form></Section> }
function Section({ title, action, click, children }: { title: string; action?: string; click?: () => void; children: ReactNode }) { return <section className="section"><header><h2>{title}</h2>{action && <button className="text" onClick={click}>{action}</button>}</header>{children}</section> }; function Empty({ text }: { text: string }) { return <p className="empty">{text}</p> }
function Dialog({ title, close, children, action }: { title: string; close: () => void; children: ReactNode; action?: ReactNode }) { return <div className="backdrop"><section className="dialog"><header><div className="dialog-title-row"><h2>{title}</h2>{action}</div><button className="icon" onClick={close}>×</button></header>{children}</section></div> }
function Notifications({ items, close, remove }: { items: FailedTransaction[]; close: () => void; remove: (id: string) => Promise<void> }) { return <Dialog title="同步通知" close={close}><div className="list">{items.map((item) => <article className="notification" key={item.id}><span><b>交易同步失敗</b><small>{item.transaction_date} · {item.kind === 'income' ? '收入' : '支出'} {twd(item.amount)}</small><small>{item.reason}</small><small>帳戶：{item.account_name ?? '已刪除帳戶'}　分類：{item.category_name ?? '未分類'}</small>{item.note && <small>備註：{item.note}</small>}</span><button className="text danger" onClick={() => void remove(item.id)}>刪除未同步交易</button></article>)}{!items.length && <Empty text="目前沒有同步失敗通知。" />}</div></Dialog> }
function useSave(done: () => Promise<void>) { const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const save = async (work: () => Promise<unknown>) => { try { setBusy(true); await work(); await done() } catch (cause) { setError(cause instanceof Error ? cause.message : '儲存失敗') } finally { setBusy(false) } }; return { busy, error, save } }
function Footer({ close, busy }: { close: () => void; busy: boolean }) { return <footer className="footer"><button type="button" className="secondary" onClick={close}>取消</button><button className="primary" disabled={busy}>{busy ? '儲存中…' : '儲存'}</button></footer> }
function Accounts({ data, value, change, stockOnly = false, label = '帳戶', showBalances = false, onSelect }: { data: FinanceSnapshot; value: string; change: (value: string) => void; stockOnly?: boolean; label?: string; showBalances?: boolean; onSelect?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const options = data.accounts.filter((account) => !account.is_archived && (!stockOnly || account.kind === 'stock'))
  const selected = options.find((account) => account.id === value)
  return <div className="account-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}>
    <span className="field-label">{label}</span>
    <button type="button" className="account-picker-trigger" aria-expanded={expanded} aria-haspopup="listbox" onClick={() => setExpanded(!expanded)}>
      {selected ? <><AccountIcon iconKey={selected.icon_key} /><span>{selected.name}</span></> : <span className="muted">選擇帳戶</span>}
      <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
    </button>
    {expanded && <div className="account-picker-panel" role="listbox" aria-label={label} onKeyDown={(event) => { if (event.key === 'Escape') setExpanded(false) }}>
      {options.map((account) => <button type="button" role="option" aria-selected={value === account.id} className={value === account.id ? 'account-picker-option selected' : 'account-picker-option'} key={account.id} onClick={() => { change(account.id); setExpanded(false); onSelect?.() }}>
        <AccountIcon iconKey={account.icon_key} /><span><b>{account.name}</b><small>{accountKinds[account.kind]}{showBalances ? ` · 目前餘額 ${twd(accountBalance(account, data.transactions))}` : ''}</small></span>
      </button>)}
      {!options.length && <span className="muted">沒有可用帳戶</span>}
    </div>}
  </div>
}

function CategoryPicker({ categories, direction, value, change, collapseChildren = false, expandSignal = 0 }: { categories: Category[]; direction: CategoryDirection; value: string; change: (value: string) => void; collapseChildren?: boolean; expandSignal?: number }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedRoot, setExpandedRoot] = useState<string | null>(null)
  useEffect(() => { if (expandSignal > 0) { setExpanded(true); setExpandedRoot(null) } }, [expandSignal])
  const current = activeCategories(categories).filter((category) => category.direction === direction)
  const roots = current.filter((category) => !category.parent_id)
  const selected = current.find((category) => category.id === value)
  const choose = (id: string) => { change(id); setExpanded(false); setExpandedRoot(null) }
  return <div className="category-picker"><span className="field-label">分類</span>
    <button type="button" className="category-picker-trigger" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); setExpandedRoot(null) }}>{selected ? <><span className="category-badge" style={{ color: selected.color }}><CategoryIcon iconKey={selected.icon_key} size={18} /></span><b>{categoryName(selected, categories)}</b></> : <span className="muted">未分類</span>}<span aria-hidden="true">{expanded ? '▴' : '▾'}</span></button>
    {expanded && <div className="category-picker-panel"><button type="button" className={!value ? 'category-option selected' : 'category-option'} onClick={() => choose('')}><span className="category-badge"><CategoryIcon iconKey="tag" size={18} /></span><span>未分類</span></button>
      {roots.map((root) => {
        const children = current.filter((child) => child.parent_id === root.id)
        const collapsible = collapseChildren && direction === 'expense' && children.length > 0
        const rootExpanded = expandedRoot === root.id
        return <div className="category-option-group" key={root.id}>
          <button type="button" className={value === root.id ? 'category-option root selected' : 'category-option root'} aria-expanded={collapsible ? rootExpanded : undefined} onClick={() => collapsible ? setExpandedRoot(rootExpanded ? null : root.id) : choose(root.id)}><span className="category-badge" style={{ color: root.color }}><CategoryIcon iconKey={root.icon_key} size={18} /></span><span>{root.name}</span>{collapsible && <span className="category-option-chevron" aria-hidden="true">{rootExpanded ? '▴' : '▾'}</span>}</button>
          {(!collapsible || rootExpanded) && children.map((child) => <button type="button" className={value === child.id ? 'category-option child selected' : 'category-option child'} key={child.id} onClick={() => choose(child.id)}><span className="category-badge" style={{ color: child.color }}><CategoryIcon iconKey={child.icon_key} size={17} /></span><span>{child.name}</span></button>)}
        </div>
      })}
    </div>}
  </div>
}
function QuickTransactionsDialog({ data, close, reload }: { data: FinanceSnapshot; close: () => void; reload: () => Promise<void> }) {
  const [item, setItem] = useState<QuickTransaction | null>(null)
  const [creating, setCreating] = useState(false)
  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const begin = (selected?: QuickTransaction) => { setItem(selected ?? null); setCreating(true); setKind(selected?.kind ?? 'expense'); setAmount(selected ? String(selected.amount) : ''); setAccount(selected?.account_id ?? ''); setCategory(selected?.category_id ?? ''); setNote(selected?.note ?? ''); setError('') }
  const saveItem = async (event: FormEvent) => {
    event.preventDefault()
    const numeric = Number(amount)
    if (!Number.isInteger(numeric) || numeric < 1) { setError('金額需為大於 0 的整數。'); return }
    if (!account || !data.accounts.some((candidate) => candidate.id === account && !candidate.is_archived)) { setError('請選擇有效帳戶。'); return }
    if (category && !data.categories.some((candidate) => candidate.id === category && !candidate.deleted_at && candidate.direction === kind)) { setError('所選分類已失效，請重新選擇。'); return }
    try { setBusy(true); setError(''); await financeRepository.saveQuickTransaction({ ...(item ? { id: item.id } : {}), kind, amount: numeric, account_id: account, category_id: category || null, note }); await reload(); setCreating(false); setItem(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '儲存失敗') }
    finally { setBusy(false) }
  }
  const remove = async (selected: QuickTransaction) => { if (!confirm('確定要刪除這個快速交易選項嗎？')) return; try { await financeRepository.softDelete('quick_transactions', selected.id); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : '刪除失敗') } }
  const title = (selected: QuickTransaction) => { const categoryItem = data.categories.find((candidate) => candidate.id === selected.category_id); return [selected.kind === 'income' ? '收入' : '支出', categoryItem ? categoryName(categoryItem, data.categories) : '', selected.note].filter(Boolean).join(' · ') || '未命名快速交易' }
  if (!creating) return <Dialog title="編輯快速交易" close={close} action={<button type="button" className="text" onClick={() => begin()}>新增</button>}><div className="list">{data.quickTransactions.map((selected) => <article className="quick-transaction-row" key={selected.id}><span><b>{title(selected)}</b><small>{twd(selected.amount)} · {data.accounts.find((candidate) => candidate.id === selected.account_id)?.name ?? '帳戶已移除'}</small></span><button type="button" className="text" onClick={() => begin(selected)}>編輯</button><button type="button" className="text danger" onClick={() => void remove(selected)}>刪除</button></article>)}{!data.quickTransactions.length && <Empty text="尚無快速交易選項。新增後可在交易表單中快速帶入欄位。" />}{error && <p className="notice error">{error}</p>}</div></Dialog>
  return <Dialog title={item ? '編輯快速交易' : '新增快速交易'} close={() => { setCreating(false); setItem(null) }}><form className="form" onSubmit={saveItem}>
    <div className="tabs"><button type="button" className={kind === 'expense' ? 'selected' : ''} onClick={() => { setKind('expense'); setCategory('') }}>支出</button><button type="button" className={kind === 'income' ? 'selected' : ''} onClick={() => { setKind('income'); setCategory('') }}>收入</button></div>
    <label>金額（TWD）<input required inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} /></label>
    <Accounts data={data} value={account} change={setAccount} label="帳戶" />
    <CategoryPicker key={kind} categories={data.categories} direction={kind} value={category} change={setCategory} collapseChildren />
    <label>備註（可不填）<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {error && <p className="notice error">{error}</p>}<footer className="footer"><button type="button" className="secondary" onClick={() => { setCreating(false); setItem(null) }}>返回</button><button className="primary" disabled={busy}>{busy ? '儲存中…' : '儲存選項'}</button></footer>
  </form></Dialog>
}
function TransactionDialog({ data, item, close, done, offline, queue }: { data: FinanceSnapshot; item: (TransferEdit & { transferFee?: number }) | null; close: () => void; done: () => Promise<void>; offline: boolean; queue: (value: Omit<PendingTransaction, 'id' | 'user_id' | 'queued_at'>) => Promise<void> }) {
  const initial = item?.transfer_group_id ? 'transfer' : item?.kind ?? 'expense'
  const [kind, setKind] = useState(initial)
  const [date, setDate] = useState(item?.transaction_date ?? item?.defaultDate ?? dateToday())
  const [amount, setAmount] = useState(String(item?.amount ?? ''))
  const [account, setAccount] = useState(item?.account_id ?? '')
  const [target, setTarget] = useState(item?.targetAccountId ?? '')
  const [category, setCategory] = useState(item?.category_id ?? '')
  const [categoryOpenRequest, setCategoryOpenRequest] = useState(0)
  const [note, setNote] = useState(item?.note ?? '')
  const [transferFee, setTransferFee] = useState(String(item?.transferFee ?? 0))
  const [showQuickTransactions, setShowQuickTransactions] = useState(false)
  const budget = dailyBudget(data)
  const currentBudgetPercent = budget.quota > 0 ? Math.round(budget.spentToday / budget.quota * 100) : null
  const enteredExpenseAmount = kind === 'expense' && date === dateToday() && amount !== '' && Number(amount) > 0
  const projectedSpentToday = budget.spentToday + Number(amount)
  const budgetWarning = !item?.id && enteredExpenseAmount
    ? budget.quota === 0
      ? '今日額度已用完'
      : budget.quota > 0 && projectedSpentToday === budget.quota
        ? '今日額度將會達到100%'
        : budget.quota > 0 && projectedSpentToday > budget.quota
          ? `今日額度將會超支${Math.max(1, Math.round((projectedSpentToday - budget.quota) / budget.quota * 100))}%`
          : ''
    : ''
  const feeCategory = data.categories.find((child) => child.name === '手續費' && !child.deleted_at && child.parent_id && data.categories.some((parent) => parent.id === child.parent_id && parent.name === '金融/政府' && parent.direction === 'expense' && !parent.deleted_at))
  const { busy, error, save } = useSave(done)
  const submit = (event: FormEvent) => { event.preventDefault(); void save(async () => {
    const numeric = Number(amount)
    if (!Number.isInteger(numeric) || numeric < 1) throw new Error('金額需為大於 0 的整數。')
    if (!account) throw new Error('請選擇帳戶。')
    if (kind === 'transfer') {
      if (!target || target === account) throw new Error('請選擇不同的轉入帳戶。')
      const fee = transferFee === '' ? 0 : Number(transferFee)
      if (!Number.isInteger(fee) || fee < 0) throw new Error('手續費需為 0 或以上的整數。')
      if (fee > 0 && !feeCategory) throw new Error('找不到「金融/政府 › 手續費」分類，請先確認分類仍有效。')
      const transferInput = { transactionDate: date, amount: numeric, fromAccountId: account, toAccountId: target, note, transferFee: fee, feeCategoryId: feeCategory?.id ?? null }
      if (item?.transfer_group_id) await financeRepository.updateTransfer(item.transfer_group_id, transferInput)
      else await financeRepository.saveTransfer(transferInput)
    } else {
      const value = { transaction_date: date, amount: numeric, kind: kind as 'income' | 'expense', account_id: account, category_id: category || null, transfer_group_id: null, is_transfer_fee: false, note }
      if (offline) await queue(value)
      else await financeRepository.saveTransaction({ ...(item?.id ? { id: item.id } : {}), ...value })
    }
  }) }
  const remove = async () => {
    if (!item || !confirm('確定要刪除這筆交易嗎？')) return
    if (item.transfer_group_id) await financeRepository.softDeleteTransfer(item.transfer_group_id)
    else await financeRepository.softDelete('transactions', item.id)
    await done()
  }
  const changeKind = (value: string) => { setKind(value); setCategory(''); setShowQuickTransactions(false) }
  const usableQuickTransactions = data.quickTransactions.filter((quick) => data.accounts.some((candidate) => candidate.id === quick.account_id && !candidate.is_archived) && (!quick.category_id || data.categories.some((candidate) => candidate.id === quick.category_id && !candidate.deleted_at && candidate.direction === quick.kind)))
  const applyQuickTransaction = (quick: QuickTransaction) => { setKind(quick.kind); setAmount(String(quick.amount)); setAccount(quick.account_id); setCategory(quick.category_id ?? ''); setNote(quick.note); setTarget(''); setTransferFee('0'); setShowQuickTransactions(false) }
  return <Dialog title={item ? '編輯交易' : '新增交易'} close={close} action={<button type="button" className="text quick-transaction-trigger" aria-expanded={showQuickTransactions} onClick={() => setShowQuickTransactions((value) => !value)}>新增快速交易</button>}><form className="form" onSubmit={submit}>
    {showQuickTransactions && <div className="quick-transaction-menu">{usableQuickTransactions.length ? usableQuickTransactions.map((quick) => { const categoryItem = data.categories.find((candidate) => candidate.id === quick.category_id); const title = [quick.kind === 'income' ? '收入' : '支出', categoryItem ? categoryName(categoryItem, data.categories) : '', quick.note].filter(Boolean).join(' · '); return <button type="button" className="quick-transaction-option" key={quick.id} onClick={() => applyQuickTransaction(quick)}><span>{title}</span><small>{twd(quick.amount)}</small></button> }) : <p className="empty">尚無快速交易，請先到交易頁新增選項。</p>}</div>}
    {offline && <p className="notice offline">離線新增會在恢復連線後自動同步。</p>}<div className="tabs">{[['expense', '支出'], ['income', '收入'], ...(offline ? [] : [['transfer', '轉帳']])].map(([value, label]) => <button type="button" className={kind === value ? 'selected' : ''} onClick={() => changeKind(value)} key={value}>{label}</button>)}</div>
    {!item?.id && <div className="daily-budget-summary"><small>今日已支出 {twd(budget.spentToday)}</small><small>今日可支出額度 {twd(budget.quota)}</small>{currentBudgetPercent !== null && <small>目前使用 {currentBudgetPercent}%</small>}{budgetWarning && <small className="danger" role="status">{budgetWarning}</small>}</div>}
    <label>金額（TWD）<input autoFocus required inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} /></label>
    <label>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <Accounts data={data} value={account} change={setAccount} label={kind === 'transfer' ? '轉出帳戶' : '帳戶'} showBalances={!item?.id} onSelect={!item?.id && kind !== 'transfer' ? () => setCategoryOpenRequest((value) => value + 1) : undefined} />
    {kind === 'transfer' ? <><Accounts data={data} value={target} change={setTarget} label="轉入帳戶" showBalances={!item?.id} /><label>手續費（TWD，可不填）<input inputMode="numeric" value={transferFee} onChange={(event) => setTransferFee(event.target.value.replace(/[^0-9]/g, ''))} placeholder="0" /></label></> : <CategoryPicker key={kind} categories={data.categories} direction={kind as CategoryDirection} value={category} change={setCategory} collapseChildren expandSignal={categoryOpenRequest} />}
    <label>備註（可不填）<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {error && <p className="notice error">{error}</p>}{item?.id && <button type="button" className="transaction-delete" onClick={() => void remove()}>刪除這筆交易</button>}<Footer close={close} busy={busy} />
  </form></Dialog>
}
function AccountDialog({ item, close, done }: { item: Account | null; close: () => void; done: () => Promise<void> }) {
  const [name, setName] = useState(item?.name ?? '')
  const [kind, setKind] = useState(item?.kind ?? 'bank')
  const [opening, setOpening] = useState(String(item?.opening_balance ?? 0))
  const [archived, setArchived] = useState(item?.is_archived ?? false)
  const [iconKey, setIconKey] = useState(item?.icon_key ?? null)
  const { busy, error, save } = useSave(done)
  return <Dialog title={item ? '編輯帳戶' : '新增帳戶'} close={close}><form className="form" onSubmit={(event) => {
    event.preventDefault()
    void save(() => financeRepository.saveAccount({ ...(item ? { id: item.id } : {}), name, kind: kind as Account['kind'], opening_balance: Number(opening), currency: 'TWD', is_archived: archived, icon_key: iconKey }))
  }}>
    <label>名稱<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>類型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="cash">現金</option><option value="bank">銀行</option><option value="stored_value">儲值卡</option></select></label>
    <label>起始餘額<input required inputMode="numeric" value={opening} onChange={(event) => setOpening(event.target.value.replace(/[^-0-9]/g, ''))} /></label>
    <fieldset className="icon-field"><legend>帳戶圖標</legend><div className="account-icon-grid">
      <button type="button" className={!iconKey ? 'account-icon-choice selected' : 'account-icon-choice'} aria-label="不使用帳戶圖標" aria-pressed={!iconKey} onClick={() => setIconKey(null)}><AccountIcon iconKey={null} size={48} /></button>
      {accountIconOptions.map((option, index) => <button type="button" className={iconKey === option.key ? 'account-icon-choice selected' : 'account-icon-choice'} aria-label={`帳戶圖標 ${index + 1}`} aria-pressed={iconKey === option.key} key={option.key} onClick={() => setIconKey(option.key)}><AccountIcon iconKey={option.key} size={48} /></button>)}
    </div><small>第一個選項為不使用圖片。</small></fieldset>
    {item && <label className="check"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />封存帳戶</label>}
    {error && <p className="notice error">{error}</p>}<Footer close={close} busy={busy} />
  </form></Dialog>
}
function CategoryDialog({ data, target, close, done }: { data: FinanceSnapshot; target: CategoryDialogTarget | null; close: () => void; done: () => Promise<void> }) {
  const item = target?.item
  const initialParent = target?.parentId ?? item?.parent_id ?? ''
  const [name, setName] = useState(item?.name ?? '')
  const [direction, setDirection] = useState<CategoryDirection>(item?.direction ?? target?.direction ?? 'expense')
  const [parent, setParent] = useState(initialParent)
  const [color, setColor] = useState(item?.color ?? '#72e3bc')
  const [iconKey, setIconKey] = useState(item?.icon_key ?? 'tag')
  const { busy, error, save } = useSave(done)
  const current = activeCategories(data.categories)
  const childCount = item && !item.parent_id ? current.filter((category) => category.parent_id === item.id).length : 0
  const rootLimit = direction === 'expense' ? 20 : 15
  const currentRootCount = current.filter((category) => category.direction === direction && !category.parent_id && category.id !== item?.id).length
  const parentOptions = current.filter((category) => !category.parent_id && category.direction === 'expense' && category.id !== item?.id && (category.id === item?.parent_id || current.filter((child) => child.parent_id === category.id && child.id !== item?.id).length < 20))
  const isChild = Boolean(parent)
  const chooseParent = (value: string) => { setParent(value); if (value) setDirection('expense') }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save(() => {
      if (isChild && direction !== 'expense') throw new Error('收入分類只能使用大分類。')
      if (!isChild && currentRootCount >= rootLimit) throw new Error(`${direction === 'expense' ? '支出' : '收入'}大分類最多 ${rootLimit} 個。`)
      if (isChild && current.filter((category) => category.parent_id === parent && category.id !== item?.id).length >= 20) throw new Error('每個支出大分類最多 20 個小分類。')
      return financeRepository.saveCategory({ ...(item ? { id: item.id } : {}), name, direction, parent_id: parent || null, color, icon_key: iconKey, sort_order: item?.sort_order ?? (parent ? 999 : 100) })
    })
  }
  return <Dialog title={item ? `編輯${item.parent_id ? '小' : '大'}分類` : `新增${isChild ? '小' : '大'}分類`} close={close}><form className="form" onSubmit={submit}>
    <label>名稱<input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
    {isChild ? <label>所屬大分類<select required value={parent} onChange={(event) => chooseParent(event.target.value)}>{parentOptions.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label> : <label>用途<select value={direction} disabled={childCount > 0} onChange={(event) => setDirection(event.target.value as CategoryDirection)}><option value="expense">支出</option><option value="income">收入</option></select>{childCount > 0 && <small>大分類已有小分類，需先移動或刪除小分類才能變更用途。</small>}</label>}
    <label>顏色<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
    <fieldset className="icon-field"><legend>Icon（{categoryIconOptions.length} 個可選）</legend><div className="icon-grid">{categoryIconOptions.map((option) => <button type="button" className={iconKey === option.key ? 'icon-choice selected' : 'icon-choice'} aria-label={option.label} title={option.label} key={option.key} onClick={() => setIconKey(option.key)}><CategoryIcon iconKey={option.key} /></button>)}</div></fieldset>
    {error && <p className="notice error">{error}</p>}<Footer close={close} busy={busy} />
  </form></Dialog>
}
function LiabilityDialog({ item, close, done }: { item: Liability | null; close: () => void; done: () => Promise<void> }) {
  const [name, setName] = useState(item?.name ?? '')
  const [kind, setKind] = useState<Liability['kind']>(item?.kind ?? 'loan')
  const [principal, setPrincipal] = useState(String(item?.principal ?? ''))
  const [rate, setRate] = useState(String((item?.annual_rate_bps ?? 0) / 100))
  const [payment, setPayment] = useState(String(item?.monthly_payment ?? ''))
  const [term, setTerm] = useState(String(item?.term_months ?? 12))
  const [start, setStart] = useState(item?.start_date ?? dateToday())
  const [driver, setDriver] = useState<'rate' | 'payment'>(item?.kind === 'installment' ? 'payment' : 'rate')
  const [calculationError, setCalculationError] = useState('')
  const { busy, error, save } = useSave(done)
  const recalculate = (nextPrincipal: string, nextTerm: string, source: 'rate' | 'payment', nextRate = rate, nextPayment = payment) => {
    const amount = Number(nextPrincipal)
    const months = Number(nextTerm)
    if (!amount || !months) { setPayment(''); setCalculationError(''); return }
    if (kind === 'installment') {
      setRate('0')
      if (source === 'rate') setPayment(String(paymentForRate(amount, 0, months)))
      setCalculationError('')
      return
    }
    if (source === 'rate') {
      if (nextRate === '') { setPayment(''); setCalculationError(''); return }
      setPayment(String(paymentForRate(amount, Math.round(Number(nextRate) * 100), months)))
      setCalculationError('')
      return
    }
    if (nextPayment === '') { setRate(''); setCalculationError(''); return }
    const inferredRate = rateForPayment(amount, Number(nextPayment), months)
    if (inferredRate === null) {
      setRate('')
      setCalculationError('月繳款需不低於零利率月繳款，且須能對應 0% 至 1000% 的年利率。')
      return
    }
    setRate((inferredRate / 100).toFixed(2))
    setCalculationError('')
  }
  const changePrincipal = (value: string) => { setPrincipal(value); recalculate(value, term, driver) }
  const changeTerm = (value: string) => { setTerm(value); recalculate(principal, value, driver) }
  const changeRate = (value: string) => { setDriver('rate'); setRate(value); recalculate(principal, term, 'rate', value) }
  const changePayment = (value: string) => { setDriver('payment'); setPayment(value); recalculate(principal, term, 'payment', rate, value) }
  const changeKind = (value: Liability['kind']) => {
    setKind(value)
    setCalculationError('')
    if (value === 'installment') { setDriver('payment'); setRate('0'); setPayment(principal && term ? String(paymentForRate(Number(principal), 0, Number(term))) : '') }
    else { setDriver('rate'); recalculate(principal, term, 'rate') }
  }
  const paymentLabel = kind === 'loan' ? '月繳款（TWD）' : '每月分期金額（TWD）'
  return <Dialog title={item ? '編輯負債' : '新增負債'} close={close}><form className="form" onSubmit={(event) => { event.preventDefault(); void save(() => {
    const principalValue = Number(principal)
    const termValue = Number(term)
    const paymentValue = Number(payment)
    if (!principalValue || !termValue || !paymentValue) throw new Error('請輸入有效的本金、期數與月繳款。')
    const calculatedRate = kind === 'installment' ? 0 : driver === 'payment' ? rateForPayment(principalValue, paymentValue, termValue) : Math.round(Number(rate) * 100)
    if (calculatedRate === null) throw new Error('月繳款無法對應有效的年利率。')
    return financeRepository.saveLiability({ ...(item ? { id: item.id } : {}), name, kind, principal: principalValue, annual_rate_bps: calculatedRate, monthly_payment: paymentValue, term_months: termValue, start_date: start })
  }) }}>
    <label>名稱<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>類型<select value={kind} onChange={(event) => changeKind(event.target.value as Liability['kind'])}><option value="loan">貸款</option><option value="installment">分期／零卡</option></select></label>
    <label>本金（TWD）<input required inputMode="numeric" value={principal} onChange={(event) => changePrincipal(event.target.value.replace(/[^0-9]/g, ''))} /></label>
    {kind === 'loan' && <label>年利率（%）<input required type="number" min="0" max="1000" step="0.01" value={rate} onChange={(event) => changeRate(event.target.value)} /></label>}
    <label>{paymentLabel}<input required inputMode="numeric" value={payment} onChange={(event) => changePayment(event.target.value.replace(/[^0-9]/g, ''))} /></label>
    {calculationError && <p className="notice error">{calculationError}</p>}
    <label>期數（月）<input required type="number" min="1" max="1200" value={term} onChange={(event) => changeTerm(event.target.value)} /></label>
    <label>起始日<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
    {error && <p className="notice error">{error}</p>}<Footer close={close} busy={busy} />
  </form></Dialog>
}
function StockDialog({ item, close, done }: { item: Stock | null; close: () => void; done: () => Promise<void> }) {
  const [ticker, setTicker] = useState(item?.ticker ?? '')
  const [shares, setShares] = useState(item?.shares == null ? '' : String(item.shares))
  const [closePrice, setClosePrice] = useState<number | null>(null)
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [priceError, setPriceError] = useState('')
  const [annual, setAnnual] = useState(String((item?.annual_return_bps ?? 0) / 100))
  const { busy, error, save } = useSave(done)
  const tickerCode = ticker.trim().toUpperCase()
  const shareCount = shares === '' ? null : Number(shares)
  const marketValue = closePrice !== null && shareCount !== null && Number.isSafeInteger(shareCount) && shareCount >= 0
    ? Math.round(closePrice * shareCount)
    : null

  const fetchClosePrice = async () => {
    if (!tickerCode) { setPriceError('請先輸入股票代號。'); return }
    setLoadingPrice(true)
    setPriceError('')
    setClosePrice(null)
    try {
      const response = await fetch(`/api/quote?tickers=${encodeURIComponent(tickerCode)}`, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`報價服務回應 ${response.status}`)
      const payload = await response.json() as { prices?: Record<string, { close?: unknown }>; missing?: string[] }
      const close = Number(payload.prices?.[tickerCode]?.close)
      if (payload.missing?.includes(tickerCode) || !Number.isFinite(close) || close <= 0) throw new Error('查無有效收盤價，請確認股票代號後重試。')
      setClosePrice(close)
    } catch (fetchError) {
      setPriceError(fetchError instanceof Error ? fetchError.message : '無法取得收盤價，請確認網路連線及 /api/quote 服務。')
    } finally {
      setLoadingPrice(false)
    }
  }

  return <Dialog title={item ? '編輯股票' : '新增股票'} close={close}><form className="form" onSubmit={(event) => {
    event.preventDefault()
    void save(() => {
      if (!tickerCode) throw new Error('請輸入股票代號。')
      if (closePrice === null) throw new Error('請先抓取收盤價。')
      if (shareCount === null || !Number.isSafeInteger(shareCount) || shareCount < 0) throw new Error('股數必須是 0 或以上的整數。')
      if (marketValue === null || !Number.isSafeInteger(marketValue)) throw new Error('計算出的市值超出可儲存範圍。')
      return financeRepository.saveStock({ ...(item ? { id: item.id } : {}), account_id: null, ticker: tickerCode, shares: shareCount, annual_return_bps: Math.round(Number(annual) * 100), valuation_amount: marketValue, valuation_date: dateToday(), price_updated_at: new Date().toISOString() })
    })
  }}>
    <label>股票代號<input autoFocus required value={ticker} onChange={(event) => { setTicker(event.target.value); setClosePrice(null); setPriceError('') }} placeholder="0050" /></label>
    <button type="button" className="secondary" disabled={loadingPrice || !tickerCode} onClick={() => void fetchClosePrice()}>{loadingPrice ? '抓取中…' : '抓取收盤價'}</button>
    {closePrice !== null && <p className="muted">最新收盤價：NT$ {closePrice.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}</p>}
    {priceError && <p className="notice error">{priceError}</p>}
    <label>股數<input type="number" min="0" step="1" inputMode="numeric" required value={shares} onChange={(event) => setShares(event.target.value)} placeholder="輸入持有股數" /></label>
    <label>目前市值（TWD，自動計算）<input readOnly value={marketValue === null ? '請先抓取收盤價並輸入股數' : marketValue.toLocaleString('en-US')} /></label>
    <label>年化報酬率（%）<input required type="number" step="0.01" value={annual} onChange={(event) => setAnnual(event.target.value)} /></label>
    {error && <p className="notice error">{error}</p>}
    <Footer close={close} busy={busy} />
  </form></Dialog>
}
function RecurringDialog({ data, item, close, done }: { data: FinanceSnapshot; item: any; close: () => void; done: () => Promise<void> }) {
  const [name, setName] = useState(item?.name ?? '')
  const [kind, setKind] = useState(item?.kind ?? 'expense')
  const [amount, setAmount] = useState(String(item?.amount ?? ''))
  const [category, setCategory] = useState(item?.category_id ?? '')
  const [interval, setInterval] = useState(String(item?.interval_months ?? 1))
  const [start, setStart] = useState(item?.start_date ?? dateToday())
  const { busy, error, save } = useSave(done)
  const changeKind = (value: string) => { setKind(value); setCategory('') }
  return <Dialog title={item ? '編輯固定收支' : '新增固定收支'} close={close}><form className="form" onSubmit={(e) => { e.preventDefault(); void save(() => financeRepository.saveRecurringRule({ ...(item ? { id: item.id } : {}), name, kind, amount: Number(amount), category_id: category || null, interval_months: Number(interval), day_of_month: 1, start_date: start, end_date: null, is_active: true })) }}>
    <label>名稱<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="房租" /></label>
    <label>類型<select value={kind} onChange={(e) => changeKind(e.target.value)}><option value="expense">支出</option><option value="income">收入</option></select></label>
    <label>金額（TWD）<input required inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} /></label>
    <CategoryPicker categories={data.categories} direction={kind as CategoryDirection} value={category} change={setCategory} />
    <label>每幾個月一次<input required type="number" min="1" max="24" value={interval} onChange={(e) => setInterval(e.target.value)} /></label>
    <label>開始日<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
    {error && <p className="notice error">{error}</p>}<Footer close={close} busy={busy} />
  </form></Dialog>
}
function InvestmentDialog({ data, item, close, done }: { data: FinanceSnapshot; item: any; close: () => void; done: () => Promise<void> }) {
  const [name, setName] = useState(item?.name ?? '')
  const [stock, setStock] = useState(item?.stock_id ?? '')
  const [amount, setAmount] = useState(String(item?.monthly_amount ?? ''))
  const [start, setStart] = useState(item?.start_date ?? dateToday())
  const { busy, error, save } = useSave(done)
  return <Dialog title={item ? '編輯持續投入' : '新增持續投入'} close={close}><form className="form" onSubmit={(e) => { e.preventDefault(); void save(() => financeRepository.saveInvestmentPlan({ ...(item ? { id: item.id } : {}), name, stock_id: stock, monthly_amount: Number(amount), day_of_month: 1, start_date: start, end_date: null, is_active: true })) }}>
    <label>名稱<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="0050 定期定額" /></label>
    <label>股票<select required value={stock} onChange={(e) => setStock(e.target.value)}><option value="" disabled>選擇股票</option>{data.stocks.map((s) => <option key={s.id} value={s.id}>{s.ticker}</option>)}</select></label>
    <label>每月投入金額（TWD）<input required inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} /></label>
    <label>開始日<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
    {error && <p className="notice error">{error}</p>}<Footer close={close} busy={busy} />
  </form></Dialog>
}
function downloadCsv(key: 'transactions' | 'accounts' | 'liabilities' | 'stocks' | 'netWorthSnapshots', data: FinanceSnapshot) { const rows = data[key] as unknown as Record<string, unknown>[]; const headers = rows[0] ? Object.keys(rows[0]) : []; const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? '').replaceAll('"', '""')}"`).join(','))].join('\r\n'); const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }); const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = `${key}-${dateToday()}.csv`; link.click(); URL.revokeObjectURL(href) }

function ExcelReportExport({ data, user }: { data: FinanceSnapshot; user: User | null }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const exportReport = async () => {
    setBusy(true); setError('')
    try { const { downloadExcelReport } = await import('./lib/excelReport'); await downloadExcelReport(data, { email: user?.email ?? '' }) }
    catch (cause) { setError(cause instanceof Error ? `匯出失敗：${cause.message}` : '匯出失敗') }
    finally { setBusy(false) }
  }
  return <Section title="Excel 財務報表"><p className="muted">匯出一份可直接閱讀的 Excel 報表，含摘要、月度收支、分類分析、交易明細、帳戶、股票、負債、推演設定、12 個月推演與淨資產紀錄，方便提供給理財專員或 AI 檢視。</p><div className="exports"><button className="primary" disabled={busy} onClick={() => void exportReport()}>{busy ? '產生中…' : '下載 Excel 報表'}</button></div>{error && <p className="notice error">{error}</p>}</Section>
}
