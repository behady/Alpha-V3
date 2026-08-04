"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, X, Send, Loader2, Bot, Trash2, CheckCircle2, UserPlus, Zap
} from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { hasFeature, getAiCreditLimit } from "@/lib/subscriptions";
import { getClinicDoc } from "@/lib/db-utils";
import { auth } from "@/lib/firebase";
import { onSnapshot } from "firebase/firestore";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function AiChatWidget() {
  const { clinic, clinicId } = useClinic();
  const { user } = useAuth();
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";

  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const canUseAi = hasFeature(clinic, "aiChat");
  const totalLimit = getAiCreditLimit(clinic);
  const monthKey = new Date().toISOString().slice(0, 7);

  // Listen to live monthly credit usage for this clinic
  useEffect(() => {
    if (!clinicId || !canUseAi) return;

    const unsub = onSnapshot(getClinicDoc("ai_usage", monthKey), (snap) => {
      if (snap.exists()) {
        setCreditsUsed(Number(snap.data()?.creditsUsed) || 0);
      } else {
        setCreditsUsed(0);
      }
    });

    return () => unsub();
  }, [clinicId, monthKey, canUseAi]);

  const remainingCredits = Math.max(0, totalLimit - creditsUsed);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isLoading]);

  if (!canUseAi) return null;

  const handleSendMessage = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSend = customText || inputMessage;
    if (!textToSend.trim() || isLoading) return;

    setInputMessage("");
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: textToSend,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // The API verifies this token and derives the caller's identity from it, so userId is no
      // longer sent in the body — the server would ignore it anyway.
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error(isAr ? "انتهت الجلسة. سجّل الدخول مرة أخرى." : "Session expired. Please sign in again.");

      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          prompt: textToSend,
          clinicId,
          userName: user?.name,
          history: messages.map(m => ({ role: m.role, parts: [{ text: m.content }] }))
        })
      });

      if (!response.ok) {
         if (response.status === 429) {
           throw new Error(isAr ? "لقد استنفدت رصيد الذكاء الاصطناعي لهذا الشهر. يرجى الترقية." : "Monthly AI credit limit reached. Please upgrade.");
         } else if (response.status === 403) {
           throw new Error(isAr ? "ميزة الذكاء الاصطناعي غير متوفرة في باقتك الحالية." : "AI feature requires Pro or Premium tier.");
         }
         throw new Error("Failed to process with Gemini AI");
      }
      
      const data = await response.json();

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply || "...",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `⚠️ ${err.message || (isAr ? "حدث خطأ غير متوقع" : "An unexpected error occurred")}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Trigger Button */}
      <div className={`fixed bottom-5 ${isRTL ? "left-5" : "right-5"} z-50`}>
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className="group relative flex items-center gap-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold px-4 py-3.5 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 border border-indigo-500/40"
        >
          <div className="relative">
            <Sparkles size={20} className="text-violet-200 animate-pulse" />
          </div>
          <span className="text-xs tracking-tight hidden sm:inline">
            {isAr ? "مساعد جيميناي الذكي" : "Gemini Assistant"}
          </span>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 ${
            remainingCredits < (totalLimit * 0.1)
              ? "bg-rose-500/90 text-white border border-rose-400"
              : "bg-indigo-900/50 text-indigo-100 border border-indigo-400/30"
          }`}>
            <Zap size={10} className={remainingCredits < (totalLimit * 0.1) ? "animate-pulse" : ""} />
            {remainingCredits}
          </span>
        </button>
      </div>

      {/* Slide-out Gemini Assistant Drawer Panel */}
      {isOpen && (
        <div
          className={`fixed bottom-20 ${isRTL ? "left-4 sm:left-6" : "right-4 sm:right-6"} z-50 w-[calc(100vw-2rem)] sm:w-[420px] h-[560px] max-h-[80vh] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200`}
          dir={isRTL ? "rtl" : "ltr"}
        >
          {/* Header */}
          <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-400 flex items-center justify-center shrink-0">
                <Bot size={20} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  {isAr ? "ألفا الذكي - مدعوم من جيميناي" : "Alpha AI - Powered by Gemini"}
                </h3>
                <p className="text-[10px] text-indigo-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 size={10} /> {isAr ? "تحليل متقدم للبيانات" : "Advanced Data Analysis"}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Quick Actions Strip */}
          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200/80 flex items-center justify-between shrink-0">
            <span className="text-[11px] font-bold text-slate-600">
              {isAr ? "الرصيد المتبقي: " : "Credits Remaining: "} 
              <strong className={remainingCredits < (totalLimit * 0.1) ? "text-rose-600" : "text-indigo-600"}>
                {remainingCredits} / {totalLimit}
              </strong>
            </span>
            <button
              onClick={() => setMessages([])}
              title={isAr ? "مسح المحادثة" : "Clear Chat"}
              className="text-slate-400 hover:text-rose-500 transition-colors p-1 rounded"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/40 custom-scrollbar">
            {messages.length === 0 && (
              <div className="text-center py-6 px-3 text-slate-500 space-y-3">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                  <UserPlus size={24} />
                </div>
                <h4 className="font-bold text-slate-800 text-xs">
                  {isAr ? "مرحباً بك! أنا مساعدك الذكي." : "Welcome! I am your AI assistant."}
                </h4>
                <p className="text-[10px] text-slate-500">
                  {isAr 
                    ? "يمكنني مساعدتك في تحليل البيانات والتشخيص وجدولة المواعيد بناءً على أوامرك." 
                    : "I can help you analyze data, diagnose issues, and schedule appointments based on your requests."}
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${
                  msg.role === "user" ? "bg-slate-800 text-white" : "bg-indigo-100 text-indigo-600 border border-indigo-200"
                }`}>
                  {msg.role === "user" ? <span className="text-xs font-bold">{user?.name?.[0] || "U"}</span> : <Bot size={16} />}
                </div>
                <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} max-w-[80%]`}>
                  <div className={`px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-sm whitespace-pre-wrap ${
                    msg.role === "user" 
                      ? "bg-slate-800 text-white rounded-tr-sm" 
                      : "bg-white text-slate-700 border border-slate-200/60 rounded-tl-sm"
                  }`}>
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 border border-indigo-200 flex items-center justify-center shadow-sm">
                  <Bot size={16} />
                </div>
                <div className="bg-white border border-slate-200/60 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                  <Loader2 className="animate-spin text-indigo-400" size={16} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-2" />
          </div>

          {/* Input Area */}
          <div className="p-3 bg-white border-t border-slate-100 shrink-0">
            <form onSubmit={handleSendMessage} className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all shadow-inner">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={isAr ? "اكتب سؤالك لجيميناي..." : "Ask Gemini anything..."}
                className="w-full bg-transparent border-none text-sm px-4 py-3.5 focus:outline-none text-slate-700 placeholder:text-slate-400"
                dir={isRTL ? "rtl" : "ltr"}
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || isLoading}
                className="absolute shrink-0 text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 p-2 rounded-lg transition-all mx-2"
                style={{ [isRTL ? "left" : "right"]: 0 }}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className={isRTL ? "rotate-180" : ""} />}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
