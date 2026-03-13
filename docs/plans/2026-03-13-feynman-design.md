# Project Feynman — Design Document

**Date:** 2026-03-13
**Status:** Design Approved

---

## Vision

Feynman is a personal knowledge management + content creation system. Named after Richard Feynman's philosophy of learning by teaching, the system serves two pillars:

1. **Personal Knowledge Management (PKM)** — Collect, organize, and develop knowledge from all activities (work + personal)
2. **Content Creation** — Create authentic content grounded in real work and learnings

The guiding principle: only create content on things you've actually worked on and learned — no fluff.

---

## Two Pillars

### Pillar 1: Personal Knowledge Management

**Goal:** One central place to ingest, organize, search, and develop knowledge from all sources.

**Knowledge Sources (priority order):**

| # | Source | Notes |
|---|--------|-------|
| 1 | Claude Code transcripts | `.claude/` JSONL files — richest thinking/planning record |
| 2 | OpenClaw bot conversations | Telegram — mobile equivalent of Claude Code |
| 3 | Telegram saved messages | Years of personal bookmarking, very important |
| 4 | Git repos | Code + markdown commits across personal and work repos |
| 5 | Fathom call recordings | Internal team calls + external customer conversations |
| 6 | YouTube watch history | 2 accounts, mixed learning + entertainment (needs filtering) |
| 7 | Twitter/X bookmarks and posts | |
| 8 | Notion notes | Scattered |
| 9 | Sublime Text local notes | Local only, not in cloud |
| 10 | Slack messages | Work channels + personal |
| 11 | Google Calendar | Shows calls/meetings |
| 12 | Gmail | Some relevant info |
| 13 | Browser history | Laptop + phone |
| 14 | LinkedIn | Minor |
| 15 | Substack | Minor |

The system should be extensible to add new sources over time.

**Knowledge Curation Pipeline:**
```
Ideas (Topics to learn about) → Researching (What to learn, from what sources) → Learning (Actual learning) → Curated (Learned)
```

### Pillar 2: Content Creation

**Content Formats:**
- **AI-generated videos** — 2D cartoon animation, experimenting with Google Veo/Flow, Nano Banana model
- **Talking head videos** — Building-in-public style, inspired by Austin Kleon's "Show Your Work"
- **Blog posts** — For Substack, personal blog
- **Social posts** — Twitter/X threads, LinkedIn posts

**Distribution Channels:** YouTube (primary), Twitter/X, LinkedIn, Substack, personal blog

**Content Creation Pipeline:**
```
Ideas → Researching → Scripting/Outlining → Production → Editing → Review → Published → Archive
```

Items can flow from Knowledge Curation "Curated" stage → Content Creation "Ideas" stage.

---

## Key Features

### 1. Weekly Digest (Highest Priority)
- Generated on **Friday evening / Saturday morning**
- Covers the past 7 days of activity across all ingested sources
- Contains:
  - **Activity summary** — what you worked on across sources
  - **Key themes** — recurring topics or areas of focus
  - **Content ideas** — 3-5 suggested pieces with format recommendation and reasoning
  - **Knowledge gaps** — things explored but not resolved
  - **Notable bookmarks/saves** — interesting things saved during the period
- Content ideas auto-populate into the Content Pipeline "Ideas" stage (user controls promotion)
- **Nice-to-have:** On-demand digest for any date range (last few days, last month, etc.)

### 2. Dual Pipelines (Kanban)
- Knowledge Curation Pipeline: Ideas → Researching → Learning → Curated
- Content Creation Pipeline: Ideas → Researching → Scripting/Outlining → Production → Editing → Review → Published → Archive
- Digest auto-populates ideas into the Ideas stage only — pipeline does NOT move by itself

### 3. Searchable Knowledge Base
- Full-text search across all knowledge entries
- Semantic/vector search for conceptual queries (using Convex vector search)
- Pull up all relevant context for a topic from any source

---

## Architecture

### Approach: Core + Scripts

A Next.js + Convex app for the **UI and data layer**, plus **standalone ingestion scripts** (pure TypeScript) that run via Claude Code or cron and push data into Convex via its API.

**Why this approach:**
- Clean separation — app focuses on organizing/viewing, scripts focus on pulling data
- New sources = new script, no app changes needed
- Matches the "start batch/manual, graduate to automation" plan
- Scripts are immediately useful via Claude Code before the app UI is built

