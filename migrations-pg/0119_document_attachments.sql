-- REVERSAL: drop table scm.doc_attachments;
-- Photos and documents on every step of the transaction flow (owner, 16 Oct 2026: "every step of the transaction
-- flow -- PO, DO, GR and the rest -- can hold photos or documents, MULTIPLE photos, because DO and GR must both have
-- photos. After that I will import those documents into the project").
--
-- One list of files for every document: quotation, sales order, variation order, purchase order, delivery order,
-- goods received, delivery return, purchase return, purchase invoice, sales invoice and receipt. A row names its
-- document by type and id (an SO by its doc_no, every other document by its uuid). The files themselves go in the
-- engine's existing R2 bucket (binding SO_ITEM_PHOTOS, the bucket the SO attachments and line photos already use),
-- under doc-attachments/<company>/<type>/<document>/<uuid>.<ext>. Read by engine/backend/src/scm/routes/doc-attachments.ts.
--
-- * A removed file is hidden (deleted_at, deleted_by_name), never deleted: the row is the audit of who removed it.
-- * sha256 is the original file's fingerprint: the same file attached twice to one document is refused, which is
--   what makes the import (Supply chain > Import document files) safe to run again.
-- * source: 'upload' from a document page, 'import' from the import page, 'legacy' copied from a sales order's
--   older attachment list (scm.mfg_sales_orders.attachments, migration 0115) the first time the order's files load.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- Until it is applied the document pages show "Attachments are not switched on yet" and nothing else changes.
set local search_path = scm, public, extensions;

create table scm.doc_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1 references public.companies(id),
  doc_type text not null,
  doc_id text not null,
  r2_key text not null unique,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null default 0,
  sha256 text,
  caption text not null default '',
  source text not null default 'upload',
  uploaded_by bigint,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by bigint,
  deleted_by_name text,
  constraint doc_attachments_type_check check (doc_type in (
    'quotation', 'sales_order', 'variation_order', 'purchase_order', 'delivery_order', 'goods_received',
    'delivery_return', 'purchase_return', 'purchase_invoice', 'sales_invoice', 'receipt')),
  constraint doc_attachments_source_check check (source in ('upload', 'import', 'legacy')),
  constraint doc_attachments_name_check check (length(btrim(file_name)) between 1 and 200),
  constraint doc_attachments_caption_check check (length(caption) <= 500),
  constraint doc_attachments_sha_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')
);
create index doc_attachments_doc_idx on scm.doc_attachments (doc_type, doc_id, created_at) where deleted_at is null;
create unique index doc_attachments_same_file_idx on scm.doc_attachments (company_id, doc_type, doc_id, sha256)
  where deleted_at is null and sha256 is not null;

alter table scm.doc_attachments owner to scm_engine;
alter table scm.doc_attachments enable row level security;
revoke all on scm.doc_attachments from anon, authenticated;
