/**
 * Where a WhatsApp conversation came from, when it came from an ad.
 *
 * A clinic running Click-to-WhatsApp ads pays per conversation started, and until now the system
 * treated those conversations exactly like a patient who found the number on a business card:
 * greeted with a generic menu, no record of which ad they tapped, and no way to tell the owner
 * which creative brought bookings and which brought silence. Both channels DO carry the answer —
 * the Cloud API puts a `referral` object on the first message of every ad conversation, and
 * WhatsApp Web (what the gateway speaks) attaches `externalAdReply` to it — it was simply read by
 * nothing.
 *
 * This module is the one place both shapes become one record. Pure: parsing and wording only.
 */

export interface AdReferral {
  /** The ad's title as the person saw it. The thing they actually clicked. */
  headline?: string;
  /** The ad's primary text, shortened. */
  body?: string;
  /** Meta's id for the ad (source_id). Groups conversations by creative in the report. */
  sourceId?: string;
  /** "ad" for a paid ad, "post" for a boosted/organic post with a WhatsApp button. */
  sourceType?: string;
  /** The link to the ad or post on Facebook/Instagram. */
  sourceUrl?: string;
  /** "image" | "video" — what the creative was. */
  mediaType?: string;
  /** The click id Meta's Conversions API needs to credit a booking back to this ad. */
  ctwaClid?: string;
  /** A picture of the creative, when the payload carried one. */
  thumbnailUrl?: string;
}

const str = (v: unknown, max = 300): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

function tidy(ad: AdReferral): AdReferral | null {
  const out: AdReferral = {};
  for (const [k, v] of Object.entries(ad)) if (v) (out as Record<string, string>)[k] = v;
  // Something has to identify the ad. A referral with none of these is not one we can use.
  return out.headline || out.body || out.sourceId || out.sourceUrl || out.ctwaClid ? out : null;
}

/**
 * The Cloud API shape: `messages[].referral`, present only on the first message of a conversation
 * that started from an ad or a post with a "Send message" button.
 */
export function parseMetaReferral(raw: unknown): AdReferral | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return tidy({
    headline: str(r.headline, 160),
    body: str(r.body, 400),
    sourceId: str(r.source_id, 64),
    sourceType: str(r.source_type, 20),
    sourceUrl: str(r.source_url, 500),
    mediaType: str(r.media_type, 20),
    ctwaClid: str(r.ctwa_clid, 300),
    thumbnailUrl: str(r.thumbnail_url ?? r.image_url, 500),
  });
}

/**
 * The WhatsApp Web shape the gateway sees: `contextInfo.externalAdReply` on the first message.
 *
 * Baileys serialises `mediaType` as an enum name or a number; both are mapped to the same two
 * words the Cloud API uses so the report never shows "1" beside "image". A message whose
 * `conversionSource` names Facebook/Instagram ads but has no `externalAdReply` is still an ad
 * conversation — that case exists (boosted posts) and is kept, headline-less.
 */
export function parseBaileysAdReply(contextInfo: unknown): AdReferral | null {
  if (!contextInfo || typeof contextInfo !== "object") return null;
  const c = contextInfo as Record<string, unknown>;
  const ad = (c.externalAdReply && typeof c.externalAdReply === "object" ? c.externalAdReply : null) as Record<string, unknown> | null;
  const conversion = str(c.conversionSource, 40) || "";
  const fromAds = /ads?$/i.test(conversion) || /ads?[_ ]/i.test(conversion);
  if (!ad && !fromAds) return null;
  const mt = ad?.mediaType;
  const mediaType =
    typeof mt === "string" ? (mt.toLowerCase() === "video" || mt === "2" ? "video" : mt.toLowerCase() === "image" || mt === "1" ? "image" : str(mt, 20)) : mt === 2 ? "video" : mt === 1 ? "image" : undefined;
  return tidy({
    headline: str(ad?.title, 160),
    body: str(ad?.body, 400),
    sourceId: str(ad?.sourceId, 64),
    sourceType: str(ad?.sourceType, 20) || (fromAds ? "ad" : undefined),
    sourceUrl: str(ad?.sourceUrl, 500),
    mediaType,
    ctwaClid: str(ad?.ctwaClid, 300),
    thumbnailUrl: str(ad?.thumbnailUrl, 500),
  });
}

