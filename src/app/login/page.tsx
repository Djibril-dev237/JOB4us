"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const login = form.get("login") as string;
    // On accepte email ou téléphone, mais NextAuth attend email -> on envoie tel que
    const password = form.get("password") as string;

    const res = await signIn("credentials", {
      email: login,
      password,
      redirect: false,
    });

    setLoading(false);
    if (res?.error) {
      setError(res.error);
    } else {
      router.push("/offres");
      router.refresh();
    }
  }

  return (
    <>
      <style>{`
        * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
        :root { --primary:#0066FF; --primary-dark:#0044BB; --secondary:#FF6B35; }
        body { background:#F1F5F9; min-height:100vh; display:flex; flex-direction:column; }
        .auth-topbar { padding:1rem 2rem; display:flex; justify-content:space-between; align-items:center; background:#fff; border-bottom:1px solid #E2E8F0; }
        .topbar-logo { display:flex; align-items:center; gap:8px; text-decoration:none; }
        .topbar-logo-icon { width:34px; height:34px; background:#0066FF; border-radius:9px; display:flex; align-items:center; justify-content:center; }
        .topbar-logo-text { font-size:1.15rem; font-weight:900; letter-spacing:-.5px; line-height:1; }
        .topbar-logo-text .j { color:#0066FF; } .topbar-logo-text .u { color:#FF6B35; }
        .auth-wrapper { flex:1; display:flex; align-items:center; justify-content:center; padding:2rem 1rem; }
        .auth-card { width:100%; max-width:980px; border:none; border-radius:20px; box-shadow:0 8px 40px rgba(0,0,0,.1); overflow:hidden; background:#fff; }
        .auth-left { background:#0066FF; padding:3rem 2.5rem; display:flex; flex-direction:column; justify-content:space-between; color:#fff; position:relative; overflow:hidden; }
        .auth-left::before{content:''; position:absolute; width:320px; height:320px; border-radius:50%; background:rgba(255,255,255,.06); top:-100px; right:-100px;}
        .auth-left::after{content:''; position:absolute; width:220px; height:220px; border-radius:50%; background:rgba(255,255,255,.06); bottom:-60px; left:-60px;}
        .panel-logo { display:flex; align-items:center; gap:8px; margin-bottom:2.5rem; position:relative; z-index:1; }
        .panel-logo-icon { width:38px; height:38px; background:rgba(255,255,255,.15); border-radius:10px; display:flex; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,.2); }
        .panel-logo-text{ font-size:1.3rem; font-weight:900; letter-spacing:-.5px; }
        .panel-logo-text .j{ color:#fff; } .panel-logo-text .u{ color:#FF6B35; }
        .auth-left h2{ font-size:1.45rem; font-weight:800; line-height:1.35; margin-bottom:.75rem; letter-spacing:-.3px; position:relative; z-index:1; }
        .auth-left p{ opacity:.8; font-size:.88rem; line-height:1.65; position:relative; z-index:1; }
        .feature-item{ display:flex; align-items:center; gap:12px; margin-bottom:.85rem; font-size:.875rem; font-weight:500; position:relative; z-index:1; }
        .fi-icon{ width:36px; height:36px; border-radius:9px; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.15); display:flex; align-items:center; justify-content:center; font-size:.95rem; flex-shrink:0; }
        .stats-row{ display:flex; gap:.75rem; margin-top:2.5rem; position:relative; z-index:1; }
        .stat-pill{ background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.15); border-radius:12px; padding:.85rem .75rem; text-align:center; flex:1; }
        .stat-pill .sp-number{ font-size:1.25rem; font-weight:800; letter-spacing:-.3px; }
        .stat-pill .sp-label{ font-size:.68rem; opacity:.7; font-weight:500; margin-top:2px; }
        .auth-right{ background:#fff; padding:3rem 2.75rem; position:relative; }
        .auth-right h3{ font-size:1.5rem; font-weight:800; color:#0F172A; letter-spacing:-.4px; margin-bottom:.3rem; }
        .auth-right .subtitle{ color:#64748B; font-size:.875rem; margin-bottom:1.75rem; }
        .form-label{ font-weight:600; font-size:.82rem; color:#374151; margin-bottom:.4rem; text-transform:uppercase; letter-spacing:.04em; }
        .form-control{ border:1.5px solid #E2E8F0; border-radius:10px; padding:.72rem 1rem; font-size:.9rem; color:#0F172A; transition:all .2s; background:#FAFAFA; }
        .form-control:focus{ border-color:var(--primary); box-shadow:0 0 0 3px rgba(0,102,255,.1); background:#fff; outline:none; }
        .form-control::placeholder{ color:#94A3B8; }
        .btn-auth{ background:var(--primary); color:#fff; border:none; border-radius:10px; padding:.85rem; font-weight:700; font-size:.95rem; width:100%; transition:all .2s; }
        .btn-auth:hover{ background:var(--primary-dark); transform:translateY(-1px); box-shadow:0 6px 20px rgba(0,102,255,.25); color:#fff; }
        .btn-auth:active{ transform:translateY(0); }
        .auth-divider{ display:flex; align-items:center; gap:.75rem; color:#CBD5E1; font-size:.8rem; margin:1.25rem 0; font-weight:500; }
        .auth-divider::before,.auth-divider::after{ content:''; flex:1; height:1px; background:#E2E8F0; }
        .auth-footer{ text-align:center; padding:1.25rem; font-size:.78rem; color:#94A3B8; }
        .auth-footer a{ color:var(--primary); text-decoration:none; }
        .auth-footer a:hover{ text-decoration:underline; }
      `}</style>

      {/* Topbar */}
      <div className="auth-topbar">
        <Link href="/" className="topbar-logo">
          <div className="topbar-logo-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </div>
          <div className="topbar-logo-text"><span className="j">Job</span><span className="u">4Us</span></div>
        </Link>
        <div className="d-flex align-items-center gap-3">
          <span className="text-muted small d-none d-sm-inline">Pas encore de compte ?</span>
          <Link href="/register" className="btn btn-sm btn-outline-primary rounded-pill px-3">S&apos;inscrire</Link>
        </div>
      </div>

      <div className="auth-wrapper">
        <div className="card auth-card">
          <div className="row g-0">
            <div className="col-lg-5 auth-left d-none d-lg-flex flex-column">
              <div>
                <div className="panel-logo">
                  <div className="panel-logo-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  </div>
                  <div className="panel-logo-text"><span className="j">Job</span><span className="u">4Us</span></div>
                </div>
                <h2>Bon retour parmi nous ! 👋</h2>
                <p>Connectez-vous et continuez votre recherche d&apos;emploi là où vous l&apos;avez laissée.</p>
                <div className="mt-4">
                  <div className="feature-item"><div className="fi-icon"><i className="bi bi-briefcase-fill"></i></div><span>Des milliers d&apos;offres vérifiées</span></div>
                  <div className="feature-item"><div className="fi-icon"><i className="bi bi-lightning-charge-fill"></i></div><span>Candidature en 1 clic</span></div>
                  <div className="feature-item"><div className="fi-icon"><i className="bi bi-bell-fill"></i></div><span>Alertes emploi en temps réel</span></div>
                  <div className="feature-item"><div className="fi-icon"><i className="bi bi-shield-check-fill"></i></div><span>Entreprises certifiées Job4Us</span></div>
                </div>
              </div>
              <div className="stats-row">
                <div className="stat-pill"><div className="sp-number">5K+</div><div className="sp-label">Offres actives</div></div>
                <div className="stat-pill"><div className="sp-number">2K+</div><div className="sp-label">Entreprises</div></div>
                <div className="stat-pill"><div className="sp-number">10K+</div><div className="sp-label">Candidats</div></div>
              </div>
            </div>

            <div className="col-lg-7 auth-right">
              <h3>Se connecter</h3>
              <p className="subtitle">Accédez à votre espace Job4Us</p>

              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label className="form-label">Email ou Téléphone</label>
                  <input type="text" name="login" className="form-control" placeholder="email@exemple.com ou +237 6XX XXX XXX" required />
                </div>

                <div className="mb-3">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <label className="form-label mb-0">Mot de passe</label>
                    <Link href="#" className="small text-primary text-decoration-none fw-medium">Mot de passe oublié ?</Link>
                  </div>
                  <div className="position-relative">
                    <input type={showPwd ? "text" : "password"} name="password" className="form-control" placeholder="••••••••" required style={{ paddingRight: "3rem" }} />
                    <button type="button" onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: ".75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94A3B8", cursor: "pointer", padding: 0 }}>
                      <i className={`bi ${showPwd ? "bi-eye-slash" : "bi-eye"}`}></i>
                    </button>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="remember" />
                    <label className="form-check-label small text-muted" htmlFor="remember" style={{ textTransform: "none", letterSpacing: 0 }}>Se souvenir de moi</label>
                  </div>
                </div>

                {error && <div className="alert alert-danger py-2 small"><i className="bi bi-exclamation-circle me-1"></i>{error}</div>}

                <button type="submit" className="btn-auth" disabled={loading}>
                  {loading ? "Connexion..." : <><i className="bi bi-box-arrow-in-right me-2"></i>Se connecter</>}
                </button>
              </form>

              <div className="auth-divider">ou</div>

              <div className="d-grid gap-2 mb-3">
                <button onClick={() => signIn("google", { callbackUrl: "/offres" })} className="btn btn-outline-dark bg-white d-flex align-items-center justify-content-center gap-2" style={{ borderRadius: 10, padding: ".72rem", border: "1.5px solid #E2E8F0", fontWeight: 600, fontSize: ".9rem" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                  Continuer avec Google
                </button>
                <button onClick={() => signIn("apple", { callbackUrl: "/offres" })} className="btn btn-dark d-flex align-items-center justify-content-center gap-2" style={{ borderRadius: 10, padding: ".72rem", fontWeight: 600, fontSize: ".9rem", background: "#000", border: "none" }}>
                  <i className="bi bi-apple" style={{ fontSize: "1.1rem" }}></i> Continuer avec Apple
                </button>
              </div>

              <p className="text-center text-muted small mb-0">
                Pas encore de compte ? <Link href="/register" className="text-primary fw-semibold text-decoration-none">Créer un compte gratuitement</Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-footer">© {new Date().getFullYear()} Job4Us · Cameroun &nbsp;·&nbsp; <a href="#">Confidentialité</a> &nbsp;·&nbsp; <a href="#">Conditions d&apos;utilisation</a></div>
    </>
  );
}
