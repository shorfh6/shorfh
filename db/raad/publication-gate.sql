-- Explicit, transactional operator installation. NOT an automatic startup migration.
-- Install and provision credentials only after production approval and a backup.
SELECT pg_catalog.pg_advisory_xact_lock(724214, 1);
LOCK TABLE public.articles, public.article_tags, public.categories, public.tags, public.users IN SHARE ROW EXCLUSIVE MODE;
CREATE SCHEMA IF NOT EXISTS raad_gate;
REVOKE ALL ON SCHEMA raad_gate FROM PUBLIC;

CREATE TABLE IF NOT EXISTS raad_gate.installation (
  singleton boolean PRIMARY KEY CHECK (singleton), version integer NOT NULL CHECK (version = 1),
  legacy_captured boolean NOT NULL DEFAULT false, installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO raad_gate.installation(singleton,version) VALUES(true,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS raad_gate.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), article_id integer NOT NULL,
  snapshot jsonb NOT NULL, snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  task_hash text NOT NULL CHECK (task_hash ~ '^[a-f0-9]{64}$'),
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz NOT NULL, approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL, proof jsonb NOT NULL, UNIQUE(article_id,task_hash)
);
CREATE TABLE IF NOT EXISTS raad_gate.revocations (
  approval_id uuid PRIMARY KEY REFERENCES raad_gate.approvals(id), reason text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS raad_gate.legacy (
  article_id integer PRIMARY KEY, snapshot_hash text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS raad_gate.attempts (
  article_id integer NOT NULL, transaction_id bigint NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(article_id,transaction_id)
);
CREATE TABLE IF NOT EXISTS raad_gate.dependency_checks (
  article_id integer NOT NULL, transaction_id bigint NOT NULL, before_hash text,
  checked boolean NOT NULL DEFAULT false, PRIMARY KEY(article_id,transaction_id)
);
CREATE INDEX IF NOT EXISTS raad_dependency_pending_tx ON raad_gate.dependency_checks(transaction_id) WHERE NOT checked;
CREATE TABLE IF NOT EXISTS raad_gate.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, article_id integer NOT NULL,
  event text NOT NULL, snapshot_hash text, approval_id uuid,
  transaction_id bigint NOT NULL DEFAULT txid_current(), db_login text NOT NULL DEFAULT session_user,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION raad_gate.lock_publication_scope() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(724214,1)
$$;
CREATE OR REPLACE FUNCTION raad_gate.article_snapshot(p_id integer) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'version',1,'id',a.id,'title',a.title,'excerpt',a.excerpt,'body',a.body,'image',a.image,
    'category',jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug),
    'author',CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'name',u.name,'bio',u.bio) END,
    'tags',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) ORDER BY t.id)
      FROM public.article_tags at JOIN public.tags t ON t.id=at.tag_id WHERE at.article_id=a.id),'[]'::jsonb),
    'sourceUrl',a.source_url,'featured',a.featured,'exclusive',a.exclusive,
    'createdAt',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  FROM public.articles a JOIN public.categories c ON c.id=a.category_id
  LEFT JOIN public.users u ON u.id=a.author_id WHERE a.id=p_id
