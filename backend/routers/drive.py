from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from supabase import create_client

from models.proposal import ProposalSections
from services.google_drive import create_proposal_doc

router = APIRouter()

supabase = create_client(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
)


class SaveToDriveRequest(BaseModel):
    proposal_id: str
    sections: ProposalSections
    folder_id: str = ""
    user_id: str


@router.post("/save")
async def save_to_drive(req: SaveToDriveRequest):
    try:
        url = create_proposal_doc(req.sections, folder_id=req.folder_id)
    except Exception as e:
        raise HTTPException(500, f"Google Drive error: {e}")

    supabase.table("proposals").update({"drive_doc_url": url}).eq("id", req.proposal_id).execute()

    return {"drive_doc_url": url}


@router.get("/folders")
async def list_drive_folders():
    """Placeholder — Drive folder listing uses the user's OAuth token from the frontend."""
    return {"message": "Use the frontend Google Drive picker for folder selection"}
