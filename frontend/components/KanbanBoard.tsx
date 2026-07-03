"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type Proposal } from "@/lib/api";

const COLUMNS: Proposal["status"][] = ["New", "Drafted", "Submitted", "Won", "Lost"];

const COLUMN_STYLES: Record<string, string> = {
  New: "border-gray-300",
  Drafted: "border-blue-300",
  Submitted: "border-yellow-300",
  Won: "border-green-400",
  Lost: "border-red-300",
};

interface Props {
  proposals: Proposal[];
  onStatusChange: (id: string, status: string) => void;
}

export default function KanbanBoard({ proposals, onStatusChange }: Props) {
  const router = useRouter();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function handleDragOver(e: React.DragEvent, col: string) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent, col: string) {
    e.preventDefault();
    if (draggingId) {
      onStatusChange(draggingId, col);
      setDraggingId(null);
    }
  }

  return (
    <div className="grid grid-cols-5 gap-4 min-h-[60vh]">
      {COLUMNS.map((col) => {
        const cards = proposals.filter((p) => p.status === col);
        return (
          <div
            key={col}
            onDragOver={(e) => handleDragOver(e, col)}
            onDrop={(e) => handleDrop(e, col)}
            className={`bg-white dark:bg-gray-800 rounded-xl border-t-4 ${COLUMN_STYLES[col]} p-3 flex flex-col gap-3 min-h-[200px]`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{col}</h3>
              <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{cards.length}</span>
            </div>
            {cards.map((p) => {
              const total = p.budget.reduce((s, i) => s + i.hours * i.rate, 0);
              return (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => setDraggingId(p.id)}
                  onClick={() => router.push(`/proposals/${p.id}`)}
                  className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 cursor-pointer hover:shadow-md transition border border-gray-100 dark:border-gray-600 select-none"
                >
                  <div className="text-sm font-medium line-clamp-2">{p.title || "Untitled"}</div>
                  {p.client_name && (
                    <div className="text-xs text-gray-500 mt-1">{p.client_name}</div>
                  )}
                  {total > 0 && (
                    <div className="text-xs text-green-600 font-semibold mt-1">
                      ${total.toLocaleString()}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {new Date(p.created_at).toLocaleDateString()}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
