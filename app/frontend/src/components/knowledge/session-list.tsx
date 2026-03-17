"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Plus, MoreHorizontal } from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import type { Id } from "@backend/convex/_generated/dataModel";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: any;
    title: string;
  } | null>(null);

  const projects = useQuery(api.projects.listBySource, { source });
  const ungroupedFiles = useQuery(api.rawFiles.listUngrouped, { source });
  const createProject = useMutation(api.projects.create);
  const renameProject = useMutation(api.projects.rename);
  const deleteProject = useMutation(api.projects.remove);
  const reorderProjects = useMutation(api.projects.reorder);
  const moveToProject = useMutation(api.rawFiles.moveToProject);
  const softDeleteFile = useMutation(api.rawFiles.softDelete);

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

  async function handleDragEnd(result: DropResult) {
    const { draggableId, destination, source: dragSource, type } = result;
    if (!destination) return;

    if (type === "project") {
      // Reorder projects
      const newOrder = Array.from(projectList);
      const [moved] = newOrder.splice(dragSource.index, 1);
      newOrder.splice(destination.index, 0, moved);
      await reorderProjects({
        projectIds: newOrder.map((p: any) => p._id),
      });
    } else {
      // Move session between projects
      const targetProjectId = destination.droppableId;
      if (targetProjectId === "ungrouped") return;

      await moveToProject({
        rawFileId: draggableId as Id<"rawFiles">,
        projectId: targetProjectId as Id<"projects">,
      });
    }
  }

  async function handleDeleteProject(projectId: string, projectName: string, sessionCount: number) {
    const confirmed = confirm(
      `Delete project '${projectName}' and its ${sessionCount} sessions? All transcripts will be hidden and extracted content will be removed. Transcripts can be recovered later, but extraction will need to be re-run.`
    );
    if (!confirmed) return;
    await deleteProject({ projectId: projectId as Id<"projects"> });
  }

  const renameSession = useMutation(api.rawFiles.renameSession);

  async function handleContextRename(rawFileId: string, currentTitle: string) {
    const newName = prompt("Rename session:", currentTitle);
    if (newName === null || !newName.trim()) return;
    await renameSession({
      rawFileId: rawFileId as Id<"rawFiles">,
      displayName: newName.trim(),
    });
  }

  async function handleContextDelete(rawFileId: string, fileName: string) {
    const confirmed = confirm(
      `Delete session '${fileName}'? The transcript will be hidden and extracted content will be removed. You can recover the transcript later, but extraction will need to be re-run.`
    );
    if (!confirmed) return;
    await softDeleteFile({ rawFileId: rawFileId as Id<"rawFiles"> });
  }

  async function handleContextMoveTo(rawFileId: string, projectId: string) {
    await moveToProject({
      rawFileId: rawFileId as Id<"rawFiles">,
      projectId: projectId as Id<"projects">,
    });
  }

  async function handleContextCreateAndMove(rawFileId: string) {
    const name = prompt("New project name:");
    if (!name?.trim()) return;
    const projectId = await createProject({ name: name.trim(), source });
    await moveToProject({
      rawFileId: rawFileId as Id<"rawFiles">,
      projectId,
    });
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
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="project-list" type="project">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
              {projectList.map((project: any, index: number) => (
                <Draggable key={project._id} draggableId={project._id} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={snapshot.isDragging ? "shadow-lg rounded" : ""}
                    >
                      <ProjectAccordion
                        project={project}
                        dragHandleProps={provided.dragHandleProps}
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
                        onContextMenu={(e: React.MouseEvent, file: any, displayTitle: string) => {
                          setContextMenu({ x: e.clientX, y: e.clientY, file, title: displayTitle });
                        }}
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>

        {/* Ungrouped section outside project droppable but inside DragDropContext */}
        {ungroupedList.length > 0 && (
          <Droppable droppableId="ungrouped" type="session" isDropDisabled={true}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
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
                      {ungroupedList.map((file: any, index: number) => (
                        <Draggable key={file._id} draggableId={file._id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                            >
                              <SessionRow
                                file={file}
                                onClick={() => onSessionClick(file)}
                                isSelected={selectedSessionId === file._id}
                                onContextMenu={(e: React.MouseEvent, file: any, displayTitle: string) => {
                                  setContextMenu({ x: e.clientX, y: e.clientY, file, title: displayTitle });
                                }}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                    </div>
                  )}
                </div>
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        )}
      </DragDropContext>

      {projectList.length === 0 && ungroupedList.length === 0 && (
        <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No sessions found. Run ingestion to populate.
        </div>
      )}

      {contextMenu && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          projects={projectList}
          onClose={() => setContextMenu(null)}
          onRename={(rawFileId) => handleContextRename(rawFileId, contextMenu!.title)}
          onMoveTo={handleContextMoveTo}
          onDelete={handleContextDelete}
          onCreateAndMove={handleContextCreateAndMove}
        />
      )}
    </div>
  );
}

// --- Sub-components ---

interface ContextMenuProps {
  x: number;
  y: number;
  file: any;
  projects: any[];
  onClose: () => void;
  onRename: (rawFileId: string) => void;
  onMoveTo: (rawFileId: string, projectId: string) => void;
  onDelete: (rawFileId: string, fileName: string) => void;
  onCreateAndMove: (rawFileId: string) => void;
}

function SessionContextMenu({
  x,
  y,
  file,
  projects,
  onClose,
  onRename,
  onMoveTo,
  onDelete,
  onCreateAndMove,
}: ContextMenuProps) {
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);

  // Close on click outside
  useEffect(() => {
    function handleClick() { onClose(); }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onClose]);

  return (
    <div
      className="fixed z-[60] bg-background border rounded-lg shadow-lg py-1 min-w-[180px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => { onRename(file._id); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
      >
        Rename
      </button>
      <div
        className="relative"
        onMouseEnter={() => setShowMoveSubmenu(true)}
        onMouseLeave={() => setShowMoveSubmenu(false)}
      >
        <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex items-center justify-between">
          Move to
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </button>
        {showMoveSubmenu && (
          <div className="absolute left-full top-0 bg-background border rounded-lg shadow-lg py-1 min-w-[160px] ml-1">
            {projects
              .filter((p: any) => p._id !== file.projectId)
              .map((p: any) => (
                <button
                  key={p._id}
                  onClick={() => { onMoveTo(file._id, p._id); onClose(); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  {p.name}
                </button>
              ))}
            <div className="border-t my-1" />
            <button
              onClick={() => { onCreateAndMove(file._id); onClose(); }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors text-muted-foreground"
            >
              + New Project...
            </button>
          </div>
        )}
      </div>
      <button
        onClick={() => { onDelete(file._id, file.fileName); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
      >
        Delete session
      </button>
    </div>
  );
}

interface ProjectAccordionProps {
  project: any;
  dragHandleProps?: any;
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
  onContextMenu: (e: React.MouseEvent, file: any, title: string) => void;
}

function ProjectAccordion({
  project,
  dragHandleProps,
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
  onContextMenu,
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
        <span {...dragHandleProps} className="cursor-grab text-muted-foreground">
          ⠿
        </span>
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
        <Droppable droppableId={project._id} type="session">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`divide-y ${snapshot.isDraggingOver ? "bg-accent/20" : ""}`}
            >
              {fileList.length === 0 ? (
                <div className="px-4 py-3 text-xs text-muted-foreground italic">
                  No sessions in this project
                </div>
              ) : (
                fileList.map((file: any, index: number) => (
                  <Draggable key={file._id} draggableId={file._id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className={snapshot.isDragging ? "shadow-lg bg-background rounded" : ""}
                      >
                        <SessionRow
                          file={file}
                          onClick={() => onSessionClick(file)}
                          isSelected={selectedSessionId === file._id}
                          displayTitle={titleMap?.[file._id]}
                          onContextMenu={onContextMenu}
                        />
                      </div>
                    )}
                  </Draggable>
                ))
              )}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      )}
    </div>
  );
}

interface SessionRowProps {
  file: any;
  onClick: () => void;
  isSelected: boolean;
  displayTitle?: string;
  onContextMenu?: (e: React.MouseEvent, file: any, title: string) => void;
}

function SessionRow({ file, onClick, isSelected, displayTitle, onContextMenu }: SessionRowProps) {
  const title = file.displayName ?? displayTitle ?? file.fileName;

  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e, file, title);
      }}
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
      <button
        onClick={(e) => {
          e.stopPropagation();
          onContextMenu?.(e, file, title);
        }}
        className="shrink-0 p-1 rounded hover:bg-accent transition-colors text-muted-foreground"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
