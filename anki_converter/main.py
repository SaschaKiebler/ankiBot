from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import genanki
import os
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager

app = FastAPI(title="Anki Deck Generator")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define request models
class QAItem(BaseModel):
    question: str
    answer: str

class AnkiDeckRequest(BaseModel):
    title: str
    qa_list: List[QAItem]
    deck_id: Optional[int] = None  # Allow custom deck ID for consistency

def create_anki_deck(title: str, qa_list: List[QAItem], deck_id: Optional[int] = None):
    """
    Create an Anki deck with the given title and Q&A pairs
    """
    # Generate a random deck ID if not provided
    if deck_id is None:
        deck_id = abs(hash(title)) % (10 ** 10)  # Generate a 10-digit ID
    
    # Create a new deck
    deck = genanki.Deck(
        deck_id=deck_id,
        name=title,
    )
    
    # Create a model for our cards
    model = genanki.Model(
        abs(hash("Basic (and reversed card)")),  # Generate a unique ID for the model
        'Basic Model',
        fields=[
            {'name': 'Question'},
            {'name': 'Answer'},
        ],
        templates=[
            {
                'name': 'Card 1',
                'qfmt': '{{Question}}',
                'afmt': '{{FrontSide}}<hr id="answer">{{Answer}}',
            },
        ])
    
    # Add cards to the deck
    for qa in qa_list:
        note = genanki.Note(
            model=model,
            fields=[qa.question, qa.answer]
        )
        deck.add_note(note)
    
    # Generate a temporary file path
    filename = f"{title.replace(' ', '_')}.apkg"
    filepath = f"/tmp/{filename}"
    
    # Save the deck to a file
    genanki.Package(deck).write_to_file(filepath)
    
    return filepath, filename

@asynccontextmanager
async def temp_file_generator(filepath: str):
    """Context manager to handle temporary file cleanup"""
    try:
        with open(filepath, 'rb') as f:
            yield f
    finally:
        if os.path.exists(filepath):
            os.remove(filepath)

def read_in_chunks(file_object, chunk_size=8192):
    """Generator to read file in chunks"""
    while True:
        data = file_object.read(chunk_size)
        if not data:
            break
        yield data

@app.post("/generate-deck")
async def generate_deck(request: AnkiDeckRequest):
    """
    Generate an Anki deck from a list of Q&A pairs
    """
    filepath = None
    try:
        filepath, filename = create_anki_deck(
            title=request.title,
            qa_list=request.qa_list,
            deck_id=request.deck_id
        )
        
        # Create a generator to stream the file in chunks
        async def file_stream():
            async with temp_file_generator(filepath) as file:
                while chunk := file.read(8192):
                    yield chunk
        
        # Return the file as a streaming response
        return StreamingResponse(
            file_stream(),
            media_type='application/octet-stream',
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Content-Type": "application/apkg"
            }
        )
        
    except Exception as e:
        if filepath and os.path.exists(filepath):
            os.remove(filepath)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
