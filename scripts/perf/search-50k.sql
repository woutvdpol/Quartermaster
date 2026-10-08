-- Synthetic 50k-product tenant for search benchmarks (docs/search.md § Prestaties). Run ONLY in a scratch
-- database that is a copy of the dev database (with the demo tenant concept-militaria indexed):
--
--   docker exec quartermaster-postgres createdb -U quartermaster qm_search_perf
--   docker exec quartermaster-postgres sh -c 'pg_dump -U quartermaster quartermaster | psql -q -U quartermaster qm_search_perf'
--   docker exec -i quartermaster-postgres psql -U quartermaster -d qm_search_perf < scripts/perf/search-50k.sql
--   DATABASE_URL=…/qm_search_perf EMBEDDER_URL=… npm run search -- bench perf-50k
--
-- Clones the 80 demo products 625× (titles numbered, 70 % for sale / 25 % sold / 5 % draft) with their
-- facet values, and copies their text + image embeddings with a little noise, so the vector indexes see
-- 50k distinct, realistically clustered vectors. Facets/categories/settings are copied too.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM product_embeddings WHERE "tenantId" = 'perf50k';
DELETE FROM product_facet_values WHERE "tenantId" = 'perf50k';
DELETE FROM products WHERE "tenantId" = 'perf50k';
DELETE FROM facet_values WHERE "tenantId" = 'perf50k';
DELETE FROM facets WHERE "tenantId" = 'perf50k';
DELETE FROM categories WHERE "tenantId" = 'perf50k';
DELETE FROM settings WHERE "tenantId" = 'perf50k';
DELETE FROM tenants WHERE id = 'perf50k';

CREATE TEMP TABLE src AS SELECT id FROM tenants WHERE slug = 'concept-militaria';

INSERT INTO tenants (id, slug, name, status, currency, timezone, "createdAt", "updatedAt")
SELECT 'perf50k', 'perf-50k', 'Perf 50k', 'ACTIVE', currency, timezone, now(), now() FROM tenants WHERE id = (SELECT id FROM src);

INSERT INTO settings (id, "tenantId", "group", data, "updatedAt")
SELECT 'ps' || md5(id), 'perf50k', "group", data, now() FROM settings WHERE "tenantId" = (SELECT id FROM src);

INSERT INTO categories (id, "tenantId", "parentId", title, slug, description, "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT 'pc' || md5(id), 'perf50k', CASE WHEN "parentId" IS NULL THEN NULL ELSE 'pc' || md5("parentId") END, title, slug, description, "isActive", "sortOrder", now(), now()
FROM categories WHERE "tenantId" = (SELECT id FROM src);

INSERT INTO facets (id, "tenantId", kind, name, slug, "sortOrder", "isFilterable", "createdAt", "updatedAt")
SELECT 'pf' || md5(id), 'perf50k', kind, name, slug, "sortOrder", "isFilterable", now(), now() FROM facets WHERE "tenantId" = (SELECT id FROM src);

INSERT INTO facet_values (id, "tenantId", "facetId", "parentId", name, slug, "sortOrder", "createdAt", "updatedAt")
SELECT 'pv' || md5(id), 'perf50k', 'pf' || md5("facetId"), CASE WHEN "parentId" IS NULL THEN NULL ELSE 'pv' || md5("parentId") END, name, slug, "sortOrder", now(), now()
FROM facet_values WHERE "tenantId" = (SELECT id FROM src);

CREATE TEMP TABLE clones AS
SELECT p.id AS src_id, n, 'pp' || md5(p.id || ':' || n) AS id, row_number() OVER () AS rn
FROM products p, generate_series(1, 625) n
WHERE p."tenantId" = (SELECT id FROM src);

INSERT INTO products (id, "tenantId", "stockCode", slug, title, description, status, price, quantity, "weightGrams", importance,
  "publishedAt", "soldAt", "categoryId", "createdAt", "updatedAt")
SELECT c.id, 'perf50k', 100000 + c.rn, p.slug || '-' || c.n, p.title || ' #' || c.n, p.description,
  -- status by clone number (not rn: rn % 4 would give every clone of one demo item the same status)
  (CASE WHEN c.n % 20 = 0 THEN 'DRAFT' WHEN c.n % 4 = 1 THEN 'SOLD' ELSE 'ACTIVE' END)::"ProductStatus",
  (p.price * (0.5 + (c.n % 10) / 10.0))::int,
  CASE WHEN c.n % 4 = 1 THEN 0 ELSE 1 END, p."weightGrams", 0,
  now() - (c.rn || ' minutes')::interval, CASE WHEN c.n % 4 = 1 THEN now() - (c.rn || ' minutes')::interval END,
  CASE WHEN p."categoryId" IS NULL THEN NULL ELSE 'pc' || md5(p."categoryId") END, now(), now()
FROM clones c JOIN products p ON p.id = c.src_id;

INSERT INTO product_facet_values ("tenantId", "productId", "facetValueId")
SELECT 'perf50k', c.id, 'pv' || md5(pfv."facetValueId") FROM clones c JOIN product_facet_values pfv ON pfv."productId" = c.src_id;

-- Embeddings: demo vector + uniform noise (±0.02 per dimension), renormalised. updatedAt in the future
-- so the search.sync safety net does not treat them as outdated.
INSERT INTO product_embeddings ("tenantId", "productId", kind, model, dim, embedding, "contentHash", "updatedAt")
SELECT 'perf50k', c.id, e.kind, e.model, e.dim,
  (SELECT l2_normalize(array_agg(x + (random() - 0.5) * 0.04 ORDER BY i)::vector) FROM unnest(e.embedding::real[]) WITH ORDINALITY AS t(x, i)),
  'synthetic', now() + interval '1 day'
FROM clones c JOIN product_embeddings e ON e."productId" = c.src_id;
COMMIT;
ANALYZE products; ANALYZE product_embeddings; ANALYZE product_facet_values;
SELECT status, count(*) FROM products WHERE "tenantId" = 'perf50k' GROUP BY 1;
SELECT kind, count(*) FROM product_embeddings WHERE "tenantId" = 'perf50k' GROUP BY 1;
