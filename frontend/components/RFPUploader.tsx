"use client";
import { useState, useRef } from "react";

interface Props {
  onSubmit: (text: string) => void;
  loading: boolean;
}

export default function RFPUploader({ onSubmit, loading }: Props) {
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === "text/plain") {
      const reader = new FileReader();
      reader.onload = (ev) => setText(ev.target?.result as string);
      reader.readAsText(file);
    }
  }

  function handleSubmit() {
    if (mode === "paste") onSubmit(text);
    else onSubmit(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["paste", "url"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              mode === m
                ? "bg-blue-600 text-white"
                : "border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
          >
            {m === "paste" ? "📋 Paste RFP" : "🔗 From URL"}
          </button>
        ))}
      </div>

      {mode === "paste" ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-4 transition ${
            dragging ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"
          }`}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your RFP or job posting here… or drag & drop a .txt file"
            rows={8}
            className="w-full bg-transparent resize-none outline-none text-sm"
          />
          <div className="flex justify-between items-center mt-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs text-blue-600 hover:underline"
            >
              Browse file
            </button>
            <span className="text-xs text-gray-400">{text.length} chars</span>
          </div>
          <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              const r = new FileReader();
              r.onload = (ev) => setText(ev.target?.result as string);
              r.readAsText(f);
            }
          }} />
        </div>
      ) : (
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.upwork.com/jobs/..."
          className="w-full border border-input rounded-lg px-3 py-2 bg-background"
        />
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || (mode === "paste" ? !text.trim() : !url.trim())}
        className="px-6 py-2 bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 transition"
      >
        {loading ? "Analyzing..." : "Analyze RFP"}
      </button>
    </div>
  );
}
