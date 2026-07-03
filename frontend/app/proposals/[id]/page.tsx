"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api, type Proposal } from "@/lib/api";
import ProposalEditor from "@/components/ProposalEditor";

export default function ProposalDetailPage({ params }: { params: { id: string } }) {
  const { data: session } = useSession();
  const userId = (session as any)?.userId ?? "";
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [saving, setSaving] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (userId) {
      api.getProposal(params.id, userId).then(setProposal);
    }
  }, [params.id, userId]);

  async function handleSaveToDrive() {
    if (!proposal) return;
    setDriveLoading(true);
    try {
      const { drive_doc_url } = await api.saveToDrive({
        proposal_id: proposal.id,
        sections: proposal,
        user_id: userId,
      });
      setProposal({ ...proposal, drive_doc_url });
      setMessage("Saved to Google Drive!");
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setDriveLoading(false);
    }
  }

  if (!proposal) return <div className="p-6">Loading...</div>;

  const budgetTotal = proposal.budget.reduce((s, i) => s + i.hours * i.rate, 0);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">← Dashboard</a>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          proposal.status === "Won" ? "bg-green-100 text-green-700" :
          proposal.status === "Lost" ? "bg-red-100 text-red-700" :
          "bg-blue-100 text-blue-700"
        }`}>{proposal.status}</span>
      </div>

      <h1 className="text-2xl font-bold">{proposal.title}</h1>

      {message && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">{message}</div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleSaveToDrive}
          disabled={driveLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {driveLoading ? "Saving..." : "📁 Save to Google Drive"}
        </button>
        {proposal.drive_doc_url && (
          <a
            href={proposal.drive_doc_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Open in Drive →
          </a>
        )}
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
        <div className="text-sm font-medium mb-2">Budget Summary</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pb-1">Task</th>
              <th className="pb-1 text-right">Hours</th>
              <th className="pb-1 text-right">Rate</th>
              <th className="pb-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {proposal.budget.map((item, i) => (
              <tr key={i} className="border-t border-gray-200 dark:border-gray-700">
                <td className="py-1">{item.task}</td>
                <td className="py-1 text-right">{item.hours}h</td>
                <td className="py-1 text-right">${item.rate}/hr</td>
                <td className="py-1 text-right">${(item.hours * item.rate).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-semibold">
              <td colSpan={3} className="pt-2">Total</td>
              <td className="pt-2 text-right">${budgetTotal.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ProposalEditor sections={proposal} onChange={(s) => setProposal({ ...proposal, ...s })} />
    </div>
  );
}
