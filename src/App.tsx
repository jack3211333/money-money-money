// @ts-nocheck -- Supabase rows are runtime-validated by Postgres; UI forms use dynamic fields.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import './App.css'
import './category.css'
import './account.css'
import { Forecast, ForecastEventDialog } from './Forecast'
import { AccountIcon, accountIconOptions } from './accountIcons'
import { CategoryIcon, categoryIconOptions } from './categoryIcons'
import { authRepository, financeRepository } from './data/repository'
import { isSupabaseConfigured } from './data/supabase'
import { emptySnapshot, type Account, type Category, type CategoryDirection, type FinanceSnapshot, type ForecastEvent, type Liability, type Stock, type Transaction } from './data/types'
import { accountBalance, dateToday, financialTotals, liabilityBalance, paymentForRate, rateForPayment, stockValue, twd } from './lib/finance'

type Page = 'home' | 'transactions' | 'assets' | 'forecast' | 'settings'
type Modal = 'transaction' | 'account' | 'category' | 'liability' | 'stock' | 'recurring' | 'investment' | 'forecastEvent' | null
type TransferEdit = Transaction & { targetAccountId?: string; defaultDate?: string }
type CategoryDialogTarget = { item?: Category; parentId?: string; direction?: CategoryDirection }
const accountKinds: Record<Account['kind'], string> = { cash: '現金', bank: '銀行', stored_value: '儲值卡' }

