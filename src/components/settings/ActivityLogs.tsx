"use client";

/*
 * Settings → Activity log (owner and admins; the registry's `logs` panel, ADMIN view). The page
 * itself is the shared activity feed, which the patient file also uses with a fixed patient.
 */

import ActivityFeed from "@/components/activity/ActivityFeed";

export default function ActivityLogs() {
  return <ActivityFeed />;
}
