import re
from typing import Optional

try:
    import spacy
    nlp = spacy.load("en_core_web_sm")
    SPACY_AVAILABLE = True
except (ImportError, OSError):
    SPACY_AVAILABLE = False


TECH_KEYWORDS = {
    "python", "javascript", "typescript", "react", "nextjs", "node", "fastapi",
    "django", "flask", "postgres", "mysql", "mongodb", "supabase", "aws", "gcp",
    "azure", "docker", "kubernetes", "graphql", "rest", "api", "machine learning",
    "ai", "llm", "openai", "langchain", "pandas", "numpy", "tensorflow", "pytorch",
    "excel", "automation", "scraping", "selenium", "playwright", "figma", "tailwind",
}

BUDGET_PATTERNS = [
    r"\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?",
    r"[\d,]+\s*(?:usd|dollars?)",
    r"budget[:\s]+[\$\d,]+",
    r"(?:up to|max(?:imum)?)[:\s]+\$[\d,]+",
]

DEADLINE_PATTERNS = [
    r"(?:due|deadline|by|before|deliver(?:ed)? (?:by|on))[:\s]+([A-Za-z]+ \d{1,2},?\s*\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
    r"(?:in|within)\s+(\d+)\s+(?:days?|weeks?|months?)",
    r"(?:start(?:ing)?|begin(?:ning)?)[:\s]+([A-Za-z]+ \d{4}|\d{1,2}[/-]\d{2,4})",
]


def extract_keywords_regex(text: str) -> list[str]:
    """Original prototype logic — 5+ char words."""
    return list(set(re.findall(r"\b[A-Za-z]{5,}\b", text.lower())))


def extract_technologies(text: str) -> list[str]:
    lower = text.lower()
    return [tech for tech in TECH_KEYWORDS if tech in lower]


def extract_budget_signal(text: str) -> Optional[str]:
    for pattern in BUDGET_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0)
    return None


def extract_deadline(text: str) -> Optional[str]:
    for pattern in DEADLINE_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0)
    return None


def extract_keywords_nlp(text: str) -> list[str]:
    if not SPACY_AVAILABLE:
        return extract_keywords_regex(text)
    doc = nlp(text)
    keywords = set()
    for chunk in doc.noun_chunks:
        kw = chunk.text.lower().strip()
        if len(kw) >= 4:
            keywords.add(kw)
    for ent in doc.ents:
        if ent.label_ in ("ORG", "PRODUCT", "GPE", "SKILL", "WORK_OF_ART"):
            keywords.add(ent.text.lower())
    keywords.update(extract_technologies(text))
    return list(keywords)


def categorize_rfp(text: str, technologies: list[str]) -> str:
    lower = text.lower()
    if any(t in lower for t in ("machine learning", "ai", "llm", "model", "neural")):
        return "AI/ML"
    if any(t in lower for t in ("web", "website", "frontend", "react", "nextjs")):
        return "Web Development"
    if any(t in lower for t in ("automation", "script", "excel", "scraping")):
        return "Automation"
    if any(t in lower for t in ("mobile", "ios", "android", "app")):
        return "Mobile"
    if any(t in lower for t in ("data", "analytics", "dashboard", "report")):
        return "Data & Analytics"
    if any(t in lower for t in ("grant", "nonprofit", "foundation")):
        return "Grant Writing"
    return "General"


def analyze_rfp(text: str) -> dict:
    keywords = extract_keywords_nlp(text)
    technologies = extract_technologies(text)
    return {
        "keywords": keywords,
        "technologies": technologies,
        "deadline": extract_deadline(text),
        "budget_signal": extract_budget_signal(text),
        "category": categorize_rfp(text, technologies),
        "raw_text": text,
    }
