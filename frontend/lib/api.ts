const BASE = "/api/backend";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "API error");
  }
  return res.json();
}

export type RFPSource = "paste" | "email" | "url";

export interface RFPAnalysis {
  keywords: string[];
  technologies: string[];
  deadline: string | null;
  budget_signal: string | null;
  category: string;
  score: number;
  raw_text: string;
}

export interface BudgetLineItem {
  task: string;
  hours: number;
  rate: number;
}

export interface ProposalSections {
  title: string;
  executive_summary: string;
  scope_of_work: string;
  timeline: string;
  budget: BudgetLineItem[];
  cover_letter: string;
  follow_up_email: string;
}

export interface Proposal extends ProposalSections {
  id: string;
  rfp_id: string | null;
  user_id: string;
  status: "New" | "Drafted" | "Submitted" | "Won" | "Lost";
  tone: string;
  drive_doc_url: string | null;
  client_name: string | null;
  organization: string | null;
  hourly_rate: number;
  created_at: string;
}

export const api = {
  analyzeRFP: (payload: {
    source: RFPSource;
    text?: string;
    url?: string;
    user_id: string;
  }) =>
    request<RFPAnalysis>("/rfp/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  generateProposal: (payload: {
    rfp_id: string;
    rfp_text: string;
    tone: string;
    hourly_rate: number;
    client_name?: string;
    organization?: string;
    project_type?: string;
    user_id: string;
  }) =>
    request<ProposalSections>("/proposals/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listProposals: (user_id: string) =>
    request<Proposal[]>(`/proposals/?user_id=${user_id}`),

  getProposal: (id: string, user_id: string) =>
    request<Proposal>(`/proposals/${id}?user_id=${user_id}`),

  saveProposal: (data: Partial<Proposal>) =>
    request<Proposal>("/proposals/", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateStatus: (id: string, status: string, user_id: string) =>
    request(`/proposals/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, user_id }),
    }),

  saveToDrive: (payload: {
    proposal_id: string;
    sections: ProposalSections;
    folder_id?: string;
    user_id: string;
  }) =>
    request<{ drive_doc_url: string }>("/drive/save", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
