# Job Automation Platform

Automated job application platform with AI-powered resume parsing and form filling.

## Live Links

- **Frontend:** https://iapply.onrender.com
- **Backend:** https://iapply-telegram-bot.onrender.com

## Quick Start

> **All commands should be run from the `jobs/` directory (root folder)**

### Prerequisites

- **Node.js** 18+
- **Supabase** (running locally or via cloud project)

### 1. Install Dependencies

```bash
# Run from: jobs/
npm run install:all
```

### 2. Setup Environment

```bash
# Run from: jobs/
cp .env.example server/.env
```

Edit `server/.env`:

```env
PORT=3001
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-key
JWT_SECRET=your-secret-key
CLIENT_URL=http://localhost:3000
```

### 3. Start the App

```bash
# Run from: jobs/
npm run dev
```

This automatically clears the Next.js cache and starts both:

- **Frontend:** http://localhost:3000
- **Backend:** http://localhost:3001

---

## Project Structure

```
jobs/                 ← Run all commands from here
├── client/           # Next.js frontend (port 3000)
├── server/           # Express.js backend (port 3001)
├── extension/        # Chrome extension
├── ai-service/       # Python AI service
├── supabase/         # Supabase migrations and schema
└── shared/           # Shared types
```

---

## Commands (run from jobs/ directory)

| Command               | Description                       |
| --------------------- | --------------------------------- |
| `npm run dev`         | Start frontend + backend together |
| `npm run dev:client`  | Start frontend only (port 3000)   |
| `npm run dev:server`  | Start backend only (port 3001)    |
| `npm run install:all` | Install all dependencies          |
| `npm run build`       | Build frontend for production     |

---

## Troubleshooting

### App stuck loading

The cache is automatically cleared on `npm run dev`. If still having issues, manually clear:

```powershell
# PowerShell (from jobs/ directory)
Remove-Item -Recurse -Force client/.next -ErrorAction SilentlyContinue
npm run dev
```

```bash
# macOS/Linux (from jobs/ directory)
rm -rf client/.next
npm run dev
```

### Port already in use

```powershell
# PowerShell
Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Get-NetTCPConnection -LocalPort 3001 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

---

## API Endpoints (port 3001)

### Auth

| Method | Endpoint       | Description      |
| ------ | -------------- | ---------------- |
| POST   | `/auth/signup` | Create account   |
| POST   | `/auth/login`  | Login            |
| GET    | `/auth/me`     | Get current user |

### Profile & Resume

| Method | Endpoint         | Description    |
| ------ | ---------------- | -------------- |
| GET    | `/profile`       | Get profile    |
| PUT    | `/profile`       | Update profile |
| POST   | `/resume/upload` | Upload resume  |
| GET    | `/resume`        | Get resume     |
| POST   | `/resume/generate` | Generate tailored DOCX resume |
| GET    | `/resume/:id/file` | Download/stream a stored resume file |

### Automation

| Method | Endpoint             | Description      |
| ------ | -------------------- | ---------------- |
| GET    | `/automation/status` | Get status       |
| POST   | `/automation/start`  | Start automation |
| POST   | `/automation/pause`  | Pause            |
| POST   | `/automation/stop`   | Stop             |

### Applications

| Method | Endpoint            | Description       |
| ------ | ------------------- | ----------------- |
| GET    | `/applications`     | List applications |
| GET    | `/applications/:id` | Get details       |

---

## License

MIT
