// Money Money Money iPhone 小工具（Scriptable 中型）
// 顯示：目前淨資產、較上月增減、今日已支出、本月已支出。
// 安裝：把整份內容貼到 Scriptable 新腳本，先在 App 內執行一次登入，再把 Scriptable 中型小工具加到主畫面或今天視圖。
// 本檔由網站建置時產生；Supabase Publishable key 本來就公開於網站程式中，不是秘密金鑰。帳號密碼不會被保存，只保存登入 token。

const SUPABASE_URL = '__SUPABASE_URL__'
const SUPABASE_KEY = '__SUPABASE_PUBLISHABLE_KEY__'
const APP_URL = '__APP_URL__'
const SESSION_KEY = 'money-money-money.widget.session'
const CACHE_KEY = 'money-money-money.widget.summary'

const colors = { bg: new Color('#181d25'), text: new Color('#edf4f8'), muted: new Color('#9cabb9'), accent: new Color('#8af0cc'), up: new Color('#72e3bc'), down: new Color('#ffaaaa') }
const money = (value) => `$${Math.round(Math.abs(value)).toLocaleString('en-US')}`
const signedMoney = (value) => `${value < 0 ? '▼' : '▲'} ${money(value)}`

const readJson = (key) => { try { return Keychain.contains(key) ? JSON.parse(Keychain.get(key)) : null } catch { return null } }
const writeJson = (key, value) => Keychain.set(key, JSON.stringify(value))
const clearSession = () => { if (Keychain.contains(SESSION_KEY)) Keychain.remove(SESSION_KEY) }

async function authRequest(grantType, body) {
  const request = new Request(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`)
  request.method = 'POST'
  request.headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }
  request.body = JSON.stringify(body)
  const data = await request.loadJSON()
  if (request.response.statusCode !== 200 || !data.access_token) throw new Error(data.error_description || data.msg || '登入失敗')
  const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600) }
  writeJson(SESSION_KEY, session)
  return session
}

async function login() {
  const alert = new Alert()
  alert.title = 'Money Money Money 登入'
  alert.message = '使用與記帳 App 相同的 Email 與密碼。密碼不會被保存。'
  alert.addTextField('Email')
  alert.addSecureTextField('密碼')
  alert.addAction('登入')
  alert.addCancelAction('取消')
  if (await alert.presentAlert() === -1) return null
  return authRequest('password', { email: alert.textFieldValue(0).trim(), password: alert.textFieldValue(1) })
}

async function validSession() {
  const session = readJson(SESSION_KEY)
  if (!session) return null
  if (session.expires_at * 1000 > Date.now() + 60 * 1000) return session
  try { return await authRequest('refresh_token', { refresh_token: session.refresh_token }) } catch { return null }
}

async function fetchSummary(session) {
  const request = new Request(`${SUPABASE_URL}/functions/v1/widget-summary`)
  request.method = 'POST'
  request.headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
  request.body = '{}'
  const data = await request.loadJSON()
  if (request.response.statusCode !== 200) throw new Error(data.reason || '讀取失敗')
  const summary = { ...data, fetchedAt: Date.now() }
  writeJson(CACHE_KEY, summary)
  return summary
}

function addLabel(stack, text, size, color, weight = 'regular') {
  const label = stack.addText(text)
  label.font = weight === 'bold' ? Font.boldRoundedSystemFont(size) : weight === 'mono' ? Font.semiboldMonospacedSystemFont(size) : Font.systemFont(size)
  label.textColor = color
  label.lineLimit = 1
  label.minimumScaleFactor = 0.5
  return label
}

function buildWidget(summary, notice) {
  const widget = new ListWidget()
  widget.backgroundColor = colors.bg
  widget.setPadding(14, 16, 14, 16)
  if (APP_URL.startsWith('http')) widget.url = APP_URL
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000)

  const header = widget.addStack()
  header.centerAlignContent()
  addLabel(header, 'Money Money Money', 11, colors.accent, 'bold')
  header.addSpacer()
  const time = summary ? new Date(summary.fetchedAt) : null
  addLabel(header, notice || (time ? `更新 ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}` : ''), 10, notice ? colors.down : colors.muted)
  widget.addSpacer()

  if (!summary) {
    addLabel(widget, '請在 Scriptable App 內執行此腳本登入', 13, colors.text)
    widget.addSpacer()
    return widget
  }

  const body = widget.addStack()
  body.bottomAlignContent()
  const left = body.addStack()
  left.layoutVertically()
  addLabel(left, '目前淨資產', 11, colors.muted)
  addLabel(left, `${summary.netWorth < 0 ? '-' : ''}${money(summary.netWorth)}`, 24, colors.text, 'mono')
  if (summary.netWorthChange === null) addLabel(left, '較上月 —', 11, colors.muted)
  else addLabel(left, `較上月 ${signedMoney(summary.netWorthChange)}`, 11, summary.netWorthChange < 0 ? colors.down : colors.up)
  body.addSpacer()

  const right = body.addStack()
  right.layoutVertically()
  addLabel(right, '今日已支出', 11, colors.muted)
  addLabel(right, money(summary.spentToday), 17, colors.text, 'mono')
  right.addSpacer(6)
  addLabel(right, '本月已支出', 11, colors.muted)
  addLabel(right, money(summary.spentThisMonth), 17, colors.text, 'mono')
  return widget
}

async function loadWidget() {
  const session = await validSession()
  if (!session) return buildWidget(readJson(CACHE_KEY), '需要重新登入')
  try { return buildWidget(await fetchSummary(session)) } catch { return buildWidget(readJson(CACHE_KEY), '更新失敗') }
}

if (config.runsInWidget) {
  Script.setWidget(await loadWidget())
} else {
  const menu = new Alert()
  menu.title = 'Money Money Money 小工具'
  menu.message = readJson(SESSION_KEY) ? '已登入' : '尚未登入'
  menu.addAction('預覽小工具')
  menu.addAction('登入／重新登入')
  menu.addDestructiveAction('登出')
  menu.addCancelAction('取消')
  const choice = await menu.presentSheet()
  try {
    if (choice === 1) { await login() }
    if (choice === 2) { clearSession(); if (Keychain.contains(CACHE_KEY)) Keychain.remove(CACHE_KEY) }
    if (choice === 0 || choice === 1) {
      if (readJson(SESSION_KEY) || await login()) await (await loadWidget()).presentMedium()
    }
  } catch (error) {
    const failed = new Alert()
    failed.title = '發生錯誤'
    failed.message = String(error.message || error)
    failed.addAction('好')
    await failed.presentAlert()
  }
}
Script.complete()
