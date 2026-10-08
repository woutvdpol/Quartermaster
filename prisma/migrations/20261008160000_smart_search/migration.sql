-- Smart search (docs/search.md): lexical full-text search + pgvector embeddings.
--
-- Requires the `vector` extension (pgvector ≥ 0.8 for iterative HNSW scans). Local/CI use the
-- pgvector/pgvector:pg18 image; on managed Postgres enable/allow-list the extension first
-- (docs/deploy.md § Postgres). `unaccent` ships with every Postgres (contrib).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Text search configuration for every shop language: `simple` (no stemming — titles mix NL/DE/EN
-- and proper names) behind `unaccent` (Feldmütze = feldmutze, Croix de Guerre ≈ croix de guerre).
-- Prefix queries (`helm:*`) and pg_trgm similarity cover inflections and typos instead of stemming.
CREATE TEXT SEARCH CONFIGURATION qm_search (COPY = pg_catalog.simple);
ALTER TEXT SEARCH CONFIGURATION qm_search
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
  WITH unaccent, simple;

-- Generated (always in sync, no trigger, no worker needed): title + SKU weight A, description weight C.
-- Category, facet and tag names are not in here (a generated column cannot read other tables): the
-- query parser turns them into facet filters and the text embedding contains them.
ALTER TABLE "products" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('qm_search'::regconfig, coalesce("title", '')), 'A') ||
  setweight(to_tsvector('qm_search'::regconfig, coalesce("sku", '')), 'A') ||
  setweight(to_tsvector('qm_search'::regconfig, coalesce("description", '')), 'C')
) STORED;

-- CreateIndex
CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("searchVector");

-- CreateEnum
CREATE TYPE "embedding_kind" AS ENUM ('text', 'image');

-- CreateTable
CREATE TABLE "product_embeddings" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "embedding_kind" NOT NULL,
    "model" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "embedding" vector NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("productId","kind"),
    CONSTRAINT "product_embeddings_dim_check" CHECK (vector_dims("embedding") = "dim")
);

-- CreateIndex
CREATE INDEX "product_embeddings_tenantId_kind_idx" ON "product_embeddings"("tenantId", "kind");

-- Approximate nearest neighbour (cosine) per kind. Partial expression indexes with a fixed dimension:
-- queries must ORDER BY exactly `embedding::vector(384) <=> …` (text) / `embedding::vector(768) <=> …`
-- (image) to use them. Not modelled in schema.prisma (Prisma has no syntax for them; `migrate diff`
-- leaves them alone). A model with another dimension needs a new migration (docs/search.md § Ops).
CREATE INDEX "product_embeddings_text_hnsw_idx" ON "product_embeddings"
  USING hnsw (("embedding"::vector(384)) vector_cosine_ops) WHERE "kind" = 'text';
CREATE INDEX "product_embeddings_image_hnsw_idx" ON "product_embeddings"
  USING hnsw (("embedding"::vector(768)) vector_cosine_ops) WHERE "kind" = 'image';

-- AddForeignKey
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Latest "Rebuild search index" run per tenant (admin progress).
-- CreateTable
CREATE TABLE "search_index_runs" (
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "textEmbedded" INTEGER NOT NULL DEFAULT 0,
    "imageEmbedded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_index_runs_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "search_index_runs" ADD CONSTRAINT "search_index_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
