import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { loadSupplyStoreConfig, wooRequest } from "@/lib/server/wooClient";
import { friendlyStoreError, mapWooCategory, mapWooProduct } from "@/lib/supplyStore";

/**
 * The partner's catalogue, proxied.
 *
 * The browser never talks to WooCommerce directly, and not only to keep the credentials server
 * side: the same key would let anyone holding it read the partner's customer list. Proxying means
 * a clinic learns the products and nothing else about his business.
 *
 * Search and paging are handed to WooCommerce rather than done here. Its `search` covers name,
 * SKU and description in whatever language the products are written in, which is the behaviour a
 * clinic expects from a shop — and pulling the whole catalogue to filter it in Node would put a
 * supplier's entire price list in our logs on every keystroke.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_PAGE = 24;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinic = url.searchParams.get("clinicId") || "";

  // access.store, not access.inventory: ordering supplies and counting them are different jobs,
  // and a clinic may well want the assistant who counts stock to be unable to spend money.
  // allowInactive because this is a read; the order route is where a lapsed clinic is stopped.
  const staff = await requireStaffPermission(request, requestedClinic || undefined, "access.store", {
    allowInactive: true,
  });
  if (!staff.ok) return staff.response;

  try {
    // Proves the caller actually belongs to the clinic they named, and throws if not.
    await resolveUserClinicId(staff.uid, requestedClinic);

    const config = await loadSupplyStoreConfig();

    const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page")) || 1));
    const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
    const category = (url.searchParams.get("category") || "").trim();

    const [products, categories] = await Promise.all([
      wooRequest<unknown[]>(config, "products", {
        params: {
          per_page: PER_PAGE,
          page,
          status: "publish",
          // Out-of-stock items are hidden rather than greyed out. A catalogue that mostly cannot
          // be ordered trains people to stop opening it.
          stock_status: "instock",
          orderby: "title",
          order: "asc",
          search: search || undefined,
          category: category || undefined,
        },
      }),
      // Only worth fetching on the first page — the filter bar does not change as you page.
      page === 1
        ? wooRequest<unknown[]>(config, "products/categories", {
            params: { per_page: 100, hide_empty: "true", orderby: "name", order: "asc" },
          })
        : Promise.resolve(null),
    ]);

    if (!products.ok) {
      console.error("supply store products failed", products.status, products.code, products.detail);
      const language = url.searchParams.get("lang") === "ar" ? "ar" : "en";
      return NextResponse.json(
        { ok: false, error: friendlyStoreError(products.status, products.code, language) },
        // 502, not the shop's own status: a 401 from WooCommerce is not the caller being
        // unauthorised, and answering 401 here would bounce a signed-in receptionist to the
        // login screen over a configuration mistake of ours.
        { status: products.status === 503 ? 503 : 502 }
      );
    }

    const list = Array.isArray(products.data) ? products.data : [];
    return NextResponse.json({
      ok: true,
      products: list.map(mapWooProduct).filter(Boolean),
      categories:
        categories && categories.ok && Array.isArray(categories.data)
          ? categories.data.map(mapWooCategory).filter(Boolean)
          : undefined,
      page,
      totalPages: products.totalPages,
      currency: config.currency,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the store";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
