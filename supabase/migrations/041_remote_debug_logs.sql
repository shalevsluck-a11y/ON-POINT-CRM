-- Remote debug logging table for iPhone-to-PC debugging
-- Captures events from iPhone app and service worker for real-time monitoring

CREATE TABLE IF NOT EXISTS remote_debug_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'ios',
  source TEXT NOT NULL CHECK (source IN ('app', 'service_worker', 'push_handler', 'system')),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB,
  error_json JSONB,
  user_agent TEXT,
  session_id TEXT
);

-- Index for fast querying by time and filtering
CREATE INDEX idx_remote_debug_logs_created_at ON remote_debug_logs(created_at DESC);
CREATE INDEX idx_remote_debug_logs_user_id ON remote_debug_logs(user_id);
CREATE INDEX idx_remote_debug_logs_device_id ON remote_debug_logs(device_id);
CREATE INDEX idx_remote_debug_logs_event_type ON remote_debug_logs(event_type);
CREATE INDEX idx_remote_debug_logs_source ON remote_debug_logs(source);

-- Enable realtime for live updates on PC
ALTER PUBLICATION supabase_realtime ADD TABLE remote_debug_logs;

-- RLS Policies: Only admins can read debug logs
ALTER TABLE remote_debug_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own debug logs
CREATE POLICY "Users can insert their own debug logs"
  ON remote_debug_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only admins can view debug logs
CREATE POLICY "Admins can view all debug logs"
  ON remote_debug_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Auto-cleanup old debug logs (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_debug_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM remote_debug_logs
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE remote_debug_logs IS 'Remote debug events from iPhone app and service worker for real-time PC monitoring';
COMMENT ON COLUMN remote_debug_logs.source IS 'Where the log came from: app, service_worker, push_handler, system';
COMMENT ON COLUMN remote_debug_logs.event_type IS 'Type of event: login, push_received, notification_shown, error, etc';
COMMENT ON COLUMN remote_debug_logs.device_id IS 'Unique device identifier for filtering';
