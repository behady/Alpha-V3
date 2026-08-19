"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, AlertTriangle, Calendar, Package, Trash2, ChevronRight, BellRing, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, limit, onSnapshot, doc, writeBatch } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useRouter } from "next/navigation";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { enableFcmPushForUser } from "@/lib/fcmClient";

// --- TELL TYPESCRIPT EXACTLY WHAT A NOTIFICATION LOOKS LIKE ---
interface AppNotification {
  id: string;
  title: string;
  body: string;
  eventType: string;
  actionUrl?: string; // This is the secret link!
  read: boolean;
  createdAt?: any;
}

export default function NotificationBell() {
  const { language } = useLanguage();
  const router = useRouter();
  
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /**
   * Device push registration. Historically only the reception-summon overlay ever asked for
   * notification permission, so admins and dentists silently had zero registered devices and
   * every push (review alerts, lead alerts, complaints) went nowhere. Two repairs here:
   * already-granted browsers re-register their token quietly on load, and everyone else gets
   * a visible "enable" button inside the bell.
   */
  const [pushState, setPushState] = useState<"unknown" | "needed" | "enabling" | "on" | "blocked">("unknown");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      // Permission exists but the token may never have been saved — self-heal silently.
      void enableFcmPushForUser().then((r) => setPushState(r.ok ? "on" : "needed"));
    } else if (Notification.permission === "denied") {
      setPushState("blocked");
    } else {
      setPushState("needed");
    }
  }, []);

  const enablePush = async () => {
    setPushState("enabling");
    const r = await enableFcmPushForUser();
    if (r.ok) setPushState("on");
    else if (r.reason === "denied") setPushState("blocked");
    else setPushState("needed");
  };

  useEffect(() => {
    const q = query(getClinicCollection("notifications"), orderBy("createdAt", "desc"), limit(20));
    const unsubscribe = onSnapshot(q, (snap) => {
      const notifs = snap.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as AppNotification));
      
      setNotifications(notifs);
      setUnreadCount(notifs.filter(n => !n.read).length);
    });

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      unsubscribe();
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const markAllAsRead = async () => {
    const batch = writeBatch(db);
    notifications.forEach(n => {
      if (!n.read) batch.update(getClinicDoc("notifications", n.id), { read: true });
    });
    await batch.commit();
  };

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    // Mark as read when opening the menu
    if (!isOpen && unreadCount > 0) markAllAsRead();
  };

  const clearAll = async () => {
    const batch = writeBatch(db);
    notifications.forEach(n => batch.delete(getClinicDoc("notifications", n.id)));
    await batch.commit();
    setIsOpen(false);
  };

  // --- THE CLICK HANDLER ---
  const handleNotificationClick = (n: AppNotification) => {
    if (n.actionUrl) {
       router.push(n.actionUrl); // Teleport to the page
       setIsOpen(false); // Close the dropdown menu automatically
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={toggleDropdown} 
        className="relative p-2.5 bg-white hover:bg-gray-50 rounded-xl text-gray-600 transition-colors border border-gray-200 shadow-sm"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white shadow-sm animate-in zoom-in">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 md:w-96 bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-in slide-in-from-top-4">
          <div className="bg-gray-50 px-5 py-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-black text-gray-900">{language === 'ar' ? 'الإشعارات' : 'Notifications'}</h3>
            {notifications.length > 0 && (
              <button onClick={clearAll} className="text-xs font-bold text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1">
                <Trash2 size={14}/> {language === 'ar' ? 'مسح الكل' : 'Clear All'}
              </button>
            )}
          </div>
          
          {pushState === "needed" && (
            <button
              onClick={enablePush}
              className="w-full flex items-center gap-2.5 px-5 py-3 bg-emerald-50 hover:bg-emerald-100 border-b border-emerald-100 text-start transition-colors"
            >
              <BellRing size={16} className="text-emerald-600 shrink-0" />
              <span className="text-xs font-black text-emerald-800">
                {language === 'ar'
                  ? 'فعّل الإشعارات على هذا الجهاز — تنبيهات العملاء والتقييمات تصلك هنا'
                  : 'Enable notifications on this device — lead & review alerts arrive here'}
              </span>
            </button>
          )}
          {pushState === "enabling" && (
            <div className="w-full flex items-center gap-2.5 px-5 py-3 bg-emerald-50 border-b border-emerald-100">
              <Loader2 size={16} className="text-emerald-600 animate-spin shrink-0" />
              <span className="text-xs font-black text-emerald-800">
                {language === 'ar' ? 'جارٍ التفعيل… اسمح للإشعارات لو سألك المتصفح' : 'Enabling… allow notifications if the browser asks'}
              </span>
            </div>
          )}
          {pushState === "blocked" && (
            <div className="w-full px-5 py-3 bg-amber-50 border-b border-amber-100">
              <span className="text-xs font-bold text-amber-800">
                {language === 'ar'
                  ? 'الإشعارات محظورة لهذا الموقع — فعّلها من إعدادات المتصفح (رمز القفل بجوار العنوان)'
                  : 'Notifications are blocked for this site — allow them from the browser settings (the lock icon by the address)'}
              </span>
            </div>
          )}

          <div className="max-h-[400px] overflow-y-auto p-2">
            {notifications.length === 0 ? (
              <div className="text-center py-10 opacity-50 flex flex-col items-center">
                <Bell size={32} className="mb-2 text-gray-300"/>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{language === 'ar' ? 'لا توجد إشعارات' : 'All caught up!'}</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div 
                  key={n.id} 
                  onClick={() => handleNotificationClick(n)}
                  className={`p-3 rounded-2xl mb-1 flex items-start gap-3 transition-colors ${n.actionUrl ? 'cursor-pointer group' : ''} ${!n.read ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="mt-1 shrink-0">
                    {n.eventType === 'cancellation' ? <AlertTriangle size={16} className="text-red-500" /> : 
                     n.eventType === 'lowInventory' ? <Package size={16} className="text-orange-500" /> :
                     <Calendar size={16} className="text-blue-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!n.read ? 'font-black text-gray-900' : 'font-bold text-gray-700'} ${n.actionUrl ? 'group-hover:text-primary-600 transition-colors' : ''}`}>
                      {n.title.split('|')[language === 'ar' ? 1 : 0]}
                    </p>
                    <p className="text-xs font-medium text-gray-500 mt-0.5 leading-tight whitespace-pre-wrap">{n.body}</p>
                  </div>
                  {/* Shows a little arrow if the notification is clickable */}
                  {n.actionUrl && (
                     <ChevronRight size={14} className="text-gray-300 group-hover:text-primary-400 group-hover:translate-x-1 transition-all mt-1 shrink-0 opacity-0 group-hover:opacity-100" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}