### Tech Stack
- **Frontend:** Next.js + React (App Router)
- **Backend/Database:** Convex (personal account, separate from work)
- **Ingestion:** Pure TypeScript scripts
- **AI:** Claude API for digest generation, summarization, tagging

### Repository Structure

```
feynman/
├── app/
│   ├── backend/
│   │   └── convex/              # Convex schema, functions, queries, mutations
│   │       ├── schema.ts
│   │       ├── knowledgeEntries.ts
│   │       ├── contentPipeline.ts
│   │       ├── knowledgePipeline.ts
│   │       ├── digests.ts
│   │       ├── cronConfig.ts
│   │       ├── digestAction.ts
│   │       ├── crons.ts
│   │       └── search.ts
│   ├── feynman-lib/
│   │   └── scripts/             # Pure TypeScript ingestion & utility scripts
│   │       ├── ingest-claude-transcripts.ts
│   │       ├── ingest-git-history.ts
│   │       ├── ingest-youtube-history.ts
│   │       ├── ingest-twitter-bookmarks.ts
│   │       ├── ingest-telegram-saved.ts
│   │       ├── generate-digest.ts
│   │       └── shared/
│   │           ├── types.ts
│   │           └── convex-client.ts
│   └── frontend/
│       └── src/                 # Next.js app
│           ├── app/
│           │   ├── dashboard/   # Weekly digest view
│           │   ├── content/     # Content creation pipeline (kanban)
│           │   ├── knowledge/   # Knowledge curation pipeline (kanban)
│           │   ├── search/      # Search across knowledge base
│           │   └── settings/    # Scheduled jobs visibility & control
│           └── components/
├── content/                     # Content artifacts (scripts, outlines, drafts)
│   ├── talking-head/
│   ├── ai-videos/
│   ├── blog/
│   └── social/
├── knowledge/                   # Local knowledge staging area
│   ├── raw/
│   └── curated/
├── docs/
│   ├── plans/
│   └── workflows/
├── assets/
├── CLAUDE.md
└── README.md
```

### Convex Data Model

**Core tables:**

- **`knowledgeEntries`** — Individual pieces of knowledge ingested from any source
  - source, sourceId, title, content, summary, tags, url, timestamp, metadata

- **`knowledgeItems`** — Items in the knowledge curation pipeline
  - stage (Ideas | Researching | Learning | Curated), topic, linked entry IDs, notes

- **`contentItems`** — Items in the content creation pipeline
  - stage (Ideas | Researching | Scripting | Production | Editing | Review | Published | Archive), format, script/outline, linked knowledge item IDs

- **`digests`** — Generated weekly digests
  - date range, activity summary, themes, suggested content ideas

- **`sources`** — Registered knowledge sources
  - type, last ingested timestamp, config

- **`cronConfig`** — Runtime configuration for scheduled jobs (visibility + control layer)
  - name, description, schedule (human-readable), enabled (toggle), lastRunAt, lastStatus, lastError, runCount

### Shared KnowledgeEntry Type

```typescript
type KnowledgeEntry = {
  source: string;                    // "claude-transcript" | "git-commit" | "youtube" | etc.
  sourceId: string;                  // Unique ID from source (for dedup)
  title: string;                     // Brief title or summary
  content: string;                   // Full text content
  summary?: string;                  // AI-generated summary
  tags?: string[];                   // Auto-generated or manual tags
  url?: string;                      // Link back to source
  timestamp: number;                 // When captured
  metadata?: Record<string, any>;    // Source-specific extras
}
```

### Ingestion Scripts Priority

| Priority | Script | Source | Approach |
|----------|--------|--------|----------|
| 1 | ingest-claude-transcripts.ts | .claude/ JSONL files | Read local files, parse conversations |
| 2 | ingest-git-history.ts | Git repos | git log across repos, extract commits + markdown diffs |
| 3 | ingest-telegram-saved.ts | Telegram saved messages | Telegram API or exported JSON |
| 4 | ingest-youtube-history.ts | YouTube watch history | YouTube Data API or Google Takeout |
| 5 | ingest-twitter-bookmarks.ts | Twitter/X bookmarks | Twitter API or export |
| 6 | ingest-fathom.ts | Fathom recordings | Fathom API (transcripts) |
| 7 | ingest-notion.ts | Notion pages | Notion API |
| 8 | ingest-browser-history.ts | Browser history | SQLite from Chrome/Safari |
| 9 | ingest-calendar.ts | Google Calendar | Google Calendar API |
| 10 | ingest-slack.ts | Slack messages | Slack API |

