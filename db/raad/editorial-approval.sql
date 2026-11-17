-- Manual editorial approval path: a logged-in admin/editor approves the exact
-- saved version after human review, bound to the article snapshot and the real
-- media SHA-256 supplied in proof. Additive — the pipeline path is unchanged.
CREATE OR REPLACE FUNCTION raad_gate.record_editorial_approval(
  p_article_id integer, p_proof jsonb, p_valid_for_seconds integer DEFAULT 86400
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.articles; s jsonb; h text; existing raad_gate.approvals;
  th text; rh text; ph text; answer uuid;
BEGIN
  PERFORM raad_gate.lock_publication_scope();
  SELECT * INTO a FROM public.articles WHERE id=p_article_id FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('draft','pending') THEN RAISE EXCEPTION 'RAAD_REVIEW_DRAFT_REQUIRED'; END IF;
  s:=raad_gate.article_snapshot(p_article_id); h:=raad_gate.article_snapshot_hash(p_article_id);
  IF nullif(btrim(a.title),'') IS NULL OR nullif(btrim(a.excerpt),'') IS NULL OR
     nullif(btrim(a.body),'') IS NULL OR nullif(btrim(a.image),'') IS NULL THEN RAISE EXCEPTION 'RAAD_REVIEW_INCOMPLETE'; END IF;
  IF p_proof->>'final_agent' IS DISTINCT FROM 'editorial-panel' OR p_proof->>'decision' IS DISTINCT FROM 'APPROVED' OR
     p_proof->>'media_sha256' IS NULL OR p_proof->>'media_sha256' !~ '^[a-f0-9]{64}$' OR
     p_proof->>'site' IS NULL OR p_proof->>'site' !~ '^https?://' OR
     nullif(p_proof->>'actor','') IS NULL OR
     p_valid_for_seconds IS NULL OR p_valid_for_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'RAAD_REVIEW_INCOMPLETE'; END IF;
  th:=encode(sha256(convert_to('editorial-task:'||h,'UTF8')),'hex');
  rh:=encode(sha256(convert_to('editorial-result:'||h,'UTF8')),'hex');
  ph:=encode(sha256(convert_to('editorial-policy:'||coalesce(p_proof->>'actor','')||':'||coalesce(p_proof->>'site',''),'UTF8')),'hex');
  SELECT * INTO existing FROM raad_gate.approvals WHERE article_id=p_article_id AND task_hash=th;
  IF FOUND THEN
    IF existing.snapshot IS DISTINCT FROM s OR existing.proof IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'RAAD_REVIEW_CONFLICT'; END IF;
    RETURN existing.id;
  END IF;
  INSERT INTO raad_gate.approvals(article_id,snapshot,snapshot_hash,task_hash,result_hash,policy_hash,reviewed_at,expires_at,proof)
    VALUES(p_article_id,s,h,th,rh,ph,clock_timestamp(),clock_timestamp()+p_valid_for_seconds*interval '1 second',p_proof) RETURNING id INTO answer;
  INSERT INTO raad_gate.audit(article_id,event,snapshot_hash,approval_id) VALUES(p_article_id,'editorial_review_recorded',h,answer);
  RETURN answer;
END $$;
GRANT EXECUTE ON FUNCTION raad_gate.record_editorial_approval(integer,jsonb,integer) TO raad_gate_publisher,raad_gate_approver;