export default function App() {
  const [user, setUser] = useState<User | null>(null); const [data, setData] = useState<FinanceSnapshot>(emptySnapshot)
  const [page, setPage] = useState<Page>('home'); const [modal, setModal] = useState<Modal>(null); const [editing, setEditing] = useState<unknown>(null); const [message, setMessage] = useState(''); const [selectedTransactionDate, setSelectedTransactionDate] = useState(dateToday())
  const reload = async () => { try { setData(await financeRepository.snapshot()); setMessage('') } catch (error) { setMessage(error instanceof Error ? error.message : '讀取資料失敗') } }
  useEffect(() => { if (!isSupabaseConfigured) return; authRepository.currentUser().then((current) => { setUser(current); if (current) void reload() }); const { data: subscription } = authRepository.onAuthChange(() => void authRepository.currentUser().then((current) => { setUser(current); if (current) void reload() })); return () => subscription.subscription.unsubscribe() }, [])
  const open = (kind: Modal, item?: unknown) => { setEditing(item ?? null); setModal(kind) }; const done = async () => { setModal(null); setEditing(null); await reload() }
  if (!isSupabaseConfigured) return <Setup />
  if (!user) return <Login />
  return <main className="shell"><header className="top"><div><small>MONEY MONEY MONEY</small><h1>{({ home: '總覽', transactions: '交易', assets: '資產與負債', forecast: '未來推演', settings: '設定' })[page]}</h1></div><button className="icon" onClick={() => setPage('settings')}>⚙</button></header>{message && <p className="notice error">{message}</p>}<section className="content">{page === 'home' && <Home data={data} open={open} />}{page === 'transactions' && <Transactions data={data} open={open} selectedDate={selectedTransactionDate} setSelectedDate={setSelectedTransactionDate} />}{page === 'assets' && <Assets data={data} open={open} reload={reload} />}{page === 'forecast' && <Forecast data={data} open={open} reload={reload} />}{page === 'settings' && <Settings data={data} open={open} reload={reload} logout={async () => { await authRepository.signOut(); setData(emptySnapshot) }} />}</section><nav><Nav page={page} value="home" label="總覽" icon="●" set={setPage} /><Nav page={page} value="transactions" label="交易" icon="≡" set={setPage} /><button className="add" onClick={() => open('transaction', { defaultDate: page === 'transactions' ? selectedTransactionDate : dateToday() })}>＋<span>新增</span></button><Nav page={page} value="assets" label="資產" icon="◇" set={setPage} /><Nav page={page} value="forecast" label="推演" icon="↗" set={setPage} /></nav>{modal === 'transaction' && <TransactionDialog data={data} item={editing as TransferEdit | null} close={() => setModal(null)} done={done} />}{modal === 'account' && <AccountDialog item={editing as Account | null} close={() => setModal(null)} done={done} />}{modal === 'category' && <CategoryDialog data={data} target={editing as CategoryDialogTarget | null} close={() => setModal(null)} done={done} />}{modal === 'liability' && <LiabilityDialog item={editing as Liability | null} close={() => setModal(null)} done={done} />}{modal === 'stock' && <StockDialog item={editing as Stock | null} close={() => setModal(null)} done={done} />}{modal === 'recurring' && <RecurringDialog data={data} item={editing as any} close={() => setModal(null)} done={done} />}{modal === 'investment' && <InvestmentDialog data={data} item={editing as any} close={() => setModal(null)} done={done} />}{modal === 'forecastEvent' && <ForecastEventDialog item={editing as ForecastEvent | null} close={() => setModal(null)} done={done} />}</main>
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
function Home({ data, open }: { data: FinanceSnapshot; open: (m: Modal) => void }) { const totals = useMemo(() => financialTotals(data), [data]); const currentMonth = dateToday().slice(0, 7); const flow = data.transactions.filter((t) => t.transaction_date.startsWith(currentMonth)).reduce((all, t) => ({ income: all.income + (t.kind === 'income' ? t.amount : 0), expense: all.expense + (t.kind === 'expense' ? t.amount : 0) }), { income: 0, expense: 0 }); return <><section className="hero"><span>淨資產</span><strong>{twd(totals.netWorth)}</strong><small>資產 {twd(totals.assets)}　負債 {twd(totals.liabilities)}</small></section><div className="metrics"><Metric title="本月收入" value={twd(flow.income)} /><Metric title="本月支出" value={twd(flow.expense)} /></div><Section title="帳戶餘額" action="管理" click={() => open('account')}><div className="list">{data.accounts.filter((a) => !a.is_archived).map((a) => <div className="row" key={a.id}><AccountIcon iconKey={a.icon_key} /><span><b>{a.name}</b><small>{accountKinds[a.kind]}</small></span><strong>{twd(accountBalance(a, data.transactions))}</strong></div>)}{!data.accounts.length && <Empty text="先新增帳戶。" />}</div></Section></> }
function Metric({ title, value }: { title: string; value: string }) { return <div className="metric"><small>{title}</small><b>{value}</b></div> }
function Transactions({ data, open, selectedDate, setSelectedDate }: { data: FinanceSnapshot; open: (m: Modal, item?: unknown) => void; selectedDate: string; setSelectedDate: (date: string) => void }) {
  const [search, setSearch] = useState('')
  const feeByGroup = new Map(data.transactions.filter((t) => t.is_transfer_fee && t.transfer_group_id).map((t) => [t.transfer_group_id!, t]))
  const rows = data.transactions.filter((t) => t.kind !== 'transfer_in' && !t.is_transfer_fee && t.transaction_date === selectedDate).filter((t) => {
    const fee = t.transfer_group_id ? feeByGroup.get(t.transfer_group_id) : undefined
    const category = data.categories.find((c) => c.id === t.category_id)
    const feeCategory = fee ? data.categories.find((c) => c.id === fee.category_id) : undefined
    const haystack = [category ? categoryName(category, data.categories) : '', feeCategory ? categoryName(feeCategory, data.categories) : '', t.note, fee?.note ?? ''].join(' ').toLocaleLowerCase()
    return haystack.includes(search.trim().toLocaleLowerCase())
  })
  return <><div className="transaction-filters"><label>日期<input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || dateToday())} /></label><label>搜尋分類或備註<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="大分類、小分類、備註" /></label></div><div className="toolbar"><small>{selectedDate} 的交易</small><button className="primary" onClick={() => open('transaction', { defaultDate: selectedDate })}>新增交易</button></div><div className="list">{rows.map((t) => { const peer = t.transfer_group_id ? data.transactions.find((x) => x.transfer_group_id === t.transfer_group_id && x.kind === 'transfer_in') : undefined; const fee = t.transfer_group_id ? feeByGroup.get(t.transfer_group_id) : undefined; const account = data.accounts.find((a) => a.id === t.account_id); const category = data.categories.find((c) => c.id === t.category_id); const categoryPath = category ? categoryName(category, data.categories) : ''; return <article className="transaction" key={t.id}><span className="category-badge" style={{ color: category?.color ?? (t.kind === 'income' ? '#72e3bc' : '#f4b873') }}><CategoryIcon iconKey={category?.icon_key ?? 'tag'} /></span><span className="transaction-info"><b>{t.note || categoryPath || (t.kind.startsWith('transfer') ? '轉帳' : t.kind === 'income' ? '收入' : '支出')}</b><small className="transaction-detail">{t.transaction_date} · {account && <><AccountIcon iconKey={account.icon_key} size={22} /><span className="transaction-account-name">{account.name}</span></>}{t.note && categoryPath ? ` · ${categoryPath}` : ''}{fee ? ` · 手續費 ${twd(fee.amount)}` : ''}</small></span><strong className={t.kind === 'income' ? 'positive' : ''}>{t.kind === 'income' ? '+' : t.kind === 'expense' ? '-' : ''}{twd(t.amount)}</strong><button className="text" onClick={() => open('transaction', { ...t, targetAccountId: peer?.account_id, transferFee: fee?.amount ?? 0 })}>編輯</button></article> })}{!rows.length && <Empty text="這一天沒有符合條件的交易。" />}</div></>
}
function Assets({ data, open, reload }: { data: FinanceSnapshot; open: (m: Modal, item?: unknown) => void; reload: () => Promise<void> }) { const remove = async (table: 'liabilities' | 'stocks', id: string) => { if (confirm('確定要刪除嗎？')) { await financeRepository.softDelete(table, id); await reload() } }; return <><Section title="負債" action="新增" click={() => open('liability')}><div className="list">{data.liabilities.map((item) => <div className="row" key={item.id}><span><b>{item.name}</b><small>{item.kind === 'loan' ? `貸款 · 年利率 ${item.annual_rate_bps / 100}%` : '分期／零卡'} · 月繳 ${twd(item.monthly_payment)}</small></span><strong>{twd(liabilityBalance(item))}</strong><button className="text" onClick={() => open('liability', item)}>編輯</button><button className="text danger" onClick={() => void remove('liabilities', item.id)}>刪除</button></div>)}{!data.liabilities.length && <Empty text="沒有未清償負債。" />}</div></Section><Section title="股票" action="新增" click={() => open('stock')}><div className="list">{data.stocks.map((item) => <div className="row" key={item.id}><span><b>{item.ticker}</b><small>年化 {item.annual_return_bps / 100}%</small></span><strong>{twd(stockValue(item))}</strong><button className="text" onClick={() => open('stock', item)}>編輯</button><button className="text danger" onClick={() => void remove('stocks', item.id)}>刪除</button></div>)}{!data.stocks.length && <Empty text="新增股票並輸入目前市值。" />}</div></Section></> }
function Settings({ data, open, reload, logout }: { data: FinanceSnapshot; open: (m: Modal, item?: unknown) => void; reload: () => Promise<void>; logout: () => Promise<void> }) { const removeAccount = async (id: string) => { if (confirm('確定要刪除嗎？')) { await financeRepository.softDelete('accounts', id); await reload() } }; const removeCategory = async (item: Category) => { const children = activeCategories(data.categories).filter((c) => c.parent_id === item.id).length; const wording = children ? `這會同時刪除 ${children} 個小分類，確定嗎？` : '確定要刪除這個分類嗎？'; if (confirm(wording)) { await financeRepository.softDeleteCategory(item.id); await reload() } }; return <><Section title="帳戶" action="新增" click={() => open('account')}><div className="list">{data.accounts.map((item) => <div className="row" key={item.id}><AccountIcon iconKey={item.icon_key} /><span><b>{item.name}</b><small>{accountKinds[item.kind]} {item.is_archived ? '· 已封存' : ''}</small></span><button className="text" onClick={() => open('account', item)}>編輯</button><button className="text danger" onClick={() => void removeAccount(item.id)}>刪除</button></div>)}</div></Section>{(['income', 'expense'] as CategoryDirection[]).map((direction) => <CategorySettings key={direction} direction={direction} categories={data.categories} open={open} remove={removeCategory} />)}<Section title="CSV 匯出"><div className="exports">{(['transactions', 'accounts', 'liabilities', 'stocks'] as const).map((key) => <button className="secondary" key={key} onClick={() => downloadCsv(key, data)}>{({ transactions: '交易', accounts: '帳戶', liabilities: '負債', stocks: '股票' })[key]}</button>)}</div></Section><PasswordSettings /><button className="signout" onClick={() => void logout()}>登出</button></> }

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
function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { return <div className="backdrop"><section className="dialog"><header><h2>{title}</h2><button className="icon" onClick={close}>×</button></header>{children}</section></div> }
function useSave(done: () => Promise<void>) { const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const save = async (work: () => Promise<unknown>) => { try { setBusy(true); await work(); await done() } catch (cause) { setError(cause instanceof Error ? cause.message : '儲存失敗') } finally { setBusy(false) } }; return { busy, error, save } }
function Footer({ close, busy }: { close: () => void; busy: boolean }) { return <footer className="footer"><button type="button" className="secondary" onClick={close}>取消</button><button className="primary" disabled={busy}>{busy ? '儲存中…' : '儲存'}</button></footer> }
function Accounts({ data, value, change, stockOnly = false, label = '帳戶' }: { data: FinanceSnapshot; value: string; change: (value: string) => void; stockOnly?: boolean; label?: string }) {
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
      {options.map((account) => <button type="button" role="option" aria-selected={value === account.id} className={value === account.id ? 'account-picker-option selected' : 'account-picker-option'} key={account.id} onClick={() => { change(account.id); setExpanded(false) }}>
        <AccountIcon iconKey={account.icon_key} /><span><b>{account.name}</b><small>{accountKinds[account.kind]}</small></span>
      </button>)}
      {!options.length && <span className="muted">沒有可用帳戶</span>}
    </div>}
  </div>
}

