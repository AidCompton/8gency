# Audit log — page overrides

> Overrides `../MASTER.md` for `/app/audit`. Anything not listed here follows Master.

**Pattern:** activity feed, not a table. People scan an audit log by *what happened* and *when*, then read the detail — a five-column table of raw codes made them decode `invoice.payment` first.

## Structure

1. `PageHeader` with total event count.
2. Toolbar: search (`role="search"`, Phosphor `MagnifyingGlass` inside the field) + record-type filter chips with counts. Chips wrap (never clip), are links (`?type=`), active chip = `border-brand bg-brand/10 text-brand` + `aria-current`.
3. Feed in a `Card pad={false}`, grouped by day: header row `Today` / `Yesterday` / `Tue, 20 Oct 2026` with event count.
4. Event row (`grid-cols-[2rem_1fr_auto]`):
   - 32px icon tile — category icon on `TONE[tone]` (invoice good · job/scope/brief/time info · deliverable/retainer brand · change request/cost warning · admin neutral).
   - Title: plain-English action (`ACTION` map; fallback humanises the code — raw code stays in `title`), then `· INV-00009` when the record has a number/name/title.
   - Meta: initials avatar (decorative) + actor + category.
   - Changes as pills: `field  old → new`, old struck through, `sr-only` "changed to". Key only in `before` → `was …`. Money keys in cents → `formatMoney`; cost fields masked `•••` without `seeCostRates`.
   - Time `HH:MM` right-aligned, full timestamp in `title`/`dateTime`.

## Motion

`<Stagger replay={q|type}>` around the feed; day headers and rows are `data-stagger`. Filter changes replay the entrance.

## States

- Empty: `Empty` with "Clear filters" when filtered.
- More than 300 events: footnote to search/filter for older ones.
