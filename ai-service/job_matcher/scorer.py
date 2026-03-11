from typing import Dict, Any, List

def match_job(profile: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate a match score between a profile and a job.
    Returns a score from 0-100 and reasons for the match.
    """
    
    score = 0
    reasons = []
    
    profile_skills = set(s.lower() for s in profile.get("skills", []))
    profile_roles = set(r.lower() for r in profile.get("preferredRoles", []))
    profile_experience = profile.get("experienceYears", 0)
    
    job_title = job.get("title", "").lower()
    job_description = job.get("description", "").lower()
    job_company = job.get("company", "")
    
    # --- Skill Matching (up to 50 points) ---
    matched_skills = []
    for skill in profile_skills:
        if skill in job_description or skill in job_title:
            matched_skills.append(skill)
    
    if len(matched_skills) > 0:
        skill_score = min(50, len(matched_skills) * 10)
        score += skill_score
        reasons.append(f"Skills match: {', '.join(matched_skills[:5])}")
    
    # --- Role Matching (up to 30 points) ---
    role_matched = False
    for role in profile_roles:
        if role in job_title:
            role_matched = True
            score += 30
            reasons.append(f"Role matches your preference: {role}")
            break
    
    if not role_matched:
        # Partial match in description
        for role in profile_roles:
            if role in job_description:
                score += 15
                reasons.append(f"Related to your preferred role: {role}")
                break
    
    # --- Experience Level (up to 20 points) ---
    # Try to detect experience requirements from job description
    experience_keywords = {
        "entry": (0, 2),
        "junior": (0, 2),
        "mid-level": (2, 5),
        "senior": (5, 10),
        "lead": (7, 15),
        "principal": (10, 20),
        "staff": (8, 15),
    }
    
    experience_match = False
    for keyword, (min_exp, max_exp) in experience_keywords.items():
        if keyword in job_description or keyword in job_title:
            if min_exp <= profile_experience <= max_exp + 3:
                score += 20
                reasons.append(f"Experience level matches ({profile_experience} years)")
                experience_match = True
                break
            elif profile_experience >= min_exp:
                score += 10
                reasons.append(f"Experience qualifies ({profile_experience} years)")
                experience_match = True
                break
    
    if not experience_match:
        # Default: some points for having experience
        if profile_experience > 0:
            score += 10
    
    # --- Ensure score is 0-100 ---
    score = max(0, min(100, score))
    
    # Add general reason if score is good
    if score >= 70:
        reasons.insert(0, f"Great match for {job_company}!")
    elif score >= 50:
        reasons.insert(0, f"Good potential match at {job_company}")
    
    return {
        "score": score,
        "reasons": reasons[:5]  # Limit to 5 reasons
    }
