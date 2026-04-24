// Remote Debug Logger - Send iPhone events to PC for real-time monitoring
// Works in both app context and service worker context

const RemoteDebug = {
  enabled: true, // Toggle to disable remote logging
  deviceId: null,
  sessionId: null,
  queue: [], // Offline queue for failed requests
  maxQueueSize: 50,

  // Initialize with device and session IDs
  init(deviceId, sessionId) {
    this.deviceId = deviceId || this.generateDeviceId();
    this.sessionId = sessionId || this.generateSessionId();
    this.log('system', 'remote_debug_initialized', 'Remote debug logger initialized', {
      deviceId: this.deviceId,
      sessionId: this.sessionId,
      userAgent: navigator.userAgent
    });
  },

  // Generate unique device ID (persists in localStorage)
  generateDeviceId() {
    if (typeof localStorage !== 'undefined') {
      let deviceId = localStorage.getItem('debug_device_id');
      if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('debug_device_id', deviceId);
      }
      return deviceId;
    }
    return 'device_' + Date.now();
  },

  // Generate session ID (unique per app load)
  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  },

  // Main logging function
  async log(source, eventType, message, payload = null, error = null) {
    if (!this.enabled) return;

    const logEntry = {
      device_id: this.deviceId || this.generateDeviceId(),
      platform: 'ios',
      source: source, // 'app', 'service_worker', 'push_handler', 'system'
      event_type: eventType,
      message: message,
      payload_json: payload ? this.sanitizePayload(payload) : null,
      error_json: error ? this.serializeError(error) : null,
      user_agent: navigator.userAgent,
      session_id: this.sessionId || this.generateSessionId(),
      created_at: new Date().toISOString()
    };

    // Get current user ID if available
    try {
      const user = await this.getCurrentUser();
      if (user?.id) {
        logEntry.user_id = user.id;
      }
    } catch (e) {
      // User not available, continue without user_id
    }

    // Try to send immediately
    const sent = await this.sendLog(logEntry);

    // If failed, queue for retry
    if (!sent) {
      this.queueLog(logEntry);
    }
  },

  // Send log to backend
  async sendLog(logEntry) {
    try {
      const authToken = await this.getAuthToken();

      // If no auth token (not authenticated), skip silently - don't spam 401 errors
      if (!authToken) {
        // Queue it for later when auth is ready
        return false;
      }

      // Use fetch with proper headers
      const response = await fetch('https://api.onpointprodoors.com/rest/v1/remote_debug_logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': window.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODk3NzIsImV4cCI6MjA5MjI2NTc3Mn0.h_81EX9KbJHkIwqWz5c0LPwDRUQs8bOKrvC_j6MJYBk',
          'Authorization': 'Bearer ' + authToken
        },
        body: JSON.stringify(logEntry)
      });

      return response.ok;
    } catch (error) {
      console.error('[RemoteDebug] Failed to send log:', error);
      return false;
    }
  },

  // Get current auth token (returns null if not authenticated)
  async getAuthToken() {
    try {
      // Check if supabaseClient exists
      if (!window.supabaseClient) {
        return null;
      }

      // Try to get the session
      const { data } = await window.supabaseClient.auth.getSession();
      if (data?.session?.access_token) {
        return data.session.access_token;
      }

      // No authenticated session
      return null;
    } catch (e) {
      return null;
    }
  },

  // Get current user
  async getCurrentUser() {
    try {
      if (typeof window !== 'undefined' && window.supabaseClient) {
        const { data } = await window.supabaseClient.auth.getUser();
        return data?.user || null;
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  // Queue log for retry
  queueLog(logEntry) {
    this.queue.push(logEntry);
    if (this.queue.length > this.maxQueueSize) {
      this.queue.shift(); // Remove oldest
    }
    // Try to flush queue later
    setTimeout(() => this.flushQueue(), 5000);
  },

  // Retry sending queued logs
  async flushQueue() {
    if (this.queue.length === 0) return;

    const toSend = [...this.queue];
    this.queue = [];

    for (const log of toSend) {
      const sent = await this.sendLog(log);
      if (!sent) {
        this.queue.push(log); // Re-queue if failed
      }
    }
  },

  // Sanitize payload (remove sensitive data)
  sanitizePayload(payload) {
    if (!payload) return null;

    const sanitized = { ...payload };

    // Remove sensitive fields
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'apikey', 'auth'];
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  },

  // Serialize error object
  serializeError(error) {
    if (!error) return null;

    return {
      message: error.message || String(error),
      stack: error.stack || null,
      name: error.name || 'Error',
      code: error.code || null
    };
  },

  // Convenience methods for common events
  logAppEvent(eventType, message, payload) {
    return this.log('app', eventType, message, payload);
  },

  logServiceWorkerEvent(eventType, message, payload) {
    return this.log('service_worker', eventType, message, payload);
  },

  logPushEvent(eventType, message, payload, error) {
    return this.log('push_handler', eventType, message, payload, error);
  },

  logError(source, message, error) {
    return this.log(source, 'error', message, null, error);
  }
};

// Auto-initialize if in browser context
if (typeof window !== 'undefined') {
  window.RemoteDebug = RemoteDebug;
  RemoteDebug.init();
}

// Export for service worker
if (typeof self !== 'undefined' && self.constructor.name === 'ServiceWorkerGlobalScope') {
  self.RemoteDebug = RemoteDebug;
  RemoteDebug.init();
}
