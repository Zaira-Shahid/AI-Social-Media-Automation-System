"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { selectStories, type SelectFormState } from "@/app/(app)/news/actions";
import { Button } from "@/components/ui/button";
import { SELECTION_SIZE } from "@/lib/news/schema";
import type { StoredNewsItem, StoredNewsSelection } from "@/lib/news/store";
import { cn } from "@/lib/utils";

/**
 * The news screen (spec §36) and the human selection (§8, §10, §46).
 *
 * §36 fixes what it must contain: the list, source, publication date,
 * category, relevance, selection state, search, filters and article detail.
 * §8 fixes what each shortlisted story shows. §10 fixes who decides.
 *
 * The count here is a convenience. The rule that exactly three stories are
 * selected is enforced on the server, which is the only place it counts (§33).
 */
const INITIAL_STATE: SelectFormState = { status: "idle" };

function SaveButton({ count }: { count: number }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || count !== SELECTION_SIZE}>
      {pending ? "Saving…" : `Select these ${SELECTION_SIZE}`}
    </Button>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * A simulated score must never be presented as a real one (§21).
 *
 * The badge sits on the story rather than once at the top of the page, because
 * a story can outlive the run that scored it — a list can hold both.
 */
function ModeBadge({ analysis }: { analysis: Record<string, unknown> | undefined }) {
  if (analysis?.mode !== "MOCK") return null;

  return (
    <span
      className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      data-testid="mock-badge"
    >
      Simulated
    </span>
  );
}

/** Selection state (§36) — shown on the story, where the decision is made. */
function StatusBadge({ status }: { status: StoredNewsItem["status"] }) {
  if (status === "RANKED") return null;

  const label =
    status === "SELECTED" ? "Selected" : status === "REJECTED" ? "Rejected" : "Shortlisted";

  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        status === "SELECTED"
          ? "bg-primary/10 text-primary"
          : status === "REJECTED"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
      )}
      data-testid={`status-${status.toLowerCase()}`}
    >
      {label}
    </span>
  );
}

