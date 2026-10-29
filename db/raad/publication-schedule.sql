-- Explicit operator installation only. Definitions do not activate a schedule.
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM raad_queue.installation WHERE singleton AND version=1) THEN RAISE EXCEPTION 'RAAD_SCHEDULE_QUEUE_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN RAISE EXCEPTION 'RAAD_SCHEDULE_VAULT_REQUIRED'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS raad_queue.schedule_config(
  singleton boolean PRIMARY KEY CHECK(singleton),
  origin text CHECK(origin IN('https://www.shurfh.com','https://shorfh-raad-staging.onrender.com')),
  worker_secret_id uuid,basic_secret_id uuid,cron_job_id bigint,
  enabled boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO raad_queue.schedule_config(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS raad_queue.schedule_audit(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event text NOT NULL CHECK(event IN('configured','enabled','disabled','dispatched')),
  request_id bigint,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE raad_queue.schedule_audit ADD COLUMN IF NOT EXISTS http_status integer CHECK(http_status BETWEEN 100 AND 599);
ALTER TABLE raad_queue.schedule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE raad_queue.schedule_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON raad_queue.schedule_config,raad_queue.schedule_audit FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
REVOKE ALL ON SEQUENCE raad_queue.schedule_audit_id_seq FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
CREATE OR REPLACE TRIGGER raad_schedule_audit_immutable BEFORE UPDATE OR DELETE ON raad_queue.schedule_audit FOR EACH ROW EXECUTE FUNCTION raad_gate.immutable_record();
CREATE OR REPLACE TRIGGER raad_schedule_audit_no_truncate BEFORE TRUNCATE ON raad_queue.schedule_audit FOR EACH STATEMENT EXECUTE FUNCTION raad_gate.block_truncate();

CREATE OR REPLACE FUNCTION raad_queue.configure_schedule(p_origin text,p_worker_secret uuid,p_basic_secret uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE secret text; basic text;
BEGIN
  IF p_origin IS NULL OR p_origin NOT IN('https://www.shurfh.com','https://shorfh-raad-staging.onrender.com') THEN RAISE EXCEPTION 'RAAD_SCHEDULE_ORIGIN'; END IF;
  IF (p_origin='https://www.shurfh.com' AND p_basic_secret IS NOT NULL) OR
     (p_origin='https://shorfh-raad-staging.onrender.com' AND p_basic_secret IS NULL) THEN RAISE EXCEPTION 'RAAD_SCHEDULE_BASIC_AUTH'; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE id=p_worker_secret;
  IF secret IS NULL OR length(secret) NOT BETWEEN 32 AND 256 THEN RAISE EXCEPTION 'RAAD_SCHEDULE_SECRET'; END IF;
  IF p_basic_secret IS NOT NULL THEN
    SELECT decrypted_secret INTO basic FROM vault.decrypted_secrets WHERE id=p_basic_secret;
    IF basic IS NULL OR basic NOT LIKE 'Basic %' OR length(basic)>512 THEN RAISE EXCEPTION 'RAAD_SCHEDULE_BASIC_AUTH'; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(724214,2);
  IF (SELECT enabled FROM raad_queue.schedule_config WHERE singleton) THEN RAISE EXCEPTION 'RAAD_SCHEDULE_PAUSE_FIRST'; END IF;
  UPDATE raad_queue.schedule_config SET origin=p_origin,worker_secret_id=p_worker_secret,basic_secret_id=p_basic_secret,updated_at=clock_timestamp() WHERE singleton;
  INSERT INTO raad_queue.schedule_audit(event) VALUES('configured');
END $$;

CREATE OR REPLACE FUNCTION raad_queue.dispatch_tick() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE config raad_queue.schedule_config; secret text; basic text; headers extensions.http_header[]; status integer; invocation bigint;
BEGIN
  SELECT * INTO config FROM raad_queue.schedule_config WHERE singleton;
  IF NOT config.enabled THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE id=config.worker_secret_id;
  IF secret IS NULL THEN RAISE EXCEPTION 'RAAD_SCHEDULE_SECRET'; END IF;
  headers:=ARRAY[ROW('x-raad-worker-key',secret)::extensions.http_header];
  IF config.basic_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO basic FROM vault.decrypted_secrets WHERE id=config.basic_secret_id;
    IF basic IS NULL THEN RAISE EXCEPTION 'RAAD_SCHEDULE_BASIC_AUTH'; END IF;
    headers:=array_append(headers,ROW('Authorization',basic)::extensions.http_header);
  END IF;
  -- Keep credentials in backend memory, not pg_net's publicly granted request
  -- tables. Connection/response deadlines and TLS verification are transaction-local.
  PERFORM set_config('http.curlopt_timeout_ms','15000',true);
  PERFORM set_config('http.curlopt_connecttimeout_ms','10000',true);
  PERFORM set_config('http.curlopt_ssl_verifypeer','1',true);
  PERFORM set_config('http.curlopt_ssl_verifyhost','2',true);
  SELECT r.status INTO status FROM extensions.http(ROW('POST',config.origin||'/api/raad/worker',headers,'application/json','{}')::extensions.http_request) r;
  INSERT INTO raad_queue.schedule_audit(event,http_status) VALUES('dispatched',status) RETURNING id INTO invocation;
  RETURN invocation;
END $$;

CREATE OR REPLACE FUNCTION raad_queue.activate_schedule() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE config raad_queue.schedule_config; existing record; id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(724214,2);
  SELECT * INTO config FROM raad_queue.schedule_config WHERE singleton FOR UPDATE;
  IF config.origin IS NULL OR config.worker_secret_id IS NULL THEN RAISE EXCEPTION 'RAAD_SCHEDULE_CONFIG_REQUIRED'; END IF;
  SELECT jobid,schedule,command,username INTO existing FROM cron.job WHERE jobname='raad-approved-publications-v1';
  IF FOUND THEN
    IF existing.schedule<>'*/5 * * * *' OR existing.command<>'SELECT raad_queue.dispatch_tick();' OR existing.username<>current_user THEN RAISE EXCEPTION 'RAAD_SCHEDULE_JOB_CONFLICT'; END IF;
    id:=existing.jobid;
  ELSE
    SELECT cron.schedule('raad-approved-publications-v1','*/5 * * * *','SELECT raad_queue.dispatch_tick();') INTO id;
  END IF;
  UPDATE raad_queue.schedule_config SET enabled=true,cron_job_id=id,updated_at=clock_timestamp() WHERE singleton;
  INSERT INTO raad_queue.schedule_audit(event) VALUES('enabled');RETURN id;
END $$;

CREATE OR REPLACE FUNCTION raad_queue.pause_schedule() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE id bigint; existing record;
BEGIN
  PERFORM pg_advisory_xact_lock(724214,2);
  SELECT cron_job_id INTO id FROM raad_queue.schedule_config WHERE singleton FOR UPDATE;
  IF id IS NOT NULL THEN
    SELECT jobname,command INTO existing FROM cron.job WHERE jobid=id;
    IF FOUND THEN
      IF existing.jobname<>'raad-approved-publications-v1' OR existing.command<>'SELECT raad_queue.dispatch_tick();' THEN RAISE EXCEPTION 'RAAD_SCHEDULE_JOB_CONFLICT'; END IF;
      PERFORM cron.unschedule(id);
    END IF;
  END IF;
  UPDATE raad_queue.schedule_config SET enabled=false,cron_job_id=NULL,updated_at=clock_timestamp() WHERE singleton;
  INSERT INTO raad_queue.schedule_audit(event) VALUES('disabled');
END $$;
REVOKE ALL ON FUNCTION raad_queue.configure_schedule(text,uuid,uuid),raad_queue.dispatch_tick(),raad_queue.activate_schedule(),raad_queue.pause_schedule() FROM PUBLIC,raad_gate_publisher,raad_gate_approver;
