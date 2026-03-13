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
  "ideas",
  "researching",
  "scripting",
  "production",
  "editing",
  "review",
  "published",
  "archive",
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

  const item = items?.find((i: any) => i._id === itemId);

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

  async function handleStageChange(
    newStage: (typeof stages)[number],
  ) {
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
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Stage
            </label>
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
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Format
            </label>
            <div className="mt-1">
              <Badge variant="secondary" className="capitalize">
                {item.format}
              </Badge>
            </div>
          </div>
          <Separator />
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this content about?"
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[60px] resize-y"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Script / Outline
            </label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Write your script or outline here..."
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[200px] resize-y font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Notes
            </label>
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
