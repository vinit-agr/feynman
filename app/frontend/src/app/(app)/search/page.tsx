"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { EntryCard } from "@/components/search/entry-card";
import { useDebounce } from "@/hooks/use-debounce";
import { Search as SearchIcon } from "lucide-react";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  const results = useQuery(
    api.knowledgeEntries.search,
    debouncedQuery.length >= 2 ? { query: debouncedQuery } : "skip"
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Search</h1>
      <div className="relative max-w-xl">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search across all knowledge entries..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>
      {debouncedQuery.length < 2 && (
        <p className="text-sm text-muted-foreground">
          Type at least 2 characters to search.
        </p>
      )}
      {results !== undefined && results.length === 0 && debouncedQuery.length >= 2 && (
        <p className="text-sm text-muted-foreground">
          No results found for &quot;{debouncedQuery}&quot;.
        </p>
      )}
      {results && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          {results.map((entry: any) => (
            <EntryCard key={entry._id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
