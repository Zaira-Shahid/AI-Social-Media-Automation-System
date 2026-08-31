"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  fetchNow,
  removeSource,
  saveSource,
  toggleSourceActive,
  type SourceFormState,
} from "@/app/(app)/news/sources/actions";
import { Button } from "@/components/ui/button";
import { SOURCE_PRIORITIES, type NewsSource } from "@/lib/news/schema";
import { cn } from "@/lib/utils";

/**
 * Source list and editor (spec §5, §63).
 *
 * Health is shown rather than acted on: a failing source stays active and
 * visibly red. Auto-deactivating would turn a broken feed into a story that
 * quietly stops appearing, which is the harder problem to notice.
 */
const INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

const INITIAL_STATE: SourceFormState = { status: "idle" };

/**
 * A submit button that reports the surrounding form's pending state.
 *
 * `type` defaults to "submit" explicitly. The underlying Base UI button does
 * not, so leaving it off produces a button that looks right, is inside a
 * form, and silently does nothing when clicked.
 */
function PendingButton({
  children,
  pendingLabel,
  type = "submit",
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <Button {...props} type={type} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

function relative(iso: string | null): string {
  if (!iso) return "never";

  const elapsed = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(elapsed / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

function HealthBadge({ source }: { source: NewsSource }) {
  const { status, consecutiveFailures } = source.health;

  const tone =
    status === "OK"
      ? "bg-muted text-muted-foreground"
      : status === "FAILING"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";

  return (
    <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", tone)}>
      {status === "FAILING" && consecutiveFailures > 1
        ? `Failing ×${consecutiveFailures}`
        : status === "OK"
          ? "OK"
          : status === "FAILING"
            ? "Failing"
            : "Not checked"}
    </span>
  );
}

function SourceRow({ source, onEdit }: { source: NewsSource; onEdit: (id: string) => void }) {
  const [toggleState, toggleAction] = useActionState(toggleSourceActive, INITIAL_STATE);
  const [deleteState, deleteAction] = useActionState(removeSource, INITIAL_STATE);
  const [fetchState, fetchAction] = useActionState(fetchNow, INITIAL_STATE);

  /*
   * These three actions each return a message, and a row that silently
   * discards them leaves a failed fetch or a refused delete looking exactly
   * like a successful one. §52: never silently fail.
   */
  const outcome = [fetchState, toggleState, deleteState].find((state) => state.status !== "idle");

  return (
    <li className="border-b border-border py-3 last:border-b-0" data-testid="source-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn("text-sm font-medium", !source.active && "text-muted-foreground")}>
              {source.name}
            </p>
            <HealthBadge source={source} />
            {!source.active ? (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Inactive
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {source.feedUrl}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Priority {source.priority}
            {source.category ? ` · ${source.category}` : ""} · checked{" "}
            {relative(source.health.lastCheckedAt)} · last success{" "}
            {relative(source.health.lastSuccessAt)}
            {source.health.lastItemCount !== null ? ` · ${source.health.lastItemCount} items` : ""}
          </p>

          {source.health.lastError ? (
            <p className="mt-1 text-xs text-destructive" data-testid="source-error">
              {source.health.lastError}
            </p>
          ) : null}

          {outcome?.message ? (
            <p
              role="status"
              data-testid="source-row-status"
              className={cn(
                "mt-1 text-xs",
                outcome.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {outcome.message}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(source.id)}>
            Edit
          </Button>

          <form action={fetchAction}>
            <input type="hidden" name="id" value={source.id} />
            <PendingButton variant="ghost" size="sm" pendingLabel="Fetching…">
              Fetch
            </PendingButton>
          </form>

          <form action={toggleAction}>
            <input type="hidden" name="id" value={source.id} />
            <PendingButton variant="ghost" size="sm" pendingLabel="…">
              {source.active ? "Deactivate" : "Activate"}
            </PendingButton>
          </form>

          <form action={deleteAction}>
            <input type="hidden" name="id" value={source.id} />
            <PendingButton variant="ghost" size="sm" pendingLabel="…">
              Delete
            </PendingButton>
          </form>
        </div>
      </div>
    </li>
  );
}

function SourceForm({ source, onDone }: { source: NewsSource | null; onDone: () => void }) {
  const [state, action] = useActionState(saveSource, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="mt-4 space-y-4 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold">{source ? `Edit ${source.name}` : "Add a source"}</h2>

      {source ? <input type="hidden" name="id" value={source.id} /> : null}

      <div className="space-y-1">
        <label htmlFor="source-name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="source-name"
          name="name"
          className={INPUT_CLASS}
          defaultValue={source?.name ?? ""}
          required
        />
        {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="source-feed" className="text-sm font-medium">
          Feed URL
        </label>
        <p className="text-xs text-muted-foreground">
          RSS or Atom. Verify it works before adding it — an unreachable feed is not a source.
        </p>
        <input
          id="source-feed"
          name="feedUrl"
          type="url"
          className={INPUT_CLASS}
          defaultValue={source?.feedUrl ?? ""}
          required
        />
        {errors.feedUrl ? (
          <p role="alert" className="text-xs text-destructive">
            {errors.feedUrl}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="source-homepage" className="text-sm font-medium">
          Homepage
        </label>
        <input
          id="source-homepage"
          name="homepageUrl"
          type="url"
          className={INPUT_CLASS}
          defaultValue={source?.homepageUrl ?? ""}
        />
        {errors.homepageUrl ? (
          <p className="text-xs text-destructive">{errors.homepageUrl}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="source-category" className="text-sm font-medium">
            Category
          </label>
          <input
            id="source-category"
            name="category"
            className={INPUT_CLASS}
            defaultValue={source?.category ?? ""}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="source-priority" className="text-sm font-medium">
            Priority
          </label>
          <select
            id="source-priority"
            name="priority"
            className={INPUT_CLASS}
            defaultValue={String(source?.priority ?? 3)}
          >
            {SOURCE_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
                {value === 1 ? " (highest)" : value === 5 ? " (lowest)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={source ? source.active : true}
          className="size-4"
        />
        Active
      </label>

      <div className="flex items-center gap-3">
        <PendingButton type="submit" pendingLabel="Saving…">
          {source ? "Save changes" : "Add source"}
        </PendingButton>

        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {source ? "Cancel" : "Close"}
        </Button>

        {state.status !== "idle" && state.message ? (
          <p
            role="status"
            data-testid="source-form-status"
            className={cn(
              "text-sm",
              state.status === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function SourceManager({ sources }: { sources: NewsSource[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, fetchAllAction] = useActionState(fetchNow, INITIAL_STATE);

  const editingSource = sources.find((source) => source.id === editing) ?? null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
        >
          Add source
        </Button>

        <form action={fetchAllAction}>
          <PendingButton variant="outline" pendingLabel="Fetching all…">
            Fetch all now
          </PendingButton>
        </form>
      </div>

      {adding || editingSource ? (
        <SourceForm
          key={editingSource?.id ?? "new"}
          source={editingSource}
          onDone={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : null}

      {sources.length === 0 ? (
        /* Empty state (§59): nothing is discovered until a feed exists. */
        <p className="mt-6 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          No sources yet. Discovery has nothing to read until at least one feed is added and active.
        </p>
      ) : (
        <ul className="mt-6 rounded-lg border border-border px-4">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onEdit={(id) => {
                setEditing(id);
                setAdding(false);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
