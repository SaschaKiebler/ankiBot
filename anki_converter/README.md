# Anki Deck Generator

A FastAPI service that generates Anki decks from Q&A pairs using genanki.

## Setup

1. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Run the FastAPI application:
   ```bash
   python main.py
   ```

   The service will be available at `http://localhost:8000`

## API Endpoints

### Generate Anki Deck

- **URL**: `/generate-deck`
- **Method**: `POST`
- **Request Body**:
  ```json
  {
    "title": "My Deck",
    "qa_list": [
      {
        "question": "What is the capital of France?",
        "answer": "Paris"
      },
      {
        "question": "What is 2+2?",
        "answer": "4"
      }
    ],
    "deck_id": 12345  // Optional
  }
  ```

- **Response**:
  - Returns the generated .apkg file as a download

### Health Check

- **URL**: `/health`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "status": "ok"
  }
  ```

## Example Usage with cURL

```bash
curl -X POST http://localhost:8000/generate-deck \
  -H "Content-Type: application/json" \
  -d '{"title":"Sample Deck","qa_list":[{"question":"Q1","answer":"A1"},{"question":"Q2","answer":"A2"}]}' \
  --output deck.apkg
```
