# Contributing to Kira

Thank you for your interest in contributing to Kira! 🎉 This guide will help you get up and running quickly.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Development Setup](#local-development-setup)
  - [Verifying Everything Works](#verifying-everything-works)
- [Project Architecture](#project-architecture)
- [Development Workflow](#development-workflow)
- [Code Style Guidelines](#code-style-guidelines)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Issues](#reporting-issues)
- [Getting Help](#getting-help)

---

## Code of Conduct

This project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold a welcoming, inclusive, and harassment-free environment for everyone.

---

## Getting Started

### Prerequisites

| Tool | Minimum Version | Purpose |
| :--- | :--- | :--- |
| [Node.js](https://nodejs.org/) | 20 LTS | Runtime for all backend services |
| [Docker](https://docs.docker.com/get-docker/) | 24+ | Runs Postgres & Redis locally |
| [Docker Compose](https://docs.docker.com/compose/) | v2+ | Orchestrates dev infrastructure |
| [Git](https://git-scm.com/) | 2.40+ | Version control |

You will also need a **Google Gemini API key** — get one free at [ai.google.dev](https://ai.google.dev).

### Local Development Setup

1. **Fork & clone the repository**

   ```bash
   git clone https://github.com/<your-username>/kira.git
   cd kira
   ```

2. **Start the infrastructure (Postgres + Redis)**

   ```bash
   docker compose up -d
   ```

   This spins up:
   - **PostgreSQL 16** with `pgvector` on port `5432` (mirrors production Supabase)
   - **Redis 7** on port `6379` (mirrors production Upstash)

   The database schema (`supabase_schema.sql`) is automatically applied on first boot.

3. **Configure environment variables**

   ```bash
   cp .env.docker .env
   ```

   Open `.env` and fill in at minimum:
   - `GEMINI_API_KEY` — your Google AI key

   All other values have sensible local defaults pre-filled.

4. **Install dependencies**

   ```bash
   npm install
   ```

5. **Start the application**

   ```bash
   # Start all services (Ingestion API, Chat API, Admin API, Dashboard)
   npm run start:all
   ```

   Or start individual services:

   ```bash
   npm run dev             # Ingestion API (port 3000)
   npm run start:chat      # Sandra's Chat API (port 3001)
   npm run start:admin     # Admin API (port 4001)
   npm run start:dashboard # React Dashboard (port 5173)
   ```

### Verifying Everything Works

```bash
# Check Postgres is healthy
docker compose exec postgres pg_isready -U kira -d kira

# Check Redis is healthy
docker compose exec redis redis-cli ping

# Hit the health endpoint
curl http://localhost:3000/health
```

---

## Project Architecture

Kira is a multi-service monorepo. Understanding the layout will help you find the right place to make changes:

```
Kira/
├── src/                    # Core Ingestion API (Node.js + Express)
│   ├── index.js            # Main server entry point
│   ├── db/                 # Database connection & migrations
│   ├── routes/             # Express route handlers
│   └── workers/            # BullMQ background job workers
├── sandra-chat-api/        # AI Chat API (Gemini + RAG + SSE streaming)
├── dashboard/              # React + Vite customer dashboard
├── supabase_schema.sql     # Database schema (auto-applied by Docker)
├── docker-compose.yml      # Local dev infrastructure
├── Dockerfile              # Production container image
└── helm/                   # Kubernetes Helm charts (production)
```

| Service | Port | Description |
| :--- | :--- | :--- |
| Ingestion API | `3000` | PDF/URL ingestion, chunking, vector embeddings |
| Chat API | `3001` | RAG-powered chat with Gemini SSE streaming |
| Admin API | `4001` | Internal admin dashboard backend |
| Dashboard | `5173` | Customer-facing React SPA |

---

## Development Workflow

We use a **feature-branch** workflow:

1. **Create a branch** from `main` (or the current integration branch):

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** — write code, add tests, update docs.

3. **Commit with clear messages** following [Conventional Commits](https://www.conventionalcommits.org/):

   ```
   feat(chat-api): add token window summarization for long sessions
   fix(ingestion): handle empty PDF pages without crashing
   docs(readme): update architecture diagram with V2 voice flow
   chore(deps): bump @google/genai to 1.50.0
   ```

4. **Push & open a Pull Request** against `main`.

---

## Code Style Guidelines

### General

- **Language:** JavaScript (ES2022+, Node.js 20). No TypeScript in the backend yet.
- **Modules:** Use `require()` / CommonJS (matching the existing codebase).
- **Formatting:** 2-space indentation, single quotes, trailing commas.
- **Linting:** Run `npx eslint .` before committing. Fix all warnings.

### Backend (Node.js)

- Use `async/await` over raw Promises or callbacks.
- Handle errors explicitly — never swallow exceptions silently.
- Use `winston` for logging (`console.log` is only acceptable in dev scripts).
- Database queries go through the `pg` pool — never construct raw SQL with string interpolation (use parameterized queries `$1, $2, ...`).

### Frontend (React / Dashboard)

- Functional components with hooks only — no class components.
- Use Tailwind CSS utility classes; avoid custom CSS unless absolutely necessary.
- Keep components small and focused — prefer composition over large monolithic files.

### Commit Hygiene

- Keep commits atomic — one logical change per commit.
- Squash fixup commits before requesting review.
- Never commit `.env`, API keys, or credentials.

---

## Submitting a Pull Request

### Before You Submit

- [ ] Code runs locally without errors
- [ ] `npx eslint .` passes with no warnings
- [ ] New features include relevant documentation updates
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] No secrets, API keys, or `.env` files are included

### PR Guidelines

1. **Title** — Use a clear, descriptive title:
   `feat(ingestion): add YouTube transcript chunking support`

2. **Description** — Include:
   - **What** changed and **why**
   - Screenshots or terminal output if applicable
   - Any breaking changes or migration steps

3. **Link issues** — Reference related issues with `Closes #123` or `Fixes #456`.

4. **Keep PRs focused** — Small, reviewable PRs are merged faster than large ones.

5. **Be responsive** — Address review feedback promptly. We aim to review all PRs within 48 hours.

---

## Reporting Issues

Found a bug or have a feature idea? We'd love to hear from you!

- **Bug reports** — Use the [Bug Report](../../issues/new?template=bug_report.md) template
- **Feature requests** — Use the [Feature Request](../../issues/new?template=feature_request.md) template
- **Security vulnerabilities** — **Do NOT open a public issue.** see [SECURITY.md](SECURITY.md).

### Writing a Good Bug Report

1. **Title:** Short and specific — `Chat API returns 500 when PDF has no text content`
2. **Environment:** Node version, OS, Docker version
3. **Steps to reproduce:** Numbered, minimal steps to trigger the issue
4. **Expected vs. actual behavior**
5. **Logs / screenshots:** Include relevant error output

---

## Getting Help

- **Discussions:** Open a thread in [GitHub Discussions](../../discussions) for questions
- **Chat:** Reach out in the project's community channels
- **Docs:** Check the [`docs/`](docs/) folder for architecture guides and API references

---

Thank you for helping make Kira better! Every contribution — from fixing a typo to building a new feature — is valued and appreciated. 💜
