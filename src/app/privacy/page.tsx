import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Alpha Dental",
  description: "How Alpha Dental clinics handle the information you share with us.",
};

/**
 * Public privacy policy — required by Meta for lead forms and app review, and linked
 * from anywhere else a policy URL is needed. Deliberately static, bilingual, and
 * dependency-free: no auth, no client JS, nothing to break.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-slate-200 shadow-sm p-8 space-y-10">
        <section>
          <h1 className="text-2xl font-black text-slate-900 mb-1">Privacy Policy</h1>
          <p className="text-xs text-slate-400 font-semibold mb-6">Alpha Dental — last updated 17 August 2026</p>

          <div className="space-y-4 text-sm text-slate-700 leading-relaxed">
            <p>
              When you contact a clinic that uses Alpha Dental — including through a form on
              Facebook or Instagram — you share your <strong>name and phone number</strong>, and
              optionally the service you are asking about.
            </p>
            <p>
              This information is used for one purpose: <strong>so the clinic can contact you</strong> about
              your enquiry and, if you become a patient, manage your care. It is stored securely,
              it is never sold, and it is never shared with anyone outside the clinic you contacted.
            </p>
            <p>
              If you want your information corrected or deleted, contact the clinic you reached out
              to, or email us at <a href="mailto:behady2014@gmail.com" className="text-teal-700 font-bold">behady2014@gmail.com</a> and
              we will handle it.
            </p>
          </div>
        </section>

        <section dir="rtl">
          <h2 className="text-2xl font-black text-slate-900 mb-1">سياسة الخصوصية</h2>
          <p className="text-xs text-slate-400 font-semibold mb-6">ألفا دنتال — آخر تحديث ١٧ أغسطس ٢٠٢٦</p>

          <div className="space-y-4 text-sm text-slate-700 leading-relaxed">
            <p>
              لما بتتواصل مع عيادة بتستخدم نظام ألفا دنتال — بما في ذلك من خلال نموذج على فيسبوك أو
              انستجرام — انت بتشارك <strong>اسمك ورقم تليفونك</strong>، واختيارياً الخدمة اللي بتسأل عنها.
            </p>
            <p>
              المعلومات دي بتُستخدم لغرض واحد: <strong>إن العيادة تتواصل معاك</strong> بخصوص استفسارك،
              ولو بقيت مريض عندهم، إدارة رعايتك. بياناتك متخزنة بشكل آمن، ومش بتتباع، ومش بتتشارك مع
              أي حد خارج العيادة اللي تواصلت معاها.
            </p>
            <p>
              لو عايز تعدّل بياناتك أو تمسحها، تواصل مع العيادة، أو ابعتلنا على{" "}
              <a href="mailto:behady2014@gmail.com" className="text-teal-700 font-bold">behady2014@gmail.com</a> واحنا هنتصرف.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
