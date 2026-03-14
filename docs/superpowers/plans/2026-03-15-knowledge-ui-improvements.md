# Knowledge UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the Claude Transcripts source page with better entry browsing (project grouping, filters, markdown rendering), a JSONL raw file viewer, cleaner sidebar navigation, and smarter title generation.

**Architecture:** Frontend-heavy changes to existing components (sidebar, entry list, slide-over) plus a new raw file viewer component. One backend change: better title heuristic in the mechanical parser and a new `getDownloadUrl` query for raw files.

**Tech Stack:** Next.js App Router, React, Convex, Tailwind CSS, shadcn UI, `react-markdown`, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-15-knowledge-ui-improvements.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `app/frontend/src/components/knowledge/raw-file-viewer.tsx` | Slide-over panel for viewing JSONL raw files with virtual scroll and parsed/raw toggle |

### Modified Files

| File | Changes |
|------|---------|
| `app/frontend/src/components/app-sidebar.tsx` | Remove Sources sub-accordion, rename labels to "Claude" and "Git", tighten spacing |
| `app/frontend/src/components/knowledge/source-entry-list.tsx` | Add project/date filters, group by project accordion, friendly timestamps |
| `app/frontend/src/components/knowledge/entry-slide-over.tsx` | Add markdown rendering with rendered/raw toggle |
| `app/frontend/src/components/knowledge/raw-files-list.tsx` | Add click handler to open raw file viewer |
| `app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx` | Wire up raw file viewer state |
| `app/backend/convex/extraction.ts` | Improve title heuristic in `parseClaudeStripTools` |
| `app/backend/convex/rawFiles.ts` | Add `getDownloadUrl` query |
| `app/frontend/package.json` | Add `react-markdown` dependency |

---

## Chunk 1: Phase 1 — Quick Wins

### Task 1: Sidebar cleanup

**Files:**
- Modify: `app/frontend/src/components/app-sidebar.tsx`

- [ ] **Step 1: Simplify the sidebar**

Remove the Sources sub-accordion entirely. Show source items directly under the Knowledge accordion. Rename labels. Remove the `sourcesOpen` state and the nested `SidebarMenuSub` for Sources.

Replace the current Knowledge section (lines 69-157) with a flattened structure:

```tsx
{/* Knowledge accordion */}
<SidebarMenuItem>
  <SidebarMenuButton
    onClick={() => setKnowledgeOpen((o) => !o)}
    isActive={isKnowledgeRoute}
  >
    <BookOpen className="h-4 w-4" />
    <span>Knowledge</span>
    {knowledgeOpen ? (
      <ChevronDown className="ml-auto h-4 w-4" />
    ) : (
      <ChevronRight className="ml-auto h-4 w-4" />
    )}
  </SidebarMenuButton>

  {knowledgeOpen && (
    <SidebarMenuSub>
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          render={<Link href="/knowledge/sources/claude-transcripts" />}
          isActive={pathname === "/knowledge/sources/claude-transcripts"}
        >
          <MessageSquare className="h-3 w-3" />
          <span className="flex-1">Claude</span>
          {claudeCount !== undefined && (
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {claudeCount}
            </span>
          )}
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>

      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          render={<Link href="/knowledge/sources/git-history" />}
          isActive={pathname === "/knowledge/sources/git-history"}
        >
          <GitBranch className="h-3 w-3" />
          <span className="flex-1">Git</span>
          {gitCount !== undefined && (
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {gitCount}
            </span>
          )}
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>

      <SidebarSeparator className="my-1" />

      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          render={<Link href="/knowledge/pipeline" />}
          isActive={pathname === "/knowledge/pipeline"}
        >
          <ArrowRightLeft className="h-3 w-3" />
          <span>Pipeline</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  )}
</SidebarMenuItem>
```

Also remove the `sourcesOpen` state variable and its import is no longer needed.

- [ ] **Step 2: Verify the sidebar renders correctly**

```bash
pnpm dev
```

