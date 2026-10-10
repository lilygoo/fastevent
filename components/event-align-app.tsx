"use client";

import { useEffect, useState } from "react";
import {
  BarChart3, BookOpen, CalendarDays, ChevronDown, Download, LoaderCircle, Plus,
  Eye, EyeOff, RefreshCw, Save, Trash2, X,
} from "lucide-react";
import { initialStudy } from "@/lib/default-study";
import { BENCHMARKS, INSTRUMENTS, type EventSeries, type EventStudyResponse, type SavedStudy, type StudyDefinition } from "@/lib/types";

const COLORS = ["#2f6db0", "#7e9fc3", "#7b61a8", "#c27c5a", "#3e8f8b"];
const CURRENT_SERIES_COLOR = "#46a57b";

function seriesColor(series: EventSeries, allSeries: EventSeries[]) {
  if (series.current) return CURRENT_SERIES_COLOR;
  const historicalIndex = allSeries.filter((item) => !item.current).findIndex((item) => item.eventId === series.eventId);
  return COLORS[Math.max(0, historicalIndex) % COLORS.length];
}

type TutorialFlowKey = "new-study" | "saved-studies";
type TutorialStep = { target: string; title: string; copy: string; hint: string };

const TUTORIAL_FLOWS: Record<TutorialFlowKey, { name: string; duration: string; summary: string; steps: TutorialStep[] }> = {
  "new-study": {
    name: "Create an event study",
    duration: "6 steps · about 60 seconds",
    summary: "Set the current event, define comparable historical Day 0s, and load the aligned return chart.",
    steps: [
      { target: "#newStudyButton", title: "Start with New study", copy: "This resets the editor to a blank working study. Your saved studies remain untouched.", hint: "Use New study when you want a separate setup rather than editing the currently loaded source." },
      { target: "#studySetupSection", title: "Define what to compare", copy: "Name the study, choose a different instrument and benchmark, select the return lens, and set the pre- and post-event windows.", hint: "Beta-adjusted uses the cached current pair beta; Raw and Excess remain available if beta cannot be calculated." },
      { target: "#currentEventSection", title: "Enter the current event", copy: "Give the current event a clear label, choose its requested Day 0, and set the as-of date. Milestones can belong to the current event too.", hint: "A non-trading Day 0 maps forward to the next joint instrument and benchmark session." },
      { target: "#pastEventsSection", title: "Add comparable past events", copy: "Each historical episode needs a name and Day 0. Add milestones when a follow-up date should appear as an annotation on the chart.", hint: "Use events with the same economic catalyst when you want the historical distribution to be meaningful." },
      { target: "#runStudyButton", title: "Load the study data", copy: "FastEvent fills its independent adjusted-close cache, aligns joint sessions, and calculates the selected return lens.", hint: "Latest prices are never polled. Choose Latest and use Pull latest when you explicitly want a delayed quote." },
      { target: "#chartPanel", title: "Read the aligned result", copy: "Every path is normalized to zero at its effective Day 0. Overlay shows individual episodes; Range emphasizes the historical median and interquartile band.", hint: "The dark EVENT D0 line is the alignment anchor. Milestones inherit their episode color, while the green latest-point guide marks the current event's newest EOD or explicitly pulled quote." },
    ],
  },
  "saved-studies": {
    name: "Save and reopen a study",
    duration: "5 steps · about 45 seconds",
    summary: "Create a shared saved source, reopen it later, and write edits back safely with revision checks.",
    steps: [
      { target: "#saveStudyButton", title: "Save the current study", copy: "The first save creates a shared study source. Later saves update the source currently loaded in the editor.", hint: "Creating a study is one of the two moments when FastEvent checks whether the pair beta needs calculation or refresh." },
      { target: "#studyNameInput", title: "Give the source a clear name", copy: "The study name travels with its instrument, benchmark, lens, windows, events, milestones, and display choices.", hint: "Names must be unique among active studies and can be up to 120 characters." },
      { target: "#savedStudiesButton", title: "Open Saved studies", copy: "Saved studies is the shared retrieval library. Opening the library itself does not change the working setup.", hint: "Select Load beside the source you want to reopen." },
      { target: "#savedStudiesButton", title: "Load an earlier source", copy: "Loading restores the saved definition and checks beta freshness. A beta more than 30 calendar days old is refreshed.", hint: "If refresh fails, the previous beta remains usable and FastEvent shows a stale warning." },
      { target: "#saveStudyButton", title: "Save later edits safely", copy: "After editing a loaded study, Save writes back to that exact source. Revision checks prevent silently overwriting another session's changes.", hint: "A revision conflict asks you to reload rather than replacing newer work." },
    ],
  },
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pct(value: number | null, digits = 2) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function relativeDayLabel(day: number) {
  return day === 0 ? "D0" : day > 0 ? `D+${day}` : `D${day}`;
}

function updateEvent(definition: StudyDefinition, current: boolean, eventIndex: number, field: "label" | "day0", value: string) {
  const next = clone(definition);
  const event = current ? next.currentEvent : next.historicalEvents[eventIndex];
  event[field] = value;
  return next;
}

function activeMilestoneKeys(definition: StudyDefinition) {
  return new Set([definition.currentEvent, ...definition.historicalEvents].flatMap((event) =>
    event.milestones.filter((milestone) => milestone.active).map((milestone) => `${event.id}:${milestone.id}`),
  ));
}

function EventChart({ result, definition }: { result: EventStudyResponse; definition: StudyDefinition }) {
  const width = 980;
  const plotHeight = 332;
  const horizontalMargin = { right: 26, left: 58 };
  const visibleSeries = result.series.filter((series) => series.current || series.active);
  const minDay = definition.display.showPre ? -definition.preDays : 0;
  const maxDay = definition.postDays;
  const x = (day: number) => horizontalMargin.left + ((day - minDay) / Math.max(1, maxDay - minDay)) * (width - horizontalMargin.left - horizontalMargin.right);
  const visibleMilestoneKeys = activeMilestoneKeys(definition);
  const milestoneItems = (definition.display.showMilestones
    ? visibleSeries.flatMap((series) => series.milestones
      .filter((milestone) => visibleMilestoneKeys.has(`${milestone.eventId}:${milestone.id}`) && milestone.day >= minDay && milestone.day <= maxDay)
      .map((milestone) => ({
        ...milestone,
        current: series.current,
        color: seriesColor(series, result.series),
        chartLabel: `${relativeDayLabel(milestone.day)} · ${milestone.label.slice(0, 28)}`,
      })))
    : [])
    .slice(0, 8)
    .sort((a, b) => a.day - b.day || Number(b.current) - Number(a.current));
  const dayCounts = new Map<number, number>();
  milestoneItems.forEach((milestone) => dayCounts.set(milestone.day, (dayCounts.get(milestone.day) ?? 0) + 1));
  const dayPositions = new Map<number, number>();
  const laneEnds: number[] = [];
  const milestones = milestoneItems.map((milestone) => {
    const position = dayPositions.get(milestone.day) ?? 0;
    dayPositions.set(milestone.day, position + 1);
    const lineX = x(milestone.day) + (position - ((dayCounts.get(milestone.day) ?? 1) - 1) / 2) * 3;
    const estimatedWidth = Math.min(206, 14 + milestone.chartLabel.length * 4.7);
    const labelX = Math.max(horizontalMargin.left, Math.min(lineX + 5, width - horizontalMargin.right - estimatedWidth));
    let lane = laneEnds.findIndex((laneEnd) => labelX > laneEnd + 8);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = labelX + estimatedWidth;
    return { ...milestone, lineX, labelX, lane };
  });
  const margin = {
    top: Math.max(54, 27 + Math.max(1, laneEnds.length) * 15),
    right: horizontalMargin.right,
    bottom: 44,
    left: horizontalMargin.left,
  };
  const height = margin.top + plotHeight + margin.bottom;
  const values = visibleSeries.flatMap((series) => series.points.flatMap((point) => point.value === null ? [] : [point.value]));
  result.distribution.forEach((point) => values.push(point.q1, point.q3));
  const minValue = values.length ? Math.min(...values) : -1;
  const maxValue = values.length ? Math.max(...values) : 1;
  const pad = Math.max(1, (maxValue - minValue) * 0.14);
  const yMin = Math.floor((minValue - pad) * 2) / 2;
  const yMax = Math.ceil((maxValue + pad) * 2) / 2;
  const y = (value: number) => margin.top + ((yMax - value) / Math.max(0.001, yMax - yMin)) * (height - margin.top - margin.bottom);
  const path = (series: EventSeries) => series.points.filter((point) => point.value !== null).map((point, index) => `${index ? "L" : "M"}${x(point.day).toFixed(1)},${y(point.value!).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: 6 }, (_, index) => yMin + (index / 5) * (yMax - yMin));
  const xTicks = Array.from({ length: Math.floor((maxDay - minDay) / 6) + 1 }, (_, index) => minDay + index * 6).filter((day) => day <= maxDay);
  if (!xTicks.includes(0)) xTicks.push(0);
  xTicks.sort((a, b) => a - b);
  const activeHistorical = visibleSeries.filter((series) => !series.current);
  const band = result.distribution.filter((point) => point.day >= minDay && point.day <= maxDay);
  const bandPath = band.length
    ? `${band.map((point, index) => `${index ? "L" : "M"}${x(point.day)},${y(point.q3)}`).join(" ")} ${[...band].reverse().map((point) => `L${x(point.day)},${y(point.q1)}`).join(" ")} Z`
    : "";
  const currentSeries = visibleSeries.find((series) => series.current);
  const latestPoint = currentSeries?.points.findLast((point) => point.value !== null && point.day >= minDay && point.day <= maxDay) ?? null;
  const latestX = latestPoint ? x(latestPoint.day) : 0;
  const latestY = latestPoint?.value === null || latestPoint === null ? 0 : y(latestPoint.value);
  const latestBadgeWidth = 88;
  const latestBadgeX = Math.max(margin.left + 3, Math.min(latestX - latestBadgeWidth / 2, width - margin.right - latestBadgeWidth - 3));
  const valueLabelOnRight = latestX < width - margin.right - 74;
  const valueLabelY = latestPoint && latestY < margin.top + 70 ? latestY + 19 : latestY - 10;

  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Aligned event performance chart">
      <rect x={margin.left} y={margin.top} width={width - margin.left - margin.right} height={height - margin.top - margin.bottom} fill="#fff" />
      {ticks.map((tick) => <g key={tick}>
        <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke="#e8edf3" />
        <text x={margin.left - 10} y={y(tick) + 4} textAnchor="end" className="axis-label">{tick.toFixed(1)}%</text>
      </g>)}
      {xTicks.map((tick) => <g key={tick}>
        {tick !== 0 && <line x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} stroke="#f0f3f6" />}
        <text x={x(tick)} y={height - 17} textAnchor="middle" className="axis-label">{relativeDayLabel(tick)}</text>
      </g>)}
      {definition.display.showBand && bandPath && <path d={bandPath} fill="#dbe7f3" opacity=".62" />}
      {definition.display.showMedian && band.length > 0 && <path d={band.map((point, index) => `${index ? "L" : "M"}${x(point.day)},${y(point.median)}`).join(" ")} fill="none" stroke="#344054" strokeWidth="1.7" strokeDasharray="3 4" />}
      {milestones.map((milestone) => <g key={`${milestone.eventId}-${milestone.id}`}>
        <line x1={milestone.lineX} x2={milestone.lineX} y1={margin.top} y2={height - margin.bottom} stroke={milestone.color} strokeWidth={milestone.current ? "1.45" : "1"} strokeDasharray="3 4" opacity={milestone.current ? ".92" : ".68"} />
        <text x={milestone.labelX} y={16 + milestone.lane * 15} className="milestone-label" style={{ fill: milestone.color }}>{milestone.chartLabel}</text>
      </g>)}
      <g className="day-zero-marker">
        <line x1={x(0)} x2={x(0)} y1={margin.top} y2={height - margin.bottom} />
        <rect x={x(0) - 31} y={margin.top + 6} width="62" height="19" rx="9.5" />
        <text x={x(0)} y={margin.top + 19} textAnchor="middle">EVENT D0</text>
      </g>
      {latestPoint && <g className="latest-guide">
        <line x1={latestX} x2={latestX} y1={margin.top} y2={height - margin.bottom} />
        <rect x={latestBadgeX} y={margin.top + 32} width={latestBadgeWidth} height="20" rx="10" />
        <text x={latestBadgeX + latestBadgeWidth / 2} y={margin.top + 45.5} textAnchor="middle">{relativeDayLabel(latestPoint.day)} · {result.priceStatus === "latest" ? "LATEST" : "EOD"}</text>
      </g>}
      {definition.display.view === "overlay" && activeHistorical.map((series) => <path key={series.eventId} d={path(series)} fill="none" stroke={seriesColor(series, result.series)} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><title>{series.label}</title></path>)}
      {visibleSeries.filter((series) => series.current).map((series) => <path key={series.eventId} d={path(series)} fill="none" stroke={CURRENT_SERIES_COLOR} strokeWidth="2.8" strokeDasharray="7 4" strokeLinecap="round" strokeLinejoin="round"><title>{series.label}</title></path>)}
      {latestPoint && latestPoint.value !== null && <g className="latest-point-marker">
        <title>Latest {result.priceStatus === "latest" ? "intraday" : "EOD"} point: {relativeDayLabel(latestPoint.day)}, {pct(latestPoint.value)}</title>
        <circle cx={latestX} cy={latestY} r="6" />
        <text x={latestX + (valueLabelOnRight ? 10 : -10)} y={valueLabelY} textAnchor={valueLabelOnRight ? "start" : "end"}>{pct(latestPoint.value)}</text>
      </g>}
      <text x={margin.left} y={margin.top - 12} className="axis-title">Cumulative return</text>
      <text x={width - margin.right} y={height - 4} textAnchor="end" className="axis-title">Trading days from event</text>
    </svg>
  </div>;
}

export function EventAlignApp() {
  const [definition, setDefinition] = useState<StudyDefinition>(() => clone(initialStudy));
  const [studies, setStudies] = useState<SavedStudy[]>([]);
  const [activeStudy, setActiveStudy] = useState<SavedStudy | null>(null);
  const [result, setResult] = useState<EventStudyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"saved" | "help" | null>(null);
  const [tutorial, setTutorial] = useState<{ flowKey: TutorialFlowKey; index: number } | null>(null);
  const [tutorialRect, setTutorialRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!tutorial) {
      setTutorialRect(null);
      return;
    }
    const step = TUTORIAL_FLOWS[tutorial.flowKey].steps[tutorial.index];
    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) return;
    const updateRect = () => {
      const rect = target.getBoundingClientRect();
      const padding = 7;
      setTutorialRect({
        left: Math.max(7, rect.left - padding),
        top: Math.max(7, rect.top - padding),
        width: Math.min(window.innerWidth - 14, rect.width + padding * 2),
        height: Math.min(window.innerHeight - 14, rect.height + padding * 2),
      });
    };
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    updateRect();
    const settle = window.setTimeout(updateRect, 280);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [tutorial]);

  async function runStudy(next = definition, checkBeta = false, includeLatest = false) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/event-studies/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: next, checkBeta, includeLatest }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to run study.");
      setResult(payload);
      if (payload.warnings?.length) setNotice(payload.warnings.join(" "));
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  async function refreshLibrary(runFirst = false) {
    const response = await fetch("/api/studies", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load saved studies.");
    setStudies(payload.studies);
    if (runFirst && payload.studies.length) {
      const first = payload.studies.find((study: SavedStudy) => study.name === initialStudy.name) ?? payload.studies[0];
      setActiveStudy(first); setDefinition(first.definition);
      await runStudy(first.definition, true, false);
    }
  }

  useEffect(() => { refreshLibrary(true).catch((reason) => setError(reason.message)); }, []);

  async function saveStudy() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(activeStudy ? `/api/studies/${activeStudy.id}` : "/api/studies", {
        method: activeStudy ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeStudy ? { definition, revision: activeStudy.revision } : { definition }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save study.");
      setActiveStudy(payload.study);
      setNotice(activeStudy ? "Study updated." : "Study saved. Beta checked for this new study.");
      await refreshLibrary(false);
      if (!activeStudy) await runStudy(definition, true, false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function loadStudy(study: SavedStudy) {
    setActiveStudy(study); setDefinition(clone(study.definition)); setModal(null);
    await runStudy(study.definition, true, false);
  }

  async function removeStudy(study: SavedStudy) {
    const response = await fetch(`/api/studies/${study.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: study.revision }),
    });
    if (!response.ok) { const payload = await response.json(); setError(payload.error); return; }
    if (activeStudy?.id === study.id) setActiveStudy(null);
    await refreshLibrary(false);
  }

  function newStudy() {
    const next = clone(initialStudy);
    next.name = "Untitled event study";
    next.currentEvent = { id: crypto.randomUUID(), label: "Current event", day0: next.currentEvent.day0, active: true, milestones: [] };
    next.historicalEvents = [{ id: crypto.randomUUID(), label: "Past event", day0: next.historicalEvents[0].day0, active: true, milestones: [] }];
    setDefinition(next); setActiveStudy(null); setResult(null); setError(null); setNotice("New unsaved study.");
  }

  function exportCsv() {
    if (!result) return;
    const days = [...new Set(result.series.flatMap((series) => series.points.map((point) => point.day)))].sort((a, b) => a - b);
    const lines = [["relative_day", ...result.series.map((series) => series.label)].join(",")];
    for (const day of days) lines.push([day, ...result.series.map((series) => series.points.find((point) => point.day === day)?.value ?? "")].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "event-aligned-returns.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  const visibleMilestoneKeys = activeMilestoneKeys(definition);
  const allMilestones = result?.series.flatMap((series) => series.milestones).filter((item) => visibleMilestoneKeys.has(`${item.eventId}:${item.id}`)) ?? [];
  const milestoneColors = new Map(result?.series.map((series) => [series.eventId, seriesColor(series, result.series)]));
  const betaDisabled = Boolean(
    result
    && result.definition.instrument === definition.instrument
    && result.definition.benchmark === definition.benchmark
    && !result.betaAvailable,
  );

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><BarChart3 size={17} /></span><strong>FastEvent</strong><span className="prototype-pill"><i />Private research workspace</span></div>
      <nav>
        <button id="howItWorksButton" onClick={() => setModal("help")}><BookOpen size={15} />How it works</button>
        <button id="newStudyButton" className="primary" onClick={newStudy}><Plus size={16} />New study</button>
        <button id="saveStudyButton" onClick={saveStudy} disabled={busy}><Save size={15} />Save</button>
        <button id="savedStudiesButton" onClick={() => setModal("saved")}>Saved studies <span className="count">{studies.length}</span></button>
        <button onClick={exportCsv} disabled={!result}><Download size={15} />Export CSV</button>
      </nav>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <Section id="studySetupSection" title="Study setup">
          <Field label="Study name"><input id="studyNameInput" value={definition.name} onChange={(event) => setDefinition({ ...definition, name: event.target.value })} /></Field>
          <div className="field-row">
            <Field label="Instrument"><select value={definition.instrument} onChange={(event) => setDefinition({ ...definition, instrument: event.target.value as StudyDefinition["instrument"] })}>{INSTRUMENTS.map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field label="Benchmark"><select value={definition.benchmark} onChange={(event) => setDefinition({ ...definition, benchmark: event.target.value as StudyDefinition["benchmark"] })}>{BENCHMARKS.map((value) => <option key={value}>{value}</option>)}</select></Field>
          </div>
          <Field label="Return lens"><div className="segments">{(["raw", "excess", "beta"] as const).map((lens) => <button key={lens} className={definition.lens === lens ? "active" : ""} disabled={lens === "beta" && betaDisabled} title={lens === "beta" && betaDisabled ? "Beta is unavailable for this pair." : undefined} onClick={() => setDefinition({ ...definition, lens })}>{lens === "beta" ? "β-adjusted" : lens === "excess" ? "Excess" : "Raw"}</button>)}</div></Field>
          <div className="field-row">
            <Field label="Pre-event days"><input type="number" min={0} max={20} value={definition.preDays} onChange={(event) => setDefinition({ ...definition, preDays: Number(event.target.value) })} /></Field>
            <Field label="Post-event days"><input type="number" min={5} max={80} value={definition.postDays} onChange={(event) => setDefinition({ ...definition, postDays: Number(event.target.value) })} /></Field>
          </div>
        </Section>

        <Section id="currentEventSection" title="Current event">
          <Field label="Label"><input value={definition.currentEvent.label} onChange={(event) => setDefinition(updateEvent(definition, true, 0, "label", event.target.value))} /></Field>
          <div className="field-row">
            <Field label="Day 0"><input type="date" value={definition.currentEvent.day0} onChange={(event) => setDefinition(updateEvent(definition, true, 0, "day0", event.target.value))} /></Field>
            <Field label="As of"><input type="date" value={definition.asOf} onChange={(event) => setDefinition({ ...definition, asOf: event.target.value })} /></Field>
          </div>
          <MilestoneEditor definition={definition} setDefinition={setDefinition} current eventIndex={0} />
          <Field label="Current-day price"><div className="segments two"><button className={definition.priceMode === "eod" ? "active" : ""} onClick={() => setDefinition({ ...definition, priceMode: "eod" })}>EOD close</button><button className={definition.priceMode === "latest" ? "active" : ""} onClick={() => setDefinition({ ...definition, priceMode: "latest" })}>Latest</button></div></Field>
          <button className="wide secondary" disabled={busy || definition.priceMode !== "latest"} onClick={() => runStudy(definition, false, true)}><RefreshCw size={14} />Pull latest</button>
        </Section>

        <Section id="pastEventsSection" title="Past similar events">
          {definition.historicalEvents.map((historical, index) => <article className="event-card" key={historical.id}>
            <div className="event-head"><input value={historical.label} aria-label="Historical event label" onChange={(event) => setDefinition(updateEvent(definition, false, index, "label", event.target.value))} /><button aria-label="Delete event" onClick={() => { const next = clone(definition); next.historicalEvents.splice(index, 1); setDefinition(next); }}><Trash2 size={14} /></button></div>
            <Field label="Day 0"><input type="date" value={historical.day0} onChange={(event) => setDefinition(updateEvent(definition, false, index, "day0", event.target.value))} /></Field>
            <MilestoneEditor definition={definition} setDefinition={setDefinition} current={false} eventIndex={index} />
          </article>)}
          <button className="wide secondary" onClick={() => { const next = clone(definition); next.historicalEvents.push({ id: crypto.randomUUID(), label: `Past event ${next.historicalEvents.length + 1}`, day0: definition.historicalEvents.at(-1)?.day0 ?? definition.currentEvent.day0, active: true, milestones: [] }); setDefinition(next); }}><Plus size={14} />Add past Day 0</button>
        </Section>

        <Section title="Display">
          <Toggle label="Milestone lines" checked={definition.display.showMilestones} onChange={(checked) => setDefinition({ ...definition, display: { ...definition.display, showMilestones: checked } })} />
          <Toggle label="Median path" checked={definition.display.showMedian} onChange={(checked) => setDefinition({ ...definition, display: { ...definition.display, showMedian: checked } })} />
          <Toggle label="25–75% range" checked={definition.display.showBand} onChange={(checked) => setDefinition({ ...definition, display: { ...definition.display, showBand: checked } })} />
          <Toggle label="Pre-event window" checked={definition.display.showPre} onChange={(checked) => setDefinition({ ...definition, display: { ...definition.display, showPre: checked } })} />
        </Section>
        <button id="runStudyButton" className="wide primary run-button" disabled={busy} onClick={() => runStudy(definition, !activeStudy, false)}>{busy ? <LoaderCircle className="spin" size={16} /> : <BarChart3 size={16} />}Load study data</button>
      </aside>

      <section className="content">
        <div className="page-head">
          <div><span className="eyebrow">Aligned event study</span><h1>{definition.name}: {definition.instrument} vs {definition.benchmark}</h1><p>{definition.lens === "beta" ? "β-adjusted" : definition.lens === "excess" ? "Benchmark-relative" : "Raw"} cumulative return, normalized to 0 at each event&apos;s Day 0</p></div>
          <div className="meta">{result ? <>Latest point: {shortDate(result.dataAsOf)} · <strong>{result.priceStatus.toUpperCase()}</strong>{result.beta && <span>β {result.beta.beta.toFixed(2)} · calculated {shortDate(result.beta.calculatedAt.slice(0, 10))}</span>}</> : "Awaiting data"}</div>
        </div>
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert notice">{notice}</div>}
        <article id="chartPanel" className="panel chart-panel">
          <div className="panel-head"><div><h2>Performance after similar events</h2><p>Trading-day alignment using FastEvent&apos;s independent adjusted-close cache.</p></div><div className="segments compact"><button className={definition.display.view === "overlay" ? "active" : ""} onClick={() => setDefinition({ ...definition, display: { ...definition.display, view: "overlay" } })}>Overlay</button><button className={definition.display.view === "range" ? "active" : ""} onClick={() => setDefinition({ ...definition, display: { ...definition.display, view: "range" } })}>Range</button></div></div>
          {result ? <>
            <div className="legend">{result.series.map((series) => <span key={series.eventId}><i style={{ background: seriesColor(series, result.series) }} />{series.current ? "Current · " : ""}{series.label}</span>)}{definition.display.showMedian && <span><i className="median-line" />Past median</span>}</div>
            <EventChart result={result} definition={definition} />
          </> : <div className="empty-chart">{busy ? <><LoaderCircle className="spin" />Loading market data…</> : <><BarChart3 />Load study data to calculate aligned returns.</>}</div>}
        </article>

        {result && <div className="below-grid">
          <article className="panel"><div className="panel-head"><div><h2>Day 0 definitions</h2><p>Requested dates map to the next joint trading session when needed.</p></div></div><div className="definition-list">{result.series.map((series) => <div key={series.eventId}><CalendarDays size={15} /><span><strong>{shortDate(series.effectiveDay0)} · Day 0</strong>{series.label}{series.requestedDay0 !== series.effectiveDay0 && <small>Requested {shortDate(series.requestedDay0)}</small>}</span></div>)}</div></article>
          <article className="panel"><div className="panel-head"><div><h2>Visible milestones</h2><p>Annotations owned by current and historical events.</p></div></div><div className="definition-list">{allMilestones.length ? allMilestones.map((milestone) => <div key={`${milestone.eventId}-${milestone.id}`}><span className="milestone-dot" style={{ background: milestoneColors.get(milestone.eventId) }} /><span><strong>{shortDate(milestone.effectiveDate)} · {relativeDayLabel(milestone.day)}</strong>{milestone.label}<small>{milestone.eventLabel}</small></span></div>) : <p className="quiet">No visible milestones.</p>}</div></article>
        </div>}

        {result && <article className="panel results-panel"><div className="panel-head"><div><h2>Outcome comparison</h2><p>Percentage points from each event&apos;s effective Day 0.</p></div></div><div className="table-scroll"><table><thead><tr><th>Event</th><th>Day 0</th><th>D+1</th><th>D+5</th><th>D+20</th><th>Worst drawdown</th></tr></thead><tbody>{result.outcomes.map((row) => <tr key={row.eventId}><td>{row.label}{row.current && <em>Current</em>}</td><td>{shortDate(row.effectiveDay0)}</td><td>{pct(row.day1)}</td><td>{pct(row.day5)}</td><td>{pct(row.day20)}</td><td>{pct(row.worstDrawdown)}</td></tr>)}</tbody></table></div></article>}
      </section>
    </div>

    {modal === "saved" && <Modal title="Saved studies" onClose={() => setModal(null)}><div className="saved-list">{studies.length ? studies.map((study) => <div key={study.id}><div><strong>{study.name}</strong><span>{study.definition.instrument} vs {study.definition.benchmark} · updated {new Date(study.updatedAt).toLocaleString()}</span></div><button onClick={() => loadStudy(study)}>Load</button><button className="danger" aria-label={`Delete ${study.name}`} onClick={() => removeStudy(study)}><Trash2 size={14} /></button></div>) : <p className="quiet">No saved studies.</p>}</div></Modal>}
    {modal === "help" && <Modal wide title="How to use FastEvent" onClose={() => setModal(null)}><TutorialChooser onStart={(flowKey) => { setModal(null); setTutorial({ flowKey, index: 0 }); }} /></Modal>}
    {tutorial && <TutorialCoach
      flow={TUTORIAL_FLOWS[tutorial.flowKey]}
      index={tutorial.index}
      rect={tutorialRect}
      onClose={() => setTutorial(null)}
      onBack={() => setTutorial((current) => current ? { ...current, index: Math.max(0, current.index - 1) } : null)}
      onNext={() => setTutorial((current) => {
        if (!current) return null;
        const lastIndex = TUTORIAL_FLOWS[current.flowKey].steps.length - 1;
        return current.index >= lastIndex ? null : { ...current, index: current.index + 1 };
      })}
    />}
  </main>;
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="side-section"><h2>{title}</h2>{children}</section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function MilestoneEditor({ definition, setDefinition, current, eventIndex }: { definition: StudyDefinition; setDefinition: (definition: StudyDefinition) => void; current: boolean; eventIndex: number }) {
  const selected = current ? definition.currentEvent : definition.historicalEvents[eventIndex];
  return <details className="milestones"><summary>Milestones <span>{selected.milestones.length}</span><ChevronDown size={13} /></summary><div>
    {selected.milestones.map((milestone, milestoneIndex) => <div className={`milestone-row${milestone.active ? "" : " is-hidden"}`} key={milestone.id}><input value={milestone.label} aria-label="Milestone label" onChange={(event) => { const next = clone(definition); const target = current ? next.currentEvent : next.historicalEvents[eventIndex]; target.milestones[milestoneIndex].label = event.target.value; setDefinition(next); }} /><input type="date" value={milestone.date} aria-label="Milestone date" onChange={(event) => { const next = clone(definition); const target = current ? next.currentEvent : next.historicalEvents[eventIndex]; target.milestones[milestoneIndex].date = event.target.value; setDefinition(next); }} /><button className="milestone-visibility" aria-label={`${milestone.active ? "Hide" : "Show"} milestone ${milestone.label}`} aria-pressed={!milestone.active} title={milestone.active ? "Hide milestone" : "Show milestone"} onClick={() => { const next = clone(definition); const target = current ? next.currentEvent : next.historicalEvents[eventIndex]; target.milestones[milestoneIndex].active = !target.milestones[milestoneIndex].active; setDefinition(next); }}>{milestone.active ? <Eye size={13} /> : <EyeOff size={13} />}</button><button aria-label={`Delete milestone ${milestone.label}`} title="Delete milestone" onClick={() => { const next = clone(definition); const target = current ? next.currentEvent : next.historicalEvents[eventIndex]; target.milestones.splice(milestoneIndex, 1); setDefinition(next); }}><X size={13} /></button></div>)}
    <button className="mini-add" onClick={() => { const next = clone(definition); const target = current ? next.currentEvent : next.historicalEvents[eventIndex]; target.milestones.push({ id: crypto.randomUUID(), label: "New milestone", date: target.day0, active: true }); setDefinition(next); }}><Plus size={12} />Add milestone</button>
  </div></details>;
}

function TutorialChooser({ onStart }: { onStart: (flowKey: TutorialFlowKey) => void }) {
  return <div className="tutorial-chooser">
    <p className="tutorial-intro">Choose a guided walkthrough. The coach points to the exact control for each step and never changes the study unless you click a highlighted control yourself.</p>
    <div className="tutorial-card-grid">{(["new-study", "saved-studies"] as const).map((flowKey) => {
      const flow = TUTORIAL_FLOWS[flowKey];
      return <article className="tutorial-card" key={flowKey}>
        <div className="tutorial-card-top"><span>{flowKey === "new-study" ? <BarChart3 size={18} /> : <Save size={18} />}</span><div><h3>{flow.name}</h3><small>{flow.duration}</small></div></div>
        <p>{flow.summary}</p>
        <ol>{flow.steps.slice(0, 5).map((step) => <li key={step.title}>{step.title}</li>)}</ol>
        <button className="primary" onClick={() => onStart(flowKey)}>Start tutorial</button>
      </article>;
    })}</div>
    <div className="tutorial-reference"><strong>Chart guide</strong><span><b>EVENT D0</b> is the common alignment anchor. Milestone lines inherit their episode color. The green latest guide, dot, and return label mark the current event&apos;s newest plotted point; intraday data appears only after an explicit pull.</span></div>
  </div>;
}

function TutorialCoach({ flow, index, rect, onClose, onBack, onNext }: {
  flow: (typeof TUTORIAL_FLOWS)[TutorialFlowKey];
  index: number;
  rect: { left: number; top: number; width: number; height: number } | null;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const step = flow.steps[index];
  const last = index === flow.steps.length - 1;
  return <>
    {rect && <div className="tutorial-focus" style={rect} aria-hidden="true" />}
    <section className="tutorial-coach" role="dialog" aria-modal="false" aria-label={`${flow.name}, step ${index + 1}`}>
      <button className="tutorial-coach-close" aria-label="End tutorial" onClick={onClose}><X size={16} /></button>
      <div className="tutorial-kicker"><span>{flow.name}</span><span>{index + 1} of {flow.steps.length}</span></div>
      <div className="tutorial-progress" aria-hidden="true">{flow.steps.map((item, stepIndex) => <i key={item.title} className={stepIndex <= index ? "active" : ""} />)}</div>
      <h2>{step.title}</h2>
      <p>{step.copy}</p>
      <div className="tutorial-hint"><strong>Good to know</strong>{step.hint}</div>
      <footer><button className="tutorial-end" onClick={onClose}>End tutorial</button><div><button onClick={onBack} disabled={index === 0}>Back</button><button className="primary" onClick={onNext}>{last ? "Done" : "Next"}</button></div></footer>
    </section>
  </>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className={`modal${wide ? " tutorial-modal" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><h2>{title}</h2><button aria-label={`Close ${title}`} onClick={onClose}><X size={17} /></button></header>{children}</section></div>;
}
