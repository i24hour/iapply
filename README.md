# Job Automation Platform

Automated job application platform with AI-powered resume parsing and form filling. Automatically searches jobs on LinkedIn, Naukri, and Internshala, matches them with your resume, and applies using a browser extension.

## Architecture

```
User → Frontend Dashboard (Next.js) → Backend API (Express) → Chrome Extension → Job Platforms
                                    ↓
                              AI Service (Python/FastAPI)
```

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Frontend   | Next.js 14, React 18, Tailwind CSS, Zustand |
| Backend    | Express.js, Mongoose, JWT Auth      |
| Database   | MongoDB                             |
| AI Service | Python, FastAPI (optional)           |
| Extension  | Chrome Extension (Manifest V3)      |

## Project Structure

```
job-automation-platform/
├── client/          # Next.js frontend dashboard
├── server/          # Node.js/Express backend API
├── extension/       # Chrome extension for automation
├── ai-service/      # Python AI service (FastAPI)
├── shared/          # Shared TypeScript types
├── package.json     # Root scripts (dev, build)
└── .env.example     # Environment variable template
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+ → [Download](https://nodejs.org/)
- **MongoDB** (Community Server or Atlas) → [Download](https://www.mongodb.com/try/download/community)
- **Git** → [Download](https://git-scm.com/)

### 1. Clone the Repository

```bash
git clone https://github.com/<your-username>/job-automation-platform.git
cd job-automation-platform
```

### 2. Create a New Branch (recommended)

```bash
git checkout -b dev
```

### 3. Install Dependencies

```bash
# Install root dependencies (concurrently, tsx, typescript)
npm install

# Install client dependencies
cd client
npm install

# Install server dependencies
cd ../server
npm install

# Go back to root
cd ..
```

Or use the shortcut:

```bash
npm run install:all
```

### 4. Set Up Environment Variables

```bash
# Copy the example env file to the server directory
cp .env.example server/.env
```

Edit `server/.env` with your values:

```env
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/job-automation
JWT_SECRET=your-super-secret-key-change-this
CLIENT_URL=http://localhost:3000
AI_SERVICE_URL=http://localhost:8000
```

> **Important:** Change `JWT_SECRET` to a strong random string in production.

### 5. Start MongoDB

Make sure MongoDB is running:

- **Windows** (if installed as a service): it starts automatically, or run:
  ```bash
  net start MongoDB
  ```
- **macOS** (Homebrew):
  ```bash
  brew services start mongodb-community
  ```
- **Linux**:
  ```bash
  sudo systemctl start mongod
  ```
- **Docker**:
  ```bash
  docker run -d -p 27017:27017 --name mongodb mongo:7
  ```

### 6. Start the Application

#### Option A: Start Both Services Together (recommended)

```bash
npm run dev
```

This runs the backend (port 3001) and frontend (port 3000) concurrently.

#### Option B: Start Services Individually

**Terminal 1 — Backend:**
```bash
npm run dev:server
```

**Terminal 2 — Frontend:**
```bash
cd client
npm run dev
```

### 7. Open the App

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001

---

## Available Scripts

| Command             | Description                                    |
|---------------------|------------------------------------------------|
| `npm run dev`       | Start both frontend & backend concurrently     |
| `npm run dev:client`| Start frontend only (port 3000)                |
| `npm run dev:server`| Start backend only (port 3001)                 |
| `npm run build`     | Build the frontend for production              |
| `npm run install:all` | Install all dependencies (root + client + server) |

**From `client/` directory:**

| Command             | Description                   |
|---------------------|-------------------------------|
| `npm run dev`       | Start Next.js dev server      |
| `npm run build`     | Production build              |
| `npm run start`     | Start production server       |
| `npm run lint`      | Lint the codebase             |

---

## API Endpoints

### Auth
| Method | Endpoint       | Description        | Auth |
|--------|----------------|--------------------|------|
| POST   | `/auth/signup`  | Create account     | No   |
| POST   | `/auth/login`   | Login              | No   |
| GET    | `/auth/me`      | Get current user   | Yes  |

### Profile
| Method | Endpoint    | Description        | Auth |
|--------|-------------|--------------------|------|
| GET    | `/profile`  | Get user profile   | Yes  |
| PUT    | `/profile`  | Update profile     | Yes  |

### Resume
| Method | Endpoint         | Description        | Auth |
|--------|------------------|--------------------|------|
| GET    | `/resume`        | Get latest resume  | Yes  |
| POST   | `/resume/upload` | Upload resume      | Yes  |

### Preferences
| Method | Endpoint        | Description            | Auth |
|--------|-----------------|------------------------|------|
| GET    | `/preferences`  | Get job preferences    | Yes  |
| PUT    | `/preferences`  | Update preferences     | Yes  |

### Automation
| Method | Endpoint             | Description          | Auth |
|--------|----------------------|----------------------|------|
| GET    | `/automation/status` | Get automation status| Yes  |
| POST   | `/automation/start`  | Start automation     | Yes  |
| POST   | `/automation/pause`  | Pause automation     | Yes  |
| POST   | `/automation/stop`   | Stop automation      | Yes  |

### Applications
| Method | Endpoint             | Description              | Auth |
|--------|----------------------|--------------------------|------|
| GET    | `/applications`      | List applications (paginated) | Yes  |
| GET    | `/applications/:id`  | Get application details  | Yes  |

---

## Features

- **Resume Upload & Parsing**: AI-powered extraction of skills, experience, education
- **Job Matching**: Intelligent job relevance scoring based on your preferences
- **Auto Apply**: Automated application to LinkedIn Easy Apply jobs
- **Form Filling**: AI-generated answers for application questions
- **Dashboard**: Track all applications with status and screenshots
- **Job Preferences**: Configure desired roles, locations, salary, and job types

## Troubleshooting

### Port already in use

```bash
# Find and kill the process on a port (Windows PowerShell)
Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# macOS/Linux
lsof -ti:3000 | xargs kill -9
```

### MongoDB connection failed

Make sure MongoDB is running and accessible at `mongodb://127.0.0.1:27017`. Check with:
```bash
mongosh --eval "db.runCommand({ping:1})"
```

---

## Git Workflow

```bash
# After cloning, create your dev branch
git checkout -b dev

# Make changes, then commit
git add .
git commit -m "your commit message"

# Push to GitHub
git push -u origin dev

# To push main branch
git checkout main
git push -u origin main
```

---

## License

MIT