Navigate to http://localhost:3000. Verify:
- Knowledge accordion shows Claude (count), Git (count), separator, Pipeline — no "Sources" sub-level
- All links work
- Active state highlighting works

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/app-sidebar.tsx
git commit -m "feat: simplify sidebar — remove Sources sub-accordion, shorten labels"
```

---

### Task 2: Add project and date filters to entry list

**Files:**
- Modify: `app/frontend/src/components/knowledge/source-entry-list.tsx`

- [ ] **Step 1: Add filter state and date range presets**

Add to the component state:

```tsx
const [projectFilter, setProjectFilter] = useState<string>("");
const [dateRange, setDateRange] = useState<string>("7"); // days; "" = all time
```

Define date range presets:

```tsx
const datePresets = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "All time", value: "" },
];
```

- [ ] **Step 2: Derive distinct project names from entries**

After fetching entries, derive unique project names:

```tsx
const projectNames = Array.from(
  new Set(
    entryList
      .map((e: any) => e.metadata?.projectName as string | undefined)
      .filter(Boolean)
  )
).sort();
```

- [ ] **Step 3: Apply client-side filters**

Filter the entry list before rendering:

```tsx
const filteredEntries = entryList.filter((entry: any) => {
  // Project filter
  if (projectFilter && entry.metadata?.projectName !== projectFilter) {
    return false;
  }
  // Date range filter
  if (dateRange) {
    const daysAgo = parseInt(dateRange, 10);
    const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    if (entry.timestamp < cutoff) return false;
  }
  return true;
});
```

- [ ] **Step 4: Add filter dropdowns to the UI**

Update the filter bar to include project and date range selectors alongside the existing extractor filter:

```tsx
<div className="flex items-center justify-between gap-3">
  <div className="flex items-center gap-2 flex-wrap">
    <select
      value={filter}
      onChange={(e) => setFilter(e.target.value)}
      className="text-sm border rounded-md px-2 py-1 bg-background"
    >
      <option value="">All extractors</option>
      {extractorList.map((ex: any) => (
        <option key={ex.name} value={ex.name}>{ex.displayName}</option>
      ))}
    </select>

    <select
      value={projectFilter}
      onChange={(e) => setProjectFilter(e.target.value)}
      className="text-sm border rounded-md px-2 py-1 bg-background"
    >
      <option value="">All projects</option>
      {projectNames.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>

    <select
      value={dateRange}
      onChange={(e) => setDateRange(e.target.value)}
      className="text-sm border rounded-md px-2 py-1 bg-background"
    >
      {datePresets.map((preset) => (
        <option key={preset.value} value={preset.value}>{preset.label}</option>
      ))}
    </select>
  </div>

  <span className="text-xs text-muted-foreground">
    {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
  </span>
</div>
```

- [ ] **Step 5: Update the timestamp display**

Replace the `formatRelativeDate` function with a friendly date+time format:

```tsx
function formatFriendlyDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
```

Use `formatFriendlyDate(entry.timestamp)` instead of `formatRelativeDate(entry.timestamp)` in the entry row.

- [ ] **Step 6: Update the entry list to render `filteredEntries` instead of `entryList`**

Change the `.map()` call and the count to use `filteredEntries`.

- [ ] **Step 7: Verify**

```bash
pnpm dev
```

Test:
- Project dropdown populates with actual project names
- Selecting a project filters the list
- Date range filter works (default "Last 7 days")
- "All time" shows everything
- Entry count updates with filters

- [ ] **Step 8: Commit**

```bash
git add app/frontend/src/components/knowledge/source-entry-list.tsx
git commit -m "feat: add project and date range filters to source entry list"
```

---

### Task 3: Markdown rendering in slide-over

**Files:**
- Modify: `app/frontend/src/components/knowledge/entry-slide-over.tsx`
- Modify: `app/frontend/package.json`

- [ ] **Step 1: Install react-markdown and @tailwindcss/typography**

```bash
cd app/frontend && pnpm add react-markdown @tailwindcss/typography
```

Then add the typography plugin to `app/frontend/src/app/globals.css`. Add this line after the existing `@import` statements:

```css
@plugin "@tailwindcss/typography";
```

This provides the `prose` classes needed for markdown rendering.

- [ ] **Step 2: Add rendered/raw toggle state and import**

At the top of `entry-slide-over.tsx`, add:

```tsx
import { useState } from "react";
import ReactMarkdown from "react-markdown";
```

Inside the component:

```tsx
const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
```

- [ ] **Step 3: Add toggle button to the header**

Add a small toggle in the header area, after the close button (or in the metadata row). A simple segmented control:

```tsx
{/* View toggle — place in the header div, after the close button */}
<div className="flex items-center gap-0.5 border rounded-md p-0.5 shrink-0">
  <button
    onClick={() => setViewMode("rendered")}
    className={`px-2 py-0.5 text-xs rounded transition-colors ${
      viewMode === "rendered"
        ? "bg-accent font-medium"
        : "text-muted-foreground hover:text-foreground"
    }`}
  >
    Rendered
  </button>
  <button
    onClick={() => setViewMode("raw")}
    className={`px-2 py-0.5 text-xs rounded transition-colors ${
      viewMode === "raw"
        ? "bg-accent font-medium"
        : "text-muted-foreground hover:text-foreground"
    }`}
  >
    Raw
  </button>
</div>
```

- [ ] **Step 4: Replace the content area with conditional rendering**

Replace the existing `<pre>` content section (lines 119-134) with:

```tsx
{/* Content */}
<div className="flex-1 overflow-y-auto px-5 py-4">
  {entry ? (
    viewMode === "rendered" ? (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{entry.content}</ReactMarkdown>
      </div>
    ) : (
      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
        {entry.content}
      </pre>
    )
  ) : (
    <div className="space-y-2">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="h-4 bg-muted animate-pulse rounded"
          style={{ width: `${70 + Math.random() * 30}%` }}
        />
      ))}
    </div>
  )}
