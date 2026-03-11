import os
import re
from typing import Dict, Any, List, Optional
from openai import OpenAI

# Common questions and template answers
COMMON_QUESTIONS = {
    "why do you want this job": "generate",
    "why are you interested": "generate",
    "cover letter": "generate",
    "years of experience": "profile",
    "experience in years": "profile",
    "current salary": "skip",
    "expected salary": "skip",
    "salary expectation": "skip",
    "notice period": "immediate",
    "start date": "immediate",
    "work authorization": "yes",
    "legally authorized": "yes",
    "require sponsorship": "no",
    "willing to relocate": "yes",
    "remote work": "yes",
}

def generate_answer(
    question: str,
    field_type: str,
    options: Optional[List[str]],
    profile: Dict[str, Any],
    job_description: str
) -> Dict[str, Any]:
    """Generate an answer for a job application question."""
    
    question_lower = question.lower().strip()
    
    # --- Handle dropdown/radio with options ---
    if field_type in ["select", "radio"] and options:
        return handle_options_question(question_lower, options, profile)
    
    # --- Check for common questions ---
    for pattern, answer_type in COMMON_QUESTIONS.items():
        if pattern in question_lower:
            if answer_type == "profile":
                return generate_profile_answer(question_lower, profile)
            elif answer_type == "generate":
                return generate_ai_answer(question, profile, job_description)
            elif answer_type == "skip":
                return {"answer": "", "confidence": 0.5}
            elif answer_type == "immediate":
                return {"answer": "Immediately available" if field_type == "textarea" else "0", "confidence": 0.9}
            elif answer_type == "yes":
                return {"answer": "Yes", "confidence": 0.9}
            elif answer_type == "no":
                return {"answer": "No", "confidence": 0.9}
    
    # --- Default: try AI generation ---
    return generate_ai_answer(question, profile, job_description)

def handle_options_question(
    question: str,
    options: List[str],
    profile: Dict[str, Any]
) -> Dict[str, Any]:
    """Select the best option from a list."""
    
    options_lower = [o.lower() for o in options]
    
    # Experience years
    if "experience" in question or "years" in question:
        exp = profile.get("experienceYears", 0)
        for i, opt in enumerate(options_lower):
            # Try to match experience range
            numbers = re.findall(r'\d+', opt)
            if numbers:
                if len(numbers) == 1:
                    if int(numbers[0]) == exp:
                        return {"answer": options[i], "confidence": 0.95}
                elif len(numbers) == 2:
                    if int(numbers[0]) <= exp <= int(numbers[1]):
                        return {"answer": options[i], "confidence": 0.95}
        # Default to highest that's not too high
        return {"answer": options[-1], "confidence": 0.7}
    
    # Yes/No questions - prefer positive
    if any(x in options_lower for x in ["yes", "no"]):
        yes_idx = next((i for i, o in enumerate(options_lower) if o == "yes"), None)
        if yes_idx is not None:
            return {"answer": options[yes_idx], "confidence": 0.85}
    
    # Default to first option
    return {"answer": options[0], "confidence": 0.5}

def generate_profile_answer(question: str, profile: Dict[str, Any]) -> Dict[str, Any]:
    """Generate answer from profile data."""
    
    if "experience" in question or "years" in question:
        years = profile.get("experienceYears", 0)
        return {"answer": str(years), "confidence": 0.95}
    
    if "skill" in question:
        skills = profile.get("skills", [])
        return {"answer": ", ".join(skills[:10]), "confidence": 0.9}
    
    return {"answer": "", "confidence": 0.5}

def generate_ai_answer(
    question: str,
    profile: Dict[str, Any],
    job_description: str
) -> Dict[str, Any]:
    """Use AI to generate an answer."""
    
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        # Fallback template answer
        return generate_template_answer(question, profile, job_description)
    
    client = OpenAI(api_key=api_key)
    
    prompt = f"""You are helping a job applicant answer application questions.

Applicant Profile:
- Name: {profile.get('fullName', 'Applicant')}
- Skills: {', '.join(profile.get('skills', [])[:10])}
- Experience: {profile.get('experienceYears', 0)} years
- Preferred Roles: {', '.join(profile.get('preferredRoles', []))}

Job Description (excerpt):
{job_description[:1000]}

Question: {question}

Write a concise, professional answer (2-3 sentences max) that:
1. Shows enthusiasm for the role
2. Connects the applicant's skills to the job
3. Is specific but not too long

Answer:"""

    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a professional job application assistant. Write concise, compelling answers."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=200
        )
        
        answer = response.choices[0].message.content.strip()
        return {"answer": answer, "confidence": 0.85}
    except Exception as e:
        print(f"AI generation error: {e}")
        return generate_template_answer(question, profile, job_description)

def generate_template_answer(
    question: str,
    profile: Dict[str, Any],
    job_description: str
) -> Dict[str, Any]:
    """Generate a template-based answer without AI."""
    
    name = profile.get("fullName", "I")
    skills = profile.get("skills", [])[:5]
    experience = profile.get("experienceYears", 0)
    roles = profile.get("preferredRoles", [])
    
    question_lower = question.lower()
    
    if "why" in question_lower and ("job" in question_lower or "interest" in question_lower or "company" in question_lower):
        skills_str = ", ".join(skills[:3]) if skills else "my relevant skills"
        return {
            "answer": f"With {experience} years of experience in {skills_str}, I'm excited about this opportunity to contribute my expertise and continue growing professionally. The role aligns well with my career goals and technical background.",
            "confidence": 0.75
        }
    
    if "cover letter" in question_lower or "tell us about" in question_lower:
        skills_str = ", ".join(skills[:4]) if skills else "various technologies"
        return {
            "answer": f"I am an experienced professional with {experience} years of experience specializing in {skills_str}. I am passionate about delivering high-quality work and continuously improving my skills. I believe my background makes me a strong fit for this position, and I am excited about the opportunity to contribute to your team.",
            "confidence": 0.7
        }
    
    # Generic fallback
    return {
        "answer": f"With {experience} years of professional experience, I am confident in my ability to contribute effectively to this role.",
        "confidence": 0.6
    }
