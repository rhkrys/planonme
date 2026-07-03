"use client";
import { type Proposal } from "@/lib/api";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface Props {
  proposals: Proposal[];
}

export default function AnalyticsDashboard({ proposals }: Props) {
  const submitted = proposals.filter((p) => ["Submitted", "Won", "Lost"].includes(p.status));
  const won = proposals.filter((p) => p.status === "Won");
  const winRate = submitted.length ? Math.round((won.length / submitted.length) * 100) : 0;

  const totalValue = proposals.reduce((s, p) => s + p.budget.reduce((b, i) => b + i.hours * i.rate, 0), 0);
  const avgValue = proposals.length ? Math.round(totalValue / proposals.length) : 0;
  const timeSavedMinutes = proposals.length * 25;

  const byMonth: Record<string, number> = {};
  proposals.forEach((p) => {
    const month = new Date(p.created_at).toLocaleString("default", { month: "short", year: "2-digit" });
    byMonth[month] = (byMonth[month] || 0) + 1;
  });
  const monthData = Object.entries(byMonth).map(([month, count]) => ({ month, count }));

  const byStatus = ["New", "Drafted", "Submitted", "Won", "Lost"].map((s) => ({
    status: s,
    count: proposals.filter((p) => p.status === s).length,
  }));

  const STATUS_COLORS: Record<string, string> = {
    New: "#94a3b8",
    Drafted: "#60a5fa",
    Submitted: "#fbbf24",
    Won: "#34d399",
    Lost: "#f87171",
  };

  const stats = [
    { label: "Total Proposals", value: proposals.length },
    { label: "Win Rate", value: `${winRate}%` },
    { label: "Avg Value", value: `$${avgValue.toLocaleString()}` },
    { label: "Time Saved", value: `${Math.round(timeSavedMinutes / 60)}h` },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
            <div className="text-3xl font-bold text-gray-900 dark:text-white">{s.value}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold mb-4">Proposals per Month</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthData}>
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold mb-4">Pipeline by Status</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byStatus} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis dataKey="status" type="category" tick={{ fontSize: 12 }} width={70} />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {byStatus.map((entry) => (
                  <Cell key={entry.status} fill={STATUS_COLORS[entry.status]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
