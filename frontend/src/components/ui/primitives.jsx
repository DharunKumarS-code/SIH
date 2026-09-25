import clsx from 'clsx'
import { Loader2, Inbox } from 'lucide-react'
import { statusStyle } from '../../lib/format.js'

export function Badge({ children, status, className }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold',
        status ? statusStyle(status) : 'bg-slate-50 text-slate-600 border-slate-300',
        className,
      )}
    >
      {children ?? status}
    </span>
  )
}

// Amber/"warn" toned, deliberately — brass is reserved for genuinely
// official marks elsewhere (e.g. OfficialTag in LayerManager). A demo/
// prototype tag must always read as a caution, never as an official seal.
export function DemoTag({ className, label = 'DEMO' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-warn',
        className,
      )}
    >
      {label}
    </span>
  )
}

export function Card({ children, className, title, right }) {
  return (
    <section className={clsx('card p-4', className)}>
      {(title || right) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="section-title">{title}</h3>}
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint, icon: Icon, accent }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <span className="section-title">{label}</span>
        {Icon && <Icon size={16} className={accent || 'text-primary'} />}
      </div>
      <div className="data-mono mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

/* Ledger-style stat strip — a row of figures separated by hairline dividers
   instead of a grid of identical boxed cards. Use for dashboard-style KPI
   rows; falls back to a single-column stack on narrow screens. */
export function StatStrip({ children, className }) {
  return (
    <div className={clsx('card grid grid-cols-2 divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0 sm:divide-x', className)}>
      {children}
    </div>
  )
}

export function StatStripItem({ label, value, hint, icon: Icon, accent }) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="section-title">{label}</span>
        {Icon && <Icon size={14} className={accent || 'text-primary'} />}
      </div>
      <div className="data-mono mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading…', className }) {
  return (
    <div className={clsx('flex items-center gap-2 text-sm text-slate-500', className)}>
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  )
}

export function EmptyState({ title = 'Nothing here', hint, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500">
      <Icon size={28} className="opacity-60" />
      <p className="font-semibold text-slate-600">{title}</p>
      {hint && <p className="max-w-sm text-xs">{hint}</p>}
    </div>
  )
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

export function KeyValue({ data }) {
  const rows = Object.entries(data || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!rows.length) return <p className="py-2 text-sm text-slate-500">Not Available</p>
  return (
    <dl>
      {rows.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt className="kv-label">{k}</dt>
          <dd className="kv-value">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function DataTable({ columns, rows, onRowClick, empty = 'No records', rowKey }) {
  if (!rows?.length) return <EmptyState title={empty} />
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 font-semibold">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row) : i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={clsx(
                'border-t border-slate-200',
                onRowClick && 'cursor-pointer hover:bg-primary/5',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={clsx('px-3 py-2 align-top text-slate-700', c.mono && 'data-mono')}
                >
                  {c.render ? c.render(row) : row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PageScroll({ children, className }) {
  return <div className={clsx('h-full overflow-y-auto p-5', className)}>{children}</div>
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
      <p className="font-semibold">Couldn’t load data</p>
      <p className="text-danger/90">{String(error.message || error)}</p>
      {onRetry && (
        <button className="btn-ghost mt-2" onClick={onRetry} type="button">
          Retry
        </button>
      )}
    </div>
  )
}
