// Excel 財務報表：把使用者輸入的所有資料整理成可直接閱讀的 .xlsx，供理財專員或 AI 檢視。
// 只讀取 FinanceSnapshot，不寫入資料庫；金額一律四捨五入為 TWD 整數元。
import ExcelJS from 'exceljs'
import type { Category, FinanceSnapshot, Transaction } from '../data/types.ts'
import { accountBalance, buildForecast, dailyBudget, dateToday, financialTotals, liabilityBalance, monthsBetween, stockValue } from './finance.ts'

type Cell = string | number | null
type Format = 'money' | 'percent' | 'rate' | 'integer' | 'text'
type Column = { header: string; width: number; format?: Format }
type Row = { values: Cell[]; style?: 'total' | 'group' }

export type ExcelReportMeta = { email?: string; generatedAt?: Date; today?: string }

const MONEY = '#,##0;[Red]-#,##0'
const formats: Record<Format, string | undefined> = { money: MONEY, percent: '0.0%', rate: '0.00%', integer: '#,##0', text: undefined }
const HEADER_FILL = 'FF1F3A5F'
const TITLE_COLOR = 'FF1F3A5F'
const TOTAL_FILL = 'FFE8EEF5'
const GROUP_FILL = 'FFF4F6F9'

const accountKinds = { cash: '現金', bank: '銀行', stored_value: '儲值卡' } as const
const liabilityKinds = { loan: '貸款', installment: '分期' } as const
const directionLabel = { income: '收入', expense: '支出' } as const
const weekdays = ['日', '一', '二', '三', '四', '五', '六']

const round = (value: number) => Math.round(value)
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const ratio = (part: number, whole: number) => whole ? part / whole : null
const weekday = (date: string) => weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]
const addMonths = (month: string, offset: number) => {
  const [year, value] = month.split('-').map(Number)
  const next = new Date(Date.UTC(year, value - 1 + offset, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}
const monthRange = (first: string, last: string) => {
  const months: string[] = []
  for (let month = first; month <= last; month = addMonths(month, 1)) months.push(month)
  return months
}
const monthLabel = (month: string) => `${month.slice(0, 4)}/${month.slice(5, 7)}`
const taipeiDateTime = (date: Date) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(date)
const taipeiDate = (timestamp: string) => timestamp ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp)) : ''

// 報表收支口徑與報表頁一致：只計收入與支出（含轉帳手續費），轉帳本身不計。
const isIncome = (transaction: Transaction) => transaction.kind === 'income'
const isExpense = (transaction: Transaction) => transaction.kind === 'expense'

type CategoryNames = { major: string; minor: string }
const categoryNamer = (categories: Category[]) => {
  const byId = new Map(categories.map((category) => [category.id, category]))
  return (id: string | null): CategoryNames => {
    const category = id ? byId.get(id) : undefined
    if (!category) return { major: '未分類', minor: '' }
    const parent = category.parent_id ? byId.get(category.parent_id) : undefined
    return parent ? { major: parent.name, minor: category.name } : { major: category.name, minor: '' }
  }
}

const liabilityStats = (liability: FinanceSnapshot['liabilities'][number], today: string) => {
  const balance = round(liabilityBalance(liability, today))
  const elapsed = Math.min(liability.term_months, monthsBetween(liability.start_date, today))
  const dueDay = Math.min(Number(liability.start_date.slice(8)), new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate())
  const paid = Math.min(liability.term_months, Math.max(0, elapsed - (Number(today.slice(8)) < dueDay ? 1 : 0)))
  const lastMonth = addMonths(liability.start_date.slice(0, 7), liability.term_months)
  return { balance, paid, remaining: liability.term_months - paid, lastMonth, totalInterest: Math.max(0, liability.monthly_payment * liability.term_months - liability.principal) }
}

// ── 工作表繪製 ──
const addTable = (sheet: ExcelJS.Worksheet, startRow: number, columns: Column[], rows: Row[], options: { filter?: boolean } = {}) => {
  const header = sheet.getRow(startRow)
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1)
    cell.value = column.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  header.height = 22
  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(startRow + 1 + rowIndex)
    row.values.forEach((value, index) => {
      const cell = excelRow.getCell(index + 1)
      cell.value = value
      const format = columns[index]?.format
      if (format && formats[format] && typeof value === 'number') cell.numFmt = formats[format]!
      if (row.style === 'total') { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }; cell.border = { top: { style: 'thin' } } }
      if (row.style === 'group') { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_FILL } } }
      if (format === 'text' || typeof value === 'string') cell.alignment = { vertical: 'top', wrapText: true }
    })
  })
  if (options.filter && rows.length) sheet.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: columns.length } }
  return startRow + rows.length + 1
}

