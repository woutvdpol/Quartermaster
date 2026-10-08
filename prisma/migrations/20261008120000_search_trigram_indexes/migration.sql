-- Performance (docs/perf/results.md): catalog + admin search use `ILIKE '%word%'` on products.title,
-- description and sku (OR-ed per word). Without an index every search scans all products of all
-- tenants. Trigram GIN indexes turn each ILIKE into a bitmap index scan (words of ≥ 3 characters).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "products_title_trgm_idx" ON "products" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_description_trgm_idx" ON "products" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_sku_trgm_idx" ON "products" USING GIN ("sku" gin_trgm_ops);
