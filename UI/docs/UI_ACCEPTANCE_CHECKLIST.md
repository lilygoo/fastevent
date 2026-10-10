# Acceptance checklist

- The seeded ARR study loads with SOXX, QQQ, the specified event dates, and all five milestones.
- The UI shows requested and effective Day 0 when mapping changes.
- Raw, excess, and beta-adjusted lenses use the same adjusted-close inputs.
- No beta displays as unavailable rather than fabricating a value.
- Stale beta/provider warnings are visible without suppressing otherwise usable results.
- Latest is fetched only through `Pull latest`; there is no timer or background polling.
- Save creates or updates the current source. Revision conflicts surface as HTTP 409 messages.
- Current and historical events can both add, edit, and remove milestones.
- CSV export contains the visible aligned series.
- The layout remains usable on desktop, tablet, and narrow screens.
- The frozen prototype file has no production edits.
