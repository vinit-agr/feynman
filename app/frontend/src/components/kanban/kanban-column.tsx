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
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onAddItem}
          >
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
              className={`p-2 space-y-2 min-h-[200px] ${snapshot.isDraggingOver ? "bg-accent/50" : ""}`}
            >
              {items.map((item, index) => (
                <Draggable key={item._id} draggableId={item._id} index={index}>
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
