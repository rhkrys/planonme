from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from routers import rfp, proposals, drive

load_dotenv()

app = FastAPI(title="ProposalPilot API", version="1.0.0")

origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rfp.router, prefix="/api/rfp", tags=["rfp"])
app.include_router(proposals.router, prefix="/api/proposals", tags=["proposals"])
app.include_router(drive.router, prefix="/api/drive", tags=["drive"])


@app.get("/health")
def health():
    return {"status": "ok"}
