import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/current-user";
import { getNewsItem } from "@/lib/news/store";

/**
 * Article detail (spec §36).
 *
 * §36 lists "article detail" alongside the list itself. What belongs here is
 * everything a person needs to judge a story before committing a day's content
 * to it — including the factor breakdown, which is too much for a row.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Story" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function Score({ label, value }: { label: string; value: unknown }) {
  if (typeof value !== "number") return null;

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function NewsItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content:view");

  const { id } = await params;
  const item = await getNewsItem(id);

  if (!item) notFound();

  const analysis = item.aiAnalysis ?? {};
  const factors = (analysis.factors ?? {}) as Record<string, unknown>;
  const whyItMatters = typeof analysis.whyItMatters === "string" ? analysis.whyItMatters : null;
  const rejectionReason =
    typeof analysis.rejectionReason === "string" && analysis.rejectionReason !== "NONE"
      ? analysis.rejectionReason
      : null;

  return (
    <div className="max-w-3xl">
      <Link href="/news" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Back to news
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">{item.status}</span>

        {/* §21: a simulated score is labelled wherever it is shown. */}
        {analysis.mode === "MOCK" ? (
          <span
            className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
            data-testid="mock-badge"
          >
            Simulated score
          </span>
        ) : null}

        {rejectionReason ? (
          <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            {rejectionReason}
          </span>
        ) : null}
      </div>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{item.title}</h1>

      <p className="mt-2 text-sm text-muted-foreground">
        {item.sourceName} · {formatDate(item.publishedAt)}
        {item.category ? ` · ${item.category}` : ""}
      </p>

      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-1 inline-block text-sm underline underline-offset-4"
      >
        Read the original article
      </a>

      {item.summary ? <p className="mt-6 text-sm">{item.summary}</p> : null}

      {whyItMatters ? (
        <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">Why it matters</p>
          <p className="mt-1 text-sm text-muted-foreground">{whyItMatters}</p>
        </div>
      ) : null}

      <h2 className="mt-8 text-sm font-semibold">Scores</h2>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Score label="composite" value={item.compositeScore} />
        <Score label="relevance" value={item.relevanceScore} />
        <Score label="credibility" value={item.credibilityScore} />
        <Score label="social potential" value={item.socialPotentialScore} />
        <Score label="business importance" value={factors.businessImportance} />
        <Score label="AI relevance" value={factors.aiRelevance} />
        <Score label="novelty" value={factors.novelty} />
        <Score label="recency" value={factors.recency} />
        <Score label="source quality" value={factors.sourceQuality} />
      </div>

      {item.imageUrl ? (
        <div className="mt-8">
          <h2 className="text-sm font-semibold">Publisher image</h2>
          {/*
            Reference only, and deliberately not optimised or reused. §14
            forbids a publisher's image ever reaching the static post
            generator: republishing one without a licence risks takedown and
            the loss of the company's own accounts. Generated cards use our own
            templates and branding.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt=""
            className="mt-2 max-h-64 rounded-lg border border-border object-cover"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Shown here for context only. Publisher images are never used in generated posts (§14).
          </p>
        </div>
      ) : null}
    </div>
  );
}
