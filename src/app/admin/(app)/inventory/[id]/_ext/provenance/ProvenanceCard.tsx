import { Card } from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getProvenance } from "@/server/provenance/provenance";
import { listProductDocuments } from "@/server/provenance/documents";
import { CERTIFICATE_STATUSES, listCertificates } from "@/server/provenance/certificates";
import { MAX_DOCUMENT_IMAGE_BYTES, MAX_PDF_BYTES } from "@/server/provenance/files";
import { requireTenantDisplay } from "@/server/tenant-display";
import { CertificatesPanel } from "./CertificatesPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { ProvenanceForm } from "./ProvenanceForm";
import { provenanceCardCopy as copy } from "./_copy";

/**
 * Product editor card: public provenance text + guarantee, documents (upload / public toggle /
 * delete), certificates of authenticity (issue / PDF / verify link / revoke).
 * Self-contained server component: loads its own data; mutations are in ./actions.ts.
 */
export async function ProvenanceCard({ productId }: { productId: string }) {
  const ctx = await requireStaffContext();
  let data;
  try {
    data = await Promise.all([
      getProvenance(ctx, productId),
      listProductDocuments(ctx, productId),
      listCertificates(ctx, productId),
      requireTenantDisplay(ctx.tenantId),
    ]);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "NOT_FOUND") return null;
    throw err;
  }
  const [provenance, documents, certificates, tenant] = data;
  const canIssue = (CERTIFICATE_STATUSES as readonly string[]).includes(provenance.status);
  const validCount = certificates.filter((c) => c.valid).length;

  return (
    <Card title={copy.title} aside={validCount ? copy.certificates.cardAside : undefined}>
      <div className="grid gap-5">
        <ProvenanceForm productId={productId} provenance={provenance.provenance} authenticityGuaranteed={provenance.authenticityGuaranteed} />

        <section aria-labelledby="prov-docs" className="grid gap-2 border-t border-line pt-4">
          <h3 id="prov-docs" className="type-label text-xs text-muted">
            {copy.documents.heading}
          </h3>
          <DocumentsPanel
            productId={productId}
            documents={documents.map((d) => ({
              id: d.id,
              kind: d.kind,
              title: d.title,
              mimeType: d.mimeType,
              byteSize: d.byteSize,
              isPublic: d.isPublic,
              createdAt: d.createdAt,
              url: d.url,
            }))}
            timeZone={tenant.timeZone}
            maxPdfBytes={MAX_PDF_BYTES}
            maxImageBytes={MAX_DOCUMENT_IMAGE_BYTES}
          />
        </section>

        <section aria-labelledby="prov-certs" className="grid gap-2 border-t border-line pt-4">
          <h3 id="prov-certs" className="type-label text-xs text-muted">
            {copy.certificates.heading}
          </h3>
          <CertificatesPanel
            productId={productId}
            canIssue={canIssue}
            timeZone={tenant.timeZone}
            certificates={certificates.map((c) => ({
              id: c.id,
              code: c.code,
              issuedAt: c.issuedAt,
              issuedByEmail: c.issuedByEmail,
              revokedAt: c.revokedAt,
              reason: c.reason,
              valid: c.valid,
              pdfUrl: c.pdfUrl,
              verifyUrl: c.verifyUrl,
            }))}
          />
        </section>
      </div>
    </Card>
  );
}
