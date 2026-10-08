-- FAQ content block (docs/seo-geo.md §7.1): question/answer pairs rendered as a native
-- <details>/<summary> accordion, with one FAQPage JSON-LD per page. Block data lives in
-- content_blocks.data (JSON) like every other block type; only the enum needs the new value.
ALTER TYPE "ContentBlockType" ADD VALUE 'FAQ';
