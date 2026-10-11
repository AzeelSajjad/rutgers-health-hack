interface Props {
  busy: boolean;
  status: string;
  onSignIn(): void;
  onSignUp(type: 'student' | 'faculty'): void;
  onPreview(): void;
  onRetrySignOut?: () => void;
}

function Brand() {
  return <span className="auth-brand"><span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4v24M4 16h24"/><circle cx="16" cy="16" r="12"/></svg></span><span>casecoach<span className="brand-dot">.</span></span></span>;
}

/** Stephen's landing/authentication design, rendered within the shared React app. */
export function LandingPage({ busy, status, onSignIn, onSignUp, onPreview, onRetrySignOut }: Props) {
  return <main className="auth-screen">
    <section className="auth-story" aria-label="About CaseCoach">
      <Brand/>
      <div className="auth-story-copy"><div className="auth-kicker"><span/>PRACTICE WITH PURPOSE</div>
        <h1>Every patient<br/>has a story.</h1>
        <p>Build confidence in the moments that matter with realistic, guided clinical encounters.</p>
      </div>
      <div className="auth-visual" aria-hidden="true">
        <div className="auth-orbit orbit-one"/><div className="auth-orbit orbit-two"/>
        <div className="auth-visual-card">
          <div className="auth-visual-top"><span className="visual-pulse"/>VIRTUAL PATIENT<span className="visual-time">PRACTICE</span></div>
          <div className="visual-person"><div className="visual-avatar">WN</div><div><strong>Wyatt Nelson</strong><small>Educational sample case</small></div></div>
          <div className="visual-wave">{Array.from({ length: 20 }, (_, i) => <span key={i}/>)}</div>
          <div className="visual-caption">A more human way to practice</div>
        </div>
        <div className="auth-float-note"><span>✳</span>Learn by listening</div>
      </div>
      <div className="auth-story-footer">CLINICAL PRACTICE · BUILT FOR HEALTHCARE EDUCATION</div>
    </section>
    <section className="auth-form-side" aria-labelledby="welcome-title"><div className="auth-form-wrap">
      <div className="auth-form-brand"><Brand/></div>
      <div className="auth-welcome-label">YOUR LEARNING SPACE</div>
      <h2 id="welcome-title">Welcome to CaseCoach</h2>
      <p className="auth-description">Sign in to continue practicing your clinical skills.</p>
      <div className="auth-access-buttons">
        <button className="auth-primary" disabled={busy} onClick={onSignIn}>Sign in <span aria-hidden="true">→</span></button>
        <button className="auth-secondary" disabled={busy} onClick={() => onSignUp('student')}>Student sign up</button>
        <button className="auth-secondary faculty-signup" disabled={busy} onClick={() => onSignUp('faculty')}><span><strong>Faculty sign up</strong><small>For educators and clinical instructors</small></span><span aria-hidden="true">→</span></button>
      </div>
      <p className="auth-signup-summary">Student and faculty signup use your institution’s Auth0 registration flow. Faculty access requires school verification or administrator approval.</p>
      <div className="auth-divider"><span>SECURE ACCESS</span></div>
      <div className="auth0-note"><span className="auth0-lock" aria-hidden="true">▣</span><p>Account access is managed by <strong>Auth0</strong>. Passwords and verification codes are entered on Auth0’s hosted pages.</p></div>
      <p className="auth-status" role="status" aria-live="polite">{status}</p>
      {onRetrySignOut && <button className="account-exit" disabled={busy} onClick={onRetrySignOut}>Retry sign out</button>}
      <div className="demo-access"><button className="preview-demo" onClick={onPreview}>Preview demo without signing in</button><small>Educational preview · fixed replies · no live backend access</small></div>
      <div className="auth-form-footer">Use only the supplied educational cases and follow your program’s privacy and training policies.</div>
    </div></section>
  </main>;
}
