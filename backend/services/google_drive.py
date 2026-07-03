import json
import os
from google.oauth2 import service_account
from googleapiclient.discovery import build
from models.proposal import ProposalSections

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
]


def _get_credentials():
    sa_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
    info = json.loads(sa_json)
    return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)


def create_proposal_doc(
    proposal: ProposalSections,
    folder_id: str,
    access_token: str | None = None,
) -> str:
    """Create a formatted Google Doc and return its URL."""
    creds = _get_credentials()
    docs_service = build("docs", "v1", credentials=creds)
    drive_service = build("drive", "v3", credentials=creds)

    doc = docs_service.documents().create(body={"title": proposal.title}).execute()
    doc_id = doc["documentId"]

    budget_rows = "\n".join(
        f"  • {item.task}: {item.hours}h × ${item.rate}/hr = ${item.hours * item.rate:,.2f}"
        for item in proposal.budget
    )
    total = sum(item.hours * item.rate for item in proposal.budget)

    content = f"""{proposal.title}

EXECUTIVE SUMMARY
{proposal.executive_summary}

SCOPE OF WORK
{proposal.scope_of_work}

TIMELINE
{proposal.timeline}

BUDGET
{budget_rows}

Total: ${total:,.2f}

COVER LETTER
{proposal.cover_letter}

FOLLOW-UP EMAIL TEMPLATE
{proposal.follow_up_email}
"""

    requests = [
        {"insertText": {"location": {"index": 1}, "text": content}},
        {
            "updateParagraphStyle": {
                "range": {"startIndex": 1, "endIndex": len(proposal.title) + 1},
                "paragraphStyle": {"namedStyleType": "HEADING_1"},
                "fields": "namedStyleType",
            }
        },
    ]

    docs_service.documents().batchUpdate(
        documentId=doc_id, body={"requests": requests}
    ).execute()

    if folder_id:
        drive_service.files().update(
            fileId=doc_id,
            addParents=folder_id,
            removeParents="root",
            fields="id, parents",
        ).execute()

    drive_service.permissions().create(
        fileId=doc_id,
        body={"type": "anyone", "role": "writer"},
    ).execute()

    return f"https://docs.google.com/document/d/{doc_id}/edit"