### Ingestion Strategy
- **Phase 1:** Batch/manual — run scripts via Claude Code, triggered on demand
- **Phase 2:** Graduate to scheduled automation (Convex scheduled functions or cron)

### Digest Generation Flow
1. Query Convex for knowledgeEntries from past 7 days
2. Group by source and theme
3. Call Claude API to generate: activity summary, key themes, 3-5 content ideas with format recommendations, knowledge gaps, notable saves
4. Store digest in Convex + optionally output as markdown

---

## Decisions Log

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Repo scope | Central hub for PKM + content creation | One place to learn, reflect, and create — code repos are for building |
| Project name | Feynman | Learning by teaching philosophy |
| Tech stack | Next.js + React + Convex | Full control, custom app, personal Convex account |
| Architecture | Core + Scripts (Approach B) | Clean separation, fastest to value, scripts work immediately via Claude Code |
| Ingestion strategy | Batch/manual first, automate later | Prove value before investing in automation |
| Digest cadence | Weekly (Friday/Saturday) | Covers full work week, on-demand as nice-to-have |
| Pipeline auto-population | Ideas stage only, user controls rest | System suggests but doesn't move things autonomously |
| Two pipelines | Knowledge Curation + Content Creation | Not all learning needs to become content, but content should come from real knowledge |
| Cron visibility | "Soft cron" with cronConfig table | Convex crons are code-defined and auto-start on deploy — wrapping with a DB config layer gives frontend toggle/visibility without redeploying |

---

## Frontend UI

### Four Main Views

#### 1. Dashboard (Home)
- Latest digest prominently displayed — activity summary, themes, content ideas
- Pipeline snapshot — how many items in each stage across both pipelines
- Quick actions — "Generate digest now", "Add idea", "Ingest sources"
- Recent knowledge entries — latest items from any source

#### 2. Content Pipeline (Kanban)
- Horizontal kanban: Ideas → Researching → Scripting/Outlining → Production → Editing → Review → Published → Archive
- Each card: title, format (video/blog/tweet/etc.), linked knowledge items, created date
- Drag-and-drop between stages
- Click to expand: full script/outline editor, notes, linked knowledge, task checklist
- Filter by format (talking head, AI video, blog, social)
- Ideas stage has visual indicator for auto-populated (from digest) vs. manually added items

#### 3. Knowledge Pipeline (Kanban)
- Horizontal kanban: Ideas → Researching → Learning → Curated
- Each card: topic, source references, tags, notes
- "Promote to Content" action on Curated items → creates Content Pipeline item in Ideas
- Linked knowledge entries shown on each card

#### 4. Search
- Single search bar across all knowledge entries
- Results show: source icon, title, snippet, date, tags
- Click to expand full content
- Filter by source type, date range, tags

#### 5. Settings — Scheduled Jobs
- Lists all cron/scheduled jobs with full visibility: name, schedule, enabled/disabled, last run time, last status, error details, run count
- Toggle switch to enable/disable each job at runtime (without redeploying code)
- How it works: Convex `crons.ts` fires on schedule, but each cron function checks a `cronConfig` table first — if `enabled === false`, it exits immediately. This gives full runtime control from the frontend while keeping cron definitions in code.

### Design Direction
- Clean, minimal, functional — Linear/Notion aesthetics
- Dark mode preferred (or system-matching)
- Mobile-responsive but desktop-first

---

## AI Integration

### During Ingestion
- **Auto-summarization** — generate short summary when knowledge entry is ingested
- **Auto-tagging** — extract relevant tags/topics from content
- **YouTube filtering** — classify watched videos as "learning" vs "entertainment"

### Digest Generation
- Receives grouped knowledge entries from the past week
- Generates full digest: activity summary, themes, content ideas, knowledge gaps, notable saves
- Each content idea includes: suggested title, recommended format, reasoning

### Content Assistance
- **Script/outline generation** — from content idea + linked knowledge, generate draft outline
- **Social post drafting** — take published video/blog and draft Twitter threads, LinkedIn posts
- **Repurposing** — suggest how one piece of content can be adapted across formats

### Knowledge Development
- **Knowledge gap analysis** — identify areas explored but not gone deep on
- **Connection finding** — surface links between entries across different sources

All AI calls go through `feynman-lib/` — either standalone scripts or Convex action functions using the Claude API.
