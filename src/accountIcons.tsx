/* eslint-disable react/only-export-components -- the shared account icon registry and renderer intentionally live together */
import { Wallet } from 'lucide-react'

export const accountIconOptions = [
  { key: 'account-icon-1', src: '/account-icons/account-icon-1.png' },
  { key: 'account-icon-2', src: '/account-icons/account-icon-2.png' },
  { key: 'account-icon-3', src: '/account-icons/account-icon-3.png' },
  { key: 'account-icon-4', src: '/account-icons/account-icon-4.png' },
]

const iconMap = new Map(accountIconOptions.map(({ key, src }) => [key, src]))

export function AccountIcon({ iconKey, size = 34 }: { iconKey: string | null | undefined; size?: number }) {
  const src = iconKey ? iconMap.get(iconKey) : undefined
  return <span className="account-icon" style={{ width: size, height: size }} aria-hidden="true">
    {src ? <img src={src} alt="" width={size} height={size} /> : <Wallet size={Math.round(size * .58)} strokeWidth={2} />}
  </span>
}
