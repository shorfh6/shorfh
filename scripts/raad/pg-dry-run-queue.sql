-- Explicit synthetic integration install only; never an application migration.
CREATE SCHEMA IF NOT EXISTS raad_dry_run;
REVOKE ALL ON SCHEMA raad_dry_run FROM PUBLIC;
CREATE TABLE IF NOT EXISTS raad_dry_run.identity (
  singleton boolean PRIMARY KEY CHECK (singleton),
  marker text NOT NULL CHECK (marker = 'raad.synthetic-queue/1')
);
INSERT INTO raad_dry_run.identity VALUES (true, 'raad.synthetic-queue/1') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS raad_dry_run.approvals (
  approval_hash text PRIMARY KEY CHECK (approval_hash ~ '^[a-f0-9]{64}$'),
  package_hash text NOT NULL UNIQUE CHECK (package_hash ~ '^[a-f0-9]{64}$'),
  story_key text NOT NULL CHECK (story_key ~ '^synthetic-[a-f0-9-]{36}$'),
  revision_key text NOT NULL,
  task_snapshot jsonb NOT NULL,
  review_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (story_key, revision_key),
  UNIQUE (approval_hash, package_hash, story_key),
  CHECK ((task_snapshot->>'kind') IS NOT DISTINCT FROM 'task'),
  CHECK ((task_snapshot->>'stage') IS NOT DISTINCT FROM 'approval'),
  CHECK ((task_snapshot->'input'->>'synthetic') IS NOT DISTINCT FROM 'SYNTHETIC NOT REAL NEWS'),
  CHECK ((task_snapshot->'input'->>'storyKey') IS NOT DISTINCT FROM story_key),
  CHECK ((task_snapshot->'hash'->>'value') IS NOT DISTINCT FROM package_hash),
  CHECK ((review_snapshot->>'kind') IS NOT DISTINCT FROM 'result'),
  CHECK ((review_snapshot->>'stage') IS NOT DISTINCT FROM 'approval'),
  CHECK ((review_snapshot->>'agent') IS NOT DISTINCT FROM 'al-mutamid'),
  CHECK ((review_snapshot->>'status') IS NOT DISTINCT FROM 'completed'),
  CHECK ((review_snapshot->'decision'->>'status') IS NOT DISTINCT FROM 'APPROVED'),
  CHECK ((review_snapshot->'decision'->>'reviewer') IS NOT DISTINCT FROM 'al-mutamid'),
  CHECK ((review_snapshot->'decision'->>'revisionId') IS NOT DISTINCT FROM revision_key),
  CHECK ((review_snapshot->'revision'->>'id') IS NOT DISTINCT FROM revision_key),
  CHECK ((review_snapshot->'decision'->>'revisionHash') IS NOT DISTINCT FROM package_hash),
  CHECK ((review_snapshot->'hash'->>'value') IS NOT DISTINCT FROM package_hash),
  CHECK ((review_snapshot->'output'->>'reviewedHash') IS NOT DISTINCT FROM package_hash),
  CHECK ((task_snapshot->'revision'->>'id') IS NOT DISTINCT FROM revision_key),
  CHECK ((task_snapshot->'input') IS NOT DISTINCT FROM (review_snapshot->'input')),
  CHECK ((task_snapshot->'revision') IS NOT DISTINCT FROM (review_snapshot->'revision')),
  CHECK ((task_snapshot->'policy') IS NOT DISTINCT FROM (review_snapshot->'policy')),
  CHECK ((task_snapshot->'sources') IS NOT DISTINCT FROM (review_snapshot->'sources')),
  CHECK ((task_snapshot->'claims') IS NOT DISTINCT FROM (review_snapshot->'claims')),
  CHECK ((task_snapshot->'evidence') IS NOT DISTINCT FROM (review_snapshot->'evidence')),
  CHECK ((task_snapshot->'references') IS NOT DISTINCT FROM (review_snapshot->'references')),
  CHECK ((task_snapshot->'issues') IS NOT DISTINCT FROM (review_snapshot->'issues')),
  CHECK ((task_snapshot->'taskId') IS NOT DISTINCT FROM (review_snapshot->'taskId')),
  CHECK ((task_snapshot->'traceId') IS NOT DISTINCT FROM (review_snapshot->'traceId'))
);
CREATE TABLE IF NOT EXISTS raad_dry_run.jobs (
  id uuid PRIMARY KEY,
  story_key text NOT NULL UNIQUE,
  package_hash text NOT NULL UNIQUE,
  approval_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','uncertain','completed','exhausted')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  worker_hash text CHECK (worker_hash ~ '^[a-f0-9]{64}$'),
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, approval_hash, package_hash),
  FOREIGN KEY (approval_hash, package_hash, story_key)
    REFERENCES raad_dry_run.approvals (approval_hash, package_hash, story_key),
  CHECK ((state = 'leased') = (lease_until IS NOT NULL)),
  CHECK (state <> 'leased' OR worker_hash IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS raad_dry_run.outbox (
  job_id uuid PRIMARY KEY,
  approval_hash text NOT NULL,
  package_hash text NOT NULL,
  event text NOT NULL CHECK (event = 'synthetic_enqueued'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (job_id, approval_hash, package_hash)
    REFERENCES raad_dry_run.jobs (id, approval_hash, package_hash)
);
CREATE TABLE IF NOT EXISTS raad_dry_run.simulated_receipts (
  job_id uuid PRIMARY KEY,
  approval_hash text NOT NULL,
  package_hash text NOT NULL UNIQUE,
  simulated boolean NOT NULL CHECK (simulated),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (job_id, approval_hash, package_hash)
    REFERENCES raad_dry_run.jobs (id, approval_hash, package_hash)
);
CREATE TABLE IF NOT EXISTS raad_dry_run.audit (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES raad_dry_run.jobs (id),
  event text NOT NULL CHECK (event IN ('enqueued','claimed','expired','completed','retry','uncertain','exhausted','reconciled')),
  worker_hash text CHECK (worker_hash ~ '^[a-f0-9]{64}$'),
  fence bigint NOT NULL CHECK (fence >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION raad_dry_run.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_SYNTHETIC_RECORD'; END;
$$;
CREATE OR REPLACE FUNCTION raad_dry_run.bound_job() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_JOB_BINDING'; END IF;
  IF ROW(NEW.id, NEW.story_key, NEW.package_hash, NEW.approval_hash)
    IS DISTINCT FROM ROW(OLD.id, OLD.story_key, OLD.package_hash, OLD.approval_hash)
    OR NEW.fence < OLD.fence OR NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'IMMUTABLE_JOB_BINDING';
  END IF;
  RETURN NEW;
END;
$$;
-- IF NOT EXISTS for triggers without dropping/replacing existing tables or data.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['identity','approvals','outbox','simulated_receipts','audit'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = pg_catalog.to_regclass('raad_dry_run.' || t) AND tgname = 'immutable_record') THEN
      EXECUTE pg_catalog.format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON raad_dry_run.%I FOR EACH ROW EXECUTE FUNCTION raad_dry_run.immutable()', t);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'raad_dry_run.jobs'::regclass AND tgname = 'bound_job') THEN
    CREATE TRIGGER bound_job BEFORE UPDATE OR DELETE ON raad_dry_run.jobs
      FOR EACH ROW EXECUTE FUNCTION raad_dry_run.bound_job();
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA raad_dry_run FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA raad_dry_run FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA raad_dry_run FROM PUBLIC;
