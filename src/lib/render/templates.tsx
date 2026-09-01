import type { ReactElement } from "react";

import type { BrandSettings } from "@/lib/brand/schema";
import type { VisualConcept } from "@/lib/content/schema";

/**
 * Static card templates (spec §14, §15).
 *
 * Built inside Satori's CSS subset from the start, as §15 requires: flexbox
 * only, every container carrying an explicit `display: flex`, no grid, no
 * floats, no shorthand Satori does not parse. Retrofitting a freely designed
 * template into that subset is the failure mode §15 warns about.
 *
 * **These templates take no external image.** §14 forbids a publisher's image
 * reaching the generator, and the cheapest enforcement is a component that has
 * nowhere to put one: the only image any template renders is the company's own
 * logo, supplied as a data URI by the caller.
 */
export interface CardInput {
  visual: VisualConcept;
  brand: BrandSettings;
  /** The company's own logo, already fetched and inlined. Never a remote URL. */
  logoDataUri: string | null;
  /** Rendered as attribution, so a card is identifiable without the logo. */
  companyName: string;
  width: number;
  height: number;
}

/** Which brand colour the concept asked to lead with (§11). */
function accentFor(brand: BrandSettings, emphasis: VisualConcept["emphasis"]): string {
  if (emphasis === "SECONDARY") return brand.colors.secondary;
  if (emphasis === "ACCENT") return brand.colors.accent;

  return brand.colors.primary;
}

/**
 * Headline size, scaled to the text.
 *
 * Satori does not implement CSS `clamp` or container queries, so fitting is
 * arithmetic here rather than a stylesheet's job. Long headlines shrink
 * instead of overflowing the card silently.
 */
function headlineSize(text: string, width: number): number {
  const base = width / 11;

  if (text.length > 90) return base * 0.62;
  if (text.length > 60) return base * 0.76;
  if (text.length > 35) return base * 0.88;

  return base;
}

function Logo({ dataUri, size }: { dataUri: string | null; size: number }) {
  if (!dataUri) return null;

  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src={dataUri} width={size} height={size} style={{ objectFit: "contain" }} alt="" />;
}

/**
 * The frame every template shares: brand background, padding, logo, footer.
 *
 * One frame rather than four, so a brand colour change cannot apply to three
 * templates and miss the fourth.
 */
function Frame({
  brand,
  logoDataUri,
  companyName,
  width,
  height,
  accent,
  children,
}: CardInput & { accent: string; children: ReactElement }) {
  const padding = Math.round(width * 0.075);
  const logoSize = Math.round(width * 0.09);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        height,
        padding,
        backgroundColor: brand.colors.background,
        fontFamily: brand.typography.bodyFont,
        color: brand.colors.text,
      }}
    >
      {/* The accent bar is how `emphasis` shows up on every template. */}
      <div
        style={{
          display: "flex",
          width: Math.round(width * 0.14),
          height: Math.round(height * 0.014),
          backgroundColor: accent,
        }}
      />

      {children}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Logo dataUri={logoDataUri} size={logoSize} />

        <div
          style={{
            display: "flex",
            fontSize: Math.round(width * 0.022),
            color: brand.colors.secondary,
          }}
        >
          {companyName}
        </div>
      </div>
    </div>
  );
}

function Headline({ input, accent }: { input: CardInput; accent: string }) {
  const { visual, brand, width } = input;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          fontFamily: brand.typography.headingFont,
          fontWeight: 700,
          fontSize: headlineSize(visual.headline, width),
          lineHeight: 1.15,
          color: brand.colors.text,
        }}
      >
        {visual.headline}
      </div>

      {visual.supportingText ? (
        <div
          style={{
            display: "flex",
            marginTop: Math.round(width * 0.03),
            fontSize: Math.round(width * 0.032),
            lineHeight: 1.4,
            color: accent,
          }}
        >
          {visual.supportingText}
        </div>
      ) : null}
    </div>
  );
}

