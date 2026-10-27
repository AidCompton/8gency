import { LeakCalculator } from "@/components/LeakCalculator";
import { SiteShell } from "@/components/SiteShell";

export const metadata = {
  title: "How much is your agency bleeding?",
  description: "A two-minute estimate of the money slipping away from a marketing agency: unrecorded time, extra asks done for free and overserviced retainers.",
};

export default function LeakCalculatorPage() {
  return (
    <SiteShell>
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6">
        <h1 className="max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-5xl">How much is your agency bleeding?</h1>
        <p className="mt-4 max-w-2xl text-pretty text-lg text-ink-2">Most agencies lose money in three quiet places. Put in rough numbers and see what it adds up to over a year.</p>
        <div className="mt-10"><LeakCalculator /></div>
      </section>
    </SiteShell>
  );
}