</div>
```

The `prose` classes come from `@tailwindcss/typography` which was installed in Step 1.

- [ ] **Step 5: Verify**

```bash
pnpm dev
```

Open any entry's slide-over. Verify:
- Default view is "Rendered" — shows formatted headings, horizontal rules, code blocks
- Toggle to "Raw" — shows plain text with `###` markdown syntax visible
- Toggle back preserves state
- Content scrolls properly in both modes

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/knowledge/entry-slide-over.tsx app/frontend/src/app/globals.css app/frontend/package.json app/frontend/pnpm-lock.yaml
git commit -m "feat: add markdown rendering with rendered/raw toggle in entry slide-over"
```

---

### Task 4: Better entry titles in the parser

**Files:**
- Modify: `app/backend/convex/extraction.ts`

- [ ] **Step 1: Improve the title derivation logic**

Replace the current title logic (lines 68-71) in `parseClaudeStripTools`:

```typescript
// Current:
const firstHuman = messages.find((m) => m.role === "Human");
const rawTitle = firstHuman?.text ?? "Untitled Conversation";
const title = rawTitle.slice(0, 120);
```

With an improved version:

```typescript
function deriveTitle(messages: Array<{ role: string; text: string }>): string {
  const MAX_TITLE_LENGTH = 120;

  // Try first human message, fall back to second if first is too short
  let candidate = "";
  for (const msg of messages) {
    if (msg.role !== "Human") continue;
    candidate = msg.text.trim();

    // Strip leading slash commands (e.g., /commit, /review-pr, /help)
    candidate = candidate.replace(/^\/\S+\s*/g, "").trim();

    // Strip common filler phrases at the start (loop to handle chained fillers like "please can you")
    const fillers = /^(can you|could you|please|i want to|i need to|i'd like to|let's|lets)\s+/i;
    while (fillers.test(candidate)) {
      candidate = candidate.replace(fillers, "").trim();
    }

    // If still too short after cleanup, try next message
    if (candidate.length >= 10) break;
  }

  if (!candidate || candidate.length < 10) {
    return "Claude Code conversation";
  }

  // Collapse whitespace and newlines
  candidate = candidate.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

  // Truncate at first sentence boundary if within max length
  const sentenceEnd = candidate.search(/[.?!]\s/);
  if (sentenceEnd > 0 && sentenceEnd < MAX_TITLE_LENGTH) {
    candidate = candidate.slice(0, sentenceEnd + 1);
  } else if (candidate.length > MAX_TITLE_LENGTH) {
    candidate = candidate.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }

  // Capitalize first letter
  candidate = candidate.charAt(0).toUpperCase() + candidate.slice(1);

  return candidate;
}
```

Then use it:

```typescript
const title = deriveTitle(messages);
```

- [ ] **Step 2: Verify the change compiles**

No runtime test needed — this runs server-side on re-extraction. Re-running `pnpm ingest:claude` would re-upload changed files and re-extract. For already-extracted entries, you'd need to trigger re-extraction manually.

- [ ] **Step 3: Commit**

```bash
git add app/backend/convex/extraction.ts
git commit -m "feat: improve title heuristic — strip commands, filler, truncate at sentence"
```

---

## Chunk 2: Phase 2 — Grouping and Raw File Viewer

### Task 5: Group entries by project

**Files:**
- Modify: `app/frontend/src/components/knowledge/source-entry-list.tsx`

- [ ] **Step 1: Group filtered entries by project name**

After applying filters, group the entries:

```tsx
interface ProjectGroup {
  projectName: string;
  projectPath: string | undefined;
  entries: any[];
  mostRecentTimestamp: number;
}

