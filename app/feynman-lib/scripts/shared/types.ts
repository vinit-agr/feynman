export interface KnowledgeEntryInput {
  source: string;
  sourceId: string;
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  url?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface DigestInput {
  startDate: number;
  endDate: number;
  activitySummary: string;
  keyThemes: string[];
  contentIdeas: {
    title: string;
    format: string;
    reasoning: string;
  }[];
  knowledgeGaps?: string[];
  notableSaves?: string[];
  rawMarkdown: string;
}

export interface IngestResult {
  source: string;
  entriesProcessed: number;
  entriesCreated: number;
  entriesSkipped: number;
  errors: string[];
}
