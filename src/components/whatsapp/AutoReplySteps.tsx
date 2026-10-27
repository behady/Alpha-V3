"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { AutoReplyStep } from "@/lib/bot/brief";

export type AutoReplyStepRow = {
  id: AutoReplyStep;
  optional: boolean;
  title: string;
  badge?: string;
  content: ReactNode;
};

/**
 * The chosen mode's setup steps as a numbered list, one open at a time.
 *
 * Closed steps stay mounted (hidden), as the old tabs did: the playground keeps its conversation
 * and a half-typed box keeps its text when the owner looks at another step and comes back.
 */
export default function AutoReplySteps({
  steps,
  open,
  onOpen,
}: {
  steps: AutoReplyStepRow[];
  open: AutoReplyStep | null;
  onOpen: (id: AutoReplyStep | null) => void;
}) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => {
        const isOpen = open === step.id;
        const panelId = `autoreply-step-panel-${step.id}`;
        return (
          <li
            key={step.id}
            className={`rounded-xl border transition-colors ${isOpen ? "border-line-strong bg-surface" : "border-line bg-surface-subtle"}`}
          >
            <button
              type="button"
              data-tour={`autoreply-step-${step.id}`}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => onOpen(isOpen ? null : step.id)}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-start hover:bg-surface-muted/60"
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full font-figure text-[13px] font-bold tabular-nums ${
                  isOpen ? "bg-accent text-ink-on-accent" : "bg-surface-muted text-ink-body"
                }`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm font-black text-ink">{step.title}</span>
              {step.badge && (
                <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] font-bold text-ink-muted">
                  {step.badge}
                </span>
              )}
              <ChevronDown size={16} className={`shrink-0 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            <div id={panelId} hidden={!isOpen} className="border-t border-line px-4 py-4">
              {step.content}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