function CategoryPicker({ categories, direction, value, change, collapseChildren = false }: { categories: Category[]; direction: CategoryDirection; value: string; change: (value: string) => void; collapseChildren?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedRoot, setExpandedRoot] = useState<string | null>(null)
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
function TransactionDialog({ data, item, close, done }: { data: FinanceSnapshot; item: (TransferEdit & { transferFee?: number }) | null; close: () => void; done: () => Promise<void> }) {
  const initial = item?.transfer_group_id ? 'transfer' : item?.kind ?? 'expense'
  const [kind, setKind] = useState(initial)
  const [date, setDate] = useState(item?.transaction_date ?? item?.defaultDate ?? dateToday())
  const [amount, setAmount] = useState(String(item?.amount ?? ''))
  const [account, setAccount] = useState(item?.account_id ?? '')
  const [target, setTarget] = useState(item?.targetAccountId ?? '')
  const [category, setCategory] = useState(item?.category_id ?? '')
  const [note, setNote] = useState(item?.note ?? '')
  const [transferFee, setTransferFee] = useState(String(item?.transferFee ?? 0))
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
    } else await financeRepository.saveTransaction({ ...(item?.id ? { id: item.id } : {}), transaction_date: date, amount: numeric, kind: kind as 'income' | 'expense', account_id: account, category_id: category || null, transfer_group_id: null, is_transfer_fee: false, note })
  }) }
  const remove = async () => {
    if (!item || !confirm('確定要刪除這筆交易嗎？')) return
    if (item.transfer_group_id) await financeRepository.softDeleteTransfer(item.transfer_group_id)
    else await financeRepository.softDelete('transactions', item.id)
    await done()
  }
  const changeKind = (value: string) => { setKind(value); setCategory('') }
  return <Dialog title={item ? '編輯交易' : '新增交易'} close={close}><form className="form" onSubmit={submit}>
    <div className="tabs">{[['expense', '支出'], ['income', '收入'], ['transfer', '轉帳']].map(([value, label]) => <button type="button" className={kind === value ? 'selected' : ''} onClick={() => changeKind(value)} key={value}>{label}</button>)}</div>
    <label>金額（TWD）<input autoFocus required inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} /></label>
    <label>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <Accounts data={data} value={account} change={setAccount} label={kind === 'transfer' ? '轉出帳戶' : '帳戶'} />
    {kind === 'transfer' ? <><Accounts data={data} value={target} change={setTarget} label="轉入帳戶" /><label>手續費（TWD，可不填）<input inputMode="numeric" value={transferFee} onChange={(event) => setTransferFee(event.target.value.replace(/[^0-9]/g, ''))} placeholder="0" /></label></> : <CategoryPicker key={kind} categories={data.categories} direction={kind as CategoryDirection} value={category} change={setCategory} collapseChildren />}
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
    <fieldset className="icon-field"><legend>Icon（{categoryIconOptions.length} 個可選）</legend><div className="icon-grid">{categoryIconOptions.map((option) => <button type="button" className={iconKey === option.key ? 'icon-choice selected' : 'icon-choice'} aria-label={option.label} title={option.label} key={option.key} onClick={() => setIconKey(option.key)}><CategoryIcon iconKey={option.key} /><small>{option.label}</small></button>)}</div></fieldset>
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
function StockDialog({ item, close, done }: { item: Stock | null; close: () => void; done: () => Promise<void> }) { const [ticker, setTicker] = useState(item?.ticker ?? ''); const [marketValue, setMarketValue] = useState(''); const [correction, setCorrection] = useState(''); const [annual, setAnnual] = useState(String((item?.annual_return_bps ?? 0) / 100)); const { busy, error, save } = useSave(done); return <Dialog title={item ? '編輯股票' : '新增股票'} close={close}><form className="form" onSubmit={(e) => { e.preventDefault(); void save(() => { if (!item && marketValue === '') throw new Error('請輸入目前市值。'); const today = dateToday(); return financeRepository.saveStock({ ...(item ? { id: item.id } : {}), account_id: null, ticker: ticker.toUpperCase(), annual_return_bps: Math.round(Number(annual) * 100), valuation_amount: item ? (correction === '' ? item.valuation_amount : Number(correction)) : Number(marketValue), valuation_date: item ? (correction === '' ? item.valuation_date : today) : today }) }) }}><label>股票代號<input autoFocus required value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="0050" /></label>{item ? <><p className="muted">目前推算市值：{twd(stockValue(item))}</p><label>一次性修正市值（TWD，可不填）<input inputMode="numeric" value={correction} onChange={(e) => setCorrection(e.target.value.replace(/[^0-9]/g, ''))} placeholder="留空則不修正" /></label>{correction !== '' && <small>儲存後以今天的日期作為新的推算基準。</small>}</> : <label>目前市值（TWD）<input required inputMode="numeric" value={marketValue} onChange={(e) => setMarketValue(e.target.value.replace(/[^0-9]/g, ''))} /></label>}<label>年化報酬率（%）<input required type="number" step="0.01" value={annual} onChange={(e) => setAnnual(e.target.value)} /></label>{error && <p className="notice error">{error}</p>}<Footer close={close} busy={busy} /></form></Dialog> }
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
function downloadCsv(key: 'transactions' | 'accounts' | 'liabilities' | 'stocks', data: FinanceSnapshot) { const rows = data[key] as unknown as Record<string, unknown>[]; const headers = rows[0] ? Object.keys(rows[0]) : []; const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? '').replaceAll('"', '""')}"`).join(','))].join('\r\n'); const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }); const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = `${key}-${dateToday()}.csv`; link.click(); URL.revokeObjectURL(href) }
