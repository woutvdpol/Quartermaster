import { connection } from "next/server";
import { currentUser } from "@/server/auth/guards";
import { findCertificateForStaff } from "@/server/provenance/certificates";
import { getCertificatePdf } from "@/server/provenance/certificate-pdf";

// react-pdf, sharp and the storage driver need Node.js.
export const runtime = "nodejs";

/*
 * GET /api/certificates/[code]/pdf — the certificate of authenticity as PDF (A4).
 * Access: STAFF ONLY (SUPERADMIN, or the OWNER of the certificate's shop). Buyers get the printed
 * certificate with the parcel and verify it publicly at /verify/[code]; a buyer download from the
 * account area can be added later by checking the order line of the product here.
 * Unknown code / no access → 404 (401 when not signed in at all).
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/certificates/[code]/pdf">) {
  await connection();
  const { code } = await ctx.params;
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401, headers: { "Cache-Control": "no-store" } });

  const certificate = await findCertificateForStaff(code, user);
  if (!certificate) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const pdf = await getCertificatePdf(certificate);
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `inline; filename="certificate-${certificate.code}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
