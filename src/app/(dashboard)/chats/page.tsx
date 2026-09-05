"use client";

import { Suspense } from "react";
import PermissionGuard from "@/components/PermissionGuard";
import ChatsPanel from "@/components/ai/ChatsPanel";
import { useLanguage } from "@/context/LanguageContext";

/**
 * The clinic's WhatsApp, as a page of its own.
 *
 * It started as a tab of the Intelligence page and moved out within the day: a chat screen is
 * opened twenty times a shift and belongs one click from anywhere, with an unread count on the
 * rail — not behind a page whose other tabs are a morning brief and a no-show list.
 *
 * Gated on patient access, the same key the message queue has always used, so reception opens it
 * without anyone editing permissions.
 */
export default function ChatsPage() {
  const { isRTL } = useLanguage();
  return (
    <PermissionGuard permission="access.patients" allowedRoles={["Admin", "Owner"]}>
      <div className="h-full min-h-0 p-3 md:p-5 lg:p-6 pb-24 lg:pb-6" dir={isRTL ? "rtl" : "ltr"}>
        {/* useSearchParams inside the panel needs a Suspense boundary above it to prerender. */}
        <Suspense fallback={null}>
          {/* Fills the viewport minus the page padding; on phones, minus the bottom bar too. */}
          <ChatsPanel basePath="/chats" heightClass="h-[calc(100dvh-140px)] lg:h-[calc(100dvh-48px)]" />
        </Suspense>
      </div>
    </PermissionGuard>
  );
}
