"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Task } from "@/lib/types";
import { apiFetch } from "@/lib/apiClient";
import { notifyScheduleChanged } from "@/lib/scheduleBus";
import { onTasksChanged } from "@/lib/taskBus";
import { onSessionsChanged } from "@/lib/sessionsBus";
import { writeLocalSchedule, type ScheduledBlock } from "@/lib/useSchedule";

type PlannerTask = Task & { workflowState?: string; blocked?: boolean };

const DEFAULT_AVAIL: Record<number, number> = { 0: 120, 1: 240, 2: 240, 3: 240, 4: 240, 5: 240, 6: 120 };

function chicagoYmd(value: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  date.setDate(date.getDate() + days);
  return chicagoYmd(date);
}

function dowFor(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getDay();
}

function hhmmMinutes(value?: string | null): number | null {
  const raw = String(value || "").trim().toLowerCase();
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m?)?$/.exec(raw);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const ap = match[3]?.startsWith("p") ? "pm" : match[3]?.startsWith("a") ? "am" : "";
  if (ap) {
    if (hour === 12) hour = 0;
    if (ap === "pm") hour += 12;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function intervalMinutes(items: any[]): number {
  const intervals = (Array.isArray(items) ? items : [])
    .map(item => [hhmmMinutes(item?.start), hhmmMinutes(item?.end)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] != null && pair[1] != null && pair[1] > pair[0])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    if (!merged.length || start > merged[merged.length - 1][1]) merged.push([start, end]);
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], end);
  }
  return merged.reduce((sum, [start, end]) => sum + (end - start), 0);
}

function capacityForDay(day: string, settings: Record<string, any>): number {
  const dow = dowFor(day);
  const windows = settings.availabilityWindowsV1?.[dow] || settings.availabilityWindowsV1?.[String(dow)] || [];
  const breaks = settings.availabilityBreaksV1?.[dow] || settings.availabilityBreaksV1?.[String(dow)] || [];
  if (Array.isArray(windows) && windows.length) {
    return Math.max(0, intervalMinutes(windows) - intervalMinutes(Array.isArray(breaks) ? breaks : []));
  }
  const template = settings.availabilityTemplateV1 || {};
  const configured = Object.values(template).some(value => Number(value) > 0);
  return Math.max(0, Number(configured ? template[dow] ?? template[String(dow)] : DEFAULT_AVAIL[dow]) || 0);
}

function fingerprint(blocks: ScheduledBlock[]): string {
  return blocks
    .map(block => `${block.id}|${block.taskId}|${block.day}|${Math.round(block.plannedMinutes)}`)
    .sort()
    .join("\n");
}

