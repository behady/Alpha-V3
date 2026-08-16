import { notFound } from "next/navigation";
import HelpArticleView from "@/components/help/HelpArticleView";
import {
  getHelpArticle,
  getHelpArticles,
  getHelpSlugs,
  type HelpArticle,
  type HelpLang,
} from "@/lib/help";

export function generateStaticParams() {
  return getHelpSlugs().map((slug) => ({ slug }));
}

type Sibling = Pick<HelpArticle, "slug" | "title"> | null;

/** Previous / next within the same section, so the setup path can be read front to back. */
function siblingsFor(slug: string, lang: HelpLang): { prev: Sibling; next: Sibling } {
  const all = getHelpArticles(lang);
  const current = all.find((a) => a.slug === slug);
  if (!current) return { prev: null, next: null };

  const inSection = all.filter((a) => a.section === current.section);
  const i = inSection.findIndex((a) => a.slug === slug);
  const pick = (a: HelpArticle | undefined): Sibling => (a ? { slug: a.slug, title: a.title } : null);

  return { prev: pick(inSection[i - 1]), next: pick(inSection[i + 1]) };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const article = { en: getHelpArticle(slug, "en"), ar: getHelpArticle(slug, "ar") };
  if (!article.en && !article.ar) notFound();

  return (
    <HelpArticleView
      article={article}
      siblings={{ en: siblingsFor(slug, "en"), ar: siblingsFor(slug, "ar") }}
    />
  );
}
