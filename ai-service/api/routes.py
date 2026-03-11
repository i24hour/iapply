from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import base64
import tempfile
import os

from resume_parser.parser import parse_resume
from job_matcher.scorer import match_job
from form_answering.generator import generate_answer

router = APIRouter()

# --- Models ---

class ParseResumeRequest(BaseModel):
    fileBase64: str
    fileName: str

class Education(BaseModel):
    institution: str
    degree: str
    field: str
    startYear: Optional[int] = None
    endYear: Optional[int] = None

class WorkExperience(BaseModel):
    company: str
    title: str
    location: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    description: Optional[str] = None

class ParsedResume(BaseModel):
    fullName: str
    email: str
    phone: Optional[str] = None
    location: Optional[str] = None
    skills: List[str]
    experienceYears: int
    education: List[Education]
    workExperience: List[WorkExperience]
    summary: Optional[str] = None

class ParseResumeResponse(BaseModel):
    success: bool
    data: Optional[ParsedResume] = None
    error: Optional[str] = None

class Profile(BaseModel):
    fullName: str
    skills: List[str]
    experienceYears: int
    preferredRoles: List[str]

class Job(BaseModel):
    title: str
    company: str
    description: str
    location: str

class MatchJobRequest(BaseModel):
    profile: Profile
    job: Job

class MatchJobResponse(BaseModel):
    score: float
    reasons: List[str]

class GenerateAnswerRequest(BaseModel):
    question: str
    fieldType: str
    options: Optional[List[str]] = None
    profile: Profile
    jobDescription: str

class GenerateAnswerResponse(BaseModel):
    answer: str
    confidence: float

# --- Routes ---

@router.post("/parse-resume", response_model=ParseResumeResponse)
async def parse_resume_endpoint(request: ParseResumeRequest):
    """Parse a resume and extract structured data."""
    try:
        # Decode base64 file
        file_data = base64.b64decode(request.fileBase64)
        
        # Determine file type
        file_ext = os.path.splitext(request.fileName)[1].lower()
        if file_ext not in ['.pdf', '.docx']:
            raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported")
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as tmp:
            tmp.write(file_data)
            tmp_path = tmp.name
        
        try:
            # Parse resume
            parsed_data = parse_resume(tmp_path, file_ext)
            return ParseResumeResponse(success=True, data=parsed_data)
        finally:
            # Clean up temp file
            os.unlink(tmp_path)
            
    except Exception as e:
        return ParseResumeResponse(success=False, error=str(e))

@router.post("/match-job", response_model=MatchJobResponse)
async def match_job_endpoint(request: MatchJobRequest):
    """Calculate job match score based on profile."""
    try:
        result = match_job(request.profile.model_dump(), request.job.model_dump())
        return MatchJobResponse(score=result["score"], reasons=result["reasons"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate-answer", response_model=GenerateAnswerResponse)
async def generate_answer_endpoint(request: GenerateAnswerRequest):
    """Generate an answer for a job application question."""
    try:
        result = generate_answer(
            question=request.question,
            field_type=request.fieldType,
            options=request.options,
            profile=request.profile.model_dump(),
            job_description=request.jobDescription
        )
        return GenerateAnswerResponse(answer=result["answer"], confidence=result["confidence"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
