import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { CHART_COLORS, CHART_COLORS_DARK } from '../../lib/format.js'
import { Card } from '../ui/primitives.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'

function useChartChrome() {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  return {
    axis: { stroke: dark ? '#93a1b5' : '#64748b', fontSize: 11, tickLine: false },
    grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
    cursor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
    line: dark ? '#3ebeac' : '#0f766e',
    // Series colours per theme: the light palette's deep inks are illegible
    // on the dark surface, so dark mode uses the matching dark-theme tokens.
    colors: dark ? CHART_COLORS_DARK : CHART_COLORS,
    tooltip: {
      contentStyle: {
        background: dark ? '#101b2c' : '#0f1829',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 6,
        fontSize: 12,
      },
      labelStyle: { color: '#e7ecf5' },
    },
  }
}

// Long category lists (e.g. one bar per building) can't fit every label
// horizontally: angle them more steeply, give the axis room and shorten each
// label — the tooltip still shows the full name.
const MANY_CATEGORIES = 8
const shortLabel = (v) => (typeof v === 'string' && v.length > 14 ? `${v.slice(0, 13)}…` : v)

export function BarCard({ title, data, height = 200 }) {
  const chrome = useChartChrome()
  const many = (data?.length || 0) > MANY_CATEGORIES
  return (
    <Card title={title}>
      <ResponsiveContainer width="100%" height={many ? height + 36 : height}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
          <XAxis
            dataKey="name"
            {...chrome.axis}
            interval={0}
            angle={many ? -40 : -12}
            textAnchor="end"
            height={many ? 80 : 44}
            tickFormatter={many ? shortLabel : undefined}
          />
          <YAxis {...chrome.axis} />
          <Tooltip {...chrome.tooltip} cursor={{ fill: chrome.cursor }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {data?.map((_, i) => <Cell key={i} fill={chrome.colors[i % chrome.colors.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

export function PieCard({ title, data, height = 200 }) {
  const chrome = useChartChrome()
  return (
    <Card title={title}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={42} outerRadius={72} paddingAngle={2}>
            {data?.map((_, i) => <Cell key={i} fill={chrome.colors[i % chrome.colors.length]} />)}
          </Pie>
          <Tooltip {...chrome.tooltip} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  )
}

export function LineCard({ title, data, height = 200 }) {
  const chrome = useChartChrome()
  return (
    <Card title={title}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
          <XAxis dataKey="name" {...chrome.axis} />
          <YAxis {...chrome.axis} />
          <Tooltip {...chrome.tooltip} />
          <Line type="monotone" dataKey="value" stroke={chrome.line} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}
