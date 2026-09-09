"use client";

import React from "react";
import { useClinic } from "@/context/ClinicContext";
import { hasFeature, type TierFeatures } from "@/lib/subscriptions";
import { UpgradeRequired } from "@/components/UpgradeRequired";

/**
 * Wraps a whole page in a plan check.
 *
 * Used by renaming the page's component and exporting this around it, rather than by an early
 * `return` inside the page: the pages it guards call a dozen hooks before their first render, and
 * an early return above those trips the rules of hooks. Wrapping keeps the page untouched.
 */
export function FeatureGate({
  feature,
  featureName,
  minTier,
  children,
}: {
  feature: keyof TierFeatures;
  featureName: string;
  minTier: string;
  children: React.ReactNode;
}) {
  const { clinic } = useClinic();
  if (!hasFeature(clinic, feature)) {
    return (
      <div className="p-4 lg:p-8">
        <UpgradeRequired featureName={featureName} minTier={minTier} />
      </div>
    );
  }
  return <>{children}</>;
}
