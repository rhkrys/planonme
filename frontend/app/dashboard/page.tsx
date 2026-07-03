"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { api, type Proposal } from "@/lib/api";
import KanbanBoard from "@/components/KanbanBoard";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [view, setView] = useState<"kanban" | "analytics">("kanban");
  const [search, setSearch] = useState("");

  const userId = (session as any)?.userId ?? "";

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (userId) {
      api.listProposals(userId).then(setProposals);
    }
  }, [userId]);

  async function handleStatusChange(id: string, newStatus: string) {
    await api.updateStatus(id, newStatus, userId);
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: newStatus as Proposal["status"] } : p))
    );
  }

  const filtered = proposals.filter(
    (p) =>
      !search ||
      p.title?.toLowerCase().includes(search.toLowerCase()) ||
      p.client_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (status === "loading") return <div className="p-6">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">
            Proposal<span className="text-blue-600">Pilot</span>
          </h1>
          <div className="flex items-center gap-4">
            <input
              type="text"
              placeholder="Search proposals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-background w-56"
            />
            <button
              onClick={() => setView(view === "kanban" ? "analytics" : "kanban")}
              className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {view === "kanban" ? "📊 Analytics" : "📋 Kanban"}
            </button>
            <button
              onClick={() => router.push("/proposals/new")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
            >
              + New Proposal
            </button>
            <span className="text-sm text-gray-500">{session?.user?.name}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {view === "kanban" ? (
          <KanbanBoard proposals={filtered} onStatusChange={handleStatusChange} />
        ) : (
          <AnalyticsDashboard proposals={filtered} />
        )}
      </main>
    </div>
  );
}
