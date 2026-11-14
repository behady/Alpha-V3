import { isOptOutReply } from "@/lib/patientMessaging";
import { decideBotReply, type BotContext, type BotState } from "./engine";
import { parseDayWord } from "./dayWords";
import { quickIntent } from "./quickAnswers";

/**
 * May a newer patient message take the place of an answer not yet sent?
 *
 * Several messages in quick succession each start their own turn. The newest turn's model reads the
 * whole thread, so an answer composed for an older message can be dropped and the newest turn
 * answers everything at once. That is only true when the newer message really reaches the model.
 * A fixed line (thanks, "تمام" confirming tomorrow's appointment, the clinic's own script, a menu
 * digit, a name at the name step) answers only itself, and an album photo or a sticker gets no
 * answer at all; letting one of those drop the older answer left the older question unanswered.
 *
 * So the engine itself is asked, with this clinic's own context: the newer message takes over only
 * if its turn will go to the model. A stop request also takes over (nothing more is sent to someone
 * who asked us to stop), and so does a voice note still being transcribed: its own turn reads it.
 */

/** "[image]", "[audio]": what a media line says before (or without) any words. */
const PLACEHOLDER = /^\[[a-z_]+\]$/i;

export async function lineTakesOver(
  line: Record<string, unknown>,
  turn: {
    /** The state this turn's engine ran in. */
    state: BotState;
    /** This turn's engine context (scripts, menu on screen, AI budget). */
    ctx: BotContext;
    /** The clinic's today, yyyy-mm-dd, for day words at the day list. */
    today: string;
    /** Whether this patient has an appointment soon enough for "تمام" to confirm it. */
    soonAppointment: () => Promise<boolean>;
  }
): Promise<boolean> {
  const raw = String(line.transcript || line.text || "").trim();
  const words = PLACEHOLDER.test(raw) ? "" : raw;
  if (words && isOptOutReply(words)) return true;
  // A voice note still being transcribed: its own turn reads it and answers it.
  if (line.media === "audio" && !words) return true;
  // An album photo, a sticker, a location: nothing the model will answer in its place.
  if (line.media && !words) return false;
  if (!words) return false;
  const ack = quickIntent(words) === "ack";
  const decision = decideBotReply({
    state: turn.state,
    text: words,
    ctx: {
      ...turn.ctx,
      welcome: false,
      dayWord: parseDayWord(words, turn.today) || undefined,
      hasSoonAppointment: ack ? await turn.soonAppointment() : turn.ctx.hasSoonAppointment,
    },
  });
  return decision.action?.type === "ai";
}
