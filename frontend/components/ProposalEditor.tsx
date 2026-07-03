"use client";
import { type ProposalSections } from "@/lib/api";

interface Props {
  sections: ProposalSections;
  onChange: (s: ProposalSections) => void;
}

const SECTION_LABELS: { key: keyof Omit<ProposalSections, "budget">; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "executive_summary", label: "Executive Summary" },
  { key: "scope_of_work", label: "Scope of Work" },
  { key: "timeline", label: "Timeline" },
  { key: "cover_letter", label: "Cover Letter" },
  { key: "follow_up_email", label: "Follow-up Email" },
];

export default function ProposalEditor({ sections, onChange }: Props) {
  function update(key: keyof ProposalSections, value: string) {
    onChange({ ...sections, [key]: value });
  }

  return (
    <div className="space-y-6">
      {SECTION_LABELS.map(({ key, label }) => (
        <div key={key}>
          <label className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
            {label}
          </label>
          {key === "title" ? (
            <input
              value={sections[key] as string}
              onChange={(e) => update(key, e.target.value)}
              className="w-full border border-input rounded-lg px-3 py-2 bg-background font-semibold text-lg"
            />
          ) : (
            <textarea
              value={sections[key] as string}
              onChange={(e) => update(key, e.target.value)}
              rows={key === "executive_summary" || key === "cover_letter" ? 6 : 4}
              className="w-full border border-input rounded-lg px-3 py-2 bg-background text-sm resize-y"
            />
          )}
        </div>
      ))}

      <div>
        <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Budget</label>
        <div className="space-y-2">
          {sections.budget.map((item, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 items-center">
              <input
                value={item.task}
                onChange={(e) => {
                  const budget = [...sections.budget];
                  budget[i] = { ...budget[i], task: e.target.value };
                  onChange({ ...sections, budget });
                }}
                placeholder="Task name"
                className="col-span-2 border border-input rounded px-2 py-1 text-sm bg-background"
              />
              <input
                type="number"
                value={item.hours}
                onChange={(e) => {
                  const budget = [...sections.budget];
                  budget[i] = { ...budget[i], hours: Number(e.target.value) };
                  onChange({ ...sections, budget });
                }}
                placeholder="Hours"
                className="border border-input rounded px-2 py-1 text-sm bg-background"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={item.rate}
                  onChange={(e) => {
                    const budget = [...sections.budget];
                    budget[i] = { ...budget[i], rate: Number(e.target.value) };
                    onChange({ ...sections, budget });
                  }}
                  placeholder="Rate"
                  className="flex-1 border border-input rounded px-2 py-1 text-sm bg-background"
                />
                <button
                  onClick={() => {
                    const budget = sections.budget.filter((_, idx) => idx !== i);
                    onChange({ ...sections, budget });
                  }}
                  className="text-red-400 hover:text-red-600 text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => onChange({ ...sections, budget: [...sections.budget, { task: "", hours: 0, rate: 100 }] })}
            className="text-sm text-blue-600 hover:underline"
          >
            + Add line item
          </button>
        </div>
        <div className="mt-2 text-sm font-semibold text-right">
          Total: ${sections.budget.reduce((s, i) => s + i.hours * i.rate, 0).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
