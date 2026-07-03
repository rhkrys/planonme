"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { api, type ProposalSections, type RFPAnalysis } from "@/lib/api";
import ProposalEditor from "@/components/ProposalEditor";
import RFPUploader from "@/components/RFPUploader";

const TONES = ["professional", "nonprofit", "technical", "consulting", "grant-writing"];

export default function NewProposalPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [rfpText, setRfpText] = useState("");
  const [analysis, setAnalysis] = useState<RFPAnalysis | null>(null);
  const [sections, setSections] = useState<ProposalSections | null>(null);
  const [tone, setTone] = useState("professional");
  const [hourlyRate, setHourlyRate] = useState(100);
  const [clientName, setClientName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const userId = (session as any)?.userId ?? "";

  async function handleAnalyze(text: string) {
    setRfpText(text);
    setAnalyzing(true);
    setError("");
    try {
      const result = await api.analyzeRFP({ source: "paste", text, user_id: userId });
      setAnalysis(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleGenerate() {
    if (!rfpText) return;
    setGenerating(true);
    setError("");
    try {
      const result = await api.generateProposal({
        rfp_id: "",
        rfp_text: rfpText,
        tone,
        hourly_rate: hourlyRate,
        client_name: clientName,
        user_id: userId,
      });
      setSections(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!sections) return;
    setSaving(true);
    try {
      await api.saveProposal({
        ...sections,
        user_id: userId,
        status: "Drafted",
        tone,
        hourly_rate: hourlyRate,
        client_name: clientName || null,
      });
      router.push("/dashboard");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">New Proposal</h1>
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">← Dashboard</a>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">{error}</div>
      )}

      <RFPUploader onSubmit={handleAnalyze} loading={analyzing} />

      {analysis && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded-lg p-4 space-y-2">
          <div className="flex gap-4 text-sm">
            <span className="font-medium">Category:</span> {analysis.category}
            <span className="font-medium">Score:</span>
            <span className={analysis.score > 0.7 ? "text-green-600" : "text-yellow-600"}>
              {Math.round(analysis.score * 100)}%
            </span>
          </div>
          {analysis.budget_signal && (
            <div className="text-sm"><span className="font-medium">Budget signal:</span> {analysis.budget_signal}</div>
          )}
          {analysis.deadline && (
            <div className="text-sm"><span className="font-medium">Deadline:</span> {analysis.deadline}</div>
          )}
          <div className="text-sm flex flex-wrap gap-1 mt-1">
            {analysis.technologies.map((t) => (
              <span key={t} className="bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded text-xs">{t}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Tone</label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="w-full border border-input rounded-lg px-3 py-2 bg-background"
          >
            {TONES.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Hourly Rate ($)</label>
          <input
            type="number"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(Number(e.target.value))}
            className="w-full border border-input rounded-lg px-3 py-2 bg-background"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">Client Name (optional)</label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. Acme Corp"
            className="w-full border border-input rounded-lg px-3 py-2 bg-background"
          />
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={!rfpText || generating}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {generating ? "Generating proposal..." : "✨ Generate Proposal"}
      </button>

      {sections && (
        <>
          <ProposalEditor sections={sections} onChange={setSections} />
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 transition"
            >
              {saving ? "Saving..." : "Save Proposal"}
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-6 py-3 border border-blue-600 text-blue-600 rounded-lg font-semibold hover:bg-blue-50 disabled:opacity-50 transition"
            >
              Regenerate
            </button>
          </div>
        </>
      )}
    </div>
  );
}
