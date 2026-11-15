"use client";

import { Suspense } from "react";
import FeatureGate from "@/components/FeatureGate";
import PermissionGuard from "@/components/PermissionGuard";
import StockPage from "@/components/stock/StockPage";

/**
 * Stock, organised the way the cupboard is.
 *
 * The page that lived here before tracked counts in a table nobody updated; seven months of
 * live data held one clinic's test items and three clicks. This one is built around the
 * physical drawer: codes, labels, photos, a weekly count, deliveries by barcode, and reports
 * computed from those. The old `inventory` collections are left untouched.
 */
export default function InventoryPage() {
  return (
    <FeatureGate feature="inventory">
      <PermissionGuard permission="access.inventory">
        {/* useSearchParams inside the page needs a Suspense boundary above it to prerender. */}
        <Suspense fallback={null}>
          <StockPage />
        </Suspense>
      </PermissionGuard>
    </FeatureGate>
  );
}
