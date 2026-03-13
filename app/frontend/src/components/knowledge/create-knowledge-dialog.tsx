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

interface CreateKnowledgeDialogProps {
  open: boolean;
  onClose: () => void;
  defaultStage?: string;
}

export function CreateKnowledgeDialog({
  open,
  onClose,
  defaultStage = "ideas",
}: CreateKnowledgeDialogProps) {
  const createItem = useMutation(api.knowledgePipeline.create);
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");

  async function handleCreate() {
    if (!topic.trim()) return;
    await createItem({
      stage: defaultStage as any,
      topic: topic.trim(),
      description: description || undefined,
    });
    setTopic("");
    setDescription("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Knowledge Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            autoFocus
          />
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
            <Button onClick={handleCreate} disabled={!topic.trim()}>
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
