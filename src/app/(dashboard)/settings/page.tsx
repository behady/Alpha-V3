"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { 
  Building, Building2, MapPin, Clock, Pill, Stethoscope, Users, Bell, Palette, ChevronDown, 
  X, User, Mail, Lock, Badge, Save, MessageCircle, Monitor, CalendarDays, MessagesSquare, Sparkles, Trash2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, collection, onSnapshot, query, orderBy, addDoc, updateDoc } from "firebase/firestore";
import { hasFeature } from "@/lib/subscriptions";

// Sub-components
import NotificationSettings from "@/components/settings/NotificationSettings";
import UserManagement from "@/components/settings/UserManagement";
import AttendanceSettings from "@/components/settings/AttendanceSettings";
import ScheduleSettings from "@/components/settings/ScheduleSettings";
import RecallSettings from "@/components/settings/RecallSettings";
import PrescriptionSettings from "@/components/settings/PrescriptionSettings";
import PricingSettings from "@/components/settings/PricingSettings";
import PriceListSettings from "@/components/settings/PriceListSettings";
import AppearanceSettings from "@/components/settings/AppearanceSettings";
import UserProfile from "@/components/settings/UserProfile"; // <-- NEW IMPORT
import InterfaceSettings from "@/components/settings/InterfaceSettings";
import JoinRequests from "@/components/settings/JoinRequests";
import ActivityLogs from "@/components/settings/ActivityLogs";
import WhatsAppSettings from "@/components/settings/WhatsAppSettings";
import SmsSettings from "@/components/settings/SmsSettings";
import PatientSourcesSettings from "@/components/settings/PatientSourcesSettings";
import VisitReasonsSettings from "@/components/settings/VisitReasonsSettings";
import OnlineBookingSettings from "@/components/settings/OnlineBookingSettings";
import LocationsSettings from "@/components/settings/LocationsSettings";
import AiCreditsSettings from "@/components/settings/AiCreditsSettings";
import { logActivity } from "@/lib/logger";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import RecentlyDeleted from "@/components/settings/RecentlyDeleted";
import { isFullAccessRole } from "@/lib/permissions";
export default function SettingsPage() {
  const { language, isRTL } = useLanguage();
  const { user, loading: authLoading } = useAuth(); 
  const { clinic, clinicId, isAdmin } = useClinic();
  const { showToast } = useUI();

  const [activeTab, setActiveTab] = useState("general");

  // Lets other screens link straight to a tab (e.g. the recalls page pointing at ?tab=recall when
  // no interval is configured). Read from the URL rather than useSearchParams so this does not
  // need a Suspense boundary.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested) setActiveTab(requested);
  }, []);
  const [isTopMenuOpen, setIsTopMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const txt = {
    title: language === 'ar' ? "إعدادات النظام" : "System Settings",
    subtitle: language === 'ar' ? "تكوين معلمات العيادة الخاصة بك." : "Configure your clinic parameters.",
    // Invite / edit team member modal
    userModalAddTitle: language === 'ar' ? "إضافة عضو للفريق" : "Invite Team Member",
    userModalEditTitle: language === 'ar' ? "تعديل الملف الشخصي" : "Edit Profile",
    userFullName: language === 'ar' ? "الاسم الكامل" : "Full Name",
    userEmail: language === 'ar' ? "البريد الإلكتروني" : "Email Address",
    userPassword: language === 'ar' ? "كلمة السر الأولية" : "Initial Password",
    userPasswordHint: language === 'ar' ? "6 حروف على الأقل" : "Minimum 6 characters",
    userRole: language === 'ar' ? "دور النظام" : "System Role",
    roleDentist: language === 'ar' ? "طبيب" : "Dentist",
    roleAssistant: language === 'ar' ? "مساعد" : "Assistant",
    roleReceptionist: language === 'ar' ? "استقبال" : "Receptionist",
    roleAdmin: language === 'ar' ? "مدير" : "Admin",
    userSubmit: language === 'ar' ? "إنشاء حساب الدخول" : "Create System Login",
  };

  const tabs = [
    { id: "general", label: language === 'ar' ? "الملف الشخصي" : "Profile", icon: User },
    { id: "attendance", label: language === 'ar' ? "الحضور" : "Attendance", icon: MapPin, adminOnly: true },
    { id: "clinical", label: language === 'ar' ? "الجدول" : "Schedule", icon: Clock },
    { id: "locations", label: language === 'ar' ? "الفروع والغرف" : "Branches & Rooms", icon: Building2, adminOnly: true },
    { id: "recall", label: language === 'ar' ? "المتابعة" : "Recall", icon: Clock, adminOnly: true },
    { id: "prescriptions", label: language === 'ar' ? "الوصفات" : "Prescriptions", icon: Pill },
    { id: "services", label: language === 'ar' ? "الأسعار" : "Prices", icon: Stethoscope },
    { id: "users", label: language === 'ar' ? "المستخدمين" : "Users", icon: Users, adminOnly: true },
    { id: "join_requests", label: language === 'ar' ? "طلبات الانضمام" : "Join Requests", icon: Users, adminOnly: true },
    { id: "recently_deleted", label: language === 'ar' ? "المحذوفات" : "Recently Deleted", icon: Trash2 },
    { id: "logs", label: language === 'ar' ? "سجل النشاط" : "Activity Logs", icon: Clock, adminOnly: true },
    { id: "ai_credits", label: language === 'ar' ? "رصيد الذكاء الاصطناعي" : "AI Credits", icon: Sparkles, adminOnly: true },
    { id: "notifications", label: language === 'ar' ? "التنبيهات" : "Alerts", icon: Bell, adminOnly: true },
    ...(hasFeature(clinic, "whatsappIntegration") ? [{ id: "whatsapp", label: language === 'ar' ? "واتساب" : "WhatsApp", icon: MessageCircle, adminOnly: true }] : []),
    // Not gated on whatsappIntegration: sending from the clinic's own SIM needs no gateway and no
    // paid integration — it is the fallback for clinics that cannot have one.
    { id: "sms", label: language === 'ar' ? "رسائل نصية" : "SMS", icon: MessagesSquare, adminOnly: true },
    { id: "appearance", label: language === 'ar' ? "المظهر" : "Theme", icon: Palette },
    { id: "interface", label: language === 'ar' ? "واجهة الاستخدام" : "Interface", icon: Monitor },
    { id: "online_booking", label: language === 'ar' ? "الحجز الإلكتروني" : "Online Booking", icon: CalendarDays, adminOnly: true },
    { id: "sources", label: language === 'ar' ? "مصادر المرضى" : "Patient Sources", icon: Users, adminOnly: true },
    { id: "visit_reasons", label: language === 'ar' ? "أسباب الزيارة" : "Visit Reasons", icon: Stethoscope, adminOnly: true },
  ];

  // Shared Core Settings State
  const [clinicData, setClinicData] = useState({
    name: "", doctorName: "", phone: "", address: "", email: "",
    currency: "EGP", rxHeader: "",
    attendanceLat: "", attendanceLng: "", attendanceRadius: "50"
  });
  const [schedule, setSchedule] = useState({ start: "09:00", end: "21:00", slotDuration: "30", offDays: [] as string[] });

  // User Management State
  const [usersList, setUsersList] = useState<any[]>([]);
  const [staffMembers, setStaffMembers] = useState<any[]>([]); 
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null); 
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "Assistant", isDentist: false });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) { setIsTopMenuOpen(false); }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    
    getDoc(getClinicDoc("settings", "clinic_info")).then(s => {
        if (s.exists()) {
            const data = s.data();
            setClinicData(prev => ({...prev, ...data}));
            if (data.schedule) setSchedule(prev => ({...prev, ...data.schedule}));
        }
    });

    const unsubs: (() => void)[] = [];
    if (isAdmin) {
      // Listen to clinic-scoped staff (this is the source of truth for this clinic)
      unsubs.push(onSnapshot(getClinicCollection("staff"), (s) => {
        const staffList = s.docs.map(d => ({id: d.id, ...d.data()}));
        setStaffMembers(staffList);
        // Build usersList from staff records — staff IS the user list for this clinic
        setUsersList(staffList.map((staff: any) => ({
          id: staff.uid || staff.id, // Use uid as the user doc id if available
          uid: staff.uid,
          name: staff.name,
          email: staff.email,
          role: staff.role,
          isDentist: staff.isDentist,
          staffId: staff.id, // The staff doc id itself
          permissions: staff.permissions || [],
        })));
      }));
    }

    return () => { unsubs.forEach(unsub => unsub()); };
  }, [isAdmin, authLoading]); 

  const handleSaveClinic = async (e?: React.FormEvent) => {
    if(e) e.preventDefault();
    setLoading(true);
    try {
      // configuredAt is what lets availability features tell a real setting from the defaults.
      await setDoc(
        getClinicDoc("settings", "clinic_info"),
        {
          ...clinicData,
          schedule: { ...schedule, configuredAt: new Date().toISOString() },
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Settings Updated",
        "Clinic configuration was updated from settings screen."
      );
      showToast(language === 'ar' ? "تم حفظ التكوين!" : "Configuration saved!", "success");
    } catch (err) { 
      showToast(language === 'ar' ? "فشل الحفظ" : "Save failed", "error"); 
    } finally { 
      setLoading(false); 
    }
  };

  const openAddUser = () => { setEditingUser(null); setUserForm({ name: "", email: "", password: "", role: "Assistant", isDentist: false }); setIsUserModalOpen(true); }
  
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingUser) {
          // Editing user logic
      } else {
          const isDentist = isFullAccessRole(userForm.role) ? userForm.isDentist : false;
          const token = await auth.currentUser?.getIdToken();
          
          const response = await fetch('/api/staff/create', { 
            method: 'POST', 
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            }, 
            body: JSON.stringify({ 
              email: userForm.email.toLowerCase(), 
              password: userForm.password, 
              name: userForm.name,
              role: userForm.role,
              createDbRecords: true,
              clinicId,
              isDentist
            }) 
          });
          
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Failed to create auth login");
          
          await logActivity(
            { uid: user?.uid, name: user?.name, role: user?.role },
            "User Created",
            `Created user ${userForm.name} (${userForm.email.toLowerCase()})`
          );
          
          if (result.isNewUser === false) {
             showToast(result.message, "info");
          } else {
             showToast(result.message || "Account created!", "success");
          }
      }
      setIsUserModalOpen(false);
    } catch (err: any) { 
      showToast(err.message || "Operation failed", "error"); 
    } finally {
      setLoading(false);
    }
  };

  const ActiveIcon = tabs.find(t => t.id === activeTab)?.icon || Building;
  const ActiveLabel = tabs.find(t => t.id === activeTab)?.label || txt.title;

  // FIX: Removed <PermissionGuard permission="access.settings">
  // New layout structure
  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 md:p-8 animate-in fade-in pb-24 md:pb-10 font-sans text-slate-800" dir={isRTL ? "rtl" : "ltr"}>
      
      {/* HEADER */}
      <div className="flex items-center gap-4 bg-white p-6 rounded-[2rem] border border-slate-200/60 shadow-sm mb-8">
          <div className="bg-[#E8F7F0] p-3.5 rounded-2xl text-[#27ae60] shrink-0">
              <ActiveIcon size={26}/>
          </div>
          <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">{txt.title}</h1>
              <p className="text-sm text-slate-500 font-medium mt-1">{txt.subtitle}</p>
          </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        
        {/* SIDEBAR (Mobile Dropdown or Tabs, Desktop Sidebar) */}
        <div className="w-full lg:w-72 shrink-0">
          
          {/* Mobile Tab selector (Dropdown) */}
          <div className="lg:hidden relative mb-6" ref={menuRef}>
              <button 
                  onClick={() => setIsTopMenuOpen(!isTopMenuOpen)} 
                  className="w-full bg-white border border-slate-200 px-5 py-4 rounded-2xl flex items-center justify-between font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
              >
                  <span className="flex items-center gap-2"><ActiveIcon size={18} className="text-[#60d297]"/> {ActiveLabel}</span>
                  <ChevronDown size={18} className={`text-slate-400 transition-transform ${isTopMenuOpen ? 'rotate-180' : ''}`}/>
              </button>
              
              {isTopMenuOpen && (
                  <div className={`absolute top-[calc(100%+8px)] ${isRTL ? 'left-0' : 'right-0'} w-full bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95`}>
                      <div className="max-h-[60vh] overflow-y-auto py-2 custom-scrollbar">
                          {tabs.map(tab => {
                              if (tab.adminOnly && !isAdmin) return null;
                              const isActive = activeTab === tab.id;
                              return (
                                  <button
                                      key={tab.id}
                                      onClick={() => { setActiveTab(tab.id); setIsTopMenuOpen(false); }}
                                      data-tour={tab.id === 'clinical' ? 'settings-tab-schedule' : tab.id === 'services' ? 'settings-tab-prices' : undefined}
                                      className={`w-full flex items-center gap-3 px-5 py-3 text-sm font-bold transition-colors ${isActive ? 'bg-[#E8F7F0] text-[#27ae60]' : 'text-slate-600 hover:bg-slate-50'}`}
                                  >
                                      <tab.icon size={18} className={isActive ? 'text-[#27ae60]' : 'text-slate-400'}/> {tab.label}
                                  </button>
                              )
                          })}
                      </div>
                  </div>
              )}
          </div>

          {/* Desktop Sidebar */}
          <div className="hidden lg:flex flex-col gap-8 bg-slate-50/50 p-6 rounded-[2.5rem] border border-slate-200/60 shadow-sm sticky top-6">
            
            {/* Personal Group */}
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-3">
                {language === 'ar' ? 'شخصي' : 'Personal'}
              </h3>
              <div className="flex flex-col gap-1">
                {tabs.filter(t => ['general', 'appearance', 'interface'].includes(t.id)).map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-2xl transition-all ${isActive ? 'bg-white text-[#27ae60] shadow-sm border border-slate-200/60' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 border border-transparent'}`}
                    >
                      <tab.icon size={18} className={isActive ? 'text-[#27ae60]' : 'text-slate-400'}/> {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Clinic Management Group */}
            {isAdmin && (
              <div>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-3">
                  {language === 'ar' ? 'إدارة العيادة' : 'Clinic Management'}
                </h3>
                <div className="flex flex-col gap-1">
                  <Link
                    href="/settings/clinic"
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold rounded-2xl transition-all text-slate-600 hover:bg-white/60 hover:text-slate-900 border border-transparent"
                  >
                    <span className="flex items-center gap-3">
                      <Building2 size={18} className="text-slate-400"/>
                      {language === "ar" ? "ملف العيادة" : "Clinic Profile"}
                    </span>
                    <ChevronDown size={14} className={`text-slate-300 ${isRTL ? "rotate-90" : "-rotate-90"}`} />
                  </Link>

                  {tabs.filter(t => ['users', 'join_requests', 'clinical', 'services', 'prescriptions', 'sources', 'visit_reasons', 'attendance', 'online_booking'].includes(t.id)).map(tab => {
                    if (tab.adminOnly && !isAdmin) return null;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        data-tour={tab.id === 'clinical' ? 'settings-tab-schedule' : tab.id === 'services' ? 'settings-tab-prices' : undefined}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-2xl transition-all ${isActive ? 'bg-white text-[#27ae60] shadow-sm border border-slate-200/60' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 border border-transparent'}`}
                      >
                        <tab.icon size={18} className={isActive ? 'text-[#27ae60]' : 'text-slate-400'}/> {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* System & Automation Group */}
            {isAdmin && (
              <div>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-3">
                  {language === 'ar' ? 'النظام والأتمتة' : 'System & Automation'}
                </h3>
                <div className="flex flex-col gap-1">
                  {tabs.filter(t => ['whatsapp', 'sms', 'notifications', 'logs'].includes(t.id)).map(tab => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-2xl transition-all ${isActive ? 'bg-white text-[#27ae60] shadow-sm border border-slate-200/60' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 border border-transparent'}`}
                      >
                        <tab.icon size={18} className={isActive ? 'text-[#27ae60]' : 'text-slate-400'}/> {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div className="flex-1 min-w-0 bg-white rounded-[2.5rem] border border-slate-200/60 shadow-sm p-4 md:p-8 min-h-[600px]">
            {activeTab === 'general' && <UserProfile />}
            
            {activeTab === 'attendance' && <AttendanceSettings clinicData={clinicData} setClinicData={setClinicData} handleSaveClinic={handleSaveClinic} />}
            {activeTab === 'clinical' && <ScheduleSettings schedule={schedule} setSchedule={setSchedule} handleSaveClinic={handleSaveClinic} />}
            {activeTab === 'recall' && isAdmin && <RecallSettings />}
            {activeTab === 'prescriptions' && <PrescriptionSettings />}
            {activeTab === 'services' && (
              <div className="space-y-6">
                {/* Lists first: which list a service is priced on is the question you answer
                    before its price, and the blanket discount belongs beside that decision. */}
                <PriceListSettings currency={clinicData.currency} />
                <PricingSettings currency={clinicData.currency} />
              </div>
            )}
            {activeTab === 'users' && isAdmin && (
               <>
                  <UserManagement 
                     usersList={usersList} 
                     staffMembers={staffMembers} 
                     currentUser={user} 
                     openAddUser={openAddUser}
                     clinicId={clinicId}
                  />
               </>
            )}
            {activeTab === 'join_requests' && isAdmin && <JoinRequests />}
            {activeTab === 'recently_deleted' && <RecentlyDeleted />}
            {activeTab === 'logs' && isAdmin && <ActivityLogs />}
            {activeTab === 'ai_credits' && isAdmin && <AiCreditsSettings />}
            {activeTab === 'notifications' && isAdmin && (
              <NotificationSettings clinicData={clinicData} setClinicData={setClinicData} handleSaveClinic={handleSaveClinic} />
            )}
            {activeTab === 'whatsapp' && <WhatsAppSettings />}
            {activeTab === 'sms' && isAdmin && <SmsSettings />}
            {activeTab === 'appearance' && <AppearanceSettings />}
            {activeTab === 'interface' && <InterfaceSettings />}
            {activeTab === 'online_booking' && <OnlineBookingSettings />}
            {activeTab === 'locations' && isAdmin && <LocationsSettings />}
            {activeTab === 'sources' && isAdmin && <PatientSourcesSettings />}
            {activeTab === 'visit_reasons' && <VisitReasonsSettings />}
        </div>
      </div>

      {/* USER MANAGEMENT MODAL */}
      {isUserModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 border border-slate-100">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">{editingUser ? txt.userModalEditTitle : txt.userModalAddTitle}</h2>
                <button onClick={() => setIsUserModalOpen(false)} className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2 rounded-full transition-colors"><X size={20}/></button>
              </div>
              <form onSubmit={handleSaveUser} className="space-y-5">
                <div className="space-y-1.5"><label className={`text-[11px] font-bold text-slate-500 uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.userFullName}</label><div className="relative"><User size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}/><input required value={userForm.name} onChange={e => setUserForm({...userForm, name: e.target.value})} className={`w-full py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-[#60d297] transition-all ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}/></div></div>
                <div className="space-y-1.5"><label className={`text-[11px] font-bold text-slate-500 uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.userEmail}</label><div className="relative"><Mail size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}/><input required type="email" value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} className={`w-full py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-[#60d297] transition-all ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}/></div></div>
                
                {!editingUser && (
                  <div className="space-y-1.5">
                    <label className={`text-[11px] font-bold text-slate-500 uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.userPassword}</label>
                    <div className="relative">
                      <Lock size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}/>
                      <input required type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} placeholder={txt.userPasswordHint} className={`w-full py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-[#60d297] transition-all ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}/>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5"><label className={`text-[11px] font-bold text-slate-500 uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>{txt.userRole}</label><div className="relative"><Badge size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}/><select value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value, isDentist: isFullAccessRole(e.target.value) ? userForm.isDentist : false})} className={`w-full py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-[#60d297] transition-all appearance-none cursor-pointer ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}><option value="Dentist">{txt.roleDentist}</option><option value="Assistant">{txt.roleAssistant}</option><option value="Receptionist">{txt.roleReceptionist}</option><option value="Admin">{txt.roleAdmin}</option></select></div></div>
                {isFullAccessRole(userForm.role) && (
                  <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <input
                      type="checkbox"
                      checked={userForm.isDentist}
                      onChange={(e) => setUserForm({ ...userForm, isDentist: e.target.checked })}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#27ae60]"
                    />
                    <span className="text-sm font-semibold text-slate-700 leading-snug">
                      {language === "ar"
                        ? "يعمل أيضاً كطبيب (يظهر في قوائم الأطباء والمواعيد)"
                        : "Also works as dentist (shows in doctor lists & appointments)"}
                    </span>
                  </label>
                )}
                <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm shadow-md mt-6 active:scale-95 transition-all flex items-center justify-center gap-2"><Save size={18}/> {txt.userSubmit}</button>
              </form>
          </div>
        </div>
      )}

    </div>
  );
}
