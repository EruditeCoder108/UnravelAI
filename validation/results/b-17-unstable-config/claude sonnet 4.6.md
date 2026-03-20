
## 1. Hypothesis Tree

**H1: `aggregations.ts` — `computedAt: Date.now()` or `byCategory` new object reference defeats downstream memos**
ELIMINATED. `useMemo` in `ReportPanel.tsx:11` caches the *return value* of `runHeavyAggregation` — it doesn't re-run based on what the function returns. What it returns is irrelevant to whether `useMemo` re-runs. The memo re-runs only when its *inputs* (`data`, `config`) change by reference. `aggregations.ts` is entirely innocent.

**H2: `useReportData.ts` — `data` array is reconstructed on every render, producing a new reference**
ELIMINATED. `useReportData.ts:8-18`: `setData` is called only inside a `setTimeout` callback, which fires once per `projectId` change. The `data` state reference is stable between those events. Not the source of the churn.

**H3: `ReportDashboard.tsx:33` — `config` object is constructed as an inline literal on every render, producing a new reference on every render**
SURVIVED. `ReportDashboard.tsx:33`: `config={{ threshold: 0.5, mode: 'summary', maxRows: 100 }}` creates a brand-new object on every render of `ReportDashboard`. `useMemo` in `ReportPanel.tsx:11` does a referential equality check (`===`) on its deps. The `config` object always fails that check because it is always a new reference. Every render of `ReportDashboard` — including the ones triggered by `setActiveFilter` on every filter click — passes a new `config` object, unconditionally invalidating the memo.

---

## 2. Root Cause

**File:** `ReportDashboard.tsx`, **line 33**

```tsx
config={{ threshold: 0.5, mode: 'summary', maxRows: 100 }}
```

An object literal in JSX is `Object.is`-unequal to itself across renders. `useMemo`'s dependency check sees a new `config` on every render and re-runs `runHeavyAggregation` every time.

---

## 3. Causal Chain

```
[ReportDashboard.tsx:11] setActiveFilter called on filter click → state change → re-render
  → [ReportDashboard.tsx:33] new config object literal allocated: { threshold: 0.5, ... }
  → [ReportPanel.tsx:11] useMemo checks deps: data unchanged, config !== previous config (new ref)
  → [ReportPanel.tsx:12] memo invalidated → runHeavyAggregation(data, config) called
  → [aggregations.ts:28] aggregationCallCount++ → expensive computation runs
  → Symptom: 60-80% frame budget consumed on every filter interaction
```

---

## 4. Proximate Trap

The report blames **`aggregations.ts`** — specifically `computedAt: Date.now()` and the `byCategory` object construction making results "referentially unstable." This is wrong. `useMemo` doesn't re-run because of what the memoized function *returns* — it re-runs because of what it *receives* as inputs. The output's reference stability is irrelevant to the cache invalidation decision. Removing `computedAt` (as the developer tried) had no effect for exactly this reason.

---

## 5. Minimal Fix

Lift the config object out of the render cycle in `ReportDashboard.tsx` so its reference is stable:

```tsx
// Outside the component, or inside with useMemo
const REPORT_CONFIG: ReportConfig = { threshold: 0.5, mode: 'summary', maxRows: 100 };

export function ReportDashboard({ data }: ReportDashboardProps) {
  // ...
  return (
    // ...
    <ReportPanel data={filteredData} config={REPORT_CONFIG} />
  );
}
```

A module-level constant is the simplest fix since the config values are static. If the config were dynamic, `useMemo` in `ReportDashboard` with the relevant deps would be the right tool. No changes needed in `ReportPanel.tsx`, `aggregations.ts`, or `useReportData.ts`.