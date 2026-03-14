# Knowledge UI Improvements

Design spec for improving the Claude Transcripts source page UX: better entry browsing, JSONL raw file viewer, markdown rendering, project grouping, filtering, and sidebar cleanup.

## Overview

The initial implementation of the knowledge source pages provides basic functionality but needs UX polish. This spec covers improvements to make the Claude Transcripts page genuinely useful for browsing and understanding past work.

## Changes

### 1. Sidebar Cleanup

**Problem:** The sidebar Knowledge section is visually cluttered with too much nesting and long labels.

**Changes:**
- Rename "Claude Transcripts" to "Claude" in the sidebar
- Rename "Git History" to "Git"
- Remove the "Sources" sub-accordion level — show sources directly under Knowledge
- Tighten spacing and reduce visual noise

**Before:**
```
Knowledge ▼
  Sources ▼
    Claude Transcripts (142)
    Git History (89)
  ─────
  Pipeline
```

**After:**
```
Knowledge ▼
  Claude (142)
  Git (89)
  ─────
  Pipeline
```

One fewer nesting level. Shorter labels. Same information.

**Files:** `app/frontend/src/components/app-sidebar.tsx`

### 2. Group Entries by Project

**Problem:** All extracted entries are shown in a flat chronological list. When you have entries from multiple projects, it's hard to find what you're looking for.

**Changes:**
- Group entries by project name in collapsible accordion sections
- Each group header shows the short project name (e.g., "feynman") with full path as tooltip
- Groups are sorted by the most recent session within them (most recent first)
- Within each group, entries are sorted by timestamp descending (most recent first)
- Each entry shows a friendly timestamp: date and time to the minute (e.g., "Mar 14, 2:30 PM"), not just the date
- An "Ungrouped" section at the bottom for entries without a project

**Files:** `app/frontend/src/components/knowledge/source-entry-list.tsx`

### 3. Better Entry Titles

**Problem:** Many entries show as "Untitled conversation" or have raw command text as titles.

**Changes in the mechanical parser** (`parseClaudeStripTools` in `extraction.ts`):
- Strip leading slash commands (e.g., `/commit`, `/review`) from the first human message before using it as title
- Strip leading "can you", "please", "I want to" filler phrases
- Truncate at the first sentence boundary (period, question mark) rather than at a character count
- If the first human message is very short (< 10 chars after cleaning), use the second message or fall back to "Claude Code conversation"
- Capitalize the first letter

This is a parser change — re-extraction will produce better titles. Existing entries can be re-extracted by re-uploading (or running a manual extraction).

**Files:** `app/backend/convex/extraction.ts`

### 4. Project and Date Filters

**Problem:** The filter bar only has an extractor type dropdown. No way to filter by project or date range.

**Changes:**
- Add project dropdown filter — populated from distinct `projectName` values in the entries
- Add date range filter — dropdown with presets: "Last 7 days" (default), "Last 30 days", "Last 90 days", "All time"
- Filters apply before grouping — when a project filter is selected, only that project's group shows
- When a date filter is applied, entries outside the range are hidden

**Files:** `app/frontend/src/components/knowledge/source-entry-list.tsx`

### 5. Markdown Rendering in Slide-Over

**Problem:** Entry content in the slide-over panel is rendered as raw `<pre>` text. The content is formatted as markdown (with `###` headers, `---` dividers) but isn't rendered.

**Changes:**
- Install `react-markdown` (or a lightweight markdown renderer) in the frontend
- Default to rendered markdown view
- Add a toggle button in the slide-over header area (top-right): "Rendered" / "Raw"
- Raw view shows the existing `<pre>` format
- Rendered view uses markdown rendering with proper heading styles, code blocks, and dividers

**Files:**
- `app/frontend/src/components/knowledge/entry-slide-over.tsx`
- `app/frontend/package.json` (add `react-markdown`)

### 6. Raw File Viewer Slide-Over

**Problem:** The raw files list shows file metadata but there's no way to view the actual JSONL content.

**Changes:**
- Clicking a raw file in the Raw Files list opens a slide-over panel (same pattern as entry slide-over)
- The viewer fetches the file content from Convex storage via a query that returns a download URL
- Content is displayed with virtual scrolling for performance (full file loaded, only visible records rendered)
- Each JSONL record is parsed and displayed as a collapsible JSON block with:
  - Summary line showing record type, role, and timestamp
  - Expandable body showing the full JSON, syntax-highlighted
- Toggle in top-right: "Parsed" (default, collapsible records) / "Raw" (plain syntax-highlighted text)
- File metadata shown in the header: filename, size, upload date, extraction status

**New backend query needed:**
```typescript
// In rawFiles.ts
export const getDownloadUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
```

**Files:**
- Create: `app/frontend/src/components/knowledge/raw-file-viewer.tsx`
- Modify: `app/frontend/src/components/knowledge/raw-files-list.tsx` (add click handler)
- Modify: `app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx` (wire up viewer)
- Modify: `app/backend/convex/rawFiles.ts` (add getDownloadUrl query)

## Implementation Phases

### Phase 1: Quick wins (sidebar, filters, markdown, titles)
- Sidebar cleanup
- Project and date filters
- Markdown rendering with toggle
- Better title heuristic in parser

### Phase 2: Grouping and viewer
- Group by project with accordion
- Raw file viewer slide-over with virtual scroll
