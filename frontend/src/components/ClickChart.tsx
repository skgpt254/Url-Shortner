import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface ClickChartProps {
  data: Array<{ day: string; clicks: number }>;
}

export function ClickChart({ data }: ClickChartProps) {
  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-ink-muted">No clicks recorded yet in this window.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2456F5" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#2456F5" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#E4E6EC" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          tick={{ fontSize: 12, fill: '#5B6178' }}
          axisLine={{ stroke: '#E4E6EC' }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 12, fill: '#5B6178' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          labelFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          contentStyle={{ borderRadius: 8, border: '1px solid #E4E6EC', fontSize: 13 }}
        />
        <Area type="monotone" dataKey="clicks" stroke="#2456F5" strokeWidth={2} fill="url(#clicksFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
