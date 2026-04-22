-- Fix dispatcher deletion - handle foreign key constraints
-- Nulls out all references before deleting

CREATE OR REPLACE FUNCTION delete_user_profile(
  p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_assigned_jobs_count INT;
  v_created_jobs_count INT;
  v_notifications_count INT;
BEGIN
  -- Count affected records
  SELECT COUNT(*) INTO v_assigned_jobs_count
  FROM jobs WHERE assigned_tech_id = p_user_id;

  SELECT COUNT(*) INTO v_created_jobs_count
  FROM jobs WHERE created_by = p_user_id;

  SELECT COUNT(*) INTO v_notifications_count
  FROM notifications WHERE user_id = p_user_id;

  -- NULL out foreign key references
  UPDATE jobs SET assigned_tech_id = NULL
  WHERE assigned_tech_id = p_user_id;

  UPDATE jobs SET created_by = NULL
  WHERE created_by = p_user_id;

  -- Delete notifications
  DELETE FROM notifications
  WHERE user_id = p_user_id;

  -- Delete push subscriptions
  DELETE FROM push_subscriptions
  WHERE user_id = p_user_id;

  -- Delete profile
  DELETE FROM profiles
  WHERE id = p_user_id;

  -- Return summary
  RETURN json_build_object(
    'success', true,
    'assigned_jobs_unassigned', v_assigned_jobs_count,
    'created_jobs_unlinked', v_created_jobs_count,
    'notifications_deleted', v_notifications_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION delete_user_profile TO anon, authenticated;

COMMENT ON FUNCTION delete_user_profile IS
  'Safely deletes a user profile by nulling out all foreign key references first. Returns summary of affected records.';
