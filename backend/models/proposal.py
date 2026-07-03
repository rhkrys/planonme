from pydantic import BaseModel
from typing import Optional
from enum import Enum


class ProposalStatus(str, Enum):
    new = "New"
    drafted = "Drafted"
    submitted = "Submitted"
    won = "Won"
    lost = "Lost"


class ProposalTone(str, Enum):
    professional = "professional"
    nonprofit = "nonprofit"
    technical = "technical"
    consulting = "consulting"
    grant_writing = "grant-writing"


class BudgetLineItem(BaseModel):
    task: str
    hours: float
    rate: float

    @property
    def total(self) -> float:
        return self.hours * self.rate


class GenerateProposalRequest(BaseModel):
    rfp_id: str
    rfp_text: str
    tone: ProposalTone = ProposalTone.professional
    hourly_rate: float = 100.0
    client_name: Optional[str] = None
    organization: Optional[str] = None
    project_type: Optional[str] = None
    user_id: str


class ProposalSections(BaseModel):
    title: str
    executive_summary: str
    scope_of_work: str
    timeline: str
    budget: list[BudgetLineItem]
    cover_letter: str
    follow_up_email: str


class UpdateStatusRequest(BaseModel):
    status: ProposalStatus
    user_id: str
