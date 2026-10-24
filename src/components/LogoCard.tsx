import { ImageSquare } from "@phosphor-icons/react/ssr";
import { removeLogoAction, uploadLogoAction } from "@/app/app/_actions/settings";
import { SubmitButton } from "./SubmitButton";
import { Card, Field, buttonClass } from "./ui";

/** Upload / replace / remove the agency logo. `back` is where the form returns to. */
export function LogoCard({ logoV, agencyName, back, className }: { logoV: string | null; agencyName: string; back: string; className?: string }) {
  return (
    <Card title="Logo" className={className}>
      <div className="flex items-center gap-4">
        <div className="paper grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface p-2">
          {logoV ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/logo?v=${logoV}`} alt={`${agencyName} logo`} className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageSquare aria-hidden size={24} className="text-ink-3" />
          )}
        </div>
        <p className="text-xs text-ink-3">Shown on invoices, the client hub and the sidebar. PNG, JPEG, WebP or SVG, up to 512 KB. A wide logo on a transparent background works best.</p>
      </div>
      <form action={uploadLogoAction} className="mt-4 space-y-2">
        <input type="hidden" name="back" value={back} />
        <Field label={logoV ? "Replace logo" : "Upload logo"}>
          <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" required />
        </Field>
        <div className="flex flex-wrap gap-2">
          <SubmitButton className={buttonClass("secondary", "sm")}>{logoV ? "Replace" : "Upload"}</SubmitButton>
          {logoV && (
            <SubmitButton formAction={removeLogoAction} formNoValidate confirm="Remove the logo from invoices, the hub and the sidebar?" className={buttonClass("ghost", "sm")}>
              Remove
            </SubmitButton>
          )}
        </div>
      </form>
    </Card>
  );
}
