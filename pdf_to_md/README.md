# PDF to Markdown API

A FastAPI server that provides an API for converting PDF files to Markdown format, replicating the LlamaIndex PDF parsing API.

## Features

- Upload PDF files for processing
- Check job status
- Retrieve markdown results
- Supports page prefixes and suffixes

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Running the Server

```bash
uvicorn main:app --reload
```

The server will be available at `http://localhost:8000`

## API Endpoints

### Upload PDF

```
POST /api/v1/parsing/upload
```

**Form Data:**
- `file`: The PDF file to process
- `page_prefix`: (Optional) Text to prepend to each page
- `page_suffix`: (Optional) Text to append to each page

### Get Job Status

```
GET /api/v1/parsing/job/{job_id}
```

### Get Markdown Result

```
GET /api/v1/parsing/job/{job_id}/result/markdown
```

## Example Usage

```javascript
// Upload PDF
const formData = new FormData();
formData.append('file', pdfFile);
formData.append('page_prefix', 'START OF PAGE: {pageNumber}\n');
formData.append('page_suffix', '\nEND OF PAGE: {pageNumber}');

const uploadResponse = await fetch('http://localhost:8000/api/v1/parsing/upload', {
  method: 'POST',
  body: formData
});
const { id: jobId } = await uploadResponse.json();

// Check status
let statusResponse = await fetch(`http://localhost:8000/api/v1/parsing/job/${jobId}`);
let status = await statusResponse.json();

// Get markdown result
const markdownResponse = await fetch(`http://localhost:8000/api/v1/parsing/job/${jobId}/result/markdown`);
const markdown = await markdownResponse.text();
```
