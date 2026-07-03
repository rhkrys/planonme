from openai import OpenAI
import os
import numpy as np

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def get_embedding(text: str) -> list[float]:
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:8000],
    )
    return response.data[0].embedding


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a_arr, b_arr = np.array(a), np.array(b)
    denom = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
    if denom == 0:
        return 0.0
    return float(np.dot(a_arr, b_arr) / denom)


def score_rfp(rfp_text: str, winning_proposals: list[str]) -> float:
    """Score 0-1 based on similarity to past winning proposals."""
    if not winning_proposals:
        return 0.5

    rfp_embedding = get_embedding(rfp_text)
    similarities = []
    for proposal in winning_proposals[:10]:
        prop_embedding = get_embedding(proposal)
        similarities.append(cosine_similarity(rfp_embedding, prop_embedding))

    return round(float(np.mean(similarities)), 3)
