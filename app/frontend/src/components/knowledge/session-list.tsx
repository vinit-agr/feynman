"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Plus, MoreHorizontal } from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import type { Id } from "@backend/convex/_generated/dataModel";

interface SessionListProps {
  source: string;
  onSessionClick: (rawFile: any) => void;
  selectedSessionId?: string;
}

function formatFriendlyDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type FileStatus = "uploaded" | "extracting" | "extracted" | "failed";

function statusDotColor(status: FileStatus): string {
  switch (status) {
    case "uploaded": return "bg-yellow-500";
    case "extracting": return "bg-blue-500";
    case "extracted": return "bg-green-500";
    case "failed": return "bg-red-500";
    default: return "bg-gray-400";
  }
}

export function SessionList({
  source,
  onSessionClick,
  selectedSessionId,
}: SessionListProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const projects = useQuery(api.projects.listBySource, { source });
  const ungroupedFiles = useQuery(api.rawFiles.listUngrouped, { source });
  const createProject = useMutation(api.projects.create);
  const renameProject = useMutation(api.projects.rename);
  const deleteProject = useMutation(api.projects.remove);

  const projectList = projects ?? [];
  const ungroupedList = ungroupedFiles ?? [];

  // Auto-expand all groups on first load
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && projectList.length > 0) {
      setOpenGroups(new Set(projectList.map((p: any) => p._id)));
      initializedRef.current = true;
    }
  }, [projectList.length]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateProject() {
    const name = prompt("Project name:");
    if (!name?.trim()) return;
    await createProject({ name: name.trim(), source });
  }

  async function handleRenameSubmit(projectId: string) {
    if (renameValue.trim()) {
      await renameProject({
        projectId: projectId as Id<"projects">,
        newName: renameValue.trim(),
      });
    }
    setRenamingProject(null);
  }

  async function handleDeleteProject(projectId: string, projectName: string, sessionCount: number) {
    const confirmed = confirm(
      `Delete project '${projectName}' and its ${sessionCount} sessions? All transcripts will be hidden and extracted content will be removed. Transcripts can be recovered later, but extraction will need to be re-run.`
    );
    if (!confirmed) return;
    await deleteProject({ projectId: projectId as Id<"projects"> });
  }

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {projectList.length} {projectList.length === 1 ? "project" : "projects"}
        </span>
        <button
          onClick={handleCreateProject}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded-md hover:bg-accent transition-colors"
        >
          <Plus className="h-3 w-3" />
          New Project
        </button>
      </div>

      {/* Project groups */}
      <div className="space-y-2">
        {projectList.map((project: any) => (
          <ProjectAccordion
            key={project._id}
            project={project}
            isOpen={openGroups.has(project._id)}
            onToggle={() => toggleGroup(project._id)}
            onSessionClick={onSessionClick}
            selectedSessionId={selectedSessionId}
            isRenaming={renamingProject === project._id}
            renameValue={renameValue}
            onStartRename={() => {
              setRenamingProject(project._id);
              setRenameValue(project.name);
            }}
            onRenameChange={setRenameValue}
            onRenameSubmit={() => handleRenameSubmit(project._id)}
            onRenameCancel={() => setRenamingProject(null)}
            onDelete={(count) => handleDeleteProject(project._id, project.name, count)}
          />
        ))}

        {/* Ungrouped section */}
        {ungroupedList.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleGroup("ungrouped")}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            >
              {openGroups.has("ungrouped") ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-muted-foreground italic">
                Ungrouped
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {ungroupedList.length} {ungroupedList.length === 1 ? "session" : "sessions"}
              </span>
            </button>
            {openGroups.has("ungrouped") && (
              <div className="divide-y">
                {ungroupedList.map((file: any) => (
                  <SessionRow
                    key={file._id}
                    file={file}
                    onClick={() => onSessionClick(file)}
                    isSelected={selectedSessionId === file._id}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {projectList.length === 0 && ungroupedList.length === 0 && (
        <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No sessions found. Run ingestion to populate.
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

interface ProjectAccordionProps {
  project: any;
  isOpen: boolean;
  onToggle: () => void;
  onSessionClick: (file: any) => void;
  selectedSessionId?: string;
  isRenaming: boolean;
  renameValue: string;
  onStartRename: () => void;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDelete: (sessionCount: number) => void;
}

function ProjectAccordion({
  project,
  isOpen,
  onToggle,
  onSessionClick,
  selectedSessionId,
  isRenaming,
  renameValue,
  onStartRename,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
}: ProjectAccordionProps) {
  const files = useQuery(api.rawFiles.listByProject, {
    projectId: project._id as Id<"projects">,
  });
  const fileList = files ?? [];

  // Batch lookup of extraction titles for session display
  const titleMap = useQuery(
    api.knowledgeEntries.getTitlesByRawFileIds,
    fileList.length > 0
      ? { rawFileIds: fileList.map((f: any) => f._id) }
      : "skip"
  ) as Record<string, string> | undefined;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 text-left">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameSubmit();
                if (e.key === "Escape") onRenameCancel();
              }}
              className="text-sm font-medium bg-background border rounded px-1.5 py-0.5 w-48"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium">{project.name}</span>
          )}
        </button>
        <span className="text-xs text-muted-foreground">
          {fileList.length} {fileList.length === 1 ? "session" : "sessions"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onStartRename(); }}
            className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent transition-colors"
          >
            Rename
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(fileList.length); }}
            className="text-xs text-destructive hover:text-destructive/80 px-1.5 py-0.5 rounded hover:bg-destructive/10 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Sessions */}
      {isOpen && (
        <div className="divide-y">
          {fileList.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground italic">
              No sessions in this project
            </div>
          ) : (
            fileList.map((file: any) => (
              <SessionRow
                key={file._id}
                file={file}
                onClick={() => onSessionClick(file)}
                isSelected={selectedSessionId === file._id}
                displayTitle={titleMap?.[file._id]}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface SessionRowProps {
  file: any;
  onClick: () => void;
  isSelected: boolean;
  displayTitle?: string;
}

function SessionRow({ file, onClick, isSelected, displayTitle }: SessionRowProps) {
  const title = displayTitle ?? file.fileName;

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors ${
        isSelected ? "bg-accent" : ""
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(file.status)}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{title}</p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatFriendlyDate(file.timestamp)}
      </span>
    </div>
  );
}
