import { useCallback, useEffect, useRef, useState } from "react";
import "./AuthPanel.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

const GOOGLE_CLIENT_ID = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID || ""
).trim();

export default function AuthPanel({ onAuthenticated }) {
  const [loading, setLoading] = useState(false);
  const [gsiReady, setGsiReady] = useState(false);
  const [gsiInitError, setGsiInitError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const googleButtonContainerRef = useRef(null);

  const handleGoogleCredentialResponse = useCallback(
    async (response) => {
      const credential =
        typeof response?.credential === "string"
          ? response.credential.trim()
          : "";

      if (!credential) {
        setError(
          "Google sign-in was cancelled or did not return a valid credential. Please try again."
        );
        return;
      }

      setError("");
      setMessage("");
      setLoading(true);

      try {
        const apiResponse = await fetch(`${API_URL}/api/auth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ credential }),
        });

        let data = null;
        try {
          data = await apiResponse.json();
        } catch {
          // If response body is not JSON (e.g. gateway error, 404 from static host)
          if (!apiResponse.ok) {
            if (apiResponse.status === 404) {
              throw new Error(
                `LostLink authentication API was not found at ${API_URL}/api/auth/google. Please verify the backend server is running on port 5000.`
              );
            }
            throw new Error(
              `The authentication server returned HTTP ${apiResponse.status}. Please check backend logs.`
            );
          }
        }

        if (!apiResponse.ok || !data?.success) {
          throw new Error(
            data?.message ||
              "Google authentication could not be completed. Please try again."
          );
        }

        if (!data.token || !data.user) {
          throw new Error(
            "The server returned an incomplete authentication response. Please try again."
          );
        }

        setMessage("Signed in successfully with Google.");

        onAuthenticated({
          token: data.token,
          user: data.user,
        });
      } catch (err) {
        if (err.name === "TypeError" || err.message?.includes("fetch")) {
          setError(
            `Unable to connect to the LostLink backend server at ${API_URL}. Please ensure the Node server is running on port 5000 and CORS is enabled.`
          );
        } else {
          setError(
            err.message ||
              "Unable to verify Google sign-in with the server. Please try again."
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [onAuthenticated]
  );

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      return undefined;
    }

    let cancelled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    function initGoogleSignIn() {
      if (cancelled) return false;
      const googleId = window.google?.accounts?.id;
      if (!googleId) return false;

      try {
        googleId.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredentialResponse,
          cancel_on_tap_outside: true,
        });

        if (googleButtonContainerRef.current) {
          googleButtonContainerRef.current.innerHTML = "";
          googleId.renderButton(googleButtonContainerRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "left",
            width: 320,
          });
        }

        setGsiReady(true);
        setGsiInitError("");
        return true;
      } catch {
        setGsiInitError(
          "Could not initialize Google Identity Services. Please check your browser settings or ad blockers."
        );
        return false;
      }
    }

    if (!initGoogleSignIn()) {
      pollTimer = window.setInterval(() => {
        if (initGoogleSignIn() && pollTimer) {
          window.clearInterval(pollTimer);
        }
      }, 250);

      // Timeout after 6 seconds if Google Identity script fails to load
      timeoutTimer = window.setTimeout(() => {
        if (!window.google?.accounts?.id) {
          setGsiInitError(
            "Google Sign-In script could not be loaded. Please check your connection or disable script-blocking extensions."
          );
        }
      }, 6000);
    }

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
      if (timeoutTimer) window.clearTimeout(timeoutTimer);
    };
  }, [handleGoogleCredentialResponse]);

  function handleRetryInit() {
    setGsiInitError("");
    setGsiReady(false);
    const googleId = window.google?.accounts?.id;
    if (googleId && GOOGLE_CLIENT_ID && googleButtonContainerRef.current) {
      googleId.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
        cancel_on_tap_outside: true,
      });
      googleButtonContainerRef.current.innerHTML = "";
      googleId.renderButton(googleButtonContainerRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: 320,
      });
      setGsiReady(true);
    }
  }

  return (
    <section className="auth-panel" aria-label="Google account authentication">
      <div className="auth-panel-grid">
        <div className="auth-showcase">
          <span className="auth-eyebrow">LOSTLINK CAMPUS NETWORK</span>
          <h2>Sign in to your LostLink workspace</h2>
          <p>
            Continue with any valid Google account to post lost or found
            reports, check explainable smart matches, submit ownership claims,
            and earn community XP.
          </p>

          <ul className="auth-Trust-list">
            <li>
              <span className="auth-trust-icon" aria-hidden="true">
                ✦
              </span>
              <div>
                <strong>Explainable Smart Matching</strong>
                <span>
                  Rule-based similarity scoring across category, keywords,
                  location, and date.
                </span>
              </div>
            </li>
            <li>
              <span className="auth-trust-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Protected Ownership Claims</strong>
                <span>
                  Private verification proofs reviewed before any item is marked
                  returned.
                </span>
              </div>
            </li>
            <li>
              <span className="auth-trust-icon" aria-hidden="true">
                ★
              </span>
              <div>
                <strong>Server-Verified XP &amp; Badges</strong>
                <span>
                  Earn recognition for verified reports and successful campus
                  handovers.
                </span>
              </div>
            </li>
          </ul>
        </div>

        <div className="auth-form-container">
          <div className="auth-google-header">
            <span className="auth-google-badge">Verified Google Sign-In</span>
            <h3>Welcome to LostLink</h3>
            <p>
              Sign in with one click using your Google account. Any valid
              Google account is supported with zero password setup.
            </p>
          </div>

          <div className="auth-google-actions">
            {GOOGLE_CLIENT_ID ? (
              <div className="google-btn-wrapper">
                <div
                  ref={googleButtonContainerRef}
                  className={`google-gsi-slot ${gsiReady ? "ready" : "pending"}`}
                  aria-label="Google Sign-In button"
                />

                {!gsiReady && !gsiInitError && (
                  <div className="google-btn-placeholder" aria-hidden="true">
                    <svg
                      className="google-g-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fill="#4285F4"
                        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.09 3.56-5.17 3.56-8.8Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-2.98c-1.08.72-2.45 1.16-4.07 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.31c-.24-.72-.38-1.49-.38-2.31s.14-1.59.38-2.31V6.6H1.29C.47 8.23 0 10.06 0 12s.47 3.77 1.29 5.4l3.99-3.09Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.6l3.99 3.09c.95-2.85 3.6-4.94 6.72-4.94Z"
                      />
                    </svg>
                    <span>Loading Google Sign-In...</span>
                  </div>
                )}

                {gsiInitError && (
                  <div className="google-init-fallback">
                    <p className="auth-error">{gsiInitError}</p>
                    <button
                      type="button"
                      className="google-retry-btn"
                      onClick={handleRetryInit}
                    >
                      Retry Google Sign-In
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="auth-config-hint" role="status">
                <strong>Google OAuth Client ID setup required:</strong>
                <span>
                  Set <code>VITE_GOOGLE_CLIENT_ID</code> in{" "}
                  <code>client/.env.local</code> and <code>GOOGLE_CLIENT_ID</code>{" "}
                  in <code>server/.env</code> with your Google Web Client ID.
                </span>
              </div>
            )}

            {loading && (
              <div className="auth-verifying-notice" role="status">
                <span className="auth-spinner" aria-hidden="true" />
                <span>Verifying your Google account with LostLink server...</span>
              </div>
            )}
          </div>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          {message && (
            <p className="auth-success" role="status">
              {message}
            </p>
          )}

          <p className="auth-note">
            Your Google ID token is cryptographically verified on the LostLink
            server. New accounts are automatically created with student
            permissions.
          </p>
        </div>
      </div>
    </section>
  );
}