/**
 * Whatever shape a stored or forwarded copy has — the conversation document, the gateway's
 * `_data.ad`, a lead's `meta` block. Same keys as `AdReferral`, unknown ones dropped.
 */
export function readStoredAd(raw: unknown): AdReferral | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return tidy({
    headline: str(r.headline, 160),
    body: str(r.body, 400),
    sourceId: str(r.sourceId, 64),
    sourceType: str(r.sourceType, 20),
    sourceUrl: str(r.sourceUrl, 500),
    mediaType: str(r.mediaType, 20),
    ctwaClid: str(r.ctwaClid, 300),
    thumbnailUrl: str(r.thumbnailUrl, 500),
  });
}

/** The name a person would call this ad by: its headline, else its first words, else a generic. */
export function adLabel(ad: AdReferral | null | undefined, isAr = true): string {
  if (!ad) return isAr ? "إعلان" : "Ad";
  if (ad.headline) return ad.headline;
  if (ad.body) return ad.body.length > 48 ? `${ad.body.slice(0, 45).trim()}…` : ad.body;
  if (ad.sourceId) return `${isAr ? "إعلان" : "Ad"} ${ad.sourceId.slice(-6)}`;
  return isAr ? (ad.sourceType === "post" ? "منشور" : "إعلان") : ad.sourceType === "post" ? "Post" : "Ad";
}

/** The line staff see at the top of the thread, so the desk knows what this person just saw. */
export function adSystemLine(ad: AdReferral): string {
  const kind = ad.sourceType === "post" ? "منشور" : "إعلان";
  const parts = [`📣 جاي من ${kind}: ${adLabel(ad)}`];
  if (ad.body && ad.body !== ad.headline) parts.push(ad.body.length > 140 ? `${ad.body.slice(0, 137).trim()}…` : ad.body);
  return parts.join("\n");
}

/**
 * The sentence the greeting opens with for someone who arrived from an ad.
 *
 * It names what they clicked, so the first thing they read is that they are in the right place —
 * "I saw your whitening ad" answered with a three-item menu is the moment most ad conversations
 * die. `offerLine` is the clinic's own offer text for the matching service, when there is one.
 */
export function adGreetingLine(ad: AdReferral, opts: { offerLine?: string } = {}): string {
  const label = adLabel(ad);
  const offer = opts.offerLine?.trim();
  const head = ad.headline || ad.body ? `بخصوص ${ad.sourceType === "post" ? "المنشور" : "الإعلان"} اللي شفته عن *${label}* 👇` : "شكراً إنك وصلتلنا من الإعلان 🙏";
  return offer ? `${head}\n${offer}` : head;
}

/** What the model is told, so it answers the ad and not a generic question. */
export function adPromptLines(ad: AdReferral): string {
  const what = [ad.headline ? `العنوان: «${ad.headline}»` : "", ad.body ? `النص: «${ad.body.slice(0, 300)}»` : ""].filter(Boolean).join(" — ");
  return [
    `\nالمريض جاي من ${ad.sourceType === "post" ? "منشور" : "إعلان"} على فيسبوك/انستجرام${what ? `: ${what}` : "."}`,
    "ده اللي شافه قبل ما يكتب، فاعتبره موضوع المحادثة من أول رد: أكّد إنه في المكان الصح، جاوب عن الحاجة اللي في الإعلان (العرض أو الخدمة) من معلومات العيادة اللي فوق بس، ولو العرض مش مكتوب في العروض فوق قول إن الاستقبال هيأكد تفاصيله. واعرض عليه يحجز كشف.",
  ].join("\n");
}

/** Text a service matcher can search for the ad's subject: headline first, then the copy. */
export function adSubjectText(ad: AdReferral | null | undefined): string {
  if (!ad) return "";
  return [ad.headline, ad.body].filter(Boolean).join(" ");
}
