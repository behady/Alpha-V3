import HelpIndex from "@/components/help/HelpIndex";
import { getHelpArticles } from "@/lib/help";

/**
 * Server component on purpose: the articles are files on disk, so they are read here and handed
 * down already parsed. Both languages go down together because the language lives in a client
 * context — see the note in `src/lib/help.ts`.
 */
export default function HelpPage() {
  return <HelpIndex articles={{ en: getHelpArticles("en"), ar: getHelpArticles("ar") }} />;
}
