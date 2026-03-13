# Project Feynman — Phase 4 & 6 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Feynman frontend (dashboard, kanban pipelines, search) and add scheduled digest automation.

**Architecture:** Next.js App Router + shadcn/ui + @hello-pangea/dnd for kanban, Convex React hooks for real-time data, shared Convex project for full type safety. System theme (dark/light auto).

**Tech Stack:** Next.js 15, React 19, shadcn/ui, Tailwind CSS, @hello-pangea/dnd, Convex React client

---

## Phase 4: Next.js Frontend

### Task 9: Scaffold Next.js app with shadcn/ui and Convex provider

**Files:**
- Create: `app/frontend/` (via create-next-app)
- Create: `app/frontend/src/app/providers.tsx`
- Modify: `app/frontend/src/app/layout.tsx`
- Modify: `app/frontend/src/app/page.tsx`
- Modify: `app/frontend/tsconfig.json` (add backend path alias)

**Step 1: Scaffold Next.js app**

```bash
cd /Users/vinit/Tars/Content-Creation/video-creation/feynman/app/frontend
rm .gitkeep
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm
```

**Step 2: Install dependencies**

```bash
cd app/frontend
npm install convex @hello-pangea/dnd
npm install -D @types/react @types/react-dom
```

**Step 3: Initialize shadcn/ui**

```bash
cd app/frontend
npx shadcn@latest init
```

When prompted: style=default, base color=neutral, css variables=yes.

**Step 4: Add initial shadcn components**

```bash
cd app/frontend
npx shadcn@latest add button card badge tabs dialog dropdown-menu input scroll-area separator sheet tooltip avatar
```

**Step 5: Configure Convex shared project**

