"use client";

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { TUTORIALS, type Tutorial } from "@/lib/tutorials";

/**
 * Who is being walked through what.
 *
 * A tutorial is a sequence of "click here" steps that spans page navigations — the state cannot
 * live in the chat widget that starts it, because the widget closes and the user moves between
 * routes while the walkthrough runs. So it lives here, mounted once in the dashboard layout,
 * and three parties talk to it: the chat widget starts (and cancels) tutorials, the overlay
 * renders the current step and advances it, and nothing else needs to know it exists.
 *
 * Deliberately NOT persisted. A half-finished tutorial restored after a reload would point its
 * ring at a page the user is no longer on, mid-flow — confusing in exactly the way a tutorial
 * must never be. Reloading ends the lesson; asking again restarts it from the top.
 */
interface TutorialContextType {
  /** The running tutorial, or null. */
  activeTutorial: Tutorial | null;
  stepIndex: number;
  /** Starts from step 0. Unknown ids are ignored — the caller validated against TUTORIALS. */
  startTutorial: (id: string) => boolean;
  /** Ends it silently, from any of: the Cancel button, Escape, or typing "cancel" at the chat. */
  cancelTutorial: () => void;
  /** Moves to the next step; past the last step it ends the tutorial and reports completion. */
  advanceStep: () => void;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [activeTutorial, setActiveTutorial] = useState<Tutorial | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const startTutorial = useCallback((id: string): boolean => {
    const tutorial = TUTORIALS.find((t) => t.id === id);
    if (!tutorial || tutorial.steps.length === 0) return false;
    setActiveTutorial(tutorial);
    setStepIndex(0);
    return true;
  }, []);

  const cancelTutorial = useCallback(() => {
    setActiveTutorial(null);
    setStepIndex(0);
  }, []);

  const advanceStep = useCallback(() => {
    setStepIndex((i) => i + 1);
  }, []);

  const value = useMemo(
    () => ({ activeTutorial, stepIndex, startTutorial, cancelTutorial, advanceStep }),
    [activeTutorial, stepIndex, startTutorial, cancelTutorial, advanceStep],
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial must be used within TutorialProvider");
  return ctx;
}
