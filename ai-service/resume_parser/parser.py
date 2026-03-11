import os
import re
import json
from typing import Dict, Any, List
import pdfplumber
from docx import Document
from openai import OpenAI

def extract_text_from_pdf(file_path: str) -> str:
    """Extract text from PDF file."""
    text = ""
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    return text

def extract_text_from_docx(file_path: str) -> str:
    """Extract text from DOCX file."""
    doc = Document(file_path)
    text = ""
    for para in doc.paragraphs:
        text += para.text + "\n"
    return text

def parse_with_llm(text: str) -> Dict[str, Any]:
    """Use OpenAI to parse resume text into structured data."""
    
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        # Return mock data if no API key
        return parse_with_regex(text)
    
    client = OpenAI(api_key=api_key)
    
    prompt = f"""Parse the following resume text and extract structured information.
Return a JSON object with these fields:
- fullName: string (the person's full name)
- email: string (email address)
- phone: string or null (phone number)
- location: string or null (city/state/country)
- skills: array of strings (technical and soft skills)
- experienceYears: number (estimated years of experience)
- education: array of objects with {{ institution, degree, field, startYear, endYear }}
- workExperience: array of objects with {{ company, title, location, startDate, endDate, description }}
- summary: string or null (professional summary if present)

Resume text:
{text[:4000]}

Return only valid JSON, no other text."""

    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a resume parser. Extract structured data from resumes and return valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=2000
        )
        
        content = response.choices[0].message.content
        # Try to extract JSON from response
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return json.loads(content)
    except Exception as e:
        print(f"LLM parsing error: {e}")
        return parse_with_regex(text)

def parse_with_regex(text: str) -> Dict[str, Any]:
    """Fallback regex-based parsing."""
    
    # Extract email
    email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', text)
    email = email_match.group() if email_match else "unknown@email.com"
    
    # Extract phone
    phone_match = re.search(r'[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}', text)
    phone = phone_match.group() if phone_match else None
    
    # Extract name (usually at the top)
    lines = text.split('\n')
    name = "Unknown"
    for line in lines[:5]:
        line = line.strip()
        if len(line) > 2 and len(line) < 50 and not '@' in line and not any(c.isdigit() for c in line):
            name = line
            break
    
    # Extract skills (common tech keywords)
    common_skills = [
        "Python", "JavaScript", "TypeScript", "Java", "C++", "C#", "Go", "Rust",
        "React", "Angular", "Vue", "Node.js", "Express", "Django", "Flask", "FastAPI",
        "AWS", "Azure", "GCP", "Docker", "Kubernetes", "PostgreSQL", "MongoDB",
        "SQL", "NoSQL", "Redis", "Git", "CI/CD", "REST", "GraphQL", "HTML", "CSS",
        "Machine Learning", "AI", "Data Science", "TensorFlow", "PyTorch",
        "Agile", "Scrum", "Leadership", "Communication", "Problem Solving"
    ]
    
    skills = []
    text_lower = text.lower()
    for skill in common_skills:
        if skill.lower() in text_lower:
            skills.append(skill)
    
    # Estimate experience
    year_matches = re.findall(r'20\d{2}|19\d{2}', text)
    years = [int(y) for y in year_matches if 1990 <= int(y) <= 2026]
    experience_years = 0
    if len(years) >= 2:
        experience_years = max(years) - min(years)
        experience_years = min(experience_years, 30)  # Cap at 30 years
    
    return {
        "fullName": name,
        "email": email,
        "phone": phone,
        "location": None,
        "skills": skills[:20],  # Limit to 20 skills
        "experienceYears": experience_years,
        "education": [],
        "workExperience": [],
        "summary": None
    }

def parse_resume(file_path: str, file_ext: str) -> Dict[str, Any]:
    """Main function to parse a resume."""
    
    # Extract text based on file type
    if file_ext == '.pdf':
        text = extract_text_from_pdf(file_path)
    elif file_ext == '.docx':
        text = extract_text_from_docx(file_path)
    else:
        raise ValueError(f"Unsupported file type: {file_ext}")
    
    if not text.strip():
        raise ValueError("Could not extract text from resume")
    
    # Parse with LLM (falls back to regex if no API key)
    parsed = parse_with_llm(text)
    
    # Ensure required fields have defaults
    return {
        "fullName": parsed.get("fullName", "Unknown"),
        "email": parsed.get("email", "unknown@email.com"),
        "phone": parsed.get("phone"),
        "location": parsed.get("location"),
        "skills": parsed.get("skills", []),
        "experienceYears": parsed.get("experienceYears", 0),
        "education": parsed.get("education", []),
        "workExperience": parsed.get("workExperience", []),
        "summary": parsed.get("summary"),
    }
