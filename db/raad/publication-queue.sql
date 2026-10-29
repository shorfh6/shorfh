-- Explicit operator installation, inside one transaction. Not a startup migration.
SELECT pg_catalog.pg_advisory_xact_lock(724214,1);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM raad_gate.installation WHERE singleton AND version=1) THEN
    RAISE EXCEPTION 'RAAD_QUEUE_GATE_REQUIRED';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS raad_queue;
REVOKE ALL ON SCHEMA raad_queue FROM PUBLIC;
CREATE TABLE IF NOT EXISTS raad_queue.installation(
  singleton boolean PRIMARY KEY CHECK(singleton),version integer NOT NULL CHECK(version=1),
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO raad_queue.installation(singleton,version) VALUES(true,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS raad_queue.jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),article_id integer NOT NULL,
  approval_id uuid NOT NULL UNIQUE REFERENCES raad_gate.approvals(id),
  snapshot_hash text NOT NULL CHECK(snapshot_hash~'^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','uncertain','completed','cancelled','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0),
  worker_hash text CHECK(worker_hash~'^[a-f0-9]{64}$'),lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error text CHECK(last_error~'^[a-z_]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((state='leased')=(lease_until IS NOT NULL)),CHECK(state<>'leased' OR worker_hash IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS raad_queue_pending ON raad_queue.jobs(available_at,id) WHERE state='pending';
CREATE INDEX IF NOT EXISTS raad_queue_article ON raad_queue.jobs(article_id) WHERE state IN('pending','leased','uncertain');
CREATE TABLE IF NOT EXISTS raad_queue.outbox(
  job_id uuid PRIMARY KEY REFERENCES raad_queue.jobs(id),event text NOT NULL CHECK(event='publication_requested'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS raad_queue.receipts(
  job_id uuid PRIMARY KEY REFERENCES raad_queue.jobs(id),article_id integer NOT NULL,
  approval_id uuid NOT NULL REFERENCES raad_gate.approvals(id),snapshot_hash text NOT NULL,
  kind text NOT NULL CHECK(kind IN('worker','reconciled')),url text NOT NULL,
  published_at timestamptz NOT NULL,completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS raad_queue.audit(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,job_id uuid NOT NULL REFERENCES raad_queue.jobs(id),
  event text NOT NULL,worker_hash text,fence bigint NOT NULL,db_login text NOT NULL DEFAULT session_user,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION raad_queue._audit(j raad_queue.jobs,p_event text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  INSERT INTO raad_queue.audit(job_id,event,worker_hash,fence) VALUES(j.id,p_event,j.worker_hash,j.fence)
$$;
CREATE OR REPLACE FUNCTION raad_queue._view(j raad_queue.jobs) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('id',j.id,'articleId',j.article_id,'approvalId',j.approval_id,
    'snapshotHash',j.snapshot_hash,'state',j.state,'attempts',j.attempts,'fence',j.fence::text,
    'leaseUntil',j.lease_until,'availableAt',j.available_at,'lastError',j.last_error,
    'receipt',(SELECT to_jsonb(r)-'job_id' FROM raad_queue.receipts r WHERE r.job_id=j.id))
$$;
CREATE OR REPLACE FUNCTION raad_queue._valid(j raad_queue.jobs) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.articles a JOIN raad_gate.approvals r ON r.article_id=a.id
    WHERE a.id=j.article_id AND a.status IN('draft','pending') AND r.id=j.approval_id
    AND r.snapshot_hash=j.snapshot_hash AND r.snapshot_hash=raad_gate.article_snapshot_hash(a.id)
    AND r.expires_at>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM raad_gate.revocations v WHERE v.approval_id=r.id)
    AND raad_gate.approval_status(a.id)->>'approvalId'=r.id::text)
$$;
CREATE OR REPLACE FUNCTION raad_queue._cancel(j raad_queue.jobs,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed raad_queue.jobs;
BEGIN
  UPDATE raad_queue.jobs SET state='cancelled',lease_until=NULL,last_error=p_reason,updated_at=clock_timestamp()
    WHERE id=j.id AND state IN('pending','leased','uncertain') RETURNING * INTO changed;
  IF FOUND THEN PERFORM raad_queue._audit(changed,'cancelled'); END IF;
END $$;
CREATE OR REPLACE FUNCTION raad_queue._retry(j raad_queue.jobs,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed raad_queue.jobs;
BEGIN
  UPDATE raad_queue.jobs SET state=CASE WHEN attempts>=3 THEN 'dead' ELSE 'pending' END,
    lease_until=NULL,last_error=p_reason,updated_at=clock_timestamp(),
    available_at=clock_timestamp()+least(900,30*power(2,greatest(attempts-1,0)))::integer*interval '1 second'
    WHERE id=j.id RETURNING * INTO changed;
  PERFORM raad_queue._audit(changed,CASE WHEN changed.state='dead' THEN 'dead' ELSE 'retry' END);
END $$;
CREATE OR REPLACE FUNCTION raad_queue._reconcile(j raad_queue.jobs) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.articles; site text; changed raad_queue.jobs;
BEGIN
  SELECT * INTO a FROM public.articles WHERE id=j.article_id;
  IF NOT FOUND OR a.status<>'published' OR raad_gate.article_snapshot_hash(a.id)<>j.snapshot_hash OR
    NOT EXISTS(SELECT 1 FROM raad_gate.audit e WHERE e.article_id=a.id AND e.event='published'
      AND e.snapshot_hash=j.snapshot_hash AND e.approval_id=j.approval_id) THEN RETURN false; END IF;
  SELECT proof->>'site' INTO site FROM raad_gate.approvals WHERE id=j.approval_id;
  INSERT INTO raad_queue.receipts(job_id,article_id,approval_id,snapshot_hash,kind,url,published_at)
    VALUES(j.id,j.article_id,j.approval_id,j.snapshot_hash,'reconciled',site||'/article/'||j.article_id,a.published_at)
    ON CONFLICT DO NOTHING;
  UPDATE raad_queue.jobs SET state='completed',lease_until=NULL,last_error=NULL,updated_at=clock_timestamp()
    WHERE id=j.id RETURNING * INTO changed;
  PERFORM raad_queue._audit(changed,'reconciled');RETURN true;
END $$;
CREATE OR REPLACE FUNCTION raad_queue._active(p_id uuid,p_fence bigint,p_worker text) RETURNS raad_queue.jobs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs;
BEGIN
  SELECT * INTO j FROM raad_queue.jobs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR j.state<>'leased' OR j.fence IS DISTINCT FROM p_fence OR j.worker_hash IS DISTINCT FROM p_worker
    OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'RAAD_QUEUE_STALE_LEASE'; END IF;
  RETURN j;
END $$;

CREATE OR REPLACE FUNCTION raad_queue.enqueue(p_article integer,p_approval uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs; a public.articles; r raad_gate.approvals;
BEGIN
  PERFORM raad_gate.lock_publication_scope();
  SELECT * INTO j FROM raad_queue.jobs WHERE approval_id=p_approval;
  IF FOUND THEN
    IF j.article_id IS DISTINCT FROM p_article THEN RAISE EXCEPTION 'RAAD_QUEUE_BINDING_CONFLICT'; END IF;
    RETURN raad_queue._view(j);
  END IF;
  SELECT * INTO a FROM public.articles WHERE id=p_article FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN('draft','pending') THEN RAISE EXCEPTION 'RAAD_QUEUE_DRAFT_REQUIRED'; END IF;
  SELECT * INTO r FROM raad_gate.approvals WHERE id=p_approval AND article_id=p_article;
  IF NOT FOUND THEN RAISE EXCEPTION 'RAAD_QUEUE_APPROVAL_REQUIRED'; END IF;
  j.article_id:=p_article;j.approval_id:=p_approval;j.snapshot_hash:=r.snapshot_hash;
  IF NOT raad_queue._valid(j) THEN RAISE EXCEPTION 'RAAD_QUEUE_APPROVAL_STALE'; END IF;
  INSERT INTO raad_queue.jobs(article_id,approval_id,snapshot_hash) VALUES(p_article,p_approval,r.snapshot_hash) RETURNING * INTO j;
  INSERT INTO raad_queue.outbox(job_id,event) VALUES(j.id,'publication_requested');
  PERFORM raad_queue._audit(j,'enqueued');RETURN raad_queue._view(j);
END $$;
CREATE OR REPLACE FUNCTION raad_queue.claim(p_worker text,p_lease_seconds integer DEFAULT 120) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs; n integer;
BEGIN
  IF p_worker IS NULL OR p_worker!~'^[a-f0-9]{64}$' OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'RAAD_QUEUE_ARGUMENTS'; END IF;
  FOR j IN SELECT * FROM raad_queue.jobs WHERE state='uncertain' OR (state='leased' AND lease_until<=clock_timestamp())
    ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
    IF NOT raad_queue._reconcile(j) THEN PERFORM raad_queue._retry(j,'lease_expired'); END IF;
  END LOOP;
  FOR n IN 1..20 LOOP
    SELECT * INTO j FROM raad_queue.jobs WHERE state='pending' AND attempts<3 AND available_at<=clock_timestamp()
      ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF NOT raad_queue._valid(j) THEN
      IF NOT raad_queue._reconcile(j) THEN PERFORM raad_queue._cancel(j,'stale_approval'); END IF;
      CONTINUE;
    END IF;
    UPDATE raad_queue.jobs SET state='leased',attempts=attempts+1,fence=fence+1,worker_hash=p_worker,
      lease_until=clock_timestamp()+p_lease_seconds*interval '1 second',updated_at=clock_timestamp()
      WHERE id=j.id RETURNING * INTO j;
    PERFORM raad_queue._audit(j,'claimed');RETURN raad_queue._view(j);
  END LOOP;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION raad_queue.renew(p_id uuid,p_fence bigint,p_worker text,p_lease_seconds integer DEFAULT 120) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'RAAD_QUEUE_ARGUMENTS'; END IF;
  j:=raad_queue._active(p_id,p_fence,p_worker);
  UPDATE raad_queue.jobs SET lease_until=clock_timestamp()+p_lease_seconds*interval '1 second',updated_at=clock_timestamp()
    WHERE id=j.id AND state='leased' AND lease_until>clock_timestamp() RETURNING * INTO j;
  IF NOT FOUND THEN RAISE EXCEPTION 'RAAD_QUEUE_STALE_LEASE'; END IF;
  PERFORM raad_queue._audit(j,'renewed');RETURN raad_queue._view(j);
END $$;
CREATE OR REPLACE FUNCTION raad_queue.lock_work(p_id uuid,p_fence bigint,p_worker text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs;
BEGIN
  PERFORM raad_gate.lock_publication_scope();
  SELECT * INTO j FROM raad_queue.jobs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RAAD_QUEUE_NOT_FOUND'; END IF;
  IF j.state='completed' THEN RETURN raad_queue._view(j); END IF;
  j:=raad_queue._active(p_id,p_fence,p_worker);
  IF NOT raad_queue._valid(j) THEN
    IF NOT raad_queue._reconcile(j) THEN PERFORM raad_queue._cancel(j,'stale_approval'); END IF;
    SELECT * INTO j FROM raad_queue.jobs WHERE id=p_id;RETURN raad_queue._view(j);
  END IF;
  RETURN raad_queue._view(j);
END $$;
CREATE OR REPLACE FUNCTION raad_queue.publish(p_id uuid,p_fence bigint,p_worker text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs; work jsonb; a public.articles; site text;
BEGIN
  work:=raad_queue.lock_work(p_id,p_fence,p_worker);
  IF work->>'state'<>'leased' THEN RETURN work; END IF;
  j:=raad_queue._active(p_id,p_fence,p_worker);
  SELECT * INTO a FROM public.articles WHERE id=j.article_id FOR UPDATE;
  IF NOT FOUND OR NOT raad_queue._valid(j) THEN RAISE EXCEPTION 'RAAD_QUEUE_APPROVAL_STALE'; END IF;
  SELECT proof->>'site' INTO site FROM raad_gate.approvals WHERE id=j.approval_id;
  UPDATE public.articles SET status='published',reject_reason='' WHERE id=a.id RETURNING * INTO a;
  INSERT INTO raad_queue.receipts(job_id,article_id,approval_id,snapshot_hash,kind,url,published_at)
    VALUES(j.id,j.article_id,j.approval_id,j.snapshot_hash,'worker',site||'/article/'||j.article_id,a.published_at);
  UPDATE raad_queue.jobs SET state='completed',lease_until=NULL,last_error=NULL,updated_at=clock_timestamp()
    WHERE id=j.id AND state='leased' AND fence=p_fence AND worker_hash=p_worker AND lease_until>clock_timestamp()
    RETURNING * INTO j;
  IF NOT FOUND THEN RAISE EXCEPTION 'RAAD_QUEUE_STALE_LEASE'; END IF;
  PERFORM raad_queue._audit(j,'completed');RETURN raad_queue._view(j);
END $$;
CREATE OR REPLACE FUNCTION raad_queue.fail(p_id uuid,p_fence bigint,p_worker text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN('media_unavailable','stale_approval','known_failure') THEN RAISE EXCEPTION 'RAAD_QUEUE_ARGUMENTS'; END IF;
  j:=raad_queue._active(p_id,p_fence,p_worker);
  IF p_reason='stale_approval' THEN PERFORM raad_queue._cancel(j,p_reason); ELSE PERFORM raad_queue._retry(j,p_reason); END IF;
  SELECT * INTO j FROM raad_queue.jobs WHERE id=p_id;RETURN raad_queue._view(j);
END $$;
CREATE OR REPLACE FUNCTION raad_queue.uncertain(p_id uuid,p_fence bigint,p_worker text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs;
BEGIN
  SELECT * INTO j FROM raad_queue.jobs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RAAD_QUEUE_NOT_FOUND'; END IF;
  IF j.state='completed' THEN RETURN raad_queue._view(j); END IF;
  j:=raad_queue._active(p_id,p_fence,p_worker);
  UPDATE raad_queue.jobs SET state='uncertain',lease_until=NULL,last_error='outcome_unknown',updated_at=clock_timestamp()
    WHERE id=j.id RETURNING * INTO j;
  PERFORM raad_queue._audit(j,'uncertain');RETURN raad_queue._view(j);
END $$;
CREATE OR REPLACE FUNCTION raad_queue.status(p_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT raad_queue._view(j) FROM raad_queue.jobs j WHERE j.id=p_id
$$;
CREATE OR REPLACE FUNCTION raad_queue.find_request(p_article integer,p_task text,p_result text,p_policy text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT raad_queue._view(j) FROM raad_queue.jobs j JOIN raad_gate.approvals r ON r.id=j.approval_id
    WHERE j.article_id=p_article AND r.task_hash=p_task AND r.result_hash=p_result AND r.policy_hash=p_policy
$$;

CREATE OR REPLACE FUNCTION raad_queue._bound_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RAAD_QUEUE_IMMUTABLE_JOB'; END IF;
  IF ROW(NEW.id,NEW.article_id,NEW.approval_id,NEW.snapshot_hash,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.article_id,OLD.approval_id,OLD.snapshot_hash,OLD.created_at)
    OR NEW.fence<OLD.fence OR NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'RAAD_QUEUE_IMMUTABLE_JOB'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION raad_queue._article_control() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j raad_queue.jobs;
BEGIN
  IF TG_OP='DELETE' OR (OLD.status='published' AND NEW.status<>'published') THEN
    FOR j IN SELECT * FROM raad_queue.jobs WHERE article_id=OLD.id AND state IN('pending','leased','uncertain') ORDER BY id FOR UPDATE LOOP
      PERFORM raad_queue._cancel(j,CASE WHEN TG_OP='DELETE' THEN 'article_deleted' ELSE 'article_withdrawn' END);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER raad_queue_bound BEFORE UPDATE OR DELETE ON raad_queue.jobs FOR EACH ROW EXECUTE FUNCTION raad_queue._bound_job();
CREATE OR REPLACE TRIGGER raad_queue_article_control AFTER UPDATE OR DELETE ON public.articles FOR EACH ROW EXECUTE FUNCTION raad_queue._article_control();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['installation','outbox','receipts','audit'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER raad_queue_immutable BEFORE UPDATE OR DELETE ON raad_queue.%I FOR EACH ROW EXECUTE FUNCTION raad_gate.immutable_record()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['installation','jobs','outbox','receipts','audit'] LOOP
    EXECUTE format('ALTER TABLE raad_queue.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE OR REPLACE TRIGGER raad_queue_no_truncate BEFORE TRUNCATE ON raad_queue.%I FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.block_truncate()',t);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA raad_queue FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA raad_queue FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA raad_queue FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
GRANT USAGE ON SCHEMA raad_queue TO raad_gate_publisher,raad_gate_approver;
GRANT EXECUTE ON FUNCTION raad_queue.enqueue(integer,uuid) TO raad_gate_approver;
GRANT EXECUTE ON FUNCTION raad_queue.find_request(integer,text,text,text) TO raad_gate_approver;
GRANT EXECUTE ON FUNCTION raad_queue.claim(text,integer),raad_queue.renew(uuid,bigint,text,integer),raad_queue.lock_work(uuid,bigint,text),raad_queue.publish(uuid,bigint,text),raad_queue.fail(uuid,bigint,text,text),raad_queue.uncertain(uuid,bigint,text) TO raad_gate_publisher;
GRANT EXECUTE ON FUNCTION raad_queue.status(uuid) TO raad_gate_publisher,raad_gate_approver;
