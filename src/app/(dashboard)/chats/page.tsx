"use client";

import { Suspense } from "react";
import PermissionGuard from "@/components/PermissionGuard";
import ChatsPanel from "@/components/ai/ChatsPanel";
import { useLanguage } from "@/context/LanguageContext";
import PageHeader from "@/components/dashboard/PageHeader";

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
  const { isRTL, language } = useLanguage();
  return (
    <PermissionGuard permission="access.patients" allowedRoles={["Admin", "Owner"]}>
      {/* Compact: the thread list and the conversation both scroll inside themselves, so any
          height the header takes comes straight out of the messages on screen. */}
      <PageHeader compact title={language === "ar" ? "المحادثات" : "WhatsApp"} />
      <div className="flex h-full min-h-0 flex-col p-3 md:p-5 lg:p-6 pb-24 lg:pb-6" dir={isRTL ? "rtl" : "ltr"}>
        {/* useSearchParams inside the panel needs a Suspense boundary above it to prerender. */}
        <Suspense fallback={null}>
          {/* `h-full` rather than a 100dvh calculation: the layout is a flex column now, so the
              panel simply takes what is left under the black band. The old calculation hard-coded
              a chrome height and broke the day the chrome changed. */}
          <ChatsPanel basePath="/chats" heightClass="h-full min-h-0" />
        </Suspense>
      </div>
    </PermissionGuard>
  );
}
