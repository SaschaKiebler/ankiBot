from pydantic import BaseModel
from typing import Optional, Dict, Any
from enum import Enum

class JobStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"

class JobResponse(BaseModel):
    id: str
    status: JobStatus
    created_at: str
    updated_at: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class UploadResponse(BaseModel):
    id: str
    status: JobStatus
    created_at: str
    updated_at: str
