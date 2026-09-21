"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/apiClient";
import { useCourses } from "@/lib/useCourses";
import { notifyToast } from "@/lib/toastBus";
import {
  addDaysYmd,
  chicagoYmd,
  dueForReview,
  normalizeRuleBank,
  reviewRule,
  type ReviewRating,
  type RuleBankEntry,
  type RuleConfidence,
} from "@/lib/ruleBank";

type Draft = {
  course: string;
  topic: string;
  ruleText: string;
  source: string;
  exceptions: string;
  example: string;
  confidence: RuleConfidence;
};

const EMPTY: Draft = {
  course: "",
  topic: "",
  ruleText: "",
  source: "",
  exceptions: "",
  example: "",
  confidence: 3,
};

function uid(): string {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function confidenceLabel(value: number): string {
  if (value <= 1) return "Weak";
  if (value === 2) return "Shaky";
  if (value === 3) return "Developing";
  if (value === 4) return "Strong";
  return "Solid";
}

export default function RulesPage() {
  const { courses } = useCourses();
  const [rules, setRules] = useState<RuleBankEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const today = chicagoYmd();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<{ settings: Record<string, unknown> }>("/api/settings?keys=ruleBankV1");
        if (!cancelled) setRules(normalizeRuleBank(data?.settings?.ruleBankV1));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setReviewMode(params.get("review") === "1");
      const course = params.get("course");
      if (course) setCourseFilter(course);
      const query = params.get("q");
      if (query) setSearch(query);
    }
    return () => { cancelled = true; };
  }, []);

  async function persist(next: RuleBankEntry[], message?: string) {
    setRules(next);
    setSaving(true);
    try {
      await apiFetch("/api/settings", { method: "PATCH", body: { ruleBankV1: next } });
      if (message) notifyToast({ kind: "success", message });
    } catch (error: any) {
      notifyToast({ kind: "error", message: error?.message || "Could not save the rule bank." });
    } finally {
      setSaving(false);
    }
  }

  const dueRules = useMemo(() => rules
    .filter(rule => dueForReview(rule, today))
    .sort((a, b) => a.nextReview.localeCompare(b.nextReview) || a.course.localeCompare(b.course) || a.topic.localeCompare(b.topic)), [rules, today]);

  const currentReview = dueRules[0] || null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules
      .filter(rule => !courseFilter || rule.course === courseFilter)
      .filter(rule => !dueOnly || dueForReview(rule, today))
      .filter(rule => !q || [rule.course, rule.topic, rule.ruleText, rule.source, rule.exceptions, rule.example].some(value => String(value || "").toLowerCase().includes(q)))
      .sort((a, b) => {
        const dueDiff = Number(dueForReview(b, today)) - Number(dueForReview(a, today));
        if (dueDiff) return dueDiff;
        return a.course.localeCompare(b.course) || a.topic.localeCompare(b.topic);
      });
  }, [rules, search, courseFilter, dueOnly, today]);

  function resetDraft() {
    setDraft(EMPTY);
    setEditingId(null);
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.ruleText.trim() || !draft.topic.trim()) return;
    const now = new Date().toISOString();
    if (editingId) {
      const next = rules.map(rule => rule.id === editingId ? {
        ...rule,
        course: draft.course.trim(),
        topic: draft.topic.trim(),
        ruleText: draft.ruleText.trim(),
        source: draft.source.trim() || null,
        exceptions: draft.exceptions.trim() || null,
        example: draft.example.trim() || null,
        confidence: draft.confidence,
        updatedAt: now,
      } : rule);
      await persist(next, "Rule updated.");
    } else {
      const entry: RuleBankEntry = {
        id: uid(),
        course: draft.course.trim(),
        topic: draft.topic.trim(),
        ruleText: draft.ruleText.trim(),
        source: draft.source.trim() || null,
        exceptions: draft.exceptions.trim() || null,
        example: draft.example.trim() || null,
        confidence: draft.confidence,
        createdAt: now,
        updatedAt: now,
        nextReview: addDaysYmd(today, 1),
        reviewStep: 0,
        reviewCount: 0,
      };
      await persist([entry, ...rules], "Rule added.");
    }
    resetDraft();
  }

  function editRule(rule: RuleBankEntry) {
    setEditingId(rule.id);
    setDraft({
      course: rule.course,
      topic: rule.topic,
      ruleText: rule.ruleText,
      source: rule.source || "",
      exceptions: rule.exceptions || "",
      example: rule.example || "",
      confidence: rule.confidence,
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeRule(rule: RuleBankEntry) {
    if (!confirm(`Delete the rule "${rule.topic}"?`)) return;
    await persist(rules.filter(item => item.id !== rule.id), "Rule deleted.");
  }

  async function rateCurrent(rating: ReviewRating) {
    if (!currentReview) return;
    const updated = reviewRule(currentReview, rating, today);
    await persist(rules.map(rule => rule.id === updated.id ? updated : rule));
    setRevealed(false);
  }

  async function reviewSoon(rule: RuleBankEntry) {
    const next = rules.map(item => item.id === rule.id ? { ...item, nextReview: today, updatedAt: new Date().toISOString() } : item);
    await persist(next, "Added to today's review queue.");
    setReviewMode(true);
    setRevealed(false);
  }

  if (loading) return <main className="space-y-4"><div className="text-sm text-slate-400">Loading rule bank…</div></main>;

  return <main className="space-y-5">
    <section className="grid gap-3 md:grid-cols-3">
      <div className="card p-4"><div className="text-[10px] uppercase tracking-wider text-slate-500">Rules</div><div className="mt-2 text-2xl font-medium">{rules.length}</div><div className="mt-1 text-xs text-slate-500">Across all courses</div></div>
      <div className="card p-4"><div className="text-[10px] uppercase tracking-wider text-slate-500">Due for review</div><div className="mt-2 text-2xl font-medium text-amber-300">{dueRules.length}</div><div className="mt-1 text-xs text-slate-500">{dueRules.length ? "Ready in the spaced-review queue" : "Nothing due today"}</div></div>
      <div className="card p-4"><div className="text-[10px] uppercase tracking-wider text-slate-500">Strong rules</div><div className="mt-2 text-2xl font-medium">{rules.filter(rule => rule.confidence >= 4).length}</div><div className="mt-1 text-xs text-slate-500">Confidence 4 or 5</div></div>
    </section>

    {(reviewMode || dueRules.length > 0) && <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-medium">Spaced review</h2><p className="mt-1 text-sm text-slate-400">{dueRules.length ? `${dueRules.length} rule${dueRules.length === 1 ? "" : "s"} due today.` : "Your review queue is clear."}</p></div>
        <button type="button" onClick={() => { setReviewMode(value => !value); setRevealed(false); }} className="rounded border border-[#29405f] px-3 py-1.5 text-xs text-slate-300">{reviewMode ? "Hide review" : "Start review"}</button>
      </div>
      {reviewMode && currentReview ? <div className="mt-5 rounded-xl border border-[#29405f] bg-[#0a1728] p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{currentReview.course || "Unassigned"}</span><span>•</span><span>{currentReview.topic}</span><span>•</span><span>{confidenceLabel(currentReview.confidence)}</span></div>
        {!revealed ? <div className="py-10 text-center">
          <div className="text-sm text-slate-400">State the rule from memory, then reveal it.</div>
          <button type="button" onClick={() => setRevealed(true)} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white">Reveal rule</button>
        </div> : <div className="mt-5 space-y-4">
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Rule</div><div className="mt-2 whitespace-pre-wrap text-base leading-relaxed">{currentReview.ruleText}</div></div>
          {currentReview.exceptions && <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Exceptions / limits</div><div className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{currentReview.exceptions}</div></div>}
          {currentReview.example && <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Example</div><div className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{currentReview.example}</div></div>}
          {currentReview.source && <div className="text-xs text-slate-500">Source: {currentReview.source}</div>}
          <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
            <button type="button" onClick={() => void rateCurrent("again")} className="rounded border border-rose-800/70 px-3 py-2 text-sm text-rose-300">Again</button>
            <button type="button" onClick={() => void rateCurrent("hard")} className="rounded border border-amber-700/70 px-3 py-2 text-sm text-amber-300">Hard</button>
            <button type="button" onClick={() => void rateCurrent("good")} className="rounded border border-emerald-700/70 px-3 py-2 text-sm text-emerald-300">Good</button>
            <button type="button" onClick={() => void rateCurrent("easy")} className="rounded border border-blue-700/70 px-3 py-2 text-sm text-blue-300">Easy</button>
          </div>
        </div>}
      </div> : reviewMode ? <div className="mt-4 rounded border border-emerald-700/40 bg-emerald-950/20 p-4 text-sm text-emerald-300">Review queue complete.</div> : null}
    </section>}

    <section className="card p-5 space-y-4">
      <div><h2 className="text-lg font-medium">{editingId ? "Edit rule" : "Add rule"}</h2><p className="mt-1 text-sm text-slate-400">Keep the actual legal rule separate from ordinary reading and class notes.</p></div>
      <form onSubmit={saveRule} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_150px]">
          <label className="text-xs text-slate-400">Course<select value={draft.course} onChange={event => setDraft(prev => ({ ...prev, course: event.target.value }))} className="mt-1 w-full px-3 py-2"><option value="">Unassigned</option>{courses.map(course => <option key={course.id} value={course.title}>{course.title}</option>)}</select></label>
          <label className="text-xs text-slate-400">Topic<input value={draft.topic} onChange={event => setDraft(prev => ({ ...prev, topic: event.target.value }))} placeholder="e.g. FRE 407" className="mt-1 w-full px-3 py-2" /></label>
          <label className="text-xs text-slate-400">Confidence<select value={draft.confidence} onChange={event => setDraft(prev => ({ ...prev, confidence: Number(event.target.value) as RuleConfidence }))} className="mt-1 w-full px-3 py-2">{[1,2,3,4,5].map(value => <option key={value} value={value}>{value} · {confidenceLabel(value)}</option>)}</select></label>
        </div>
        <label className="block text-xs text-slate-400">Rule<textarea rows={4} value={draft.ruleText} onChange={event => setDraft(prev => ({ ...prev, ruleText: event.target.value }))} placeholder="Write the rule in the form you want to remember it." className="mt-1 w-full px-3 py-2" /></label>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="text-xs text-slate-400">Source<input value={draft.source} onChange={event => setDraft(prev => ({ ...prev, source: event.target.value }))} placeholder="Rule, case, statute…" className="mt-1 w-full px-3 py-2" /></label>
          <label className="text-xs text-slate-400">Exceptions / limits<textarea rows={2} value={draft.exceptions} onChange={event => setDraft(prev => ({ ...prev, exceptions: event.target.value }))} className="mt-1 w-full px-3 py-2" /></label>
          <label className="text-xs text-slate-400">Example<textarea rows={2} value={draft.example} onChange={event => setDraft(prev => ({ ...prev, example: event.target.value }))} className="mt-1 w-full px-3 py-2" /></label>
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={saving || !draft.topic.trim() || !draft.ruleText.trim()} className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? "Saving…" : editingId ? "Save changes" : "Add rule"}</button>
          {editingId && <button type="button" onClick={resetDraft} className="rounded border border-[#29405f] px-4 py-2 text-sm text-slate-300">Cancel</button>}
        </div>
      </form>
    </section>

    <section className="card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-medium">Rule bank</h2><div className="mt-1 text-xs text-slate-500">{filtered.length} shown</div></div>
        <div className="flex flex-wrap gap-2">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search rules…" className="w-52 px-3 py-2 text-sm" />
          <select value={courseFilter} onChange={event => setCourseFilter(event.target.value)} className="px-3 py-2 text-sm"><option value="">All courses</option>{courses.map(course => <option key={course.id} value={course.title}>{course.title}</option>)}</select>
          <label className="flex items-center gap-2 rounded border border-[#29405f] px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={dueOnly} onChange={event => setDueOnly(event.target.checked)} />Due only</label>
        </div>
      </div>

      {filtered.length ? <div className="mt-4 divide-y divide-white/10">
        {filtered.map(rule => <div key={rule.id} className="py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{rule.topic}</span>{rule.course && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">{rule.course}</span>}{dueForReview(rule, today) && <span className="rounded-full border border-amber-700/50 bg-amber-950/20 px-2 py-0.5 text-[10px] text-amber-300">Due</span>}</div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{rule.ruleText}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>{confidenceLabel(rule.confidence)}</span><span>Next review {rule.nextReview}</span><span>{rule.reviewCount} review{rule.reviewCount === 1 ? "" : "s"}</span>{rule.source && <span>{rule.source}</span>}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => void reviewSoon(rule)} className="rounded border border-[#29405f] px-2.5 py-1.5 text-xs text-blue-300">Review</button>
              <button type="button" onClick={() => editRule(rule)} className="rounded border border-[#29405f] px-2.5 py-1.5 text-xs text-slate-300">Edit</button>
              <button type="button" onClick={() => void removeRule(rule)} className="rounded border border-rose-900/70 px-2.5 py-1.5 text-xs text-rose-300">Delete</button>
            </div>
          </div>
        </div>)}
      </div> : <div className="mt-5 rounded border border-white/10 p-6 text-center text-sm text-slate-500">No rules match these filters.</div>}
    </section>

    <div className="text-xs text-slate-500">Rules are stored with the rest of your tracker settings and follow you across devices. <Link href="/review" className="text-blue-300 hover:underline">Open study review</Link>.</div>
  </main>;
}
