# Decisions

- FastEvent shares the Supabase project, not database tables, with Price Tracker and Risk Lens.
- FastEvent owns its price history and keeps it indefinitely in v1.
- Adjusted close is authoritative for beta and event paths; raw close is retained for provenance and quote adjustment.
- Pair beta follows the Risk Lens convention but is stored only in `fastevent_betas`.
- Exactly 30 calendar days is fresh; only an age greater than 30 days refreshes.
- Creation and saved-study load trigger beta evaluation. Ordinary reruns and edits do not.
- A stale beta remains usable when refresh fails. No prior beta means beta-adjusted points are unavailable, while raw and excess inputs remain in the response.
- Latest quotes are explicit, delayed-provider pulls with a 60-second cache and no polling.
- The initial chart contributes labels and dates only. Its 2.03 beta and plotted market values are deliberately absent.
- Vercel Authentication protects all deployments; Supabase credentials never reach the client.
