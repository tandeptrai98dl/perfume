-- Product full-text search (ARCHITECTURE.md §6.3).
-- product_translations.search_vector combines, per locale: product name + brand name (A),
-- subtitle + concentration (B), scent family and note names (C). Accent-insensitive via
-- immutable_unaccent and the 'simple' configuration (Postgres has no Vietnamese dictionary).

CREATE OR REPLACE FUNCTION compute_product_search_vector(
  p_product_id uuid,
  p_locale locale,
  p_name text,
  p_subtitle text
) RETURNS tsvector
LANGUAGE sql
STABLE
AS $$
  SELECT
    setweight(to_tsvector('simple', immutable_unaccent(lower(coalesce(p_name, '')))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(lower(coalesce(b.name, '')))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(lower(coalesce(p_subtitle, '')))), 'B') ||
    setweight(to_tsvector('simple', p.concentration::text), 'B') ||
    setweight(to_tsvector('simple', immutable_unaccent(lower(coalesce((
      SELECT string_agg(ft.name, ' ')
      FROM product_families pf
      JOIN fragrance_family_translations ft ON ft.family_id = pf.family_id AND ft.locale = p_locale
      WHERE pf.product_id = p_product_id
    ), '')))), 'C') ||
    setweight(to_tsvector('simple', immutable_unaccent(lower(coalesce((
      SELECT string_agg(nt.name, ' ')
      FROM product_notes pn
      JOIN fragrance_note_translations nt ON nt.note_id = pn.note_id AND nt.locale = p_locale
      WHERE pn.product_id = p_product_id
    ), '')))), 'C')
  FROM products p
  JOIN brands b ON b.id = p.brand_id
  WHERE p.id = p_product_id
$$;
--> statement-breakpoint

-- Recompute on every insert/update of a translation row.
CREATE OR REPLACE FUNCTION product_translations_set_search_vector() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector := compute_product_search_vector(NEW.product_id, NEW.locale, NEW.name, NEW.subtitle);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER product_translations_search_vector
BEFORE INSERT OR UPDATE ON product_translations
FOR EACH ROW EXECUTE FUNCTION product_translations_set_search_vector();
--> statement-breakpoint

-- Touch translations of affected products so the BEFORE trigger recomputes their vectors.
CREATE OR REPLACE FUNCTION refresh_product_search(p_product_ids uuid[]) RETURNS void
LANGUAGE sql
AS $$
  UPDATE product_translations SET search_vector = NULL WHERE product_id = ANY(p_product_ids)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_refresh_search_from_product() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_product_search(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_refresh_search
AFTER UPDATE OF brand_id, concentration ON products
FOR EACH ROW EXECUTE FUNCTION trg_refresh_search_from_product();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_refresh_search_from_brand() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_product_search(ARRAY(SELECT id FROM products WHERE brand_id = NEW.id));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER brands_refresh_search
AFTER UPDATE OF name ON brands
FOR EACH ROW EXECUTE FUNCTION trg_refresh_search_from_brand();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_refresh_search_from_product_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_product_search(ARRAY[OLD.product_id]);
  ELSE
    PERFORM refresh_product_search(ARRAY[NEW.product_id]);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER product_notes_refresh_search
AFTER INSERT OR UPDATE OR DELETE ON product_notes
FOR EACH ROW EXECUTE FUNCTION trg_refresh_search_from_product_link();
--> statement-breakpoint
CREATE TRIGGER product_families_refresh_search
AFTER INSERT OR UPDATE OR DELETE ON product_families
FOR EACH ROW EXECUTE FUNCTION trg_refresh_search_from_product_link();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_refresh_search_from_note_translation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_note_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.note_id ELSE NEW.note_id END;
BEGIN
  PERFORM refresh_product_search(ARRAY(SELECT product_id FROM product_notes WHERE note_id = v_note_id));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fragrance_note_translations_refresh_search
AFTER INSERT OR UPDATE OF name OR DELETE ON fragrance_note_translations
FOR EACH ROW EXECUTE FUNCTION trg_refresh_search_from_note_translation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_refresh_search_from_family_translation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_family_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.family_id ELSE NEW.family_id END;
BEGIN
  PERFORM refresh_product_search(ARRAY(SELECT product_id FROM product_families WHERE family_id = v_family_id));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fragrance_family_translations_refresh_search
AFTER INSERT OR UPDATE OF name OR DELETE ON fragrance_family_translations
FOR EACH ROW EXECUTE FUNCTION trg_refresh_search_from_family_translation();
--> statement-breakpoint

-- Typo-tolerant name matching.
CREATE INDEX product_translations_name_trgm_idx
ON product_translations USING gin (immutable_unaccent(lower(name)) gin_trgm_ops);
