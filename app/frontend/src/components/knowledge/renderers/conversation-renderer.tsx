"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronRight, Terminal, FileText } from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirrors backend ConversationMessage)
// ---------------------------------------------------------------------------

interface ConversationMessage {
  role: "human" | "assistant";
  text: string;
  timestamp?: string;
  toolCalls?: ToolCallSummary[];
}

interface ToolCallSummary {
  tool: string;
  shortDescription: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toolIcon(tool: string) {
  switch (tool) {
    case "bash":
      return <Terminal className="h-3 w-3" />;
    default:
      return <FileText className="h-3 w-3" />;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolCallChips({ toolCalls }: { toolCalls: ToolCallSummary[] }) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  const summary =
    toolCalls.length <= 3
      ? toolCalls.map((tc) => tc.tool).join(", ")
      : `${toolCalls.length} tool calls`;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md bg-muted/50 hover:bg-muted"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Terminal className="h-3 w-3" />
        <span>{summary}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-0.5 pl-2 border-l-2 border-muted ml-1">
          {toolCalls.map((tc, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono"
            >
              {toolIcon(tc.tool)}
              <span className="font-medium">{tc.tool}</span>
              <span className="truncate">{tc.shortDescription}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isHuman = message.role === "human";

  return (
    <div
      className={`px-4 py-3 rounded-lg ${
        isHuman
          ? "bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-400 dark:border-l-blue-600"
          : "bg-gray-50 dark:bg-gray-800/50 border-l-2 border-l-gray-300 dark:border-l-gray-600"
      }`}
    >
      {/* Header: role badge + timestamp */}
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
            isHuman
              ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
              : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          }`}
        >
          {isHuman ? "You" : "Claude"}
        </span>
        {message.timestamp && (
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(message.timestamp)}
          </span>
        )}
      </div>

      {/* Message text */}
      {message.text && (
        <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown>{message.text}</ReactMarkdown>
        </div>
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallChips toolCalls={message.toolCalls} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ConversationRendererProps {
  data: string;
}

export function ConversationRenderer({ data }: ConversationRendererProps) {
  const messages = useMemo(() => {
    try {
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return null;
      return parsed as ConversationMessage[];
    } catch {
      return null;
    }
  }, [data]);

  if (!messages) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Unable to parse conversation data. This may be stale data from before the parser update.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Run <code className="bg-muted px-1 rounded">pnpm cleanup:claude && pnpm ingest:claude</code> to re-ingest.
        </p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">No messages in this session.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3">
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
    </div>
  );
}
