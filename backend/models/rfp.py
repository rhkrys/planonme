from pydantic import BaseModel
from typing import Optional
from enum import Enum


class RFPSource(str, Enum):
    paste = "paste"
    email = "email"
    url = "url"


class RFPIngestRequest(BaseModel):
    source: RFPSource
    text: Optional[str] = None       # for paste
    email_id: Optional[str] = None   # Gmail message ID
    url: Optional[str] = None        # Upwork/Freelancer URL
    user_id: str


class RFPAnalysis(BaseModel):
    keywords: list[str]
    technologies: list[str]
    deadline: Optional[str]
    budget_signal: Optional[str]
    category: str
    score: float
    raw_text: str
