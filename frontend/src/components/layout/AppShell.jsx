import { useState } from 'react'
import { TopBar } from './TopBar.jsx'
import { SideNav } from './SideNav.jsx'

export function AppShell({ children }) {
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="flex h-full w-full flex-col bg-navy-950">
      <TopBar onToggleNav={() => setNavOpen((v) => !v)} />
      <div className="flex min-h-0 flex-1">
        <SideNav open={navOpen} onClose={() => setNavOpen(false)} />
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
