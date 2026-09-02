"use client";

import Image from "next/image";
import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";

import { saveBrandProfile, type BrandFormState } from "@/app/(app)/brand/actions";
import { Button } from "@/components/ui/button";
import { ACCEPTED_LOGO_TYPES } from "@/lib/brand/logo.shared";
import { SUPPORTED_FONTS, type BrandSettings, type CompanySettings } from "@/lib/brand/schema";

/**
 * Brand profile form (spec §43).
 *
 * Validation rules are not restated here — they live in the schema the server
 * action uses, so the two cannot disagree. This component's job is to render
 * whichever errors come back against the right inputs.
 */
const INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

function Field({
  label,
  name,
  hint,
  error,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; name: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const id = useId();

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children({ id, name, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function SubmitButton() {
  // `useFormStatus` must be read from inside the form, which is why this is
  // its own component rather than a flag on the parent.
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save brand profile"}
    </Button>
  );
}

const INITIAL_STATE: BrandFormState = { status: "idle" };

const COLOR_KEYS = ["primary", "secondary", "accent", "background", "text"] as const;

export function BrandForm({ company, brand }: { company: CompanySettings; brand: BrandSettings }) {
  const [state, action] = useActionState(saveBrandProfile, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="mt-6">
      <Section title="Company">
        <Field label="Company name" name="name" error={errors.name}>
          {(props) => (
            <input {...props} className={INPUT_CLASS} defaultValue={company.name} required />
          )}
        </Field>

        <Field label="Industry" name="industry" error={errors.industry}>
          {(props) => <input {...props} className={INPUT_CLASS} defaultValue={company.industry} />}
        </Field>

        <Field
          label="Website"
          name="website"
          hint="Full URL, including https://"
          error={errors.website}
        >
          {(props) => (
            <input {...props} type="url" className={INPUT_CLASS} defaultValue={company.website} />
          )}
        </Field>

        <Field label="Description" name="description" error={errors.description}>
          {(props) => (
            <textarea
              {...props}
              rows={3}
              className={INPUT_CLASS}
              defaultValue={company.description}
            />
          )}
        </Field>
      </Section>

      <Section title="Logo">
        {brand.logo ? (
          <div className="flex items-center gap-3">
            <Image
              src={brand.logo.url}
              alt="Current brand logo"
              width={64}
              height={64}
              unoptimized
              className="h-16 w-16 rounded border border-border object-contain p-1"
            />
            <p className="text-xs text-muted-foreground">
              {brand.logo.width}×{brand.logo.height}. Uploading a new file replaces it.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No logo yet.</p>
        )}

        <Field
          label="Upload a logo"
          name="logo"
          hint="PNG or SVG, up to 2 MB. Stored once at final size — Cloudinary bills transformations from the same credit pool as storage."
          error={errors.logo}
        >
          {(props) => (
            <input
              {...props}
              type="file"
              accept={ACCEPTED_LOGO_TYPES.join(",")}
              className="w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
          )}
        </Field>
      </Section>

      <Section title="Colours">
        <p className="text-xs text-muted-foreground">
          Hex only. These are handed straight to the card renderer, which resolves no colour names.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {COLOR_KEYS.map((key) => (
            <Field
              key={key}
              label={key[0].toUpperCase() + key.slice(1)}
              name={`colors.${key}`}
              error={errors[`colors.${key}`]}
            >
              {(props) => (
                <div className="flex items-center gap-2">
                  <input
                    {...props}
                    className={INPUT_CLASS}
                    defaultValue={brand.colors[key]}
                    required
                  />
                  <span
                    aria-hidden="true"
                    className="size-8 shrink-0 rounded border border-border"
                    style={{ background: brand.colors[key] }}
                  />
                </div>
              )}
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <p className="text-xs text-muted-foreground">
          Limited to fonts the card renderer ships with — it has no system font fallback.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Heading font"
            name="typography.headingFont"
            error={errors["typography.headingFont"]}
          >
            {(props) => (
              <select
                {...props}
                className={INPUT_CLASS}
                defaultValue={brand.typography.headingFont}
              >
                {SUPPORTED_FONTS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Body font" name="typography.bodyFont" error={errors["typography.bodyFont"]}>
            {(props) => (
              <select {...props} className={INPUT_CLASS} defaultValue={brand.typography.bodyFont}>
                {SUPPORTED_FONTS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="Voice and audience">
        <Field label="Tone of voice" name="toneOfVoice" error={errors.toneOfVoice}>
          {(props) => (
            <textarea
              {...props}
              rows={2}
              className={INPUT_CLASS}
              defaultValue={brand.toneOfVoice}
            />
          )}
        </Field>

        <Field label="Writing style" name="writingStyle" error={errors.writingStyle}>
          {(props) => (
            <textarea
              {...props}
              rows={2}
              className={INPUT_CLASS}
              defaultValue={brand.writingStyle}
            />
          )}
        </Field>

        <Field label="Target audience" name="targetAudience" error={errors.targetAudience}>
          {(props) => (
            <textarea
              {...props}
              rows={2}
              className={INPUT_CLASS}
              defaultValue={brand.targetAudience}
            />
          )}
        </Field>

        <Field label="Brand positioning" name="brandPositioning" error={errors.brandPositioning}>
          {(props) => (
            <textarea
              {...props}
              rows={2}
              className={INPUT_CLASS}
              defaultValue={brand.brandPositioning}
            />
          )}
        </Field>

        <Field label="Visual style" name="visualStyle" error={errors.visualStyle}>
          {(props) => (
            <textarea
              {...props}
              rows={2}
              className={INPUT_CLASS}
              defaultValue={brand.visualStyle}
            />
          )}
        </Field>
      </Section>

      <Section title="Topics">
        <Field
          label="Preferred topics"
          name="preferredTopics"
          hint="Comma separated."
          error={errors.preferredTopics}
        >
          {(props) => (
            <input
              {...props}
              className={INPUT_CLASS}
              defaultValue={brand.preferredTopics.join(", ")}
            />
          )}
        </Field>

        <Field
          label="Topics to avoid"
          name="topicsToAvoid"
          hint="Comma separated. A topic cannot appear in both lists."
          error={errors.topicsToAvoid}
        >
          {(props) => (
            <input
              {...props}
              className={INPUT_CLASS}
              defaultValue={brand.topicsToAvoid.join(", ")}
            />
          )}
        </Field>
      </Section>

      <Section title="Calls to action and hashtags">
        <Field label="CTA style" name="ctaStyle" error={errors.ctaStyle}>
          {(props) => <input {...props} className={INPUT_CLASS} defaultValue={brand.ctaStyle} />}
        </Field>

        <Field
          label="Maximum hashtags"
          name="hashtagRules.maxHashtags"
          error={errors["hashtagRules.maxHashtags"]}
        >
          {(props) => (
            <input
              {...props}
              type="number"
              min={0}
              max={30}
              className={INPUT_CLASS}
              defaultValue={brand.hashtagRules.maxHashtags}
            />
          )}
        </Field>

        <Field
          label="Required hashtags"
          name="hashtagRules.required"
          hint="Comma separated, without the #."
          error={errors["hashtagRules.required"]}
        >
          {(props) => (
            <input
              {...props}
              className={INPUT_CLASS}
              defaultValue={brand.hashtagRules.required.join(", ")}
            />
          )}
        </Field>

        <Field
          label="Banned hashtags"
          name="hashtagRules.banned"
          hint="Comma separated. Cannot overlap with required."
          error={errors["hashtagRules.banned"]}
        >
          {(props) => (
            <input
              {...props}
              className={INPUT_CLASS}
              defaultValue={brand.hashtagRules.banned.join(", ")}
            />
          )}
        </Field>

        <Field label="Hashtag style" name="hashtagRules.style" error={errors["hashtagRules.style"]}>
          {(props) => (
            <input {...props} className={INPUT_CLASS} defaultValue={brand.hashtagRules.style} />
          )}
        </Field>
      </Section>

      <Section title="Rules">
        <Field
          label="Content rules"
          name="contentRules"
          hint="One per line."
          error={errors.contentRules}
        >
          {(props) => (
            <textarea
              {...props}
              rows={4}
              className={INPUT_CLASS}
              defaultValue={brand.contentRules.join("\n")}
            />
          )}
        </Field>

        <Field
          label="Visual rules"
          name="visualRules"
          hint="One per line."
          error={errors.visualRules}
        >
          {(props) => (
            <textarea
              {...props}
              rows={4}
              className={INPUT_CLASS}
              defaultValue={brand.visualRules.join("\n")}
            />
          )}
        </Field>
      </Section>

      <div className="mt-6 flex items-center gap-3">
        <SubmitButton />

        {state.status !== "idle" && state.message ? (
          <p
            role="status"
            data-testid="brand-form-status"
            className={
              state.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