const tableSheet = (workbook: ExcelJS.Workbook, name: string, title: string, note: string, columns: Column[], rows: Row[], options: { filter?: boolean } = {}) => {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] })
  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width })
  sheet.getCell('A1').value = title
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: TITLE_COLOR } }
  sheet.getCell('A2').value = note
  sheet.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } }
  if (!rows.length) {
    addTable(sheet, 3, columns, [])
    sheet.getCell('A4').value = '（尚無資料）'
    return sheet
  }
  addTable(sheet, 3, columns, rows, options)
  return sheet
}

// ── 主程式 ──
export const buildExcelReport = (data: FinanceSnapshot, meta: ExcelReportMeta = {}) => {
  const today = meta.today ?? dateToday()
  const generatedAt = meta.generatedAt ?? new Date()
  const currentMonth = today.slice(0, 7)
  const nameOf = categoryNamer(data.categories)
  const accountName = new Map(data.accounts.map((account) => [account.id, account.name]))
  const stockTicker = new Map(data.stocks.map((stock) => [stock.id, stock.ticker]))
  const transactions = [...data.transactions].filter((transaction) => !transaction.deleted_at).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.created_at.localeCompare(b.created_at))
  const totals = financialTotals({ ...data, transactions })
  const recent12 = monthRange(addMonths(currentMonth, -11), currentMonth)
  const firstMonth = transactions[0]?.transaction_date.slice(0, 7)
  const allMonths = firstMonth ? monthRange(firstMonth < currentMonth ? firstMonth : currentMonth, currentMonth) : [currentMonth]
  const activePlans = data.investmentPlans.filter((plan) => stockTicker.has(plan.stock_id))

  const monthly = new Map(allMonths.map((month) => [month, { income: 0, expense: 0, count: 0 }]))
  transactions.forEach((transaction) => {
    const entry = monthly.get(transaction.transaction_date.slice(0, 7))
    if (!entry) return
    if (isIncome(transaction)) { entry.income += transaction.amount; entry.count += 1 }
    if (isExpense(transaction)) { entry.expense += transaction.amount; entry.count += 1 }
  })
  const recentStats = recent12.map((month) => monthly.get(month) ?? { income: 0, expense: 0, count: 0 })
  const activeRecentMonths = Math.max(1, recent12.filter((month) => month >= (firstMonth ?? currentMonth)).length)
  const recentIncome = sum(recentStats.map((item) => item.income))
  const recentExpense = sum(recentStats.map((item) => item.expense))

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Money Money Money'
  workbook.created = generatedAt

  // 1. 摘要
  const summary = workbook.addWorksheet('摘要')
  summary.getColumn(1).width = 26
  summary.getColumn(2).width = 20
  summary.getColumn(3).width = 70
  summary.getCell('A1').value = '個人財務報表'
  summary.getCell('A1').font = { bold: true, size: 18, color: { argb: TITLE_COLOR } }
  let line = 3
  const kv = (label: string, value: Cell, format?: Format, note = '') => {
    const row = summary.getRow(line++)
    row.getCell(1).value = label
    row.getCell(1).font = { bold: true }
    row.getCell(2).value = value
    if (format && formats[format] && typeof value === 'number') row.getCell(2).numFmt = formats[format]!
    row.getCell(2).alignment = { horizontal: typeof value === 'number' ? 'right' : 'left' }
    row.getCell(3).value = note
    row.getCell(3).font = { color: { argb: 'FF666666' } }
    row.getCell(3).alignment = { wrapText: true, vertical: 'top' }
  }
  const heading = (text: string) => {
    line += 1
    const cell = summary.getCell(`A${line++}`)
    cell.value = text
    cell.font = { bold: true, size: 13, color: { argb: TITLE_COLOR } }
  }
  kv('帳號', meta.email ?? '')
  kv('產生時間（台灣時間）', taipeiDateTime(generatedAt))
  kv('資料期間', firstMonth ? `${transactions[0].transaction_date} 至 ${transactions[transactions.length - 1].transaction_date}` : '尚無交易')
  kv('幣別', '新台幣（TWD），整數元')

  heading('目前財務狀況')
  kv('現金（所有帳戶）', round(totals.cash), 'money', '各帳戶起始餘額加上所有收入、支出與轉帳；含已封存帳戶。')
  kv('股票市值（推估）', round(totals.stocks), 'money', '以使用者設定的市值基準與年化報酬率推估至今日。')
  kv('資產總額', round(totals.assets), 'money')
  kv('負債餘額', round(totals.liabilities), 'money', '依本金、利率、月繳款與已繳期數推算的剩餘本金。')
  kv('淨資產', round(totals.netWorth), 'money', '資產總額 − 負債餘額。')
  kv('負債比', ratio(totals.liabilities, totals.assets), 'percent', '負債餘額 ÷ 資產總額。')

  heading('近 12 個月收支')
  kv('期間', `${monthLabel(recent12[0])} 至 ${monthLabel(currentMonth)}`, undefined, `有記帳的月份數：${activeRecentMonths}（月平均以此計算）。`)
  kv('總收入', recentIncome, 'money')
  kv('總支出', recentExpense, 'money', '含轉帳手續費；轉帳本身不計入收支。')
  kv('淨收入', recentIncome - recentExpense, 'money')
  kv('月平均收入', round(recentIncome / activeRecentMonths), 'money')
  kv('月平均支出', round(recentExpense / activeRecentMonths), 'money')
  kv('儲蓄率', ratio(recentIncome - recentExpense, recentIncome), 'percent', '（收入 − 支出）÷ 收入。')
  kv('緊急預備金可支應月數', recentExpense ? Math.round(totals.cash / (recentExpense / activeRecentMonths) * 10) / 10 : null, undefined, '目前現金 ÷ 月平均支出。')
  const monthlyLiabilityPayment = sum(data.liabilities.filter((liability) => liabilityBalance(liability, today) > 0).map((liability) => liability.monthly_payment))
  kv('每月負債還款', monthlyLiabilityPayment, 'money', '尚未清償負債的月繳款合計。')
  kv('負債還款占月收入比', ratio(monthlyLiabilityPayment, recentIncome / activeRecentMonths), 'percent')
  kv('每月股票持續投入', sum(activePlans.filter((plan) => plan.is_active).map((plan) => plan.monthly_amount)), 'money')

  const expenseByMajor = new Map<string, number>()
  transactions.filter((transaction) => isExpense(transaction) && recent12.includes(transaction.transaction_date.slice(0, 7))).forEach((transaction) => {
    const major = nameOf(transaction.category_id).major
    expenseByMajor.set(major, (expenseByMajor.get(major) ?? 0) + transaction.amount)
  })
  const topExpenses = [...expenseByMajor].sort((a, b) => b[1] - a[1]).slice(0, 5)
  heading('近 12 個月支出前五大分類')
  if (!topExpenses.length) kv('（尚無支出）', null)
  topExpenses.forEach(([name, amount], index) => kv(`${index + 1}. ${name}`, amount, 'money', `占支出 ${((ratio(amount, recentExpense) ?? 0) * 100).toFixed(1)}%`))

  const budget = dailyBudget({ ...data, transactions }, today)
  heading('本月預算（App 的每日額度）')
  kv('本月預計支出', budget.planned, 'money', '依「12個月推演」下個月的支出與股票投入。')
  kv('本月截至昨日已支出', budget.spentBeforeToday, 'money')
  kv('今日可支出額度', budget.quota, 'money', `本月剩餘 ${budget.remainingDays} 天（含今天）。`)

  heading('工作表說明')
  const guide: [string, string][] = [
    ['月度收支', '每月收入、支出、淨收入與儲蓄率。'],
    ['支出分類分析', '近 12 個月各支出大／小分類的每月金額、月平均與占比。'],
    ['收入分類分析', '近 12 個月各收入分類的每月金額、月平均與占比。'],
    ['交易明細', '全部收入、支出、轉帳紀錄（轉帳以一列顯示轉出與轉入帳戶）。'],
    ['帳戶', '各帳戶的起始餘額、收支、轉帳與目前餘額。'],
    ['股票', '持股、市值基準、預估年化報酬率與推估市值。'],
    ['負債', '貸款與分期：本金、利率、月繳款、剩餘期數與餘額。'],
    ['固定收支', '使用者設定的固定收入與支出（僅用於推演）。'],
    ['持續投入', '每月定期投入股票的計畫（僅用於推演）。'],
    ['一次性收支', '預計發生的一次性收入或支出（僅用於推演）。'],
    ['12個月推演', '依上述設定推算的未來 12 個月現金、股票、負債與淨資產。'],
    ['淨資產紀錄', '每月淨資產快照；「推算」為事後依交易回推，股票以目前估值基準估算。'],
    ['分類設定', '使用者自訂的收支分類及各分類的交易筆數。'],
    ['快速記帳選項', '使用者預設的常用收支範本（不是交易）。'],
  ]
  guide.forEach(([name, description]) => kv(name, '', undefined, description))
  heading('檢視者注意事項')
  ;[
    '本報表由使用者自行輸入的記帳資料產生，未與銀行或券商對帳。',
    '股票市值為使用者依收盤價與股數設定後，依預估年化報酬率推算，非即時市價。',
    '推演與固定收支只是規劃，不代表實際已發生的交易。',
    '已刪除的資料不列入報表。',
  ].forEach((text) => { summary.getCell(`A${line}`).value = `• ${text}`; summary.mergeCells(`A${line}:C${line}`); line += 1 })

  // 2. 月度收支
  const monthRows: Row[] = allMonths.map((month) => {
    const entry = monthly.get(month)!
    return { values: [monthLabel(month), entry.income, entry.expense, entry.income - entry.expense, ratio(entry.income - entry.expense, entry.income), entry.count] }
  }).reverse()
  const allIncome = sum([...monthly.values()].map((entry) => entry.income))
  const allExpense = sum([...monthly.values()].map((entry) => entry.expense))
  monthRows.push({ values: ['合計', allIncome, allExpense, allIncome - allExpense, ratio(allIncome - allExpense, allIncome), sum([...monthly.values()].map((entry) => entry.count))], style: 'total' })
  monthRows.push({ values: ['月平均', round(allIncome / allMonths.length), round(allExpense / allMonths.length), round((allIncome - allExpense) / allMonths.length), null, null], style: 'total' })
  tableSheet(workbook, '月度收支', '月度收支', '收入與支出不含轉帳；支出含轉帳手續費。儲蓄率＝淨收入 ÷ 收入。最新月份在上。', [
    { header: '月份', width: 12 }, { header: '收入', width: 14, format: 'money' }, { header: '支出', width: 14, format: 'money' },
    { header: '淨收入', width: 14, format: 'money' }, { header: '儲蓄率', width: 10, format: 'percent' }, { header: '收支筆數', width: 10, format: 'integer' },
  ], monthRows)

  // 3、4. 分類分析（近 12 個月）
  const categorySheet = (direction: 'income' | 'expense', sheetName: string) => {
    const relevant = transactions.filter((transaction) => (direction === 'income' ? isIncome(transaction) : isExpense(transaction)) && recent12.includes(transaction.transaction_date.slice(0, 7)))
    const groups = new Map<string, Map<string, number[]>>()
    relevant.forEach((transaction) => {
      const names = nameOf(transaction.category_id)
      const minors = groups.get(names.major) ?? new Map<string, number[]>()
      groups.set(names.major, minors)
      const values = minors.get(names.minor) ?? recent12.map(() => 0)
      values[recent12.indexOf(transaction.transaction_date.slice(0, 7))] += transaction.amount
      minors.set(names.minor, values)
    })
    const grand = sum(relevant.map((transaction) => transaction.amount))
    const rowFor = (major: string, minor: string, values: number[], style?: Row['style']): Row => {
      const total = sum(values)
      return { values: [major, minor, ...values, total, round(total / activeRecentMonths), ratio(total, grand)], style }
    }
    const rows: Row[] = []
    ;[...groups].map(([major, minors]) => ({ major, minors, values: recent12.map((_, index) => sum([...minors.values()].map((values) => values[index]))) }))
      .sort((a, b) => sum(b.values) - sum(a.values))
      .forEach(({ major, minors, values }) => {
        const hasMinors = [...minors.keys()].some((minor) => minor)
        rows.push(rowFor(major, hasMinors ? '（小計）' : '', values, hasMinors ? 'group' : undefined))
        if (hasMinors) [...minors].sort((a, b) => sum(b[1]) - sum(a[1])).forEach(([minor, minorValues]) => rows.push(rowFor(major, minor || '（未選小分類）', minorValues)))
      })
    if (rows.length) rows.push(rowFor('合計', '', recent12.map((_, index) => sum(relevant.filter((transaction) => transaction.transaction_date.slice(0, 7) === recent12[index]).map((transaction) => transaction.amount))), 'total'))
    const sheet = tableSheet(workbook, sheetName, `${sheetName}（${monthLabel(recent12[0])}–${monthLabel(currentMonth)}）`, `依近 12 個月${directionLabel[direction]}金額由大到小排列；月平均以有記帳的 ${activeRecentMonths} 個月計算。`, [
      { header: '大分類', width: 16 }, { header: '小分類', width: 16 },
      ...recent12.map((month) => ({ header: monthLabel(month), width: 11, format: 'money' as const })),
      { header: '12 個月合計', width: 14, format: 'money' }, { header: '月平均', width: 12, format: 'money' }, { header: '占比', width: 9, format: 'percent' },
    ], rows, { filter: true })
    sheet.views = [{ state: 'frozen', ySplit: 3, xSplit: 2 }]
  }
  categorySheet('expense', '支出分類分析')
  categorySheet('income', '收入分類分析')

  // 5. 交易明細（轉帳合併為一列）
  const transferPairs = new Map<string, { out?: Transaction; in?: Transaction }>()
  transactions.filter((transaction) => transaction.kind === 'transfer_in' || transaction.kind === 'transfer_out').forEach((transaction) => {
    const key = transaction.transfer_group_id ?? transaction.id
    const pair = transferPairs.get(key) ?? {}
    if (transaction.kind === 'transfer_out') pair.out = transaction
    else pair.in = transaction
    transferPairs.set(key, pair)
  })
  const emitted = new Set<string>()
  const detailRows: Row[] = []
  transactions.forEach((transaction) => {
    const base = [transaction.transaction_date, weekday(transaction.transaction_date)]
    if (transaction.kind === 'income' || transaction.kind === 'expense') {
      const names = nameOf(transaction.category_id)
      const type = transaction.kind === 'income' ? '收入' : transaction.is_transfer_fee ? '支出（轉帳手續費）' : '支出'
      detailRows.push({ values: [...base, type, names.major, names.minor, accountName.get(transaction.account_id) ?? '（已刪除帳戶）', '', transaction.kind === 'income' ? transaction.amount : null, transaction.kind === 'expense' ? transaction.amount : null, null, transaction.note ?? ''] })
      return
    }
    const key = transaction.transfer_group_id ?? transaction.id
    if (emitted.has(key)) return
    emitted.add(key)
    const pair = transferPairs.get(key) ?? {}
    const from = pair.out ? accountName.get(pair.out.account_id) ?? '（已刪除帳戶）' : ''
    const to = pair.in ? accountName.get(pair.in.account_id) ?? '（已刪除帳戶）' : ''
    detailRows.push({ values: [...base, '轉帳', '', '', from, to, null, null, (pair.out ?? pair.in ?? transaction).amount, (pair.out?.note || pair.in?.note) ?? ''] })
  })
  const detailTotal = (type: 'income' | 'expense') => sum(transactions.filter((transaction) => transaction.kind === type).map((transaction) => transaction.amount))
  if (detailRows.length) detailRows.push({ values: ['合計', '', `${detailRows.length} 筆`, '', '', '', '', detailTotal('income'), detailTotal('expense'), null, ''], style: 'total' })
  tableSheet(workbook, '交易明細', '交易明細', '依日期排序。轉帳以一列呈現：「帳戶」為轉出、「轉入帳戶」為轉入；手續費另列為支出。可用標題列篩選。', [
    { header: '日期', width: 12 }, { header: '星期', width: 6 }, { header: '類型', width: 14 }, { header: '大分類', width: 14 }, { header: '小分類', width: 14 },
    { header: '帳戶', width: 16 }, { header: '轉入帳戶', width: 16 }, { header: '收入', width: 12, format: 'money' }, { header: '支出', width: 12, format: 'money' },
    { header: '轉帳金額', width: 12, format: 'money' }, { header: '備註', width: 36, format: 'text' },
  ], detailRows, { filter: true })

  // 6. 帳戶
  const accountRows: Row[] = data.accounts.map((account) => {
    const own = transactions.filter((transaction) => transaction.account_id === account.id)
    const total = (kind: Transaction['kind']) => sum(own.filter((transaction) => transaction.kind === kind).map((transaction) => transaction.amount))
    return { values: [account.name, accountKinds[account.kind] ?? account.kind, account.is_archived ? '已封存' : '使用中', taipeiDate(account.created_at), account.opening_balance, total('income'), total('expense'), total('transfer_in'), total('transfer_out'), accountBalance(account, transactions), ratio(accountBalance(account, transactions), totals.cash)] }
  })
  if (accountRows.length) accountRows.push({ values: ['合計', '', '', '', sum(data.accounts.map((account) => account.opening_balance)), ...(['income', 'expense', 'transfer_in', 'transfer_out'] as const).map((kind) => sum(transactions.filter((transaction) => transaction.kind === kind && accountName.has(transaction.account_id)).map((transaction) => transaction.amount))), round(totals.cash), 1], style: 'total' })
  tableSheet(workbook, '帳戶', '帳戶', '目前餘額＝起始餘額＋收入－支出＋轉入－轉出。依 App 內排序列出。', [
    { header: '帳戶名稱', width: 18 }, { header: '類型', width: 9 }, { header: '狀態', width: 9 }, { header: '建立日期', width: 12 }, { header: '起始餘額', width: 14, format: 'money' },
    { header: '收入合計', width: 14, format: 'money' }, { header: '支出合計', width: 14, format: 'money' }, { header: '轉入合計', width: 14, format: 'money' }, { header: '轉出合計', width: 14, format: 'money' },
    { header: '目前餘額', width: 14, format: 'money' }, { header: '占現金比', width: 10, format: 'percent' },
  ], accountRows)

  // 7. 股票
  const stockRows: Row[] = data.stocks.map((stock) => {
    const value = round(stockValue(stock, today))
    const plans = activePlans.filter((plan) => plan.stock_id === stock.id && plan.is_active)
    return { values: [stock.ticker, stock.shares, stock.valuation_amount, stock.valuation_date, stock.annual_return_bps / 10000, value, ratio(value, totals.stocks), sum(plans.map((plan) => plan.monthly_amount))] }
  })
  if (stockRows.length) stockRows.push({ values: ['合計', null, sum(data.stocks.map((stock) => stock.valuation_amount)), '', null, round(totals.stocks), 1, sum(activePlans.filter((plan) => plan.is_active).map((plan) => plan.monthly_amount))], style: 'total' })
  tableSheet(workbook, '股票', '股票資產', '市值基準為使用者依收盤價×股數設定的金額；目前推估市值依預估年化報酬率由基準日推算至今日。', [
    { header: '代號', width: 10 }, { header: '股數', width: 10, format: 'integer' }, { header: '市值基準', width: 14, format: 'money' }, { header: '基準日期', width: 12 },
    { header: '預估年化報酬率', width: 14, format: 'rate' }, { header: '目前推估市值', width: 14, format: 'money' }, { header: '占股票比', width: 10, format: 'percent' }, { header: '每月持續投入', width: 14, format: 'money' },
  ], stockRows)

  // 8. 負債
  const liabilityRows: Row[] = data.liabilities.map((liability) => {
    const stats = liabilityStats(liability, today)
    return { values: [liability.name, liabilityKinds[liability.kind] ?? liability.kind, liability.principal, liability.annual_rate_bps / 10000, liability.monthly_payment, liability.term_months, liability.start_date, stats.paid, stats.remaining, monthLabel(stats.lastMonth), stats.balance, stats.totalInterest] }
  })
  if (liabilityRows.length) liabilityRows.push({ values: ['合計', '', sum(data.liabilities.map((liability) => liability.principal)), null, sum(data.liabilities.filter((liability) => liabilityBalance(liability, today) > 0).map((liability) => liability.monthly_payment)), null, '', null, null, '', round(totals.liabilities), sum(data.liabilities.map((liability) => liabilityStats(liability, today).totalInterest))], style: 'total' })
  tableSheet(workbook, '負債', '負債（貸款與分期）', '目前餘額依本息平均攤還推算；總利息＝月繳款×期數－本金。月繳款合計只計尚未清償者。', [
    { header: '名稱', width: 18 }, { header: '類型', width: 8 }, { header: '本金', width: 14, format: 'money' }, { header: '年利率', width: 9, format: 'rate' }, { header: '月繳款', width: 12, format: 'money' },
    { header: '總期數', width: 8, format: 'integer' }, { header: '起始日', width: 12 }, { header: '已繳期數', width: 9, format: 'integer' }, { header: '剩餘期數', width: 9, format: 'integer' },
    { header: '最後一期', width: 10 }, { header: '目前餘額', width: 14, format: 'money' }, { header: '總利息', width: 12, format: 'money' },
  ], liabilityRows)

  // 9. 固定收支
  const recurringRows: Row[] = [...data.recurringRules].sort((a, b) => a.kind.localeCompare(b.kind) || b.amount - a.amount).map((rule) => {
    const names = nameOf(rule.category_id)
    return { values: [rule.name, directionLabel[rule.kind], rule.amount, rule.interval_months === 1 ? '每月' : `每 ${rule.interval_months} 個月`, round(rule.amount / rule.interval_months), rule.category_id ? [names.major, names.minor].filter(Boolean).join(' › ') : '未分類', rule.day_of_month, rule.start_date, rule.end_date ?? '無', rule.is_active ? '啟用' : '停用'] }
  })
  const monthlyEquivalent = (kind: 'income' | 'expense') => sum(data.recurringRules.filter((rule) => rule.kind === kind && rule.is_active).map((rule) => round(rule.amount / rule.interval_months)))
  if (recurringRows.length) {
    recurringRows.push({ values: ['固定收入（月均）', '', null, '', monthlyEquivalent('income'), '', null, '', '', '只計啟用'], style: 'total' })
    recurringRows.push({ values: ['固定支出（月均）', '', null, '', monthlyEquivalent('expense'), '', null, '', '', '只計啟用'], style: 'total' })
  }
  tableSheet(workbook, '固定收支', '固定收支（推演設定）', '使用者預期定期發生的收入與支出，只用於推演，不會自動建立交易。', [
    { header: '項目', width: 20 }, { header: '類型', width: 8 }, { header: '每次金額', width: 13, format: 'money' }, { header: '頻率', width: 12 }, { header: '換算月均', width: 13, format: 'money' },
    { header: '分類', width: 20 }, { header: '日', width: 6, format: 'integer' }, { header: '開始日', width: 12 }, { header: '結束日', width: 12 }, { header: '狀態', width: 8 },
  ], recurringRows)

  // 10. 持續投入
  tableSheet(workbook, '持續投入', '股票持續投入（推演設定）', '每月定期投入股票的計畫，只用於推演。', [
    { header: '計畫名稱', width: 20 }, { header: '股票代號', width: 10 }, { header: '每月金額', width: 13, format: 'money' }, { header: '扣款日', width: 8, format: 'integer' },
    { header: '開始日', width: 12 }, { header: '結束日', width: 12 }, { header: '狀態', width: 8 },
  ], activePlans.map((plan) => ({ values: [plan.name, stockTicker.get(plan.stock_id) ?? '', plan.monthly_amount, plan.day_of_month, plan.start_date, plan.end_date ?? '無', plan.is_active ? '啟用' : '停用'] })))

  // 11. 一次性收支
  tableSheet(workbook, '一次性收支', '一次性收支（推演設定）', '預計發生的一次性收入或支出；日期已過者不再計入推演。', [
    { header: '日期', width: 12 }, { header: '項目', width: 24 }, { header: '類型', width: 8 }, { header: '金額', width: 14, format: 'money' }, { header: '狀態', width: 10 },
  ], [...data.forecastEvents].sort((a, b) => a.event_date.localeCompare(b.event_date)).map((event) => ({ values: [event.event_date, event.name, directionLabel[event.kind], event.amount, event.event_date < today ? '已過期' : '預計'] })))

  // 12. 12 個月推演
  const forecast = buildForecast({ ...data, transactions })
  tableSheet(workbook, '12個月推演', '未來 12 個月推演', '依目前現金、股票、負債及固定收支／持續投入／一次性收支推算，僅供參考。月淨額＝收入－支出－股票投入。', [
    { header: '月份', width: 10 }, { header: '收入', width: 13, format: 'money' }, { header: '支出', width: 13, format: 'money' }, { header: '股票投入', width: 13, format: 'money' },
    { header: '月淨額', width: 13, format: 'money' }, { header: '現金', width: 14, format: 'money' }, { header: '股票市值', width: 14, format: 'money' }, { header: '累計報酬', width: 13, format: 'money' },
    { header: '負債', width: 14, format: 'money' }, { header: '淨資產', width: 14, format: 'money' }, { header: '支出明細', width: 48, format: 'text' },
  ], forecast.map((row) => ({ values: [row.label, round(row.income), round(row.expenses), round(row.stockContribution), round(row.monthlyNet), round(row.cash), round(row.stocks), round(row.cumulativeReturn), round(row.liabilities), round(row.netWorth), row.expenseItems.map((item) => `${item.name} ${item.amount.toLocaleString('en-US')}`).join('、')] })))

  // 13. 淨資產紀錄
  const snapshots = [...data.netWorthSnapshots].sort((a, b) => a.snapshot_month.localeCompare(b.snapshot_month))
  tableSheet(workbook, '淨資產紀錄', '每月淨資產紀錄', '「實際」為當月 App 記錄的值；「推算」為依交易與攤還公式回推（股票以目前估值基準估算）。最新月份在上。', [
    { header: '月份', width: 10 }, { header: '現金', width: 14, format: 'money' }, { header: '股票', width: 14, format: 'money' }, { header: '負債', width: 14, format: 'money' },
    { header: '淨資產', width: 14, format: 'money' }, { header: '較上月增減', width: 14, format: 'money' }, { header: '增減幅度', width: 10, format: 'percent' }, { header: '資料性質', width: 10 },
  ], snapshots.map((row, index) => {
    const previous = snapshots[index - 1]
    const change = previous ? row.net_worth - previous.net_worth : null
    return { values: [monthLabel(row.snapshot_month), row.cash, row.stocks, row.liabilities, row.net_worth, change, previous && change !== null ? ratio(change, Math.abs(previous.net_worth)) : null, row.is_estimated ? '推算' : '實際'] }
  }).reverse())

  // 14. 分類設定
  const activeCategories = data.categories.filter((category) => !category.deleted_at)
  const usage = new Map<string, { count: number; amount: number }>()
  transactions.forEach((transaction) => {
    if (!transaction.category_id) return
    const entry = usage.get(transaction.category_id) ?? { count: 0, amount: 0 }
    entry.count += 1
    entry.amount += transaction.amount
    usage.set(transaction.category_id, entry)
  })
  const categoryRows: Row[] = []
  ;(['expense', 'income'] as const).forEach((direction) => {
    activeCategories.filter((category) => category.direction === direction && !category.parent_id).sort((a, b) => a.sort_order - b.sort_order).forEach((major) => {
      const children = activeCategories.filter((category) => category.parent_id === major.id).sort((a, b) => a.sort_order - b.sort_order)
      const own = usage.get(major.id) ?? { count: 0, amount: 0 }
      const childUsage = children.map((child) => usage.get(child.id) ?? { count: 0, amount: 0 })
      categoryRows.push({ values: [directionLabel[direction], major.name, children.length ? '（含小分類）' : '', own.count + sum(childUsage.map((item) => item.count)), own.amount + sum(childUsage.map((item) => item.amount))], style: children.length ? 'group' : undefined })
      children.forEach((child, index) => categoryRows.push({ values: [directionLabel[direction], major.name, child.name, childUsage[index].count, childUsage[index].amount] }))
    })
  })
  tableSheet(workbook, '分類設定', '收支分類', '使用者自訂的分類；筆數與金額為全期間交易合計（大分類列含其小分類）。', [
    { header: '方向', width: 8 }, { header: '大分類', width: 16 }, { header: '小分類', width: 16 }, { header: '交易筆數', width: 10, format: 'integer' }, { header: '金額合計', width: 14, format: 'money' },
  ], categoryRows, { filter: true })

  // 15. 快速記帳選項
  tableSheet(workbook, '快速記帳選項', '快速記帳選項', '常用的收支範本，只用於預填表單，不是交易。', [
    { header: '類型', width: 8 }, { header: '金額', width: 12, format: 'money' }, { header: '帳戶', width: 16 }, { header: '大分類', width: 14 }, { header: '小分類', width: 14 }, { header: '備註', width: 30, format: 'text' },
  ], data.quickTransactions.map((item) => {
    const names = nameOf(item.category_id)
    return { values: [directionLabel[item.kind], item.amount, accountName.get(item.account_id) ?? '（已刪除帳戶）', item.category_id ? names.major : '', names.minor, item.note ?? ''] }
  }))

  workbook.eachSheet((sheet) => { sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } })
  return workbook
}

export const excelReportFileName = (today = dateToday()) => `財務報表-${today}.xlsx`

export const downloadExcelReport = async (data: FinanceSnapshot, meta: ExcelReportMeta = {}) => {
  const buffer = await buildExcelReport(data, meta).xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = excelReportFileName(meta.today)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