Update `app/frontend/tsconfig.json` to add a path alias for the backend Convex types:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@backend/*": ["../backend/*"]
    }
  }
}
```

Also update `app/frontend/next.config.ts` to transpile the backend package:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@feynman/backend"],
};

export default nextConfig;
```

**Step 6: Create app/frontend/src/app/providers.tsx**

```tsx
"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ConvexProvider client={convex}>{children}</ConvexProvider>
    </ThemeProvider>
  );
}
```

Also install next-themes:

```bash
npm install next-themes
```

**Step 7: Update app/frontend/src/app/layout.tsx**

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Feynman — Knowledge & Content Studio",
  description: "Personal knowledge management and content creation system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**Step 8: Create minimal landing page at app/frontend/src/app/page.tsx**

```tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Feynman</h1>
        <p className="text-muted-foreground text-lg">
          Knowledge &amp; Content Studio
        </p>
        <Link
          href="/dashboard"
          className="inline-block mt-4 px-6 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}
```

**Step 9: Verify it runs**

```bash
cd app/frontend && npm run dev
```

Open http://localhost:3000 — should see the landing page with system theme.

**Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js frontend with shadcn/ui and Convex provider"
```

---

### Task 10: Build app shell with Sidebar navigation

**Files:**
- Create: `app/frontend/src/components/app-sidebar.tsx`
- Create: `app/frontend/src/app/(app)/layout.tsx`
- Create: `app/frontend/src/app/(app)/dashboard/page.tsx` (placeholder)
- Create: `app/frontend/src/app/(app)/content/page.tsx` (placeholder)
- Create: `app/frontend/src/app/(app)/knowledge/page.tsx` (placeholder)
- Create: `app/frontend/src/app/(app)/search/page.tsx` (placeholder)

**Step 1: Add shadcn sidebar component**

```bash
cd app/frontend && npx shadcn@latest add sidebar
```

**Step 2: Create app/frontend/src/components/app-sidebar.tsx**

```tsx
"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { LayoutDashboard, Kanban, BookOpen, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Content Pipeline", href: "/content", icon: Kanban },
  { title: "Knowledge Pipeline", href: "/knowledge", icon: BookOpen },
  { title: "Search", href: "/search", icon: Search },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-lg font-bold">Feynman</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href}>
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
```

Also install lucide-react (icon library used by shadcn):

```bash
npm install lucide-react
```

**Step 3: Create app/frontend/src/app/(app)/layout.tsx**

This is the layout for all authenticated/app pages. Uses shadcn SidebarProvider.

```tsx
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <SidebarTrigger />
          </div>
          <div className="p-6">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
```

**Step 4: Create placeholder pages**

Create simple placeholder pages for each route:

`app/frontend/src/app/(app)/dashboard/page.tsx`:
```tsx
export default function DashboardPage() {
  return <div><h1 className="text-2xl font-bold">Dashboard</h1></div>;
}
```

`app/frontend/src/app/(app)/content/page.tsx`:
```tsx
export default function ContentPage() {
  return <div><h1 className="text-2xl font-bold">Content Pipeline</h1></div>;
}
```

`app/frontend/src/app/(app)/knowledge/page.tsx`:
```tsx
export default function KnowledgePage() {
  return <div><h1 className="text-2xl font-bold">Knowledge Pipeline</h1></div>;
}
```

`app/frontend/src/app/(app)/search/page.tsx`:
```tsx
export default function SearchPage() {
  return <div><h1 className="text-2xl font-bold">Search</h1></div>;
}
```

**Step 5: Verify navigation works**

```bash
cd app/frontend && npm run dev
```

Navigate to /dashboard, /content, /knowledge, /search. Sidebar should highlight the active route.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add app shell with sidebar navigation and route placeholders"
```

---

### Task 11: Build Dashboard page with digest view

**Files:**
- Create: `app/frontend/src/components/digest-card.tsx`
- Create: `app/frontend/src/components/pipeline-snapshot.tsx`
- Create: `app/frontend/src/components/recent-entries.tsx`
- Modify: `app/frontend/src/app/(app)/dashboard/page.tsx`

**Step 1: Create app/frontend/src/components/digest-card.tsx**

Displays the latest digest. Uses `useQuery` from Convex.

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const formatBadgeMap: Record<string, string> = {
  "talking-head": "bg-blue-500/10 text-blue-500",
  "ai-video": "bg-purple-500/10 text-purple-500",
  blog: "bg-green-500/10 text-green-500",
  "twitter-thread": "bg-sky-500/10 text-sky-500",
  "linkedin-post": "bg-indigo-500/10 text-indigo-500",
};

export function DigestCard() {
  const digest = useQuery(api.digests.getLatest);

  if (digest === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Weekly Digest</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (digest === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Weekly Digest</CardTitle>
          <CardDescription>
            No digest yet. Run the digest generation script to create your first one.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const dateRange = `${new Date(digest.startDate).toLocaleDateString()} — ${new Date(digest.endDate).toLocaleDateString()}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Digest</CardTitle>
        <CardDescription>{dateRange}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Activity Summary */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
            Activity Summary
          </h3>
          <p className="text-sm whitespace-pre-line">{digest.activitySummary}</p>
        </div>

        <Separator />

        {/* Key Themes */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
            Key Themes
          </h3>
          <div className="flex flex-wrap gap-2">
            {digest.keyThemes.map((theme, i) => (
              <Badge key={i} variant="secondary">
                {theme}
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* Content Ideas */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
            Content Ideas
          </h3>
          <div className="space-y-3">
            {digest.contentIdeas.map((idea, i) => (
              <div
                key={i}
                className="rounded-lg border p-3 space-y-1"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{idea.title}</span>
                  <Badge
                    variant="outline"
                    className={formatBadgeMap[idea.format] || ""}
                  >
                    {idea.format}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {idea.reasoning}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Knowledge Gaps */}
        {digest.knowledgeGaps && digest.knowledgeGaps.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                Knowledge Gaps
              </h3>
              <ul className="list-disc list-inside text-sm space-y-1">
                {digest.knowledgeGaps.map((gap, i) => (
                  <li key={i} className="text-muted-foreground">
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {/* Notable Saves */}
        {digest.notableSaves && digest.notableSaves.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                Notable Saves
              </h3>
              <ul className="list-disc list-inside text-sm space-y-1">
                {digest.notableSaves.map((save, i) => (
                  <li key={i} className="text-muted-foreground">
                    {save}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

**Step 2: Create app/frontend/src/components/pipeline-snapshot.tsx**

Shows count of items per stage across both pipelines.

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const contentStages = [
  "ideas", "researching", "scripting", "production",
  "editing", "review", "published", "archive",
] as const;

const knowledgeStages = [
  "ideas", "researching", "learning", "curated",
] as const;

function countByStage<T extends { stage: string }>(
  items: T[] | undefined,
  stages: readonly string[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stage of stages) counts[stage] = 0;
  if (!items) return counts;
  for (const item of items) {
    if (counts[item.stage] !== undefined) counts[item.stage]++;
  }
  return counts;
}

function StageRow({ label, counts }: { label: string; counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">{total} total</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(counts).map(([stage, count]) => (
          <div key={stage} className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground capitalize">{stage}</span>
            <Badge variant={count > 0 ? "default" : "outline"} className="text-xs">
              {count}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PipelineSnapshot() {
  const contentItems = useQuery(api.contentPipeline.list, {});
  const knowledgeItems = useQuery(api.knowledgePipeline.list, {});

  const contentCounts = countByStage(contentItems, contentStages);
  const knowledgeCounts = countByStage(knowledgeItems, knowledgeStages);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline Snapshot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <StageRow label="Content Pipeline" counts={contentCounts} />
        <StageRow label="Knowledge Pipeline" counts={knowledgeCounts} />
      </CardContent>
    </Card>
  );
}
```

**Step 3: Create app/frontend/src/components/recent-entries.tsx**

Shows latest knowledge entries.

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

const sourceIcons: Record<string, string> = {
  "claude-transcripts": "CC",
  "git-commit": "Git",
  youtube: "YT",
  twitter: "X",
  telegram: "TG",
};

export function RecentEntries() {
  const entries = useQuery(api.knowledgeEntries.list, { limit: 15 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Knowledge Entries</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          {entries === undefined ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No entries yet. Run an ingestion script to populate.
            </p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry._id}
                  className="rounded-lg border p-3 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">
                      {sourceIcons[entry.source] || entry.source}
                    </Badge>
                    <span className="text-sm font-medium truncate flex-1">
                      {entry.title}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleDateString()} —{" "}
                    {entry.content.slice(0, 150)}
                    {entry.content.length > 150 ? "..." : ""}
                  </p>
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {entry.tags.slice(0, 5).map((tag: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
```

**Step 4: Compose the Dashboard page**

Update `app/frontend/src/app/(app)/dashboard/page.tsx`:

```tsx
import { DigestCard } from "@/components/digest-card";
import { PipelineSnapshot } from "@/components/pipeline-snapshot";
import { RecentEntries } from "@/components/recent-entries";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DigestCard />
        </div>
        <div className="space-y-6">
          <PipelineSnapshot />
          <RecentEntries />
        </div>
      </div>
    </div>
  );
}
```

**Step 5: Verify dashboard renders**

```bash
cd app/frontend && npm run dev
```

Navigate to /dashboard. Components should render (showing empty states if Convex has no data yet).

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add dashboard page with digest view and pipeline snapshot"
```

---

### Task 12: Build Content Pipeline kanban page

**Files:**
- Create: `app/frontend/src/components/kanban/kanban-board.tsx`
- Create: `app/frontend/src/components/kanban/kanban-column.tsx`
- Create: `app/frontend/src/components/content/content-card.tsx`
- Create: `app/frontend/src/components/content/content-detail-dialog.tsx`
- Create: `app/frontend/src/components/content/create-content-dialog.tsx`
- Modify: `app/frontend/src/app/(app)/content/page.tsx`

**Step 1: Create app/frontend/src/components/kanban/kanban-board.tsx**

Generic kanban board using @hello-pangea/dnd:

```tsx
"use client";

import { DragDropContext, DropResult } from "@hello-pangea/dnd";
import { KanbanColumn } from "./kanban-column";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { ReactNode } from "react";

export interface KanbanColumnConfig {
  id: string;
  title: string;
}

interface KanbanBoardProps {
  columns: KanbanColumnConfig[];
  itemsByColumn: Record<string, any[]>;
  onDragEnd: (result: DropResult) => void;
  renderCard: (item: any) => ReactNode;
  onAddItem?: (columnId: string) => void;
}

export function KanbanBoard({
  columns,
  itemsByColumn,
  onDragEnd,
  renderCard,
  onAddItem,
}: KanbanBoardProps) {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4" style={{ minWidth: columns.length * 280 }}>
          {columns.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              items={itemsByColumn[col.id] || []}
              renderCard={renderCard}
              onAddItem={onAddItem ? () => onAddItem(col.id) : undefined}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </DragDropContext>
  );
}
```

**Step 2: Create app/frontend/src/components/kanban/kanban-column.tsx**

```tsx
"use client";

import { Droppable, Draggable } from "@hello-pangea/dnd";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus } from "lucide-react";
import { ReactNode } from "react";

interface KanbanColumnProps {
  id: string;
  title: string;
  items: any[];
  renderCard: (item: any) => ReactNode;
  onAddItem?: () => void;
}

export function KanbanColumn({
  id,
  title,
  items,
  renderCard,
  onAddItem,
}: KanbanColumnProps) {
  return (
    <div className="flex flex-col w-[270px] min-w-[270px] bg-muted/50 rounded-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold capitalize">{title}</span>
          <Badge variant="secondary" className="text-xs">
            {items.length}
          </Badge>
        </div>
        {onAddItem && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onAddItem}>
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>
      <Droppable droppableId={id}>
        {(provided, snapshot) => (
          <ScrollArea className="flex-1">
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`p-2 space-y-2 min-h-[200px] ${
                snapshot.isDraggingOver ? "bg-accent/50" : ""
              }`}
            >
              {items.map((item, index) => (
                <Draggable
                  key={item._id}
                  draggableId={item._id}
                  index={index}
                >
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={snapshot.isDragging ? "opacity-75" : ""}
                    >
                      {renderCard(item)}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          </ScrollArea>
        )}
      </Droppable>
    </div>
  );
}
```

**Step 3: Create app/frontend/src/components/content/content-card.tsx**

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const formatColors: Record<string, string> = {
  "talking-head": "bg-blue-500/10 text-blue-500 border-blue-500/20",
  "ai-video": "bg-purple-500/10 text-purple-500 border-purple-500/20",
  blog: "bg-green-500/10 text-green-500 border-green-500/20",
  "twitter-thread": "bg-sky-500/10 text-sky-500 border-sky-500/20",
  "linkedin-post": "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  other: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

interface ContentCardProps {
  item: {
    _id: string;
    title: string;
    format: string;
    description?: string;
    tags?: string[];
    autoPopulated?: boolean;
    createdAt: number;
  };
  onClick: (id: string) => void;
}

export function ContentCard({ item, onClick }: ContentCardProps) {
  return (
    <Card
      className="p-3 cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onClick(item._id)}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight line-clamp-2">
            {item.title}
          </span>
          {item.autoPopulated && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              auto
            </Badge>
          )}
        </div>
        <Badge variant="outline" className={`text-xs ${formatColors[item.format] || ""}`}>
          {item.format}
        </Badge>
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          {new Date(item.createdAt).toLocaleDateString()}
        </p>
      </div>
    </Card>
  );
}
```

**Step 4: Create app/frontend/src/components/content/content-detail-dialog.tsx**

Dialog for viewing and editing a content item.

```tsx
"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Id } from "@backend/convex/_generated/dataModel";

const stages = [
  "ideas", "researching", "scripting", "production",
  "editing", "review", "published", "archive",
] as const;

const formats = [
  "talking-head", "ai-video", "blog",
  "twitter-thread", "linkedin-post", "other",
] as const;

interface ContentDetailDialogProps {
  itemId: string | null;
  open: boolean;
  onClose: () => void;
}

export function ContentDetailDialog({
  itemId,
  open,
  onClose,
}: ContentDetailDialogProps) {
  const items = useQuery(api.contentPipeline.list, {});
  const updateItem = useMutation(api.contentPipeline.update);
  const updateStage = useMutation(api.contentPipeline.updateStage);
  const removeItem = useMutation(api.contentPipeline.remove);

  const item = items?.find((i) => i._id === itemId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [script, setScript] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (item) {
      setTitle(item.title || "");
      setDescription(item.description || "");
      setScript(item.script || "");
      setNotes(item.notes || "");
    }
  }, [item]);

  if (!item) return null;

  async function handleSave() {
    if (!itemId) return;
    await updateItem({
      id: itemId as Id<"contentItems">,
      title,
      description: description || undefined,
      script: script || undefined,
      notes: notes || undefined,
    });
    onClose();
  }

  async function handleStageChange(newStage: typeof stages[number]) {
    if (!itemId) return;
    await updateStage({
      id: itemId as Id<"contentItems">,
      stage: newStage,
    });
  }

  async function handleDelete() {
    if (!itemId) return;
    await removeItem({ id: itemId as Id<"contentItems"> });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-lg font-bold border-none px-0 focus-visible:ring-0"
            />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stage selector */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Stage</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {stages.map((s) => (
                <Badge
                  key={s}
                  variant={item.stage === s ? "default" : "outline"}
                  className="cursor-pointer capitalize"
                  onClick={() => handleStageChange(s)}
                >
                  {s}
                </Badge>
              ))}
            </div>
          </div>

          {/* Format display */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Format</label>
            <div className="mt-1">
              <Badge variant="secondary" className="capitalize">
                {item.format}
              </Badge>
            </div>
          </div>

          <Separator />

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this content about?"
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[60px] resize-y"
            />
          </div>

          {/* Script/Outline */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Script / Outline</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Write your script or outline here..."
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[200px] resize-y font-mono"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[60px] resize-y"
            />
          </div>

          <Separator />

          <div className="flex justify-between">
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 5: Create app/frontend/src/components/content/create-content-dialog.tsx**

```tsx
"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const formats = [
  "talking-head", "ai-video", "blog",
  "twitter-thread", "linkedin-post", "other",
] as const;

type Format = typeof formats[number];

interface CreateContentDialogProps {
  open: boolean;
  onClose: () => void;
  defaultStage?: string;
}

export function CreateContentDialog({
  open,
  onClose,
  defaultStage = "ideas",
}: CreateContentDialogProps) {
  const createItem = useMutation(api.contentPipeline.create);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<Format>("blog");
  const [description, setDescription] = useState("");

  async function handleCreate() {
    if (!title.trim()) return;
    await createItem({
      stage: defaultStage as any,
      title: title.trim(),
      format,
      description: description || undefined,
    });
    setTitle("");
    setDescription("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Content Idea</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Format</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {formats.map((f) => (
                <Badge
                  key={f}
                  variant={format === f ? "default" : "outline"}
                  className="cursor-pointer capitalize"
                  onClick={() => setFormat(f)}
                >
                  {f}
                </Badge>
              ))}
            </div>
          </div>
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[60px] resize-y"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!title.trim()}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 6: Compose the Content Pipeline page**

Update `app/frontend/src/app/(app)/content/page.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { KanbanBoard, KanbanColumnConfig } from "@/components/kanban/kanban-board";
import { ContentCard } from "@/components/content/content-card";
import { ContentDetailDialog } from "@/components/content/content-detail-dialog";
import { CreateContentDialog } from "@/components/content/create-content-dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { DropResult } from "@hello-pangea/dnd";
import type { Id } from "@backend/convex/_generated/dataModel";

const columns: KanbanColumnConfig[] = [
  { id: "ideas", title: "Ideas" },
  { id: "researching", title: "Researching" },
  { id: "scripting", title: "Scripting" },
  { id: "production", title: "Production" },
  { id: "editing", title: "Editing" },
  { id: "review", title: "Review" },
  { id: "published", title: "Published" },
  { id: "archive", title: "Archive" },
];

export default function ContentPage() {
  const items = useQuery(api.contentPipeline.list, {});
  const updateStage = useMutation(api.contentPipeline.updateStage);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStage, setCreateStage] = useState("ideas");

  const itemsByColumn: Record<string, any[]> = {};
  for (const col of columns) itemsByColumn[col.id] = [];
  if (items) {
    for (const item of items) {
      if (itemsByColumn[item.stage]) {
        itemsByColumn[item.stage].push(item);
      }
    }
  }

  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId, destination } = result;
      if (!destination) return;
      const newStage = destination.droppableId;
      await updateStage({
        id: draggableId as Id<"contentItems">,
        stage: newStage as any,
      });
    },
    [updateStage]
  );

  function handleCardClick(id: string) {
    setSelectedItemId(id);
    setDetailOpen(true);
  }

  function handleAddItem(columnId: string) {
    setCreateStage(columnId);
    setCreateOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Content Pipeline</h1>
        <Button onClick={() => { setCreateStage("ideas"); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" />
          Add Idea
        </Button>
      </div>

      <KanbanBoard
        columns={columns}
        itemsByColumn={itemsByColumn}
        onDragEnd={handleDragEnd}
        renderCard={(item) => (
          <ContentCard item={item} onClick={handleCardClick} />
        )}
        onAddItem={handleAddItem}
      />

      <ContentDetailDialog
        itemId={selectedItemId}
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setSelectedItemId(null); }}
      />

      <CreateContentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultStage={createStage}
      />
    </div>
  );
}
```

**Step 7: Verify the kanban renders**

```bash
cd app/frontend && npm run dev
```

Navigate to /content. Board should render 8 columns. Try adding an item via the "Add Idea" button.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add content pipeline kanban page with drag-and-drop"
```

---

### Task 13: Build Knowledge Pipeline kanban page

**Files:**
- Create: `app/frontend/src/components/knowledge/knowledge-card.tsx`
- Create: `app/frontend/src/components/knowledge/knowledge-detail-dialog.tsx`
- Create: `app/frontend/src/components/knowledge/create-knowledge-dialog.tsx`
- Modify: `app/frontend/src/app/(app)/knowledge/page.tsx`

**Step 1: Create app/frontend/src/components/knowledge/knowledge-card.tsx**

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface KnowledgeCardProps {
  item: {
    _id: string;
    topic: string;
    description?: string;
    tags?: string[];
    linkedEntryIds?: string[];
    createdAt: number;
  };
  onClick: (id: string) => void;
}

export function KnowledgeCard({ item, onClick }: KnowledgeCardProps) {
  return (
    <Card
      className="p-3 cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onClick(item._id)}
    >
      <div className="space-y-2">
        <span className="text-sm font-medium leading-tight line-clamp-2">
          {item.topic}
        </span>
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {item.linkedEntryIds && item.linkedEntryIds.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {item.linkedEntryIds.length} linked entries
          </p>
        )}
      </div>
    </Card>
  );
}
```

**Step 2: Create app/frontend/src/components/knowledge/knowledge-detail-dialog.tsx**

Similar structure to ContentDetailDialog but with:
- Topic, description, notes fields
- Stage selector (ideas, researching, learning, curated)
- "Promote to Content" button on curated items — opens a format picker then calls `contentPipeline.promoteFromKnowledge`
- Save, delete, cancel actions

Use the same pattern as `content-detail-dialog.tsx` but adapted for knowledge item fields and the promote action.

**Step 3: Create app/frontend/src/components/knowledge/create-knowledge-dialog.tsx**

Simple dialog with topic input and optional description. Calls `knowledgePipeline.create`.

**Step 4: Compose the Knowledge Pipeline page**

Update `app/frontend/src/app/(app)/knowledge/page.tsx`:

Same pattern as content page but with 4 columns: Ideas, Researching, Learning, Curated. Uses `knowledgePipeline.list`, `knowledgePipeline.updateStage`, KnowledgeCard, KnowledgeDetailDialog.

**Step 5: Verify**

```bash
cd app/frontend && npm run dev
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add knowledge pipeline kanban page with promote-to-content"
```

---

### Task 14: Build Search page

**Files:**
- Create: `app/frontend/src/components/search/search-results.tsx`
- Create: `app/frontend/src/components/search/entry-card.tsx`
- Create: `app/frontend/src/hooks/use-debounce.ts`
- Modify: `app/frontend/src/app/(app)/search/page.tsx`

**Step 1: Create app/frontend/src/hooks/use-debounce.ts**

```tsx
import { useState, useEffect } from "react";

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}
```

**Step 2: Create app/frontend/src/components/search/entry-card.tsx**

Expandable card showing: source badge, title, content snippet, timestamp, tags. Click to expand full content. Has "Add to Knowledge Pipeline" and "Add to Content Pipeline" action buttons.

```tsx
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

interface EntryCardProps {
  entry: {
    _id: string;
    source: string;
    title: string;
    content: string;
    timestamp: number;
    tags?: string[];
    url?: string;
  };
}

export function EntryCard({ entry }: EntryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Badge variant="outline" className="text-xs font-mono shrink-0">
            {entry.source}
          </Badge>
          <span className="text-sm font-medium">{entry.title}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {new Date(entry.timestamp).toLocaleDateString()}
        {entry.url && (
          <>
            {" — "}
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              source
            </a>
          </>
        )}
      </p>

      {!expanded && (
        <p className="text-sm text-muted-foreground line-clamp-3">
          {entry.content.slice(0, 300)}
          {entry.content.length > 300 ? "..." : ""}
        </p>
      )}

      {expanded && (
        <div className="text-sm whitespace-pre-wrap max-h-[500px] overflow-y-auto border rounded-md p-3 bg-muted/30">
          {entry.content}
        </div>
      )}

      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
```

**Step 3: Compose the Search page**

Update `app/frontend/src/app/(app)/search/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { EntryCard } from "@/components/search/entry-card";
import { useDebounce } from "@/hooks/use-debounce";
import { Search as SearchIcon } from "lucide-react";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  // Only search when we have at least 2 characters
  const results = useQuery(
    api.knowledgeEntries.search,
    debouncedQuery.length >= 2 ? { query: debouncedQuery } : "skip"
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Search</h1>

      <div className="relative max-w-xl">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search across all knowledge entries..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>

      {debouncedQuery.length < 2 && (
        <p className="text-sm text-muted-foreground">
          Type at least 2 characters to search.
        </p>
      )}

      {results !== undefined && results.length === 0 && debouncedQuery.length >= 2 && (
        <p className="text-sm text-muted-foreground">
          No results found for &quot;{debouncedQuery}&quot;.
        </p>
      )}

      {results && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          {results.map((entry) => (
            <EntryCard key={entry._id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Verify**

```bash
cd app/frontend && npm run dev
```

Navigate to /search, type a query. Results should appear (if Convex has data).

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add search page with debounced full-text search"
```

---

## Phase 6: Scheduled Digest Automation

### Task 15: Create Convex action for digest generation

**Files:**
- Create: `app/backend/convex/digestAction.ts`

This moves the digest generation logic into a Convex action so it can be triggered by cron or manually from the dashboard.

**Step 1: Install Anthropic SDK in the backend**

The backend package needs `@anthropic-ai/sdk` to call Claude from within Convex actions.

```bash
cd app/backend && npm install @anthropic-ai/sdk
```

**Step 2: Create app/backend/convex/digestAction.ts**

```typescript
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_DAYS_BACK = 7;
const MAX_CONTENT_PER_ENTRY = 2000;
const MAX_ENTRIES_PER_SOURCE = 50;

function buildSystemPrompt(): string {
  return `You are a personal content strategist and knowledge synthesizer for a builder who creates authentic content based on their real work.

Your job is to analyze recent knowledge entries — code conversations, git commits, bookmarks, notes — and produce a structured weekly digest.

Philosophy:
- "Building in public" — sharing learnings, process, and honest reflections
- Authenticity over polish — real experiences resonate more than manufactured content
- Content should emerge naturally from the work, not be forced
- Match format to content: complex technical deep-dives → blog posts or talking-head videos, fun experiments → AI-animated videos, quick insights → twitter threads, professional reflections → LinkedIn posts

Respond with ONLY a valid JSON object (no markdown code fences):
{
  "activitySummary": "2-3 paragraphs summarizing what was worked on",
  "keyThemes": ["3-5 recurring topics or themes"],
  "contentIdeas": [{"title": "...", "format": "talking-head | ai-video | blog | twitter-thread | linkedin-post", "reasoning": "..."}],
  "knowledgeGaps": ["2-3 areas explored but not fully resolved"],
  "notableSaves": ["Interesting bookmarks or references worth highlighting"],
  "rawMarkdown": "Full digest formatted as readable markdown"
}`;
}

export const generateWeekly = action({
  args: {
    daysBack: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const daysBack = args.daysBack ?? DEFAULT_DAYS_BACK;
    const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    // Query recent entries
    const entries: any[] = await ctx.runQuery(
      internal.knowledgeEntries.getRecent,
      { since }
    );

    if (entries.length === 0) {
      return "No entries found for the specified period.";
    }

    // Group and format entries for prompt
    const grouped: Record<string, any[]> = {};
    for (const entry of entries) {
      if (!grouped[entry.source]) grouped[entry.source] = [];
      grouped[entry.source].push(entry);
    }

    let entriesText = "";
    for (const [source, sourceEntries] of Object.entries(grouped)) {
      const capped = sourceEntries.slice(0, MAX_ENTRIES_PER_SOURCE);
      entriesText += `\n## Source: ${source} (${capped.length} entries)\n\n`;
      for (const entry of capped) {
        entriesText += `### ${entry.title}\n`;
        const content = entry.content.length > MAX_CONTENT_PER_ENTRY
          ? entry.content.slice(0, MAX_CONTENT_PER_ENTRY) + "..."
          : entry.content;
        entriesText += `${content}\n\n---\n\n`;
      }
    }

    // Call Claude API
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [{
        role: "user",
        content: `Here are my knowledge entries from the past ${daysBack} days. Total: ${entries.length} entries.\n\n${entriesText}`,
      }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude API");
    }

    // Parse JSON
    let digest: any;
    try {
      digest = JSON.parse(textBlock.text);
    } catch {
      const match = textBlock.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Failed to parse Claude response as JSON");
      digest = JSON.parse(match[0]);
    }

    // Store digest
    await ctx.runMutation(internal.digests.create, {
      startDate: since,
      endDate: Date.now(),
      activitySummary: digest.activitySummary,
      keyThemes: digest.keyThemes,
      contentIdeas: digest.contentIdeas,
      knowledgeGaps: digest.knowledgeGaps || [],
      notableSaves: digest.notableSaves || [],
      rawMarkdown: digest.rawMarkdown,
    });

    return digest.rawMarkdown;
  },
});
```

**Step 3: Update knowledgeEntries.ts and digests.ts to export internal functions**

The action above uses `internal.knowledgeEntries.getRecent` and `internal.digests.create`. These need to be exported as `internalQuery` / `internalMutation` (or the existing exports work if the action uses `api` instead of `internal`).

Option: Change the action to use `ctx.runQuery(api.knowledgeEntries.getRecent, ...)` — this works with the existing public exports.

Alternatively, add internal versions. The simplest approach: use the existing public functions via `api` imports instead of `internal`.

Update the action to import `api` instead of `internal`:
```typescript
import { api } from "./_generated/api";
```

And use:
```typescript
const entries = await ctx.runQuery(api.knowledgeEntries.getRecent, { since });
await ctx.runMutation(api.digests.create, { ... });
```

**Step 4: Verify the action compiles**

```bash
cd app/backend && npx convex dev --once
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Convex action for digest generation via Claude API"
```

---

### Task 16: Add Convex cron for weekly digest

**Files:**
- Create: `app/backend/convex/crons.ts`

**Step 1: Create app/backend/convex/crons.ts**

```typescript
import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Generate weekly digest every Friday at 23:00 UTC (~6 PM ET)
crons.weekly(
  "weekly-digest",
  { dayOfWeek: "friday", hourUTC: 23, minuteUTC: 0 },
  api.digestAction.generateWeekly,
  {}
);

export default crons;
```

**Step 2: Add environment variable for Anthropic API key in Convex**

The Convex action needs `ANTHROPIC_API_KEY`. Set it via the Convex dashboard or CLI:

```bash
cd app/backend && npx convex env set ANTHROPIC_API_KEY <your-key>
```

**Step 3: Deploy and verify**

```bash
cd app/backend && npx convex dev --once
```

Check Convex dashboard — the cron should be visible.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add weekly digest cron job (Friday 6 PM ET)"
```

---

### Task 17: Add "Generate Digest" button to dashboard

**Files:**
- Modify: `app/frontend/src/app/(app)/dashboard/page.tsx`

**Step 1: Add a quick action button to the dashboard**

Add a "Generate Digest Now" button that calls the `digestAction.generateWeekly` action with a custom days parameter. Use `useMutation` (for actions: `useAction` from Convex React).

```tsx
import { useAction } from "convex/react";
import { api } from "@backend/convex/_generated/api";

// Inside the dashboard component:
const generateDigest = useAction(api.digestAction.generateWeekly);
const [generating, setGenerating] = useState(false);

async function handleGenerateDigest() {
  setGenerating(true);
  try {
    await generateDigest({ daysBack: 7 });
  } finally {
    setGenerating(false);
  }
}
```

Add a button in the dashboard header:

```tsx
<Button onClick={handleGenerateDigest} disabled={generating}>
  {generating ? "Generating..." : "Generate Digest"}
</Button>
```

**Step 2: Verify**

```bash
cd app/frontend && npm run dev
```

Click "Generate Digest" — should call the Convex action and the digest card should update reactively.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add generate-digest-now button to dashboard"
```

---

## Implementation Priority Summary

| Task | Description | Dependencies |
|------|-------------|-------------|
| 9 | Scaffold Next.js + shadcn/ui + Convex provider | None |
| 10 | App shell with sidebar navigation | Task 9 |
| 11 | Dashboard with digest view | Task 10 |
| 12 | Content Pipeline kanban | Task 10 |
| 13 | Knowledge Pipeline kanban | Task 10, reuses kanban from 12 |
| 14 | Search page | Task 10 |
| 15 | Convex digest action | None (backend only) |
| 16 | Weekly cron job | Task 15 |
| 17 | Dashboard "Generate Now" button | Task 11, Task 15 |

Tasks 12, 13, 14 are independent of each other — they can be implemented in any order after Task 10.
Tasks 15-16 (backend) are independent of Tasks 11-14 (frontend) — they can be done in parallel.
