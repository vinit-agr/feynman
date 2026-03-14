"use client";

import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  BookOpen,
  Film,
  Settings,
  MessageSquare,
  GitBranch,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";

export function AppSidebar() {
  const pathname = usePathname();

  const isKnowledgeRoute = pathname.startsWith("/knowledge");
  const isContentRoute = pathname.startsWith("/content");

  const [knowledgeOpen, setKnowledgeOpen] = useState(isKnowledgeRoute);
  const [contentOpen, setContentOpen] = useState(false);

  const claudeCount = useQuery(api.rawFiles.countBySource, {
    source: "claude-transcripts",
  });
  const gitCount = useQuery(api.rawFiles.countBySource, {
    source: "git-history",
  });

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-lg font-bold">Feynman</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu className="px-2 py-1 gap-0">
          {/* Dashboard */}
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/dashboard" />}
              isActive={pathname === "/dashboard"}
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Dashboard</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

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

          {/* Content accordion */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setContentOpen((o) => !o)}
              isActive={isContentRoute}
            >
              <Film className="h-4 w-4" />
              <span>Content</span>
              {contentOpen ? (
                <ChevronDown className="ml-auto h-4 w-4" />
              ) : (
                <ChevronRight className="ml-auto h-4 w-4" />
              )}
            </SidebarMenuButton>

            {contentOpen && (
              <SidebarMenuSub>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    render={<Link href="/content" />}
                    isActive={pathname === "/content"}
                  >
                    <ArrowRightLeft className="h-3 w-3" />
                    <span>Pipeline</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            )}
          </SidebarMenuItem>

          {/* Settings */}
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/settings" />}
              isActive={pathname === "/settings"}
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  );
}
