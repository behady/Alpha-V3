"use client";

import { useState, useEffect } from "react";
import { UserPlus, Check, X, Loader2, AlertCircle } from "lucide-react";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, deleteDoc, query, where, onSnapshot } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { canAddStaff } from "@/lib/subscriptions";
import { getDocs } from "firebase/firestore";

type JoinRequest = {
  id: string;
  userId: string;
  email: string;
  name: string;
  clinicId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export default function JoinRequests() {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const { clinicId, clinic } = useClinic();
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [staffCount, setStaffCount] = useState(0);

  const isAr = language === "ar";

  useEffect(() => {
    if (!clinicId) return;

    // Listen to global join_requests collection where clinicId matches this clinic
    const q = query(getClinicCollection("join_requests"), where("clinicId", "==", clinicId), where("status", "==", "pending"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JoinRequest));
      setRequests(docs);
    });

    // Fetch current staff count
    const fetchStaffCount = async () => {
      try {
        const snap = await getDocs(getClinicCollection("staff"));
        setStaffCount(snap.size);
      } catch (err) {
        console.error("Error fetching staff count", err);
      }
    };
    fetchStaffCount();

    return () => unsubscribe();
  }, [clinicId]);

  const handleApprove = async (req: JoinRequest) => {
    if (!clinicId) return;

    if (!canAddStaff(clinic, staffCount)) {
      showToast(isAr ? "تم الوصول للحد الأقصى للموظفين لباقتك الحالية" : "Staff limit reached for your current plan. Please upgrade.", "error");
      return;
    }

    setProcessingId(req.id);
    try {
      // 1. Create a User Profile in this clinic's subcollection
      const userRef = getClinicDoc("users", req.userId);
      await setDoc(userRef, {
        name: req.name,
        email: req.email,
        uid: req.userId,
        role: "Assistant", // default role, admin can change later
        isDentist: false,
        permissions: []
      });

      // 2. Create a Staff document (optional but matches current logic)
      const staffRef = getClinicDoc("staff");
      await setDoc(staffRef, {
        name: req.name,
        email: req.email,
        role: "Assistant",
        uid: req.userId,
        isDentist: false,
        permissions: []
      });

      // Link staff ID to user profile
      await setDoc(userRef, { staffId: staffRef.id }, { merge: true });

      // 3. Update Global User Document to add this clinic role
      const globalUserRef = getClinicDoc("users", req.userId); // getClinicDoc with "users" returns global root users collection if docId is provided
      const globalUserSnap = await getDoc(globalUserRef);
      if (globalUserSnap.exists()) {
         const data = globalUserSnap.data();
         const clinicRoles = data.clinicRoles || {};
         clinicRoles[clinicId] = "Assistant";
         await setDoc(globalUserRef, { clinicRoles }, { merge: true });
      }

      // 4. Update the Join Request status
      await setDoc(getClinicDoc("join_requests", req.id), { status: "approved" }, { merge: true });

      setStaffCount(prev => prev + 1);
      showToast(isAr ? "تم الموافقة على الطلب" : "Request approved", "success");
    } catch (error) {
      console.error(error);
      showToast(isAr ? "حدث خطأ" : "Error processing request", "error");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (req: JoinRequest) => {
    setProcessingId(req.id);
    try {
      await setDoc(getClinicDoc("join_requests", req.id), { status: "rejected" }, { merge: true });
      showToast(isAr ? "تم رفض الطلب" : "Request rejected", "success");
    } catch (error) {
      showToast(isAr ? "حدث خطأ" : "Error rejecting request", "error");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in" dir={isRTL ? "rtl" : "ltr"}>
      <div className="flex items-center gap-4 mb-6 bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
          <UserPlus size={28} />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900">{isAr ? "طلبات الانضمام" : "Join Requests"}</h3>
          <p className="text-sm font-semibold text-slate-500 mt-1">
            {isAr ? "إدارة طلبات انضمام الموظفين الجدد إلى هذه العيادة." : "Manage requests from users wanting to join this clinic."}
          </p>
        </div>
      </div>

      {!canAddStaff(clinic, staffCount) && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl flex items-center gap-3">
          <AlertCircle size={24} />
          <div>
            <h4 className="font-bold text-lg">{isAr ? "الحد الأقصى للموظفين" : "Staff Limit Reached"}</h4>
            <p className="text-sm font-semibold opacity-90">
              {isAr ? "لقد وصلت للحد الأقصى لعدد الموظفين المسموح به في باقتك. يرجى الترقية لإضافة المزيد." : "You have reached the maximum number of staff members allowed on your current plan. Please upgrade to add more."}
            </p>
          </div>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-[2rem] p-12 flex flex-col items-center justify-center text-center">
           <AlertCircle size={48} className="text-slate-300 mb-4" />
           <p className="text-lg font-bold text-slate-600">
             {isAr ? "لا توجد طلبات معلقة" : "No pending requests"}
           </p>
           <p className="text-sm text-slate-400 font-semibold max-w-md mx-auto mt-2">
             {isAr ? "سيظهر الموظفون الذين يطلبون الانضمام إلى العيادة هنا للموافقة عليهم." : "Staff members who request to join your clinic will appear here for approval."}
           </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {requests.map(req => (
             <div key={req.id} className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col gap-4">
               <div>
                  <h4 className="font-bold text-slate-900 text-lg">{req.name}</h4>
                  <p className="text-sm font-semibold text-slate-500">{req.email}</p>
                  <p className="text-xs font-medium text-slate-400 mt-1">
                    {new Date(req.createdAt).toLocaleDateString()}
                  </p>
               </div>
               
               <div className="flex gap-3 mt-auto">
                 <button
                   onClick={() => handleApprove(req)}
                   disabled={processingId === req.id}
                   className="flex-1 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                 >
                   {processingId === req.id ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                   {isAr ? "موافقة" : "Approve"}
                 </button>
                 <button
                   onClick={() => handleReject(req)}
                   disabled={processingId === req.id}
                   className="flex-1 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                 >
                   {processingId === req.id ? <Loader2 size={18} className="animate-spin" /> : <X size={18} />}
                   {isAr ? "رفض" : "Reject"}
                 </button>
               </div>
             </div>
          ))}
        </div>
      )}
    </div>
  );
}
