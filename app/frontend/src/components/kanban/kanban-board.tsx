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
        <div
          className="flex gap-4 pb-4"
          style={{ minWidth: columns.length * 280 }}
        >
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