$$;
CREATE OR REPLACE FUNCTION raad_gate.article_snapshot_hash(p_id integer) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT encode(sha256(convert_to(raad_gate.article_snapshot(p_id)::text,'UTF8')),'hex')
$$;
CREATE OR REPLACE FUNCTION raad_gate.immutable_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'RAAD_IMMUTABLE_REVIEW'; END $$;
CREATE OR REPLACE FUNCTION raad_gate.seal_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  NEW.approved_at:=clock_timestamp();
  IF NEW.reviewed_at<NEW.approved_at-interval '24 hours' OR NEW.reviewed_at>NEW.approved_at+interval '5 minutes' THEN
    RAISE EXCEPTION 'RAAD_APPROVAL_STALE';
  END IF;
  NEW.expires_at:=least(NEW.expires_at,NEW.approved_at+interval '24 hours',NEW.reviewed_at+interval '24 hours');
  IF NEW.expires_at<=NEW.approved_at THEN RAISE EXCEPTION 'RAAD_APPROVAL_STALE'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION raad_gate.record_approval(
  p_article_id integer,p_expected_snapshot jsonb,p_task_hash text,p_result_hash text,
  p_policy_hash text,p_reviewed_at timestamptz,p_proof jsonb,p_valid_for_seconds integer DEFAULT 86400
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.articles; s jsonb; h text; existing raad_gate.approvals; answer uuid;
BEGIN
  PERFORM raad_gate.lock_publication_scope();
  SELECT * INTO a FROM public.articles WHERE id=p_article_id FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('draft','pending') THEN RAISE EXCEPTION 'RAAD_REVIEW_DRAFT_REQUIRED'; END IF;
  s:=raad_gate.article_snapshot(p_article_id); h:=raad_gate.article_snapshot_hash(p_article_id);
  IF s IS DISTINCT FROM p_expected_snapshot THEN RAISE EXCEPTION 'RAAD_APPROVAL_STALE'; END IF;
  IF nullif(btrim(a.title),'') IS NULL OR nullif(btrim(a.excerpt),'') IS NULL OR
     nullif(btrim(a.body),'') IS NULL OR nullif(btrim(a.image),'') IS NULL THEN RAISE EXCEPTION 'RAAD_REVIEW_INCOMPLETE'; END IF;
  IF p_task_hash IS NULL OR p_task_hash !~ '^[a-f0-9]{64}$' OR p_result_hash IS NULL OR p_result_hash !~ '^[a-f0-9]{64}$' OR
     p_policy_hash IS NULL OR p_policy_hash !~ '^[a-f0-9]{64}$' OR p_reviewed_at IS NULL OR
     p_valid_for_seconds IS NULL OR p_valid_for_seconds NOT BETWEEN 1 AND 86400 OR
     p_proof->>'final_agent' IS DISTINCT FROM 'al-mutamid' OR p_proof->>'decision' IS DISTINCT FROM 'APPROVED' OR
     NOT COALESCE(p_proof->'agents' @> '["al-muhaqqiq","al-muharrir","al-musawwir"]'::jsonb,false) OR
     p_proof->>'media_sha256' IS NULL OR p_proof->>'media_sha256' !~ '^[a-f0-9]{64}$' OR
     p_proof->>'site' IS NULL OR p_proof->>'site' !~ '^https?://' THEN
    RAISE EXCEPTION 'RAAD_REVIEW_INCOMPLETE';
  END IF;
  SELECT * INTO existing FROM raad_gate.approvals WHERE article_id=p_article_id AND task_hash=p_task_hash;
  IF FOUND THEN
    IF existing.snapshot IS DISTINCT FROM s OR existing.result_hash<>p_result_hash OR existing.policy_hash<>p_policy_hash OR
       existing.proof IS DISTINCT FROM p_proof OR existing.reviewed_at<>p_reviewed_at THEN RAISE EXCEPTION 'RAAD_REVIEW_CONFLICT'; END IF;
    RETURN existing.id;
  END IF;
  INSERT INTO raad_gate.approvals(article_id,snapshot,snapshot_hash,task_hash,result_hash,policy_hash,reviewed_at,expires_at,proof)
    VALUES(p_article_id,s,h,p_task_hash,p_result_hash,p_policy_hash,p_reviewed_at,
      clock_timestamp()+p_valid_for_seconds*interval '1 second',p_proof) RETURNING id INTO answer;
  INSERT INTO raad_gate.audit(article_id,event,snapshot_hash,approval_id) VALUES(p_article_id,'review_recorded',h,answer);
  RETURN answer;
END $$;
CREATE OR REPLACE FUNCTION raad_gate.revoke_approval(p_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a raad_gate.approvals;
BEGIN
  PERFORM raad_gate.lock_publication_scope();
  SELECT * INTO a FROM raad_gate.approvals WHERE id=p_id;
  IF NOT FOUND OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>500 THEN RAISE EXCEPTION 'RAAD_REVIEW_INCOMPLETE'; END IF;
  INSERT INTO raad_gate.revocations(approval_id,reason) VALUES(p_id,p_reason) ON CONFLICT DO NOTHING;
  INSERT INTO raad_gate.audit(article_id,event,snapshot_hash,approval_id) VALUES(a.article_id,'review_revoked',a.snapshot_hash,p_id);
END $$;
CREATE OR REPLACE FUNCTION raad_gate.approval_status(p_id integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h text; a raad_gate.approvals; st text;
BEGIN
  SELECT status INTO st FROM public.articles WHERE id=p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','notfound'); END IF;
  h:=raad_gate.article_snapshot_hash(p_id);
  SELECT * INTO a FROM raad_gate.approvals r WHERE r.article_id=p_id AND r.snapshot_hash=h
    AND r.expires_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM raad_gate.revocations v WHERE v.approval_id=r.id)
    ORDER BY r.approved_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('state','approved','snapshotHash',h,'approvalId',a.id,'approvedAt',a.approved_at,'expiresAt',a.expires_at,'mediaSha256',a.proof->>'media_sha256','site',a.proof->>'site'); END IF;
  IF st='published' AND EXISTS(SELECT 1 FROM raad_gate.legacy l WHERE l.article_id=p_id AND l.snapshot_hash=h AND l.revoked_at IS NULL) THEN
    RETURN jsonb_build_object('state','legacy','snapshotHash',h);
  END IF;
  RETURN jsonb_build_object('state',CASE WHEN EXISTS(SELECT 1 FROM raad_gate.approvals WHERE article_id=p_id) THEN 'stale' ELSE 'missing' END,'snapshotHash',h);
END $$;
CREATE OR REPLACE FUNCTION raad_gate.assert_publishable(p_id integer) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb; attempt_time timestamptz;
BEGIN
  s:=raad_gate.approval_status(p_id);
  SELECT attempted_at INTO attempt_time FROM raad_gate.attempts WHERE article_id=p_id AND transaction_id=txid_current();
  IF s->>'state'='legacy' AND attempt_time IS NULL THEN RETURN; END IF;
  IF s->>'state'='stale' THEN RAISE EXCEPTION 'RAAD_APPROVAL_STALE'; END IF;
  IF s->>'state'<>'approved' THEN RAISE EXCEPTION 'RAAD_APPROVAL_REQUIRED'; END IF;
  IF attempt_time IS NOT NULL AND (s->>'approvedAt')::timestamptz>attempt_time THEN RAISE EXCEPTION 'RAAD_APPROVAL_MUST_PRECEDE_PUBLICATION'; END IF;
END $$;

CREATE OR REPLACE FUNCTION raad_gate.lock_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM raad_gate.lock_publication_scope(); RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION raad_gate.block_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'RAAD_TRUNCATE_BLOCKED'; END $$;
CREATE OR REPLACE FUNCTION raad_gate.article_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed boolean; ts timestamptz;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status='published' THEN RAISE EXCEPTION 'RAAD_SAVE_DRAFT_FIRST'; END IF;
    NEW.created_at:=clock_timestamp(); NEW.updated_at:=NEW.created_at; NEW.published_at:=NULL; RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'RAAD_ARTICLE_ID_IMMUTABLE'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'RAAD_CREATION_DATE_IMMUTABLE'; END IF;
  IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN RAISE EXCEPTION 'RAAD_PUBLICATION_DATE_IMMUTABLE'; END IF;
  changed:=ROW(NEW.title,NEW.excerpt,NEW.body,NEW.image,NEW.category_id,NEW.author_id,NEW.source_url,NEW.featured,NEW.exclusive)
    IS DISTINCT FROM ROW(OLD.title,OLD.excerpt,OLD.body,OLD.image,OLD.category_id,OLD.author_id,OLD.source_url,OLD.featured,OLD.exclusive);
  IF OLD.status='published' AND NEW.status='published' AND changed THEN RAISE EXCEPTION 'RAAD_PUBLISHED_EDIT_BLOCKED'; END IF;
  IF OLD.status='published' AND NEW.status<>'published' THEN
    UPDATE raad_gate.legacy SET revoked_at=clock_timestamp() WHERE article_id=OLD.id AND revoked_at IS NULL;
  END IF;
  IF OLD.status<>'published' AND NEW.status='published' THEN
    ts:=clock_timestamp();
    INSERT INTO raad_gate.attempts(article_id,transaction_id,attempted_at) VALUES(NEW.id,txid_current(),ts) ON CONFLICT DO NOTHING;
    NEW.published_at:=COALESCE(OLD.published_at,ts);
  ELSIF OLD.published_at IS NULL THEN NEW.published_at:=NULL;
  END IF;
  IF changed OR OLD.status IS DISTINCT FROM NEW.status OR pg_trigger_depth()>1 THEN NEW.updated_at:=clock_timestamp();
  ELSE NEW.updated_at:=OLD.updated_at; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION raad_gate.article_after_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE st text; a jsonb;
BEGIN
  SELECT status INTO st FROM public.articles WHERE id=NEW.id;
  IF st='published' THEN
    PERFORM raad_gate.assert_publishable(NEW.id);
    IF TG_OP='INSERT' OR OLD.status<>'published' THEN
      a:=raad_gate.approval_status(NEW.id);
      INSERT INTO raad_gate.audit(article_id,event,snapshot_hash,approval_id)
        VALUES(NEW.id,'published',a->>'snapshotHash',(a->>'approvalId')::uuid);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION raad_gate.track_dependency(p_id integer) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  INSERT INTO raad_gate.dependency_checks AS pending(article_id,transaction_id,before_hash)
    SELECT p_id,txid_current(),raad_gate.article_snapshot_hash(p_id) WHERE EXISTS(SELECT 1 FROM public.articles WHERE id=p_id)
    -- A transaction can flush deferred checks and then write again. Re-arm a
    -- completed check, preserving the first snapshot while a check is pending.
    ON CONFLICT (article_id,transaction_id) DO UPDATE
      SET before_hash=EXCLUDED.before_hash,checked=false WHERE pending.checked
$$;
CREATE OR REPLACE FUNCTION raad_gate.dependency_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE aid integer;
BEGIN
  IF TG_TABLE_NAME='article_tags' THEN
    IF TG_OP<>'INSERT' THEN PERFORM raad_gate.track_dependency(OLD.article_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM raad_gate.track_dependency(NEW.article_id); END IF;
  ELSIF TG_TABLE_NAME='tags' THEN
    FOR aid IN SELECT article_id FROM public.article_tags WHERE tag_id=OLD.id LOOP PERFORM raad_gate.track_dependency(aid); END LOOP;
  ELSIF TG_TABLE_NAME='categories' THEN
    FOR aid IN SELECT id FROM public.articles WHERE category_id=OLD.id LOOP PERFORM raad_gate.track_dependency(aid); END LOOP;
  ELSIF TG_TABLE_NAME='users' THEN
    FOR aid IN SELECT id FROM public.articles WHERE author_id=OLD.id LOOP PERFORM raad_gate.track_dependency(aid); END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE OR REPLACE FUNCTION raad_gate.dependency_after_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d record; h text; st text;
BEGIN
  FOR d IN SELECT * FROM raad_gate.dependency_checks WHERE transaction_id=txid_current() AND NOT checked ORDER BY article_id LOOP
    SELECT status INTO st FROM public.articles WHERE id=d.article_id;
    h:=raad_gate.article_snapshot_hash(d.article_id);
    IF st='published' AND h IS DISTINCT FROM d.before_hash THEN
      BEGIN PERFORM raad_gate.assert_publishable(d.article_id);
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'RAAD_PUBLIC_DEPENDENCY_BLOCKED'; END;
    END IF;
    IF h IS DISTINCT FROM d.before_hash AND st IS NOT NULL THEN
      UPDATE public.articles SET updated_at=clock_timestamp() WHERE id=d.article_id;
      INSERT INTO raad_gate.audit(article_id,event,snapshot_hash) VALUES(d.article_id,'dependency_changed',h);
    END IF;
    UPDATE raad_gate.dependency_checks SET checked=true WHERE article_id=d.article_id AND transaction_id=d.transaction_id;
  END LOOP;
  RETURN NULL;
END $$;

DO $$ BEGIN
  IF NOT (SELECT legacy_captured FROM raad_gate.installation WHERE singleton) THEN
    INSERT INTO raad_gate.legacy(article_id,snapshot_hash)
      SELECT id,raad_gate.article_snapshot_hash(id) FROM public.articles WHERE status='published';
    UPDATE raad_gate.installation SET legacy_captured=true WHERE singleton;
  END IF;
END $$;
-- CREATE OR REPLACE TRIGGER supports repeatable explicit installation on PostgreSQL 14+.
CREATE OR REPLACE TRIGGER raad_articles_lock_insert BEFORE INSERT OR DELETE ON public.articles FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.lock_statement();
CREATE OR REPLACE TRIGGER raad_articles_lock_update BEFORE UPDATE OF id,title,excerpt,body,image,category_id,author_id,source_url,featured,exclusive,status,published_at,created_at,updated_at ON public.articles FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.lock_statement();
CREATE OR REPLACE TRIGGER raad_article_before BEFORE INSERT OR UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION raad_gate.article_before_write();
DROP TRIGGER IF EXISTS raad_article_insert_check ON public.articles;
CREATE CONSTRAINT TRIGGER raad_article_insert_check AFTER INSERT ON public.articles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION raad_gate.article_after_write();
DROP TRIGGER IF EXISTS raad_article_update_check ON public.articles;
CREATE CONSTRAINT TRIGGER raad_article_update_check AFTER UPDATE ON public.articles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (ROW(NEW.title,NEW.excerpt,NEW.body,NEW.image,NEW.category_id,NEW.author_id,NEW.source_url,NEW.featured,NEW.exclusive,NEW.status)
    IS DISTINCT FROM ROW(OLD.title,OLD.excerpt,OLD.body,OLD.image,OLD.category_id,OLD.author_id,OLD.source_url,OLD.featured,OLD.exclusive,OLD.status))
  EXECUTE FUNCTION raad_gate.article_after_write();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['article_tags','tags','categories','users'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS raad_dependency_check ON public.%I',t);
    EXECUTE format('CREATE CONSTRAINT TRIGGER raad_dependency_check AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION raad_gate.dependency_after_write()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['articles','article_tags','tags','categories','users'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER raad_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.block_truncate()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['approvals','revocations','audit'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER raad_immutable BEFORE UPDATE OR DELETE ON raad_gate.%I FOR EACH ROW EXECUTE FUNCTION raad_gate.immutable_record()',t);
  END LOOP;
END $$;
CREATE OR REPLACE TRIGGER raad_approval_seal BEFORE INSERT ON raad_gate.approvals FOR EACH ROW EXECUTE FUNCTION raad_gate.seal_approval();
CREATE OR REPLACE TRIGGER raad_links_lock BEFORE INSERT OR UPDATE OR DELETE ON public.article_tags FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.lock_statement();
CREATE OR REPLACE TRIGGER raad_links_track BEFORE INSERT OR UPDATE OR DELETE ON public.article_tags FOR EACH ROW EXECUTE FUNCTION raad_gate.dependency_before_write();
CREATE OR REPLACE TRIGGER raad_tags_lock BEFORE UPDATE OF name OR DELETE ON public.tags FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.lock_statement();
CREATE OR REPLACE TRIGGER raad_tags_track BEFORE UPDATE OF name OR DELETE ON public.tags FOR EACH ROW EXECUTE FUNCTION raad_gate.dependency_before_write();
CREATE OR REPLACE TRIGGER raad_categories_lock BEFORE UPDATE OF name,slug OR DELETE ON public.categories FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.lock_statement();
CREATE OR REPLACE TRIGGER raad_categories_track BEFORE UPDATE OF name,slug OR DELETE ON public.categories FOR EACH ROW EXECUTE FUNCTION raad_gate.dependency_before_write();
CREATE OR REPLACE TRIGGER raad_authors_lock BEFORE UPDATE OF name,bio OR DELETE ON public.users FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.lock_statement();
CREATE OR REPLACE TRIGGER raad_authors_track BEFORE UPDATE OF name,bio OR DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION raad_gate.dependency_before_write();

DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='raad_gate' LOOP EXECUTE format('ALTER TABLE raad_gate.%I ENABLE ROW LEVEL SECURITY',t); END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='raad_gate_publisher') THEN CREATE ROLE raad_gate_publisher NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='raad_gate_approver') THEN CREATE ROLE raad_gate_approver NOLOGIN; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('raad_gate_publisher','raad_gate_approver') AND
      (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR
       EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) OR
       EXISTS(SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid AND d.deptype='o'))) THEN
    RAISE EXCEPTION 'RAAD_ROLE_CONFLICT';
  END IF;
  FOREACH t IN ARRAY ARRAY['articles','article_tags','tags','categories','users','sessions','activity','social_links'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS raad_server_publisher ON public.%I',t);
    EXECUTE format('CREATE POLICY raad_server_publisher ON public.%I TO raad_gate_publisher USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA raad_gate FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA raad_gate FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA raad_gate FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
GRANT USAGE ON SCHEMA public,raad_gate TO raad_gate_publisher,raad_gate_approver;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.articles,public.article_tags,public.tags,public.categories,public.users,public.sessions,public.activity,public.social_links TO raad_gate_publisher;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO raad_gate_publisher;
GRANT EXECUTE ON FUNCTION raad_gate.article_snapshot(integer),raad_gate.article_snapshot_hash(integer),raad_gate.approval_status(integer),raad_gate.lock_publication_scope(),raad_gate.assert_publishable(integer) TO raad_gate_publisher,raad_gate_approver;
GRANT EXECUTE ON FUNCTION raad_gate.record_approval(integer,jsonb,text,text,text,timestamptz,jsonb,integer),raad_gate.revoke_approval(uuid,text) TO raad_gate_approver;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA raad_gate FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA raad_gate FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA raad_gate FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA raad_gate FROM %I',r);
    END IF;
  END LOOP;
END $$;
