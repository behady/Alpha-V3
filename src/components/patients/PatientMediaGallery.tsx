"use client";

import { deleteRecords, RecycleBinError } from "@/lib/recycleBinApi";
import { useClinic } from "@/context/ClinicContext";
import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Camera,
  UploadCloud,
  Loader2,
  Eye,
  Trash2,
  Copy,
  FolderOutput,
  Calendar,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Download,
  CheckSquare,
  Square,
  AlertTriangle,
  ArrowUpDown,
  PlusCircle,
  FileImage,
  CheckCircle2
} from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { addDoc, deleteDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { storage } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { logActivity } from "@/lib/logger";
import { useUI } from "@/context/UIContext";

export interface MediaItem {
  id: string;
  url: string;
  filename?: string;
  category?: string;
  notes?: string;
  uploadedBy?: string;
  createdAt?: any;
}

interface PatientMediaGalleryProps {
  patientId: string;
  patientName: string;
  patientMedia: MediaItem[];
  language: "ar" | "en";
  isRTL: boolean;
  user: { uid?: string; name?: string; role?: string } | null;
}

const CATEGORIES = [
  { id: "All", label: { en: "All", ar: "الكل" } },
  { id: "X-Ray", label: { en: "X-Ray", ar: "أشعة أسنان" } },
  { id: "Clinical Photo", label: { en: "Clinical Photo", ar: "صور سريرية" } },
  { id: "Panoramic", label: { en: "Panoramic", ar: "بانوراما" } },
  { id: "CT Scan", label: { en: "CT Scan", ar: "أشعة مقطعية" } },
  { id: "Periodontal", label: { en: "Periodontal", ar: "حول سنية" } },
];

export default function PatientMediaGallery({
  patientId,
  patientName,
  patientMedia = [],
  language = "en",
  isRTL = false,
  user,
}: PatientMediaGalleryProps) {
  const { clinicId } = useClinic();
  const { showToast } = useUI();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [dateFilter, setDateFilter] = useState<string>("all"); // 'all' | 'today' | 'week' | 'month' | 'newest' | 'oldest'
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  
  // Selection for batch actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Lightbox
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Action confirmations / menus
  const [mediaToDelete, setMediaToDelete] = useState<MediaItem | null>(null);
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState<boolean>(false);
  const [movingMediaId, setMovingMediaId] = useState<string | null>(null);
  const [stagingFiles, setStagingFiles] = useState<Array<{ file: File; category: string; preview: string }>>([]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: patientMedia.length };
    CATEGORIES.forEach((cat) => {
      if (cat.id !== "All") {
        counts[cat.id] = patientMedia.filter((m) => m.category === cat.id).length;
      }
    });
    return counts;
  }, [patientMedia]);

  // Filtered and sorted media list
  const filteredMedia = useMemo(() => {
    let result = [...patientMedia];

    // Filter by Category
    if (activeCategory !== "All") {
      result = result.filter((m) => m.category === activeCategory);
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          (m.filename && m.filename.toLowerCase().includes(q)) ||
          (m.notes && m.notes.toLowerCase().includes(q)) ||
          (m.category && m.category.toLowerCase().includes(q))
      );
    }

    // Filter & Sort by Upload Date
    const now = new Date();
    if (dateFilter === "today") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      result = result.filter((m) => {
        const d = m.createdAt?.toDate ? m.createdAt.toDate().getTime() : 0;
        return d >= startOfDay;
      });
    } else if (dateFilter === "week") {
      const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      result = result.filter((m) => {
        const d = m.createdAt?.toDate ? m.createdAt.toDate().getTime() : 0;
        return d >= sevenDaysAgo;
      });
    } else if (dateFilter === "month") {
      const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((m) => {
        const d = m.createdAt?.toDate ? m.createdAt.toDate().getTime() : 0;
        return d >= thirtyDaysAgo;
      });
    }

    // Sort Order
    if (dateFilter === "oldest") {
      result.sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const db = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return da - db;
      });
    } else {
      // Default: Newest first
      result.sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const db = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return db - da;
      });
    }

    return result;
  }, [patientMedia, activeCategory, searchQuery, dateFilter]);

  // Current target category for dedicated upload
  const targetUploadCategory = activeCategory === "All" ? "X-Ray" : activeCategory;

  // Handle files selected for upload
  const handleFilesSelected = (files: FileList | null, overrideCat?: string) => {
    if (!files || files.length === 0) return;
    const catToUse = overrideCat || targetUploadCategory;
    const newStaged = Array.from(files).map((file) => ({
      file,
      category: catToUse,
      preview: URL.createObjectURL(file),
    }));
    setStagingFiles((prev) => [...prev, ...newStaged]);
  };

  // Drag & Drop event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  // Perform Firebase Storage Upload
  const executeUploadStagedFiles = async () => {
    if (stagingFiles.length === 0 || !patientId) return;

    setIsUploading(true);
    try {
      for (let i = 0; i < stagingFiles.length; i++) {
        const staged = stagingFiles[i];
        const ext = staged.file.name.split(".").pop() || "jpg";
        const storageRef = ref(storage, `patients/${patientId}/media/${Date.now()}_${i}.${ext}`);

        await uploadBytes(storageRef, staged.file);
        const downloadURL = await getDownloadURL(storageRef);

        await addDoc(getClinicCollection("patient_media"), {
          patientId,
          patientName: patientName || "",
          url: downloadURL,
          filename: staged.file.name,
          category: staged.category,
          notes: "",
          uploadedBy: user?.name || "Staff",
          createdAt: serverTimestamp(),
        });
      }

      await logActivity(
        { uid: user?.uid || "", name: user?.name || "", role: user?.role || "" },
        "Media Uploaded",
        `Uploaded ${stagingFiles.length} photo(s) for patient ${patientName}`
      );

      showToast(
        language === "ar" ? "تم رفع الصور بنجاح" : "Media uploaded successfully",
        "success"
      );
      setStagingFiles([]);
    } catch (err: any) {
      console.error("Media upload error:", err);
      showToast(language === "ar" ? "فشل رفع الصور" : "Failed to upload media", "error");
    } finally {
      setIsUploading(false);
    }
  };

  // Single Move Category
  const handleMoveCategory = async (mediaId: string, newCategory: string) => {
    try {
      await updateDoc(getClinicDoc("patient_media", mediaId), {
        category: newCategory,
      });
      showToast(
        language === "ar"
          ? `تم نقل الصورة إلى قسم: ${newCategory}`
          : `Moved to ${newCategory}`,
        "success"
      );
      setMovingMediaId(null);
    } catch (err) {
      console.error("Failed to move media category:", err);
      showToast(language === "ar" ? "فشل النقل" : "Failed to move category", "error");
    }
  };

  // Batch Move Category
  const handleBatchMoveCategory = async (newCategory: string) => {
    if (selectedIds.length === 0) return;
    try {
      await Promise.all(
        selectedIds.map((mediaId) =>
          updateDoc(getClinicDoc("patient_media", mediaId), { category: newCategory })
        )
      );
      showToast(
        language === "ar"
          ? `تم نقل ${selectedIds.length} عنصر إلى ${newCategory}`
          : `Moved ${selectedIds.length} items to ${newCategory}`,
        "success"
      );
      setSelectedIds([]);
    } catch (err) {
      console.error("Failed batch move:", err);
      showToast(language === "ar" ? "فشل النقل الجماعي" : "Failed batch move", "error");
    }
  };

  // Duplicate Media Document
  const handleDuplicateMedia = async (media: MediaItem) => {
    try {
      const dupFilename = media.filename
        ? `Copy_of_${media.filename}`
        : "Duplicated_Photo.jpg";

      await addDoc(getClinicCollection("patient_media"), {
        patientId,
        patientName: patientName || "",
        url: media.url,
        filename: dupFilename,
        category: media.category || "X-Ray",
        notes: media.notes || "",
        uploadedBy: user?.name || "Staff",
        createdAt: serverTimestamp(),
      });

      showToast(
        language === "ar" ? "تم تكرار الصورة بنجاح" : "Media duplicated successfully",
        "success"
      );
    } catch (err) {
      console.error("Failed to duplicate media:", err);
      showToast(language === "ar" ? "تعذر التكرار" : "Failed to duplicate media", "error");
    }
  };

  // Delete Single Media
  const handleDeleteSingle = async (mediaId: string) => {
    try {
      await deleteRecords(clinicId || "", [{ collection: "patient_media", documentId: mediaId }]);
      showToast(language === "ar" ? "تم النقل إلى المحذوفات" : "Moved to Recently Deleted", "success");
      setMediaToDelete(null);
      if (lightboxIndex !== null && filteredMedia[lightboxIndex]?.id === mediaId) {
        setLightboxIndex(null);
      }
    } catch (err) {
      showToast(
        err instanceof RecycleBinError ? err.message : language === "ar" ? "تعذر الحذف" : "Failed to delete",
        "error"
      );
    }
  };

  // Batch Delete Media
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      // ONE request, not a loop. This was `Promise.all` over N independent deletes: a failure
      // partway left some images gone and some not, with nothing recording which — and the toast
      // reported the whole batch as failed either way. The route takes the set, gives it a single
      // action id, and reports each item's outcome.
      const outcome = await deleteRecords(
        clinicId || "",
        selectedIds.map((mediaId) => ({ collection: "patient_media", documentId: mediaId }))
      );
      const failed = outcome.results.filter((r) => r.status !== "deleted");
      if (failed.length > 0) {
        showToast(
          language === "ar"
            ? `تم نقل ${outcome.deleted}، وتعذّر ${failed.length}`
            : `Moved ${outcome.deleted}, could not move ${failed.length}`,
          "error"
        );
      } else {
        showToast(
          language === "ar"
            ? `تم نقل ${outcome.deleted} عناصر إلى المحذوفات`
            : `Moved ${outcome.deleted} items to Recently Deleted`,
          "success"
        );
      }
      setSelectedIds([]);
      setShowBatchDeleteModal(false);
    } catch (err) {
      showToast(
        err instanceof RecycleBinError
          ? err.message
          : language === "ar" ? "فشل الحذف الجماعي" : "Failed batch delete",
        "error"
      );
    }
  };

  // Selection toggle
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredMedia.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredMedia.map((m) => m.id));
    }
  };

  // Lightbox keyboard shortcuts
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setLightboxIndex((prev) =>
          prev !== null ? (prev > 0 ? prev - 1 : filteredMedia.length - 1) : null
        );
      } else if (e.key === "ArrowRight") {
        setLightboxIndex((prev) =>
          prev !== null ? (prev < filteredMedia.length - 1 ? prev + 1 : 0) : null
        );
      } else if (e.key === "Escape") {
        setLightboxIndex(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex, filteredMedia]);

  const currentLightboxMedia = lightboxIndex !== null ? filteredMedia[lightboxIndex] : null;

  return (
    <div className={`space-y-6 ${isRTL ? "text-right" : ""}`}>
      {/* Hidden File Input for Triggering Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />

      {/* Header Banner */}
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-slate-900 flex items-center gap-2.5">
            <div className="w-9 h-9 bg-emerald-50 text-[#27ae60] rounded-xl flex items-center justify-center shadow-sm">
              <Camera size={22} />
            </div>
            {language === "ar" ? "الأشعة والصور السريرية" : "X-Rays & Clinical Media"}
          </h3>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {language === "ar"
              ? "إدارة ورفع أشعة أسنان المريض، صور البانوراما، والتصوير السريري بسهولة والتنقل بين الأقسام."
              : "Upload, manage, inspect, duplicate, and organize dental radiographs & clinical photos for this patient."}
          </p>
        </div>
      </div>

      {/* Filter & Options Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((cat) => {
            const isSelected = activeCategory === cat.id;
            const count = categoryCounts[cat.id] || 0;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id);
                  setSelectedIds([]);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  isSelected
                    ? "bg-white text-slate-900 shadow-sm border border-slate-200/90 ring-1 ring-slate-200/50"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                }`}
              >
                <span>{language === "ar" ? cat.label.ar : cat.label.en}</span>
                <span
                  className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                    isSelected
                      ? "bg-[#27ae60] text-white"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Side: Upload Date Filter & Search */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative">
            <Search
              size={14}
              className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${
                isRTL ? "right-2.5" : "left-2.5"
              }`}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={language === "ar" ? "بحث بالاسم..." : "Search photo..."}
              className={`text-xs font-bold bg-white border border-slate-200 rounded-xl py-1.5 ${
                isRTL ? "pr-8 pl-3" : "pl-8 pr-3"
              } text-slate-700 outline-none focus:ring-2 focus:ring-[#27ae60]/20 focus:border-[#27ae60] w-36 sm:w-44`}
            />
          </div>

          {/* Date Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
            <Calendar size={14} className="text-[#27ae60]" />
            <span className="text-[11px] font-extrabold text-slate-500 whitespace-nowrap">
              {language === "ar" ? "تاريخ الرفع:" : "Upload Date:"}
            </span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="text-xs font-black text-slate-800 bg-transparent outline-none cursor-pointer"
            >
              <option value="all">{language === "ar" ? "كل التواريخ" : "All Dates"}</option>
              <option value="today">{language === "ar" ? "اليوم" : "Today"}</option>
              <option value="week">{language === "ar" ? "هذا الأسبوع" : "This Week"}</option>
              <option value="month">{language === "ar" ? "هذا الشهر" : "This Month"}</option>
              <option value="newest">{language === "ar" ? "الأحدث أولاً" : "Newest First"}</option>
              <option value="oldest">{language === "ar" ? "الأقدم أولاً" : "Oldest First"}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Batch Selection Action Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1.5"
            >
              <CheckSquare size={16} className="text-[#27ae60]" />
              <span>
                {language === "ar"
                  ? `محدد (${selectedIds.length})`
                  : `Selected (${selectedIds.length})`}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Batch Move Dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-bold">
                {language === "ar" ? "نقل إلى:" : "Move to:"}
              </span>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleBatchMoveCategory(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="bg-slate-800 text-white text-xs font-bold rounded-xl px-3 py-1.5 border border-slate-700 outline-none focus:ring-2 focus:ring-[#27ae60]"
              >
                <option value="">{language === "ar" ? "-- اختر القسم --" : "-- Select Section --"}</option>
                {CATEGORIES.filter((c) => c.id !== "All").map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {language === "ar" ? cat.label.ar : cat.label.en}
                  </option>
                ))}
              </select>
            </div>

            {/* Batch Delete */}
            <button
              onClick={() => setShowBatchDeleteModal(true)}
              className="bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white text-xs font-bold px-3.5 py-1.5 rounded-xl border border-rose-500/30 transition-all flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              <span>{language === "ar" ? "حذف المحدد" : "Delete Selected"}</span>
            </button>

            <button
              onClick={() => setSelectedIds([])}
              className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1"
            >
              {language === "ar" ? "إلغاء" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      {/* DEDICATED IN-TAB UPLOAD DROPZONE */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-3xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-200 ${
          dragActive
            ? "border-[#27ae60] bg-emerald-50/60 scale-[1.005]"
            : "border-slate-200/90 bg-white hover:border-[#27ae60]/60 hover:bg-slate-50/50 shadow-sm"
        }`}
      >
        <div className="max-w-md mx-auto space-y-3 pointer-events-none">
          <div className="w-14 h-14 bg-emerald-50 text-[#27ae60] rounded-2xl flex items-center justify-center mx-auto shadow-sm group-hover:scale-110 transition-transform">
            <UploadCloud size={30} />
          </div>
          <div>
            <h4 className="font-extrabold text-slate-800 text-sm sm:text-base">
              {language === "ar"
                ? `رفع جديد مباشرة قسم: ${
                    CATEGORIES.find((c) => c.id === targetUploadCategory)?.label.ar
                  }`
                : `Upload directly to ${
                    CATEGORIES.find((c) => c.id === targetUploadCategory)?.label.en
                  }`}
            </h4>
            <p className="text-xs text-slate-400 mt-1 font-medium">
              {language === "ar"
                ? "اسحب وأسقط الصور هنا أو انقر لاختيار الملفات من جهازك"
                : "Drag & drop files here or click to select from your device"}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-[#27ae60] hover:bg-[#219653] text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md shadow-emerald-600/20 transition-all pointer-events-auto active:scale-95"
          >
            <PlusCircle size={16} />
            <span>
              {language === "ar"
                ? `+ إضافة ${
                    CATEGORIES.find((c) => c.id === targetUploadCategory)?.label.ar
                  }`
                : `+ Add ${
                    CATEGORIES.find((c) => c.id === targetUploadCategory)?.label.en
                  }`}
            </span>
          </button>
        </div>
      </div>

      {/* MEDIA CARDS GRID OR EMPTY STATE */}
      {filteredMedia.length === 0 ? (
        <div className="text-center py-12 px-4 bg-white rounded-3xl border border-dashed border-slate-200 space-y-3">
          <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto">
            <Camera size={32} />
          </div>
          <h4 className="font-bold text-slate-700 text-sm">
            {language === "ar"
              ? "لا توجد أشعة أو صور مرفوعة في هذا القسم بعد"
              : "No media uploaded in this section yet"}
          </h4>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {language === "ar"
              ? "استخدم مربع الرفع المخصص أعلاه لإضافة الصور فوراً لهذا القسم."
              : "Use the dedicated upload dropzone above to add photos directly."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filteredMedia.map((media, index) => {
            const isSelected = selectedIds.includes(media.id);
            return (
              <div
                key={media.id}
                className={`group bg-white rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col ${
                  isSelected
                    ? "border-[#27ae60] ring-2 ring-[#27ae60]/20 shadow-md"
                    : "border-slate-200/80 hover:shadow-md hover:border-emerald-300"
                }`}
              >
                {/* Image Container */}
                <div className="relative aspect-video bg-slate-900 overflow-hidden group">
                  <img
                    src={media.url}
                    alt={media.filename || "Patient Media"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 cursor-pointer"
                    onClick={() => setLightboxIndex(index)}
                  />

                  {/* Multi-select Checkbox overlay */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(media.id);
                    }}
                    className="absolute top-2.5 start-2.5 z-10 text-white bg-slate-900/60 p-1 rounded-lg backdrop-blur-md hover:bg-slate-900/90 transition-colors"
                  >
                    {isSelected ? (
                      <CheckSquare size={18} className="text-[#27ae60]" />
                    ) : (
                      <Square size={18} className="text-slate-300" />
                    )}
                  </button>

                  {/* Category Pill Tag */}
                  <span className="absolute top-2.5 end-2.5 bg-slate-950/80 text-white text-[10px] font-black px-2.5 py-1 rounded-md backdrop-blur-md border border-white/10 shadow-sm">
                    {media.category || "X-Ray"}
                  </span>

                  {/* Hover Overlay with Open Lightbox button */}
                  <div
                    onClick={() => setLightboxIndex(index)}
                    className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="bg-white/95 text-slate-800 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg backdrop-blur-sm hover:scale-105 transition-transform">
                      <Eye size={14} className="text-[#27ae60]" />
                      {language === "ar" ? "تكبير / معاينة" : "Inspect"}
                    </span>
                  </div>
                </div>

                {/* Card Content & Details */}
                <div className="p-3.5 flex flex-col justify-between flex-1 gap-2.5">
                  <div>
                    <p className="text-xs font-extrabold text-slate-800 truncate" title={media.filename}>
                      {media.filename || "patient_media.jpg"}
                    </p>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5 flex items-center gap-1">
                      <Calendar size={11} className="text-slate-400" />
                      {media.createdAt?.toDate
                        ? media.createdAt.toDate().toLocaleDateString("en-GB")
                        : new Date().toLocaleDateString("en-GB")}
                      {media.uploadedBy ? ` • ${media.uploadedBy}` : ""}
                    </p>
                  </div>

                  {/* Card Action Controls */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
                    {/* Move Category Selector */}
                    <div className="relative">
                      <button
                        onClick={() =>
                          setMovingMediaId(movingMediaId === media.id ? null : media.id)
                        }
                        className="text-[11px] font-bold text-slate-600 hover:text-[#27ae60] bg-slate-50 hover:bg-emerald-50 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                        title={language === "ar" ? "نقل إلى قسم آخر" : "Move to another category"}
                      >
                        <FolderOutput size={13} />
                        <span>{language === "ar" ? "نقل" : "Move"}</span>
                      </button>

                      {/* Dropdown Menu for Category Move */}
                      {movingMediaId === media.id && (
                        <div className="absolute bottom-full mb-1 start-0 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1 w-36 text-xs font-bold animate-in fade-in-50 duration-150">
                          <div className="px-3 py-1 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">
                            {language === "ar" ? "اختر القسم:" : "Select Category:"}
                          </div>
                          {CATEGORIES.filter((c) => c.id !== "All").map((cat) => (
                            <button
                              key={cat.id}
                              onClick={() => handleMoveCategory(media.id, cat.id)}
                              className={`w-full text-start px-3 py-1.5 hover:bg-emerald-50 hover:text-[#27ae60] transition-colors flex items-center justify-between ${
                                media.category === cat.id ? "text-[#27ae60] font-black" : "text-slate-700"
                              }`}
                            >
                              <span>{language === "ar" ? cat.label.ar : cat.label.en}</span>
                              {media.category === cat.id && <CheckCircle2 size={12} />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Duplicate Button */}
                      <button
                        onClick={() => handleDuplicateMedia(media)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title={language === "ar" ? "تكرار الصورة" : "Duplicate Photo"}
                      >
                        <Copy size={14} />
                      </button>

                      {/* Delete Button */}
                      <button
                        onClick={() => setMediaToDelete(media)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title={language === "ar" ? "حذف الصورة" : "Delete Photo"}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* UPLOAD STAGING MODAL */}
      {stagingFiles.length > 0 && (
        <div className="fixed inset-0 bg-slate-950/70 z-[130] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-5 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <UploadCloud size={20} className="text-[#27ae60]" />
                  {language === "ar" ? "تأكيد رفع الصور المحددة" : "Confirm Selected Photo Uploads"}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {language === "ar"
                    ? `عدد الصور: ${stagingFiles.length} • يمكنك تحديد قسم كل صورة قبل الرفع.`
                    : `${stagingFiles.length} photo(s) ready • Select target section per photo.`}
                </p>
              </div>
              <button
                onClick={() => setStagingFiles([])}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-full hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            {/* Staged file list */}
            <div className="space-y-3">
              {stagingFiles.map((staged, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200/70"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={staged.preview}
                      alt="preview"
                      className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">
                        {staged.file.name}
                      </p>
                      <p className="text-[10px] text-slate-400 font-semibold">
                        {(staged.file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-bold text-slate-500 hidden sm:inline">
                      {language === "ar" ? "القسم:" : "Section:"}
                    </span>
                    <select
                      value={staged.category}
                      onChange={(e) => {
                        const newCat = e.target.value;
                        setStagingFiles((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, category: newCat } : item))
                        );
                      }}
                      className="text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-[#27ae60]"
                    >
                      {CATEGORIES.filter((c) => c.id !== "All").map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {language === "ar" ? cat.label.ar : cat.label.en}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        setStagingFiles((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setStagingFiles([])}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                disabled={isUploading}
              >
                {language === "ar" ? "إلغاء" : "Cancel"}
              </button>
              <button
                onClick={executeUploadStagedFiles}
                disabled={isUploading}
                className="bg-[#27ae60] hover:bg-[#219653] text-white text-xs font-extrabold px-6 py-2.5 rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>{language === "ar" ? "جاري الرفع..." : "Uploading..."}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={16} />
                    <span>{language === "ar" ? "تأكيد والرفع الآن" : "Upload Now"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SINGLE DELETE CONFIRMATION MODAL */}
      {mediaToDelete && (
        <div className="fixed inset-0 bg-slate-950/70 z-[140] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-100 text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
              <AlertTriangle size={26} />
            </div>
            <div>
              <h4 className="text-base font-extrabold text-slate-900">
                {language === "ar" ? "تأكيد حذف الصورة" : "Confirm Photo Deletion"}
              </h4>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                {language === "ar"
                  ? "هل أنت تأكد من رغبتك في حذف هذه الصورة نهائياً؟"
                  : "Are you sure you want to permanently delete this media file?"}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setMediaToDelete(null)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                {language === "ar" ? "إلغاء" : "Cancel"}
              </button>
              <button
                onClick={() => handleDeleteSingle(mediaToDelete.id)}
                className="px-5 py-2.5 rounded-xl text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/20 transition-all"
              >
                {language === "ar" ? "حذف نهائي" : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BATCH DELETE CONFIRMATION MODAL */}
      {showBatchDeleteModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-[140] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-100 text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
              <AlertTriangle size={26} />
            </div>
            <div>
              <h4 className="text-base font-extrabold text-slate-900">
                {language === "ar"
                  ? `حذف ${selectedIds.length} عنصر محدد`
                  : `Delete ${selectedIds.length} Selected Items`}
              </h4>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                {language === "ar"
                  ? "سيتم حذف جميع الصور المحددة نهائياً. لا يمكن التراجع عن هذا الإجراء."
                  : "All selected media files will be permanently deleted. This action cannot be undone."}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setShowBatchDeleteModal(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                {language === "ar" ? "إلغاء" : "Cancel"}
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-5 py-2.5 rounded-xl text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/20 transition-all"
              >
                {language === "ar" ? "تأكيد الحذف الجماعي" : "Confirm Batch Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ENHANCED FULLSCREEN LIGHTBOX PREVIEW */}
      {currentLightboxMedia && (
        <div className="fixed inset-0 bg-slate-950/95 z-[150] flex flex-col items-center justify-between p-4 sm:p-6 backdrop-blur-md animate-in fade-in duration-200 select-none">
          {/* Top Bar */}
          <div className="w-full max-w-6xl flex items-center justify-between text-white shrink-0 mb-3 bg-slate-900/60 p-3.5 rounded-2xl border border-white/10 backdrop-blur-md">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 bg-emerald-500/20 text-[#27ae60] rounded-xl flex items-center justify-center border border-emerald-500/30">
                <Camera size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-extrabold truncate text-white">
                  {currentLightboxMedia.filename || "Patient Radiograph"}
                </h3>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium mt-0.5">
                  <span className="bg-[#27ae60] text-white font-black px-2 py-0.5 rounded-md text-[10px]">
                    {currentLightboxMedia.category || "X-Ray"}
                  </span>
                  <span>•</span>
                  <span>{currentLightboxMedia.uploadedBy || "Staff"}</span>
                  <span>•</span>
                  <span>
                    {lightboxIndex! + 1} / {filteredMedia.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions Bar */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Move Category Selector inside Lightbox */}
              <select
                value={currentLightboxMedia.category || "X-Ray"}
                onChange={(e) => handleMoveCategory(currentLightboxMedia.id, e.target.value)}
                className="bg-slate-800 text-white text-xs font-bold rounded-xl px-3 py-1.5 border border-slate-700 outline-none focus:ring-2 focus:ring-[#27ae60] hidden sm:block"
              >
                {CATEGORIES.filter((c) => c.id !== "All").map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {language === "ar" ? cat.label.ar : cat.label.en}
                  </option>
                ))}
              </select>

              {/* Duplicate */}
              <button
                onClick={() => handleDuplicateMedia(currentLightboxMedia)}
                className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5"
                title={language === "ar" ? "تكرار" : "Duplicate"}
              >
                <Copy size={15} />
                <span className="hidden sm:inline">{language === "ar" ? "تكرار" : "Duplicate"}</span>
              </button>

              {/* Download */}
              <a
                href={currentLightboxMedia.url}
                target="_blank"
                rel="noreferrer"
                download
                className="bg-[#27ae60] hover:bg-[#219653] text-white text-xs font-bold px-3.5 py-1.5 rounded-xl shadow-md transition-all flex items-center gap-1.5"
              >
                <Download size={15} />
                <span className="hidden sm:inline">{language === "ar" ? "تحميل" : "Download"}</span>
              </a>

              {/* Delete */}
              <button
                onClick={() => setMediaToDelete(currentLightboxMedia)}
                className="bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white p-2 rounded-xl transition-all"
                title={language === "ar" ? "حذف" : "Delete"}
              >
                <Trash2 size={16} />
              </button>

              {/* Close */}
              <button
                onClick={() => setLightboxIndex(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors ms-2"
              >
                <X size={22} />
              </button>
            </div>
          </div>

          {/* Main Fullsize Media Container with Next/Prev Arrow Overlay */}
          <div className="flex-1 w-full max-w-6xl relative flex items-center justify-center overflow-hidden my-auto">
            {/* Previous Arrow */}
            {filteredMedia.length > 1 && (
              <button
                onClick={() =>
                  setLightboxIndex(
                    lightboxIndex! > 0 ? lightboxIndex! - 1 : filteredMedia.length - 1
                  )
                }
                className="absolute start-2 sm:start-4 z-20 bg-slate-900/80 hover:bg-white text-white hover:text-slate-900 p-3 rounded-2xl backdrop-blur-md border border-white/10 shadow-2xl transition-all hover:scale-110 active:scale-95"
              >
                <ChevronLeft size={24} />
              </button>
            )}

            {/* Image display */}
            <img
              src={currentLightboxMedia.url}
              alt="Fullsize radiograph"
              className="max-w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl border border-white/10"
            />

            {/* Next Arrow */}
            {filteredMedia.length > 1 && (
              <button
                onClick={() =>
                  setLightboxIndex(
                    lightboxIndex! < filteredMedia.length - 1 ? lightboxIndex! + 1 : 0
                  )
                }
                className="absolute end-2 sm:end-4 z-20 bg-slate-900/80 hover:bg-white text-white hover:text-slate-900 p-3 rounded-2xl backdrop-blur-md border border-white/10 shadow-2xl transition-all hover:scale-110 active:scale-95"
              >
                <ChevronRight size={24} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
