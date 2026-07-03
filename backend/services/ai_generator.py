import json
import os
from openai import OpenAI
from models.proposal import ProposalSections, BudgetLineItem

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

TONE_INSTRUCTIONS = {
    "professional": "Use formal, business-appropriate language. Be direct and results-focused.",
    "nonprofit": "Use mission-driven, empathetic language. Emphasize community impact and values.",
    "technical": "Use precise technical language. Include implementation details and methodology.",
    "consulting": "Use strategic, advisory language. Emphasize expertise and ROI.",
    "grant-writing": "Use formal academic language. Emphasize objectives, measurable outcomes, and alignment with funder priorities.",
}

SYSTEM_PROMPT = """You are an expert proposal writer with 15 years of experience winning contracts.
Generate personalized, compelling proposals that sound human and specific to the opportunity.
Never use generic filler phrases. Every section should directly reference the client's stated needs.
Return ONLY valid JSON matching the exact schema provided."""


def generate_proposal(
    rfp_text: str,
    tone: str = "professional",
    hourly_rate: float = 100.0,
    client_name: str = "",
    organization: str = "",
    project_type: str = "",
) -> ProposalSections:
    tone_instruction = TONE_INSTRUCTIONS.get(tone, TONE_INSTRUCTIONS["professional"])
    client_context = ""
    if client_name:
        client_context += f"Client name: {client_name}\n"
    if organization:
        client_context += f"Organization: {organization}\n"
    if project_type:
        client_context += f"Project type: {project_type}\n"

    user_prompt = f"""
Analyze this RFP and generate a complete, winning proposal.

{client_context}
Tone: {tone_instruction}
Hourly rate: ${hourly_rate}/hr

RFP:
---
{rfp_text[:6000]}
---

Return a JSON object with exactly these fields:
{{
  "title": "Specific, compelling proposal title (not generic)",
  "executive_summary": "2-3 paragraphs demonstrating understanding of their problem and your solution",
  "scope_of_work": "Detailed bullet-point breakdown of deliverables",
  "timeline": "Week-by-week or phase-based schedule with milestones",
  "budget": [
    {{"task": "task name", "hours": 10.0, "rate": {hourly_rate}}}
  ],
  "cover_letter": "Personalized cover letter (3-4 paragraphs) that references their specific needs",
  "follow_up_email": "Short, professional follow-up email to send 3 days after submission"
}}

Budget must be an array of line items. Total 3-8 line items covering all major tasks.
"""

    response = client.chat.completions.create(
        model="gpt-4.1",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.7,
    )

    data = json.loads(response.choices[0].message.content)
    budget_items = [BudgetLineItem(**item) for item in data.get("budget", [])]

    return ProposalSections(
        title=data["title"],
        executive_summary=data["executive_summary"],
        scope_of_work=data["scope_of_work"],
        timeline=data["timeline"],
        budget=budget_items,
        cover_letter=data["cover_letter"],
        follow_up_email=data["follow_up_email"],
    )
