import "server-only";

/*
 * Duplicate photo check + product lineage (docs/duplicate-check.md).
 *
 *   checkDuplicates(ctx, { productId?, imageIds | imageBuffers })  → up to 3 look-alike products
 *   setPreviousProduct(ctx, productId, previousId | null)          → "the same piece came back"
 *   getLineage(ctx, productId) / copyProvenanceFromPrevious(ctx, productId)
 */
export { checkDuplicates, CHECK_TIMEOUT_MS, type DuplicateCandidate, type DuplicateCheckResult, type CheckDuplicatesInput } from "./service";
export { getLineage, setPreviousProduct, copyProvenanceFromPrevious, type Lineage, type LineageRef } from "./lineage";
export { bandFor, selectCandidates, VERY_CLOSE, CLOSE, MARGIN, MAX_CANDIDATES, type SimilarityBand } from "./bands";
