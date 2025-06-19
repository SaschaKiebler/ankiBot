import os
import uuid
import asyncio
import base64
import io
import nest_asyncio
from datetime import datetime
from typing import Optional, Dict, List, Tuple

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings
from pdf2image import convert_from_bytes
from PIL import Image
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage

# Load environment variables
load_dotenv()

# Apply nest_asyncio to allow nested event loops
nest_asyncio.apply()

class Settings(BaseSettings):
    google_api_key: str = ""
    openai_api_key: str = ""
    langsmith_api_key: str = ""
    langsmith_tracing: bool = False
    langsmith_endpoint: str = ""
    langsmith_project: str = ""
    
    class Config:
        env_file = ".env"
        extra = "allow"  # This will allow extra fields in the .env file

settings = Settings()

MAX_WORKERS = 10

class GoogleGenerativeAI:
    def __init__(self):
        self.chat = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            temperature=0,
            api_key=settings.google_api_key,
            
        )
        
    async def extract_text_from_image(self, image_base64: str) -> str:
        try:
            # Create the prompt
            system_prompt = """You are a helpful assistant that extracts text and tables from images. 
            Return the content in clean markdown format. For tables, use markdown table syntax. 
            Preserve the original structure as much as possible. only answer with the content."""
            
            # Create the message with the image
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=[
                        {"type": "text", "text": "Extract all text and tables from this image."},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}",
                                "detail": "high"
                            },
                        },
                    ]
                )
            ]
            
            # Get the response
            response = await self.chat.agenerate([messages])
            return response.generations[0][0].text
            
        except Exception as e:
            print(f"Error in LangChain Google Generative AI: {str(e)}")
            raise

google_client = GoogleGenerativeAI()

from models import JobStatus, JobResponse, UploadResponse

app = FastAPI(title="PDF to Markdown API")