function groupByProject(entries: any[]): ProjectGroup[] {
  const groups: Record<string, ProjectGroup> = {};
  const ungrouped: any[] = [];

  for (const entry of entries) {
    const name = entry.metadata?.projectName as string | undefined;
    if (!name) {
      ungrouped.push(entry);
      continue;
    }
    if (!groups[name]) {
      groups[name] = {
        projectName: name,
        projectPath: entry.metadata?.projectPath as string | undefined,
        entries: [],
        mostRecentTimestamp: 0,
      };
    }
    groups[name].entries.push(entry);
    if (entry.timestamp > groups[name].mostRecentTimestamp) {
      groups[name].mostRecentTimestamp = entry.timestamp;
    }
  }

  // Sort groups by most recent session first
  const sorted = Object.values(groups).sort(
    (a, b) => b.mostRecentTimestamp - a.mostRecentTimestamp
  );

  // Add ungrouped at the end if any
  if (ungrouped.length > 0) {
    sorted.push({
      projectName: "Ungrouped",
      projectPath: undefined,
      entries: ungrouped,
      mostRecentTimestamp: Math.max(...ungrouped.map((e) => e.timestamp)),
    });
  }

  return sorted;
}
```

- [ ] **Step 2: Add accordion state for groups**

```tsx
const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