/** A quote: the headline set large behind an oversized quotation mark. */
function Quote({ input, accent }: { input: CardInput; accent: string }) {
  const { visual, brand, width } = input;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          fontFamily: brand.typography.headingFont,
          fontWeight: 700,
          fontSize: Math.round(width * 0.16),
          lineHeight: 1,
          color: accent,
        }}
      >
        &ldquo;
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: brand.typography.headingFont,
          fontWeight: 700,
          fontSize: headlineSize(visual.headline, width) * 0.85,
          lineHeight: 1.2,
        }}
      >
        {visual.headline}
      </div>

      {visual.supportingText ? (
        <div
          style={{
            display: "flex",
            marginTop: Math.round(width * 0.025),
            fontSize: Math.round(width * 0.028),
            color: brand.colors.secondary,
          }}
        >
          {visual.supportingText}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A statistic: the leading number pulled out of the headline and set huge.
 *
 * If the headline carries no number the template degrades to the headline
 * treatment rather than rendering an empty slot — a card with a blank hero is
 * worse than one that simply looks like the others.
 */
function Statistic({ input, accent }: { input: CardInput; accent: string }) {
  const { visual, brand, width } = input;
  const figure = visual.headline.match(/\d[\d.,]*\s*%?/)?.[0]?.trim();

  if (!figure) return <Headline input={input} accent={accent} />;

  const rest = visual.headline
    .replace(figure, "")
    .replace(/^[\s—–-]+/, "")
    .trim();

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          fontFamily: brand.typography.headingFont,
          fontWeight: 700,
          fontSize: Math.round(width * 0.22),
          lineHeight: 1,
          color: accent,
        }}
      >
        {figure}
      </div>

      <div
        style={{
          display: "flex",
          marginTop: Math.round(width * 0.02),
          fontFamily: brand.typography.headingFont,
          fontWeight: 700,
          fontSize: Math.round(width * 0.05),
          lineHeight: 1.2,
        }}
      >
        {rest || visual.supportingText}
      </div>
    </div>
  );
}

/** An educational card: a labelled lesson rather than a news headline. */
function Educational({ input, accent }: { input: CardInput; accent: string }) {
  const { visual, brand, width } = input;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          fontSize: Math.round(width * 0.024),
          letterSpacing: 2,
          fontWeight: 700,
          color: accent,
        }}
      >
        WHAT THIS MEANS
      </div>

      <div
        style={{
          display: "flex",
          marginTop: Math.round(width * 0.02),
          fontFamily: brand.typography.headingFont,
          fontWeight: 700,
          fontSize: headlineSize(visual.headline, width) * 0.9,
          lineHeight: 1.2,
        }}
      >
        {visual.headline}
      </div>

      {visual.supportingText ? (
        <div
          style={{
            display: "flex",
            marginTop: Math.round(width * 0.03),
            paddingLeft: Math.round(width * 0.025),
            borderLeftWidth: Math.round(width * 0.006),
            borderLeftColor: accent,
            borderLeftStyle: "solid",
            fontSize: Math.round(width * 0.03),
            lineHeight: 1.4,
            color: brand.colors.secondary,
          }}
        >
          {visual.supportingText}
        </div>
      ) : null}
    </div>
  );
}

/** Build the element tree Satori renders. Pure — no I/O, no network. */
export function buildCard(input: CardInput): ReactElement {
  const accent = accentFor(input.brand, input.visual.emphasis);

  const body =
    input.visual.template === "QUOTE_CARD" ? (
      <Quote input={input} accent={accent} />
    ) : input.visual.template === "STATISTIC_CARD" ? (
      <Statistic input={input} accent={accent} />
    ) : input.visual.template === "EDUCATIONAL_CARD" ? (
      <Educational input={input} accent={accent} />
    ) : (
      <Headline input={input} accent={accent} />
    );

  return (
    <Frame {...input} accent={accent}>
      {body}
    </Frame>
  );
}