# In-memory storage for jobs
jobs: Dict[str, Dict] = {}

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PDFProcessor:
    @staticmethod
    def pdf_to_images(pdf_bytes: bytes, dpi: int = 300) -> List[Image.Image]:
        """Convert PDF to a list of PIL Images."""
        try:
            return convert_from_bytes(pdf_bytes, dpi=dpi)
        except Exception as e:
            raise Exception(f"Error converting PDF to images: {str(e)}")
    
    @staticmethod
    def image_to_base64(image: Image.Image) -> str:
        """Convert PIL Image to base64 string."""
        buffered = io.BytesIO()
        image.save(buffered, format="JPEG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')
    
    @staticmethod
    async def process_page_with_ocr(page_num: int, image: Image.Image) -> Tuple[int, str]:
        """Process a single page with gpt-4.1-mini"""
        try:
            image_base64 = PDFProcessor.image_to_base64(image)
            
            extracted_text = await google_client.extract_text_from_image(image_base64)
            
            return f"{page_prefix}{extracted_text.strip()}{page_suffix}"
        except Exception as e:
            print(f"Error processing page {page_num}: {str(e)}")
            return f"[Error processing page {page_num + 1}]"
    
    @staticmethod
    async def _process_page(
        image,
        page_num: int,
        page_prefix: str,
        page_suffix: str
    ) -> str:
        """Process a single page image and return its markdown content."""
        try:
            # Convert image to base64
            import base64
            from io import BytesIO
            
            buffered = BytesIO()
            image.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            
            # Use Google Generative AI to extract text from image
            google_client = GoogleGenerativeAI()
            extracted_text = await google_client.extract_text_from_image(img_str)
            
            return f"{page_prefix}{extracted_text.strip()}{page_suffix}"
            
        except Exception as e:
            print(f"Error processing page {page_num}: {str(e)}")
            return f"{page_prefix}[Error processing page {page_num + 1}]{page_suffix}"
    
    @staticmethod
    async def process_pdf(
        file: UploadFile,
        page_prefix: str = "\n---\n",
        page_suffix: str = "\n---\n"
    ) -> str:
        try:
            # Get the file-like object (could be our custom one or a regular file)
            file_obj = file.file
            
            # Get content type if available
            content_type = getattr(file_obj, 'content_type', 'application/octet-stream')
            print(f"Processing PDF with content type: {content_type}")
            
            # Read the file content
            contents = await file.read()
            print(f"Read {len(contents)} bytes from file")
            
            if not contents:
                raise ValueError("File is empty")
            
            # Convert PDF to images
            print("Converting PDF to images...")
            try:
                # Try with explicit poppler path first
                poppler_path = "/opt/homebrew/bin"  # Common Homebrew location
                print(f"Using poppler path: {poppler_path}")
                
                # Try with explicit path first
                try:
                    images = convert_from_bytes(contents, poppler_path=poppler_path)
                    print(f"Converted to {len(images)} page(s) using explicit poppler path")
                except Exception as e:
                    print(f"First attempt failed with error: {str(e)}")
                    print("Trying without explicit poppler path...")
                    # Fall back to system path
                    images = convert_from_bytes(contents)
                    print(f"Converted to {len(images)} page(s) using system poppler")
                    
            except Exception as e:
                error_msg = f"Error converting PDF to images: {str(e)}"
                print(error_msg)
                # Try to get more detailed error info
                import subprocess
                try:
                    result = subprocess.run(['which', 'pdftoppm'], capture_output=True, text=True)
                    print(f"pdftoppm path: {result.stdout.strip() if result.stdout else 'Not found'}")
                    print(f"Error output: {result.stderr}")
                except Exception as sub_e:
                    print(f"Could not check pdftoppm: {str(sub_e)}")
                raise Exception(error_msg) from e
            
            # Process each page concurrently
            print("Processing pages...")
            tasks = []
            for i, image in enumerate(images):
                task = PDFProcessor._process_page(image, i, page_prefix, page_suffix)
                tasks.append(asyncio.create_task(task))
            
            # Wait for all pages to be processed
            markdown_pages = await asyncio.gather(*tasks)
            
            # Combine all pages with separators
            result = "\n".join(markdown_pages)
            print(f"Processed {len(markdown_pages)} pages, total {len(result)} characters")
            return result
            
        except Exception as e:
            print(f"Error in process_pdf: {str(e)}")
            import traceback
            traceback.print_exc()
            raise

@app.post("/api/v1/parsing/upload", response_model=UploadResponse)
async def upload_pdf(
    file: UploadFile = File(...),
    page_prefix: Optional[str] = Form("\n---\n"),
    page_suffix: Optional[str] = Form("\n---\n"),
):
    print(f"Received upload request for file: {file.filename}")
    # Create a new job
    job_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    try:
        # Read the file content
        file_content = await file.read()
        print(f"Read {len(file_content)} bytes from file")
        
        if not file_content:
            raise ValueError("Uploaded file is empty")
        
        # Initialize job data
        job_data = {
            "id": job_id,
            "status": JobStatus.PENDING,
            "created_at": now,
            "updated_at": now,
            "file_content": file_content,  # Store file content directly
            "file_name": file.filename,
            "content_type": file.content_type,
            "page_prefix": page_prefix,
            "page_suffix": page_suffix,
            "result": None,
            "error": None
        }
        
        # Store job data
        jobs[job_id] = job_data
        print(f"Created job {job_id} for file {file.filename}")
        
        # Start processing the PDF in the background
        asyncio.create_task(process_pdf_background(job_id))
        print(f"Started background processing for job {job_id}")
        
        return UploadResponse(**{
            "id": job_id,
            "status": JobStatus.PROCESSING,
            "created_at": job_data["created_at"],
            "updated_at": job_data["updated_at"]
        })
    except Exception as e:
        print(f"Error in upload_pdf: {str(e)}")
        import traceback
        traceback.print_exc()
        # If there's an error, update the job status
        if job_id in jobs:
            jobs[job_id]["status"] = JobStatus.FAILED
            jobs[job_id]["error"] = str(e)
            jobs[job_id]["updated_at"] = datetime.utcnow().isoformat()
        raise HTTPException(
            status_code=500,
            detail=f"Error processing file: {str(e)}"
        )

async def process_pdf_background(job_id: str):
    print(f"Starting background processing for job {job_id}")
    if job_id not in jobs:
        print(f"Job {job_id} not found in jobs")
        return
    
    job = jobs[job_id]
    try:
        # Update job status to processing
        job["status"] = JobStatus.PROCESSING
        job["updated_at"] = datetime.utcnow().isoformat()
        print(f"Processing job {job_id} - {job['file_name']}")
        
        # Create a file-like object from the stored content
        from fastapi import UploadFile
        from io import BytesIO
        
        try:
            file_content = job.get("file_content")
            if not file_content:
                raise ValueError("No file content found in job data")
                
            print(f"Creating file-like object from {len(file_content)} bytes")
            file_like = BytesIO(file_content)
            
            # Create a custom file-like object with content type
            class FileLikeWithType:
                def __init__(self, file_like, content_type):
                    self.file = file_like
                    self.content_type = content_type
                
                def read(self, *args, **kwargs):
                    return self.file.read(*args, **kwargs)
                
                def seek(self, *args, **kwargs):
                    return self.file.seek(*args, **kwargs)
                
                def tell(self, *args, **kwargs):
                    return self.file.tell(*args, **kwargs)
                
                # Add any other methods that might be needed by UploadFile
                
            # Create the file-like object with content type
            file_with_type = FileLikeWithType(
                file_like=file_like,
                content_type=job.get("content_type", "application/octet-stream")
            )
            
            # Create the UploadFile
            upload_file = UploadFile(
                filename=job["file_name"],
                file=file_with_type
            )
            
            print(f"Processing PDF with PDFProcessor")
            # Process the PDF
            markdown_content = await PDFProcessor.process_pdf(
                upload_file,
                job["page_prefix"],
                job["page_suffix"]
            )
            
            if not markdown_content or not markdown_content.strip():
                raise ValueError("PDF processing returned empty content")
                
            print(f"Successfully processed PDF, got {len(markdown_content)} characters of markdown")
            
            # Clean up the file content to save memory
            if "file_content" in job:
                del job["file_content"]
            
            # Update job with result
            job["status"] = JobStatus.SUCCESS
            job["result"] = {"markdown": markdown_content}
            job["updated_at"] = datetime.utcnow().isoformat()
            print(f"Job {job_id} completed successfully")
            
        except Exception as e:
            print(f"Error in PDF processing: {str(e)}")
            raise
            
    except Exception as e:
        # Update job with error
        error_msg = f"Error processing PDF: {str(e)}"
        print(error_msg)
        job["status"] = JobStatus.FAILED
        job["error"] = error_msg
        job["updated_at"] = datetime.utcnow().isoformat()
        
        # Print traceback for debugging
        import traceback
        traceback.print_exc()
        
        # Ensure the error is properly set in the job
        if "result" not in job:
            job["result"] = {"error": error_msg}

@app.get("/api/v1/parsing/job/{job_id}", response_model=JobResponse)
async def get_job_status(job_id: str):
    print(f"\n--- Status request for job {job_id} ---")
    print(f"Current jobs: {list(jobs.keys())}")
    
    if job_id not in jobs:
        print(f"Job {job_id} not found")
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    print(f"Job {job_id} status: {job['status']}")
    if job.get('error'):
        print(f"Job error: {job['error']}")
    
    response_data = {
        "id": job["id"],
        "status": job["status"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "result": job.get("result"),
        "error": job.get("error")
    }
    
    print(f"Returning response: {response_data}")
    return JobResponse(**response_data)

@app.get("/api/v1/parsing/job/{job_id}/result/markdown", response_class=PlainTextResponse)
async def get_job_result_markdown(job_id: str):
    print(f"\n--- Markdown result request for job {job_id} ---")
    print(f"Current jobs: {list(jobs.keys())}")
    
    if job_id not in jobs:
        print(f"Job {job_id} not found")
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    print(f"Job {job_id} status: {job['status']}")
    
    if job["status"] != JobStatus.SUCCESS:
        error_msg = f"Job status is {job['status']}. "
        if job.get('error'):
            error_msg += f"Error: {job['error']}"
        print(error_msg)
        raise HTTPException(
            status_code=400,
            detail=error_msg
        )
    
    if not job.get("result") or not job["result"].get("markdown"):
        error_msg = "Job completed but no markdown result found"
        print(error_msg)
        raise HTTPException(
            status_code=500,
            detail=error_msg
        )
    
    print(f"Returning markdown result ({len(job['result']['markdown'])} characters)")
    return job["result"]["markdown"]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
