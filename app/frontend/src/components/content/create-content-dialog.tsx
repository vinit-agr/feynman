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
  "talking-head",
  "ai-video",
  "blog",
  "twitter-thread",
  "linkedin-post",
  "other",
] as const;
type Format = (typeof formats)[number];

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
            <label className="text-xs font-semibold text-muted-foreground">
              Format
            </label>
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
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!title.trim()}>
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
