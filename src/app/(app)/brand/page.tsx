import { BrandForm } from "@/components/brand-form";
import { requirePermission } from "@/lib/auth/current-user";
import { isBrandConfigured } from "@/lib/brand/schema";
import { getBrandProfile } from "@/lib/brand/store";

/**
 * Brand screen (spec §43).
 *
 * `brand:manage` belongs to ADMIN alone (§27); every other role is sent to
 * /forbidden rather than shown a form they cannot submit.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Brand" };

export default async function BrandPage() {
  await requirePermission("brand:manage");

  const { company, brand } = await getBrandProfile();
  const { configured, missing } = isBrandConfigured(company, brand);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Brand</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        One central profile. Every generated post inherits it — the brand is never defined per
        platform.
      </p>

      {/*
        Empty state (§59). This is not decoration: until these fields exist,
        content generation in later modules has nothing to work from, and the
        screen is the only place that can fix it.
      */}
      {!configured ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-border bg-muted/50 p-4 text-sm"
          data-testid="brand-incomplete"
        >
          <p className="font-medium">This profile is not complete yet.</p>
          <p className="mt-1 text-muted-foreground">
            Content generation needs {missing.join(", ")}. Posts generated before these are set
            would not carry the brand.
          </p>
        </div>
      ) : null}

      <BrandForm company={company} brand={brand} />
    </div>
  );
}
