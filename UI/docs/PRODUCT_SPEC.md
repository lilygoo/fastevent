# Product specification

FastEvent is a shared, private research tool for rapidly comparing market behavior after comparable events.

Users define an instrument, benchmark, return lens, current event, up to 12 historical events, and milestones owned by either current or historical events. Windows are 0–20 pre-event and 5–80 post-event joint trading sessions. Day 0 is the requested date mapped forward to the next joint session when necessary.

The three lenses are raw instrument cumulative adjusted-close return, excess return minus the benchmark cumulative return, and beta-adjusted return minus beta times the benchmark cumulative return. The same currently cached pair beta applies to every episode in a run.

Studies are shared, soft-deleted, and revision controlled. Creating a study or opening a saved study is the only action that evaluates beta freshness. Latest quotes require an explicit user action and have a 60-second server cache; there is no polling.

The seeded study is `Two ARR debates: SOXX vs QQQ`. Its event and milestone labels/dates come from the supplied chart. The chart's beta, plotted returns, intraday snapshot, and dividend note are not product inputs.
