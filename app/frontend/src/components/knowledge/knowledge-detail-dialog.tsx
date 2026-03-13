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

const stages = ["ideas", "researching", "learning", "curated"] as const;
type Stage = (typeof stages)[number];

const formats = [
  "talking-head",
  "ai-video",
  "blog",
  "twitter-thread",
  "linkedin-post",
  "other",
] as const;
type Format = (typeof formats)[number];

interface KnowledgeDetailDialogProps {
  itemId: string | null;
  open: boolean;
  onClose: () => void;
}

export function KnowledgeDetailDialog({
  itemId,
  open,
  onClose,
}: KnowledgeDetailDialogProps) {
  const items = useQuery(api.knowledgePipeline.list, {});
  const updateItem = useMutation(api.knowledgePipeline.update);
  const updateStage = useMutation(api.knowledgePipeline.updateStage);
  const removeItem = useMutation(api.knowledgePipeline.remove);
  const promoteToContent = useMutation(
    api.contentPipeline.promoteFromKnowledge,
  );

  const item = items?.find((i: any) => i._id === itemId);

  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [showFormatPicker, setShowFormatPicker] = useState(false);

  useEffect(() => {
    if (item) {
      setTopic(item.topic || "");
      setDescription(item.description || "");
      setNotes(item.notes || "");
      setShowFormatPicker(false);
    }
  }, [item]);

  if (!item) return null;

  async function handleSave() {
    if (!itemId) return;
    await updateItem({
      id: itemId as Id<"knowledgeItems">,
      topic,
      description: description || undefined,
      notes: notes || undefined,
    });
    onClose();
  }

  async function handleStageChange(newStage: Stage) {
    if (!itemId) return;
    await updateStage({
      id: itemId as Id<"knowledgeItems">,
      stage: newStage,
    });
  }

  async function handleDelete() {
    if (!itemId) return;
    await removeItem({ id: itemId as Id<"knowledgeItems"> });
    onClose();
  }

  async function handlePromote(format: Format) {
    if (!itemId) return;
    await promoteToContent({
      knowledgeItemId: itemId as Id<"knowledgeItems">,
      format,
    });
    setShowFormatPicker(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
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
          <Separator />
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this knowledge item about?"
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[60px] resize-y"
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
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[100px] resize-y"
            />
          </div>
          {item.tags && item.tags.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground">
                Tags
              </label>
              <div className="flex flex-wrap gap-1 mt-1">
                {item.tags.map((tag: string, i: number) => (
                  <Badge key={i} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {item.stage === "curated" && (
            <>
              <Separator />
              <div>
                {!showFormatPicker ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFormatPicker(true)}
                  >
                    Promote to Content
                  </Button>
                ) : (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">
                      Choose a format
                    </label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {formats.map((f) => (
                        <Badge
                          key={f}
                          variant="outline"
                          className="cursor-pointer capitalize hover:bg-primary hover:text-primary-foreground"
                          onClick={() => handlePromote(f)}
                        >
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
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
