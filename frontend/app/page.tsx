import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 px-4">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-bold text-gray-900 dark:text-white">
          Proposal<span className="text-blue-600">Pilot</span>
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300">
          Turn any RFP into a winning proposal in under 5 minutes.
          AI-generated drafts, instant budgets, saved to Google Drive.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/login"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Get Started
          </Link>
          <Link
            href="/dashboard"
            className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition"
          >
            Dashboard
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-12 text-left">
          {[
            { icon: "📋", title: "Paste any RFP", desc: "Text, email, or job board URL" },
            { icon: "✨", title: "AI drafts everything", desc: "7 sections generated in seconds" },
            { icon: "📁", title: "Saved to Drive", desc: "Google Doc created automatically" },
          ].map((f) => (
            <div key={f.title} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="font-semibold text-gray-900 dark:text-white">{f.title}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
