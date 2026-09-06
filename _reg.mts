import nextEnv from "@next/env";
(nextEnv as any).loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
const URL = "https://alpha-v3-live.vercel.app/api/webhooks/meta-whatsapp";
const { adminDb } = await import("./src/lib/firebaseAdmin");
const { conversationKey } = await import("./src/lib/bot/conversation");
const clinic = adminDb().collection("clinics").doc("SmtW6r6jKaFhfRWYcxsG");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function cleanup(FROM: string) {
  const convRef = clinic.collection("whatsapp_conversations").doc(conversationKey("+" + FROM));
  const msgs = await convRef.collection("messages").get().catch(() => null);
  if (msgs) for (const m of msgs.docs) await m.ref.delete();
  await convRef.delete().catch(() => {});
  for (const ph of ["+" + FROM, FROM]) for (const col of ["leads", "patients"]) {
    const snap = await clinic.collection(col).where("phone", "==", ph).get();
    for (const d of snap.docs) {
      if (col === "patients") { const ap = await clinic.collection("appointments").where("patientId", "==", d.id).get(); for (const a of ap.docs) await a.ref.delete(); }
      await d.ref.delete();
    }
  }
}
async function send(FROM: string, text: string) {
  const convRef = clinic.collection("whatsapp_conversations").doc(conversationKey("+" + FROM));
  const t0 = Date.now();
  const body = { object: "whatsapp_business_account", entry: [{ id: "1392032743138930", changes: [{ value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1314232971773536" }, messages: [{ from: FROM, id: `wamid.g${Date.now()}${Math.floor(t0 % 991)}`, type: "text", text: { body: text } }] }, field: "messages" }] }] };
  await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
  for (let i = 0; i < 50; i++) {
    await wait(1000);
    const c = (await convRef.get()).data();
    if (c && (c.lastMessageAt || 0) >= t0) {
      const out = await convRef.collection("messages").where("direction", "==", "out").orderBy("at", "asc").get();
      const lines = out.docs.map((d) => d.data()).filter((m) => (m.at || 0) >= t0);
      console.log(`\n> ${text}\n  [${c.lastReason}/${c.state}] latin=${c.lastLatin}`);
      for (const m of lines) console.log(`  ${String(m.text).replace(/\n/g, " | ").slice(0, 230)}`);
      return c;
    }
  }
  console.log(`\n> ${text}\n  (no reply)`);
}
const EN = "201000000791", AR = "201000000792";
try {
  await cleanup(EN); console.log("=== ENGLISH: menus and lists must be English ===");
  await send(EN, "Hi, I want to book a cleaning"); await send(EN, "ok"); await cleanup(EN);
  await cleanup(AR); console.log("\n=== ARABIC + button tap: must stay Arabic ===");
  await send(AR, "عايز احجز"); await send(AR, "m1"); await cleanup(AR);
} finally { await cleanup(EN); await cleanup(AR); console.log("\ncleaned up"); }
