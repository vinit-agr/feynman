"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, ChevronsUpDown, MessageSquare } from "lucide-react";
import {
  MessageBubble,
  ToolCallChips,
  type ConversationMessage,
} from "./conversation-renderer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopicSegment {
  id: number;
  name: string;
  title: string;
  stage: "brainstorming" | "design" | "planning" | "implemented" | "verified";
  summary: string;
  messageRange: { start: number; end: number };
}

interface TopicSegmentation {
  sessionTitle: string;
  extractionModel: string;
  extractedAt: number;
  pipelineVersion: string;
  topics: TopicSegment[];
}

interface TopicSegmentationRendererProps {
  topicSegmentation: TopicSegmentation;
  conversationMessages: ConversationMessage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_CONFIG: Record<
  string,
  { label: string; bgClass: string; textClass: string }
> = {
  brainstorming: {
    label: "Brainstorming",
    bgClass: "bg-purple-100 dark:bg-purple-900/50",
    textClass: "text-purple-700 dark:text-purple-300",
  },
  design: {
    label: "Design/Spec",
    bgClass: "bg-blue-100 dark:bg-blue-900/50",
    textClass: "text-blue-700 dark:text-blue-300",
  },
  planning: {
    label: "Planning",
    bgClass: "bg-yellow-100 dark:bg-yellow-900/50",
    textClass: "text-yellow-700 dark:text-yellow-300",
  },
  implemented: {
    label: "Implemented",
    bgClass: "bg-green-100 dark:bg-green-900/50",
    textClass: "text-green-700 dark:text-green-300",
  },
  verified: {
    label: "Verified",
    bgClass: "bg-teal-100 dark:bg-teal-900/50",
    textClass: "text-teal-700 dark:text-teal-300",
  },
};

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StageBadge({ stage }: { stage: string }) {
  const config = STAGE_CONFIG[stage] ?? STAGE_CONFIG.brainstorming;
  return (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded ${config.bgClass} ${config.textClass}`}
    >
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Topic Accordion
// ---------------------------------------------------------------------------

function TopicAccordion({
  topic,
  messages,
  forceState,
}: {
  topic: TopicSegment;
  messages: ConversationMessage[];
  forceState: { expanded: boolean; version: number } | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showMessages, setShowMessages] = useState(false);

  useEffect(() => {
    if (forceState) {
      setExpanded(forceState.expanded);
      if (!forceState.expanded) setShowMessages(false);
    }
  }, [forceState?.version]);

  const messageCount = topic.messageRange.end - topic.messageRange.start + 1;
  const topicMessages = messages.slice(
    topic.messageRange.start,
    topic.messageRange.end + 1
  );

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Topic header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          #{topic.id}
        </span>
        <span className="text-sm font-medium truncate flex-1">{topic.name}</span>
        <StageBadge stage={topic.stage} />
        <span className="text-xs text-muted-foreground shrink-0">
          {messageCount} msgs
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Title */}
          <p className="text-sm font-medium text-foreground/90">{topic.title}</p>

          {/* Summary */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            {topic.summary}
          </p>

          {/* Show/hide messages toggle */}
          <button
            onClick={() => setShowMessages(!showMessages)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md bg-muted/50 hover:bg-muted"
          >
            <MessageSquare className="h-3 w-3" />
            {showMessages ? "Hide conversation" : `Show conversation (${messageCount} messages)`}
          </button>

          {/* Messages */}
          {showMessages && (
            <div className="space-y-2 pt-1">
              {topicMessages.map((msg, i) => (
                <MessageBubble
                  key={i}
                  message={msg}
                  collapseCommand={null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TopicSegmentationRenderer({
  topicSegmentation,
  conversationMessages,
}: TopicSegmentationRendererProps) {
  const [forceState, setForceState] = useState<{
    expanded: boolean;
    version: number;
  } | null>(null);
  const [allExpanded, setAllExpanded] = useState(true);

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{topicSegmentation.sessionTitle}</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {topicSegmentation.topics.length}{" "}
            {topicSegmentation.topics.length === 1 ? "topic" : "topics"}
          </span>
          <span>Analyzed {formatTimeAgo(topicSegmentation.extractedAt)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => {
            const next = !allExpanded;
            setAllExpanded(next);
            setForceState((prev) => ({
              expanded: next,
              version: (prev?.version ?? 0) + 1,
            }));
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
        >
          <ChevronsUpDown className="h-3 w-3" />
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Topic accordions */}
      <div className="space-y-3">
        {topicSegmentation.topics.map((topic) => (
          <TopicAccordion
            key={topic.id}
            topic={topic}
            messages={conversationMessages}
            forceState={forceState}
          />
        ))}
      </div>
    </div>
  );
}
