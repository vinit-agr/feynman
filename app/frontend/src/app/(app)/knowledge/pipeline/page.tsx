"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import {
  KanbanBoard,
  KanbanColumnConfig,
} from "@/components/kanban/kanban-board";
import { KnowledgeCard } from "@/components/knowledge/knowledge-card";
import { KnowledgeDetailDialog } from "@/components/knowledge/knowledge-detail-dialog";
import { CreateKnowledgeDialog } from "@/components/knowledge/create-knowledge-dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { DropResult } from "@hello-pangea/dnd";
import type { Id } from "@backend/convex/_generated/dataModel";

const columns: KanbanColumnConfig[] = [
  { id: "ideas", title: "Ideas" },
  { id: "researching", title: "Researching" },
  { id: "learning", title: "Learning" },
  { id: "curated", title: "Curated" },
];

export default function KnowledgePipelinePage() {
  const items = useQuery(api.knowledgePipeline.list, {});
  const updateStage = useMutation(api.knowledgePipeline.updateStage);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStage, setCreateStage] = useState("ideas");

  const itemsByColumn: Record<string, any[]> = {};
  for (const col of columns) itemsByColumn[col.id] = [];
  if (items) {
    for (const item of items) {
      if (itemsByColumn[item.stage]) itemsByColumn[item.stage].push(item);
    }
  }

  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId, destination } = result;
      if (!destination) return;
      await updateStage({
        id: draggableId as Id<"knowledgeItems">,
        stage: destination.droppableId as any,
      });
    },
    [updateStage],
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
        <h1 className="text-2xl font-bold">Knowledge Pipeline</h1>
        <Button
          onClick={() => {
            setCreateStage("ideas");
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> Add Idea
        </Button>
      </div>
      <KanbanBoard
        columns={columns}
        itemsByColumn={itemsByColumn}
        onDragEnd={handleDragEnd}
        renderCard={(item) => (
          <KnowledgeCard item={item} onClick={handleCardClick} />
        )}
        onAddItem={handleAddItem}
      />
      <KnowledgeDetailDialog
        itemId={selectedItemId}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setSelectedItemId(null);
        }}
      />
      <CreateKnowledgeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultStage={createStage}
      />
    </div>
  );
}
