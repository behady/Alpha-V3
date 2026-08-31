"use client";
import { staffProfilePath } from "@/lib/storagePaths";

import { useState, useEffect, useRef } from "react";
import { 
  User, Mail, Phone, Camera, Loader2, CheckCircle2, 
  Shield, Hash, Smile, Briefcase, FileText 
} from "lucide-react";
import { db, storage, auth } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { updateProfile } from "firebase/auth";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";
import {
  DEFAULT_COUNTRY_CODE,
  COUNTRY_CODE_OPTIONS,
  buildE164FromCountryCode,
  splitE164ToCountryAndLocal,
} from "@/lib/phoneNumber";

export default function UserProfile() {
  const { language, isRTL } = useLanguage();
  // FIX: Bypass TypeScript so we can pull out the ID securely
  const { user } = useAuth() as any; 
  const { showToast } = useUI();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);

  const [profileData, setProfileData] = useState({
    name: "",
    nickname: "",
    phone: "",
    email: "",
    role: "",
    bio: "",
    photoURL: ""
  });
  /** What is stored, so a half-edited name or bio can be told apart from a saved one. */
  const [storedProfile, setStoredProfile] = useState<typeof profileData | null>(null);

  // The photo saves on upload; everything else waits for the Save button, so leaving with a
  // rewritten bio used to discard it without a word.
  useDirtyFlag(
    "general",
    storedProfile !== null && JSON.stringify(profileData) !== JSON.stringify(storedProfile)
  );

  useEffect(() => {
    const fetchProfile = async () => {
      // FIX: Securely extract UID mapping any possible property name
      const uid = auth.currentUser?.uid || user?.uid || user?.id;
      
      if (!uid) {
          setLoading(false);
          return;
      }
      
      try {
        const docRef = getClinicDoc("staff", uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          const loaded = {
            name: data.name || "",
            nickname: data.nickname || "",
            phone: splitE164ToCountryAndLocal(String(data.phone || "")).localNumber,
            email: data.email || auth.currentUser?.email || "",
            role: data.role || "Staff", 
            bio: data.bio || "",
            photoURL: data.photoURL || auth.currentUser?.photoURL || ""
          };
          setProfileData(loaded);
          setStoredProfile(loaded);
          setCountryCode(splitE164ToCountryAndLocal(String(data.phone || "")).countryCode);
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
        showToast("Failed to load profile data", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [user]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;

    if (!file.type.startsWith('image/')) {
        showToast("Please upload an image file.", "error");
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast("Image must be less than 5MB.", "error");
        return;
    }

    setUploadingImage(true);
    try {
      const storageRef = ref(storage, staffProfilePath(auth.currentUser.uid));
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed', 
        () => {}, 
        (error) => {
            showToast("Failed to upload image", "error");
            setUploadingImage(false);
        }, 
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          
          // FIX: Use setDoc with merge: true instead of updateDoc
          await setDoc(getClinicDoc("staff", auth.currentUser!.uid), { photoURL: downloadURL }, { merge: true });
          
          await updateProfile(auth.currentUser as any, { photoURL: downloadURL });
          
          setProfileData(prev => ({ ...prev, photoURL: downloadURL }));
          showToast("Profile picture updated!", "success");
          setUploadingImage(false);
        }
      );
    } catch (error) {
      console.error("Upload error:", error);
      setUploadingImage(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!auth.currentUser) return;
    const normalizedPhone = buildE164FromCountryCode(countryCode, profileData.phone);
    if (!normalizedPhone) {
      showToast(
        language === "ar"
          ? "رقم الهاتف لازم يبدأ بكود الدولة (مثال: +201001234567)"
          : "Phone must include country code first (e.g. +201001234567)",
        "error"
      );
      return;
    }
    setSaving(true);
    try {
      // FIX: Use setDoc with merge: true instead of updateDoc
      await setDoc(getClinicDoc("staff", auth.currentUser.uid), {
        name: profileData.name,
        nickname: profileData.nickname,
        phone: normalizedPhone,
        bio: profileData.bio
      }, { merge: true });

      await updateProfile(auth.currentUser as any, { displayName: profileData.name });

      setStoredProfile(profileData);
      showToast(language === 'ar' ? "تم تحديث الملف الشخصي!" : "Profile updated successfully!", "success");
    } catch (error) {
      console.error("Save error:", error);
      showToast("Failed to update profile", "error");
    } finally {
      setSaving(false);
    }
  };

  const employeeId = auth.currentUser?.uid ? `EMP-${auth.currentUser.uid.substring(0, 6).toUpperCase()}` : "N/A";

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-emerald-500" size={32}/></div>;

  return (
    <div className={`w-full max-w-4xl mx-auto bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden font-sans ${isRTL ? 'text-right' : 'text-left'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      
      <div className="h-32 bg-gradient-to-r from-slate-900 to-slate-800 relative">
         <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      </div>

      <div className="px-8 pb-8">
        <div className="flex flex-col md:flex-row items-center md:items-end gap-6 -mt-12 mb-8 relative z-10">
            
            <div className="relative group">
                <div className="w-28 h-28 rounded-full border-4 border-white bg-slate-100 shadow-lg overflow-hidden flex items-center justify-center text-slate-400 relative">
                    {profileData.photoURL ? (
                        <img src={profileData.photoURL} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                        <User size={48} />
                    )}
                    
                    <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex flex-col items-center justify-center text-white"
                    >
                        {uploadingImage ? <Loader2 className="animate-spin" size={24}/> : <Camera size={24} />}
                    </div>
                </div>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/png, image/jpeg, image/webp"
                    onChange={handleImageUpload}
                />
            </div>

            <div className="flex-1 text-center md:text-start pb-2">
                <h2 className="text-2xl font-black text-slate-900 flex items-center justify-center md:justify-start gap-2">
                    {profileData.name} 
                    {profileData.role === "Dentist" && <CheckCircle2 size={20} className="text-emerald-500" />}
                </h2>
                <p className="text-sm font-bold text-slate-500 mt-1">
                    {profileData.nickname ? `"${profileData.nickname}" • ` : ''} {profileData.role}
                </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl flex items-center gap-2 mb-2">
                <Hash size={16} className="text-slate-400" />
                <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-0.5">Staff ID</p>
                    <p className="text-sm font-bold text-slate-700 font-mono leading-none">{employeeId}</p>
                </div>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1">Full Legal Name</label>
                <div className="relative">
                    <User size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="text" 
                        value={profileData.name} 
                        onChange={e => setProfileData({...profileData, name: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl py-3 ps-12 pe-4 text-sm font-bold outline-none transition-all"
                    />
                </div>
            </div>

            <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1">Preferred Nickname</label>
                <div className="relative">
                    <Smile size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="text" 
                        placeholder="What should we call you?"
                        value={profileData.nickname} 
                        onChange={e => setProfileData({...profileData, nickname: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl py-3 ps-12 pe-4 text-sm font-bold outline-none transition-all"
                    />
                </div>
            </div>

            <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1">Phone Number</label>
                <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={e => setCountryCode(e.target.value)}
                      className="w-[45%] bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl py-3 px-3 text-sm font-bold outline-none transition-all"
                    >
                      {COUNTRY_CODE_OPTIONS.map((opt) => (
                        <option key={opt.code} value={opt.code}>{opt.label}</option>
                      ))}
                    </select>
                    <div className="relative w-[55%]">
                        <Phone size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                            type="tel" 
                            value={profileData.phone} 
                            onChange={e => setProfileData({...profileData, phone: e.target.value})}
                            placeholder="1001234567"
                            className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl py-3 ps-12 pe-4 text-sm font-bold outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1">Email Address</label>
                <div className="relative opacity-60 cursor-not-allowed">
                    <Mail size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="email" 
                        disabled
                        value={profileData.email} 
                        className="w-full bg-slate-100 border border-slate-200 rounded-xl py-3 ps-12 pe-4 text-sm font-bold outline-none"
                    />
                </div>
                <p className="text-[10px] font-bold text-slate-400 mt-1 px-1">Contact admin to change email.</p>
            </div>

            <div className="md:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1">System Role</label>
                <div className="relative opacity-60 cursor-not-allowed w-full md:w-1/2">
                    <Shield size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="text" 
                        disabled
                        value={profileData.role} 
                        className="w-full bg-slate-100 border border-slate-200 rounded-xl py-3 ps-12 pe-4 text-sm font-bold outline-none"
                    />
                </div>
            </div>

            <div className="md:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-1 flex items-center gap-1">
                    <FileText size={12}/> Short Bio / Expertise
                </label>
                <textarea 
                    rows={3}
                    placeholder="Write a little about yourself, your specialties, or your working hours..."
                    value={profileData.bio} 
                    onChange={e => setProfileData({...profileData, bio: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl p-4 text-sm font-bold outline-none transition-all resize-none custom-scrollbar"
                />
            </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end">
            <button 
                onClick={handleSaveProfile}
                disabled={saving}
                className="bg-emerald-600 text-white px-8 py-3.5 rounded-xl font-black text-sm shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
            >
                {saving && <Loader2 size={18} className="animate-spin" />}
                {language === 'ar' ? 'حفظ التغييرات' : 'Save Profile Changes'}
            </button>
        </div>

      </div>
    </div>
  );
}