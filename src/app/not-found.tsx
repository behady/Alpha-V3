import Link from "next/link";
import { Stethoscope, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#f7f7fb] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl border border-slate-200/80 p-8 shadow-xl max-w-md w-full text-center space-y-5 animate-in zoom-in-95">
        <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
          <Stethoscope size={32} />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Page Not Found</h1>
          <p className="text-sm font-bold text-slate-500">The page you are looking for does not exist or has moved.</p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 bg-purple-600 text-white font-black text-xs uppercase px-6 py-3.5 rounded-xl shadow-lg shadow-purple-200 hover:bg-purple-700 transition-all w-full"
        >
          <ArrowLeft size={16} /> Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