function toggleGroup(name: string) {
  setOpenGroups((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
}
```

Initialize all groups as open by default when entries first load:

```tsx
const groups = groupByProject(filteredEntries);

// Open all groups by default on first load
const initializedRef = useRef(false);
useEffect(() => {
  if (!initializedRef.current && groups.length > 0) {
    setOpenGroups(new Set(groups.map((g) => g.projectName)));
    initializedRef.current = true;
  }
}, [groups.length]);
```

Add `useRef` and `useEffect` to the React imports.

- [ ] **Step 3: Render grouped accordion layout**

Replace the flat entry list rendering with the grouped accordion:

```tsx
{groups.length === 0 ? (
  <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
    No entries found.
  </div>
) : (
  <div className="space-y-2">
    {groups.map((group) => (
      <div key={group.projectName} className="border rounded-lg overflow-hidden">
        {/* Group header */}
        <button
          onClick={() => toggleGroup(group.projectName)}
          className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
          title={group.projectPath ?? undefined}
        >
          {openGroups.has(group.projectName) ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{group.projectName}</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}
          </span>
        </button>

        {/* Group entries */}
        {openGroups.has(group.projectName) && (
          <div className="divide-y">
            {group.entries.map((entry: any) => (
              <div
                key={entry._id}
                onClick={() => onEntryClick(entry._id)}
                className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors ${
                  selectedEntryId === entry._id ? "bg-accent" : ""
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${extractorDotColor(entry.extractorName ?? "")}`}
                />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium truncate">{entry.title}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    {entry.extractorName && (
                      <span className="capitalize">
                        {entry.extractorName.replace(/-/g, " ")}
                      </span>
                    )}
                    {entry.metadata?.messageCount !== undefined && (
                      <span>{entry.metadata.messageCount} msgs</span>
                    )}
                    <span>{formatFriendlyDate(entry.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

Add `ChevronDown` and `ChevronRight` to the lucide-react imports.

- [ ] **Step 4: Verify**

```bash
pnpm dev
```

Test:
- Entries are grouped by project in accordion sections
- Group headers show short project name and entry count
- Hovering group header shows full path as tooltip
- Groups are sorted by most recent session
- Entries within groups are sorted by timestamp descending
- Friendly timestamps show date + time (e.g., "Mar 14, 2:30 PM")
- Clicking a group header toggles its entries
- All groups are open by default
- "Ungrouped" section appears at the bottom for entries without a project

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/knowledge/source-entry-list.tsx
git commit -m "feat: group entries by project in collapsible accordions"
```

---

### Task 6: Raw file download URL query

**Files:**
- Modify: `app/backend/convex/rawFiles.ts`

- [ ] **Step 1: Add getDownloadUrl query**

Add to `rawFiles.ts`:

```typescript
export const getDownloadUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add app/backend/convex/rawFiles.ts
git commit -m "feat: add getDownloadUrl query for raw file storage"
```

---

### Task 7: Raw file viewer slide-over

**Files:**
- Create: `app/frontend/src/components/knowledge/raw-file-viewer.tsx`

- [ ] **Step 1: Create the raw file viewer component**

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import type { Id } from "@backend/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { X, ChevronDown, ChevronRight } from "lucide-react";

interface RawFileViewerProps {
  file: {
    _id: string;
    fileName: string;
    storageId: string;
    localFileSize: number;
    timestamp: number;
    status: string;
    projectName?: string;
  };
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Derive a one-line summary for a JSONL record */
function recordSummary(record: Record<string, unknown>): string {
  const type = (record.type as string) ?? "unknown";
  const role = (record.message as { role?: string })?.role ?? "";
  const ts = record.timestamp as string | undefined;
  const parts = [type];
  if (role) parts.push(role);
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      parts.push(
        d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      );
    }
  }
  return parts.join(" · ");
}

export function RawFileViewer({ file, onClose }: RawFileViewerProps) {
  const downloadUrl = useQuery(api.rawFiles.getDownloadUrl, {
    storageId: file.storageId as Id<"_storage">,
  });

  const [records, setRecords] = useState<
    Array<{ index: number; summary: string; json: string; raw: Record<string, unknown> }>
  >([]);
  const [rawText, setRawText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"parsed" | "raw">("parsed");
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());

  // Fetch and parse the file
  useEffect(() => {
    if (!downloadUrl) return;

    setLoading(true);
    setError(null);

    fetch(downloadUrl)
      .then((res) => res.text())
      .then((text) => {
        setRawText(text);
        const lines = text.split("\n").filter((l) => l.trim());
        const parsed = lines.map((line, i) => {
          try {
            const obj = JSON.parse(line);
            return {
              index: i,
              summary: recordSummary(obj),
              json: JSON.stringify(obj, null, 2),
              raw: obj,
            };
          } catch {
            return {
              index: i,
              summary: `Line ${i + 1} (parse error)`,
              json: line,
              raw: {},
            };
          }
        });
        setRecords(parsed);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [downloadUrl]);

  const toggleRecord = useCallback((index: number) => {
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-[600px] bg-background border-l shadow-lg z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b">
          <div className="flex-1 min-w-0 space-y-1">
            <h2 className="text-base font-semibold truncate">{file.fileName}</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {file.projectName && <span>{file.projectName}</span>}
              <span>{formatBytes(file.localFileSize)}</span>
              <span>{formatDate(file.timestamp)}</span>
              <Badge variant="outline" className="text-[10px] capitalize">
                {file.status}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View toggle */}
            <div className="flex items-center gap-0.5 border rounded-md p-0.5">
              <button
                onClick={() => setViewMode("parsed")}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  viewMode === "parsed"
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Parsed
              </button>
              <button
                onClick={() => setViewMode("raw")}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  viewMode === "raw"
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Raw
              </button>
            </div>

            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Record count */}
        {!loading && !error && (
          <div className="px-5 py-2 border-b text-xs text-muted-foreground bg-muted/30">
            {records.length} records
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading file...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-destructive">Error: {error}</p>
          </div>
        ) : viewMode === "raw" ? (
          <div className="flex-1 overflow-auto px-5 py-4">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {rawText}
            </pre>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {records.map((record) => (
              <div key={record.index}>
                <button
                  onClick={() => toggleRecord(record.index)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-accent/30 transition-colors border-b text-xs"
                >
                  {expandedRecords.has(record.index) ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-mono text-muted-foreground w-8 shrink-0">
                    {record.index + 1}
                  </span>
                  <span className="truncate">{record.summary}</span>
                </button>
                {expandedRecords.has(record.index) && (
                  <div className="px-4 py-2 bg-muted/20 border-b">
                    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed overflow-x-auto">
                      {record.json}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

**Note:** This renders all records without virtual scrolling. For most JSONL files (a few hundred records), this performs well. If performance becomes an issue with very large files, add `@tanstack/react-virtual` as a follow-up.

- [ ] **Step 2: Verify component renders**

This is tested via Task 8 (wiring it up).

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/knowledge/raw-file-viewer.tsx
git commit -m "feat: add raw file viewer slide-over with parsed/raw toggle"
```

---

### Task 8: Wire up raw file viewer

**Files:**
- Modify: `app/frontend/src/components/knowledge/raw-files-list.tsx`
- Modify: `app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx`

- [ ] **Step 1: Add click handler to raw files list**

Update `RawFilesList` to accept an `onFileClick` prop:

```tsx
interface RawFilesListProps {
  source: string;
  onFileClick?: (file: any) => void;
}
```

Add `cursor-pointer hover:bg-accent/50 transition-colors` to the file row div and an `onClick` handler:

```tsx
<div
  key={file._id}
  onClick={() => onFileClick?.(file)}
  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
>
```

- [ ] **Step 2: Wire up viewer state in the Claude Transcripts page**

Update `claude-transcripts/page.tsx`:

```tsx
import { RawFileViewer } from "@/components/knowledge/raw-file-viewer";

// Add state:
const [selectedFile, setSelectedFile] = useState<any | null>(null);

// Pass onFileClick to RawFilesList:
<RawFilesList source={SOURCE} onFileClick={(file) => setSelectedFile(file)} />

// Add viewer at the end, alongside the entry slide-over:
{selectedFile && (
  <RawFileViewer
    file={selectedFile}
    onClose={() => setSelectedFile(null)}
  />
)}
```

Also ensure that when switching views (entries/raw), the corresponding slide-over closes:

```tsx
// When switching to entries view, close raw file viewer
// When switching to raw view, close entry slide-over
function handleViewChange(newView: View) {
  setView(newView);
  if (newView === "entries") setSelectedFile(null);
  if (newView === "raw") setSelectedEntryId(null);
}
```

- [ ] **Step 3: Verify end-to-end**

```bash
pnpm dev
```

Test:
- Switch to "Raw Files" tab
- Click a file — viewer opens with parsed records
- Each record shows type/role/timestamp summary
- Click a record to expand — shows formatted JSON
- Toggle to "Raw" — shows plain JSONL text
- Close button and backdrop click work
- Switching between Entries/Raw views closes the active slide-over

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/components/knowledge/raw-files-list.tsx app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx
git commit -m "feat: wire up raw file viewer with click-to-view on raw files list"
```

---

## Post-Implementation Checklist

- [ ] Sidebar shows Knowledge > Claude (count), Git (count), Pipeline — no Sources sub-level
- [ ] Entry list has extractor, project, and date range filters
- [ ] Default date filter is "Last 7 days"
- [ ] Entries are grouped by project in collapsible accordions
- [ ] Group headers show short project name, entry count, and full path as tooltip
- [ ] Timestamps show date + time to the minute
- [ ] Entry slide-over renders markdown by default with rendered/raw toggle
- [ ] Raw files list is clickable — opens the raw file viewer
- [ ] Raw file viewer shows parsed JSONL records with expand/collapse
- [ ] Raw file viewer has parsed/raw toggle
- [ ] Better titles — no more "Untitled conversation" for messages with real content