function dueKey(task: PlannerTask, fallback: string): string {
  const raw = String(task.dueDate || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

/**
 * Quietly keeps the durable week plan aligned with actual progress:
 * - completed tasks lose future blocks;
 * - work left behind on earlier days is carried into the next available study capacity;
 * - future blocks shrink as logged time reduces the remaining estimate.
 *
 * It deliberately does not auto-schedule tasks that were never placed on the
 * week plan, so the tracker stays advisory instead of taking over the calendar.
 */
export default function AutoRebalanceManager() {
  const running = useRef(false);
  const lastFingerprint = useRef("");

  const rebalance = useCallback(async () => {
    if (running.current || document.visibilityState === "hidden") return;
    running.current = true;
    try {
      const [settingsData, taskData, scheduleData] = await Promise.all([
        apiFetch<{ settings: Record<string, any> }>("/api/settings?keys=autoRebalanceEnabled,availabilityTemplateV1,availabilityWindowsV1,availabilityBreaksV1"),
        apiFetch<{ tasks: PlannerTask[] }>("/api/tasks/workspace?allTerms=true"),
        apiFetch<{ blocks: ScheduledBlock[] }>("/api/schedule"),
      ]);
      const settings = settingsData?.settings || {};
      if (settings.autoRebalanceEnabled === false) return;

      const today = chicagoYmd();
      const tasks = Array.isArray(taskData?.tasks) ? taskData.tasks : [];
      const original = Array.isArray(scheduleData?.blocks) ? scheduleData.blocks : [];
      const taskMap = new Map(tasks.map(task => [String(task.id), task]));

      const carry = new Map<string, number>();
      let next: ScheduledBlock[] = [];
      for (const block of original) {
        const task = taskMap.get(String(block.taskId));
        if (!task || task.status === "done" || task.workflowState === "done" || task.workflowState === "canceled" || task.blocked) continue;
        if (block.day < today) {
          carry.set(String(block.taskId), (carry.get(String(block.taskId)) || 0) + Math.max(0, Number(block.plannedMinutes) || 0));
          continue;
        }
        next.push({ ...block, plannedMinutes: Math.max(1, Math.round(Number(block.plannedMinutes) || 1)) });
      }

      // As real work is logged, do not leave more future time scheduled than
      // the task's remaining estimate. Trim from the latest blocks first.
      for (const task of tasks) {
        if (task.status === "done" || task.workflowState === "done" || task.workflowState === "canceled" || task.blocked || !Number(task.estimatedMinutes)) continue;
        const remaining = Math.max(0, Math.round(Number(task.estimatedMinutes)));
        const indices = next
          .map((block, index) => ({ block, index }))
          .filter(item => String(item.block.taskId) === String(task.id))
          .sort((a, b) => b.block.day.localeCompare(a.block.day) || b.index - a.index);
        let planned = indices.reduce((sum, item) => sum + item.block.plannedMinutes, 0);
        let excess = Math.max(0, planned - remaining);
        for (const item of indices) {
          if (excess <= 0) break;
          const current = next[item.index]?.plannedMinutes || 0;
          const cut = Math.min(current, excess);
          if (cut >= current) next[item.index] = { ...next[item.index], plannedMinutes: 0 };
          else next[item.index] = { ...next[item.index], plannedMinutes: current - cut };
          excess -= cut;
        }
        next = next.filter(block => block.plannedMinutes > 0);
      }

      const plannedByDay = new Map<string, number>();
      for (const block of next) plannedByDay.set(block.day, (plannedByDay.get(block.day) || 0) + block.plannedMinutes);

      const carryItems = [...carry.entries()]
        .map(([taskId, missed]) => ({ task: taskMap.get(taskId), missed }))
        .filter((item): item is { task: PlannerTask; missed: number } => Boolean(item.task && item.task.status !== "done" && item.task.workflowState !== "done" && item.task.workflowState !== "canceled" && !item.task.blocked && item.missed > 0))
        .sort((a, b) => dueKey(a.task, today).localeCompare(dueKey(b.task, today)) || (a.task.priority || 9) - (b.task.priority || 9));

      for (const { task, missed } of carryItems) {
        const futurePlanned = next.filter(block => String(block.taskId) === String(task.id)).reduce((sum, block) => sum + block.plannedMinutes, 0);
        const estimate = Math.max(0, Number(task.estimatedMinutes) || 0);
        const remainingEstimate = estimate > 0 ? estimate : missed + futurePlanned;
        let amount = Math.min(missed, Math.max(0, remainingEstimate - futurePlanned));
        if (amount <= 0) continue;

        const due = dueKey(task, today);
        const preferredEnd = due >= today ? due : today;
        const horizon = addDays(today, 21);
        const candidateDays: string[] = [];
        for (let offset = 0; offset <= 21; offset++) {
          const day = addDays(today, offset);
          if (day <= preferredEnd) candidateDays.push(day);
        }
        for (let offset = 0; offset <= 21; offset++) {
          const day = addDays(today, offset);
          if (day > preferredEnd && day <= horizon) candidateDays.push(day);
        }

        for (const day of candidateDays) {
          if (amount <= 0) break;
          const cap = capacityForDay(day, settings);
          const used = plannedByDay.get(day) || 0;
          const slack = Math.max(0, cap - used);
          if (slack <= 0) continue;
          const chunk = Math.min(amount, slack, 90);
          next.push({
            id: `auto-${task.id}-${day}-${Math.random().toString(36).slice(2, 8)}`,
            taskId: task.id,
            day,
            plannedMinutes: Math.round(chunk),
            guessed: false,
            title: task.title,
            course: task.course || "",
            pages: task.pagesRead || null,
            priority: task.priority || null,
            catchup: true,
          });
          plannedByDay.set(day, used + chunk);
          amount -= chunk;
        }
      }

      const before = fingerprint(original);
      const after = fingerprint(next);
      if (before === after || after === lastFingerprint.current) return;
      lastFingerprint.current = after;
      await apiFetch("/api/schedule", { method: "PUT", body: { blocks: next } });
      writeLocalSchedule(next);
      notifyScheduleChanged();
    } catch {
      // This is background maintenance. A failed pass should not interrupt the user.
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void rebalance(), 1200);
    const interval = window.setInterval(() => void rebalance(), 10 * 60 * 1000);
    const offTasks = onTasksChanged(() => window.setTimeout(() => void rebalance(), 600));
    const offSessions = onSessionsChanged(() => window.setTimeout(() => void rebalance(), 600));
    const onVisible = () => { if (document.visibilityState === "visible") void rebalance(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      offTasks();
      offSessions();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rebalance]);

  return null;
}
