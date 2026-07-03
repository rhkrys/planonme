from fastapi import APIRouter, HTTPException
import httpx
from bs4 import BeautifulSoup

from models.rfp import RFPIngestRequest, RFPAnalysis
from services.extractor import analyze_rfp
from services.scorer import score_rfp

router = APIRouter()


async def fetch_url_text(url: str) -> str:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    return soup.get_text(separator=" ", strip=True)[:10000]


@router.post("/analyze", response_model=RFPAnalysis)
async def analyze(req: RFPIngestRequest):
    raw_text = ""

    if req.source == "paste":
        if not req.text:
            raise HTTPException(400, "text is required for paste source")
        raw_text = req.text

    elif req.source == "url":
        if not req.url:
            raise HTTPException(400, "url is required for url source")
        try:
            raw_text = await fetch_url_text(req.url)
        except Exception as e:
            raise HTTPException(422, f"Failed to fetch URL: {e}")

    elif req.source == "email":
        if not req.email_id:
            raise HTTPException(400, "email_id is required for email source")
        # Gmail fetch is handled via the Next.js API route using the user's OAuth token
        raise HTTPException(501, "Email ingestion must go through the frontend Gmail API route")

    analysis = analyze_rfp(raw_text)
    score = score_rfp(raw_text, winning_proposals=[])  # populated once user has history

    return RFPAnalysis(score=score, **analysis)