function StoryRow({
  item,
  selectable,
  checked,
  onToggle,
}: {
  item: StoredNewsItem;
  selectable: boolean;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const analysis = item.aiAnalysis;
  const whyItMatters = typeof analysis?.whyItMatters === "string" ? analysis.whyItMatters : null;

  return (
    <li className="border-b border-border py-4 last:border-b-0" data-testid="story-row">
      <div className="flex items-start gap-3">
        {selectable ? (
          <input
            type="checkbox"
            name="storyIds"
            value={item.id}
            checked={checked}
            onChange={() => onToggle(item.id)}
            aria-label={`Select ${item.title}`}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
        ) : null}

        <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                {item.title}
              </a>
              <StatusBadge status={item.status} />
              <ModeBadge analysis={analysis} />
            </div>

            {item.summary ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>
            ) : null}

            {whyItMatters ? (
              <p className="mt-2 text-sm">
                <span className="font-medium">Why it matters: </span>
                <span className="text-muted-foreground">{whyItMatters}</span>
              </p>
            ) : null}

            <p className="mt-2 text-xs text-muted-foreground">
              {item.sourceName} · {formatDate(item.publishedAt)}
              {item.category ? ` · ${item.category}` : ""} ·{" "}
              <Link href={`/news/${item.id}`} className="underline underline-offset-4">
                Details
              </Link>
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold tabular-nums">{item.compositeScore ?? "—"}</p>
            <p className="text-xs text-muted-foreground">relevance {item.relevanceScore ?? "—"}</p>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Search and filters (§36).
 *
 * A plain GET form, so a filtered view is a URL: it survives a reload, can be
 * shared, and needs no client state to stay correct.
 */
function Filters({
  categories,
  query,
  category,
  status,
}: {
  categories: string[];
  query: string;
  category: string;
  status: string;
}) {
  return (
    <form className="mt-6 flex flex-wrap items-end gap-3" role="search">
      <div className="flex flex-col gap-1">
        <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
          Search
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder="Headline or summary"
          className="h-8 w-56 rounded-lg border border-border bg-background px-2.5 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="category" className="text-xs font-medium text-muted-foreground">
          Category
        </label>
        <select
          id="category"
          name="category"
          defaultValue={category}
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="status" className="text-xs font-medium text-muted-foreground">
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={status}
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="">Everything but rejected</option>
          <option value="SELECTED">Selected</option>
          <option value="SHORTLISTED">Shortlisted</option>
          <option value="RANKED">Scored, not shortlisted</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <Button type="submit" variant="outline">
        Apply
      </Button>

      {query || category || status ? (
        <Link href="/news" className="text-sm text-muted-foreground underline underline-offset-4">
          Clear
        </Link>
      ) : null}
    </form>
  );
}

function Section({
  title,
  items,
  selectable,
  selected,
  onToggle,
  emptyMessage,
  dimmed,
}: {
  title: string;
  items: StoredNewsItem[];
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyMessage?: string;
  dimmed?: boolean;
}) {
  if (items.length === 0 && !emptyMessage) return null;

  return (
    <>
      <h2 className="mt-8 text-sm font-semibold">{title}</h2>

      {items.length === 0 ? (
        <p className="mt-2 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ul className={cn("mt-2 rounded-lg border border-border px-4", dimmed && "opacity-70")}>
          {items.map((item) => (
            <StoryRow
              key={item.id}
              item={item}
              selectable={selectable}
              checked={selected.has(item.id)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export function NewsScreen({
  items,
  categories,
  selection,
  canSelect,
  query,
  category,
  status,
}: {
  items: StoredNewsItem[];
  categories: string[];
  selection: StoredNewsSelection | null;
  canSelect: boolean;
  query: string;
  category: string;
  status: string;
}) {
  const [state, action] = useActionState(selectStories, INITIAL_STATE);

  /*
   * Seeded from the stored selection, so the boxes reflect what was actually
   * decided rather than starting empty and inviting someone to overwrite a
   * choice they could not see.
   */
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selection?.storyIds ?? []));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  }

  const selectedItems = items.filter((item) => item.status === "SELECTED");
  const shortlisted = items.filter((item) => item.status === "SHORTLISTED");
  const ranked = items.filter((item) => item.status === "RANKED");
  const rejected = items.filter((item) => item.status === "REJECTED");

  /*
   * A selection that content has been generated from is locked (§55): quietly
   * repointing it would leave generated content attributed to stories nobody
   * chose. The server enforces this; the screen explains it.
   */
  const locked = selection?.status === "GENERATED";
  const filtered = Boolean(query || category || status);

  return (
    <>
      <Filters categories={categories} query={query} category={category} status={status} />

      {items.length === 0 ? (
        /* Empty state (§59): nothing ranked is not the same as nothing existing. */
        <p className="mt-6 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          {filtered
            ? "No stories match those filters."
            : "No stories have been ranked yet. Discovery has to run first, and then ranking scores what it found."}
        </p>
      ) : (
        <form action={action}>
          {canSelect ? (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <span className="text-sm font-medium tabular-nums" data-testid="selection-count">
                {selected.size} of {SELECTION_SIZE} selected
              </span>

              {locked ? (
                <p className="text-sm text-muted-foreground">
                  Today&apos;s selection has already been used to generate content and can no longer
                  be changed.
                </p>
              ) : (
                <SaveButton count={selected.size} />
              )}

              {state.status !== "idle" && state.message ? (
                <p
                  role="status"
                  data-testid="selection-status"
                  className={cn(
                    "text-sm",
                    state.status === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {state.message}
                </p>
              ) : null}
            </div>
          ) : null}

          <Section
            title={`Selected for today (${selectedItems.length} of ${SELECTION_SIZE})`}
            items={selectedItems}
            selectable={canSelect && !locked}
            selected={selected}
            onToggle={toggle}
          />

          <Section
            title={`Shortlist (${shortlisted.length}) — a human picks three`}
            items={shortlisted}
            selectable={canSelect && !locked}
            selected={selected}
            onToggle={toggle}
            emptyMessage="Nothing scored high enough to shortlist. That is a real result, not an error — a thin day is better than a padded list."
          />

          <Section
            title="Scored but not shortlisted"
            items={ranked}
            selectable={canSelect && !locked}
            selected={selected}
            onToggle={toggle}
            dimmed
          />

          {/* Rejected stories are never selectable: each was ruled out with a reason (§7). */}
          <Section
            title="Rejected"
            items={rejected}
            selectable={false}
            selected={selected}
            onToggle={toggle}
            dimmed
          />
        </form>
      )}
    </>
  );
}
