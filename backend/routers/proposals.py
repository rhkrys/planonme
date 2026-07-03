from fastapi import APIRouter, HTTPException
import os
from supabase import create_client

from models.proposal import GenerateProposalRequest, ProposalSections, UpdateStatusRequest
from services.ai_generator import generate_proposal

router = APIRouter()

supabase = create_client(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
)


@router.post("/generate", response_model=ProposalSections)
async def generate(req: GenerateProposalRequest):
    try:
        sections = generate_proposal(
            rfp_text=req.rfp_text,
            tone=req.tone.value,
            hourly_rate=req.hourly_rate,
            client_name=req.client_name or "",
            organization=req.organization or "",
            project_type=req.project_type or "",
        )
        return sections
    except Exception as e:
        raise HTTPException(500, f"Generation failed: {e}")


@router.get("/")
async def list_proposals(user_id: str):
    result = (
        supabase.table("proposals")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data


@router.get("/{proposal_id}")
async def get_proposal(proposal_id: str, user_id: str):
    result = (
        supabase.table("proposals")
        .select("*")
        .eq("id", proposal_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Proposal not found")
    return result.data


@router.post("/")
async def save_proposal(data: dict):
    result = supabase.table("proposals").insert(data).execute()
    return result.data[0]


@router.patch("/{proposal_id}/status")
async def update_status(proposal_id: str, req: UpdateStatusRequest):
    result = (
        supabase.table("proposals")
        .update({"status": req.status.value})
        .eq("id", proposal_id)
        .eq("user_id", req.user_id)
        .execute()
    )
    return result.data[0] if result.data else {"ok": True}


@router.delete("/{proposal_id}")
async def delete_proposal(proposal_id: str, user_id: str):
    supabase.table("proposals").delete().eq("id", proposal_id).eq("user_id", user_id).execute()
    return {"deleted": True}
