"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState("candidat");
  const [showPwd, setShowPwd] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const data = {
      name: form.get("name") as string,
      email: form.get("login") as string,
      password: form.get("password") as string,
      password_confirmation: form.get("password_confirmation") as string,
      role: form.get("role") as string,
    };

    if (data.password !== data.password_confirmation) {
      setError("Les mots de passe ne correspondent pas");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.name, email: data.email, password: data.password, role: data.role }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) setError(json.error || "Erreur");
    else router.push("/login");
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
        .auth-right{ background:#fff; padding:3rem 2.75rem; position:relative; }
        .auth-right h3{ font-size:1.5rem; font-weight:800; color:#0F172A; letter-spacing:-.4px; margin-bottom:.3rem; }
        .auth-right .subtitle{ color:#64748B; font-size:.875rem; margin-bottom:1.75rem; }
        .form-label{ font-weight:600; font-size:.82rem; color:#374151; margin-bottom:.4rem; text-transform:uppercase; letter-spacing:.04em; }
        .form-control{ border:1.5px solid #E2E8F0; border-radius:10px; padding:.72rem 1rem; font-size:.9rem; color:#0F172A; transition:all .2s; background:#FAFAFA; }
        .form-control:focus{ border-color:var(--primary); box-shadow:0 0 0 3px rgba(0,102,255,.1); background:#fff; outline:none; }
        .form-control::placeholder{ color:#94A3B8; }
        .role-card{ border:2px solid #E2E8F0; border-radius:12px; padding:1rem .75rem; cursor:pointer; transition:all .2s; text-align:center; display:block; background:#FAFAFA; }
        .role-card:hover{ border-color:var(--primary); background:#F0F7FF; transform:translateY(-1px); }
        .role-card input[type="radio"]{ display:none; }
        .role-card.selected{ border-color:var(--primary); background:#EFF6FF; box-shadow:0 0 0 3px rgba(0,102,255,.1); }
        .role-card.selected-orange{ border-color:var(--secondary); background:#FFF7ED; box-shadow:0 0 0 3px rgba(255,107,53,.1); }
        .role-card .rc-icon{ font-size:1.75rem; display:block; margin-bottom:.5rem; }
        .role-card .rc-title{ font-weight:700; font-size:.9rem; color:#0F172A; }
        .role-card .rc-desc{ font-size:.74rem; color:#64748B; margin-top:.2rem; }
        .btn-auth{ background:var(--primary); color:#fff; border:none; border-radius:10px; padding:.85rem; font-weight:700; font-size:.95rem; width:100%; transition:all .2s; }
        .btn-auth:hover{ background:var(--primary-dark); transform:translateY(-1px); box-shadow:0 6px 20px rgba(0,102,255,.25); color:#fff; }
        .auth-divider{ display:flex; align-items:center; gap:.75rem; color:#CBD5E1; font-size:.8rem; margin:1.25rem 0; font-weight:500; }
        .auth-divider::before,.auth-divider::after{ content:''; flex:1; height:1px; background:#E2E8F0; }
        .auth-footer{ text-align:center; padding:1.25rem; font-size:.78rem; color:#94A3B8; }
        .auth-footer a{ color:var(--primary); text-decoration:none; }
      `}</style>

      <div className="auth-topbar">
        <Link href="/" className="topbar-logo">
          <div className="topbar-logo-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg></div>
          <div className="topbar-logo-text"><span className="j">Job</span><span className="u">4Us</span></div>
        </Link>
        <div className="d-flex align-items-center gap-3">
          <span className="text-muted small d-none d-sm-inline">Déjà inscrit ?</span>
          <Link href="/login" className="btn btn-sm btn-outline-primary rounded-pill px-3">Se connecter</Link>
        </div>
      </div>

      <div className="auth-wrapper">
        <div className="card auth-card">
          <div className="row g-0">
            <div className="col-lg-5 auth-left d-none d-lg-flex flex-column">
              <div>
                <div className="panel-logo">
                  <div className="panel-logo-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg></div>
                  <div className="panel-logo-text"><span className="j">Job</span><span className="u">4Us</span></div>
                </div>
                <h2>Rejoignez la communauté Job4Us 🚀</h2>
                <p>Que vous cherchiez un emploi ou le bon candidat, Job4Us est fait pour vous.</p>
                <div className="mt-4">
                  <div className="p-3 rounded-3 mb-3" style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)" }}>
                    <div className="d-flex align-items-center gap-2 mb-1"><i className="bi bi-person-circle"></i><span style={{ fontWeight: 700, fontSize: ".9rem" }}>Candidat</span></div>
                    <p className="mb-0" style={{ fontSize: ".8rem", opacity: .8 }}>Créez votre profil, uploadez votre CV et postulez en quelques clics.</p>
                  </div>
                  <div className="p-3 rounded-3" style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)" }}>
                    <div className="d-flex align-items-center gap-2 mb-1"><i className="bi bi-building"></i><span style={{ fontWeight: 700, fontSize: ".9rem" }}>Recruteur</span></div>
                    <p className="mb-0" style={{ fontSize: ".8rem", opacity: .8 }}>Publiez vos offres et trouvez les meilleurs talents d&apos;Afrique.</p>
                  </div>
                </div>
              </div>
              <div className="d-flex gap-2 mt-4" style={{ position: "relative", zIndex: 1 }}>
                <div className="flex-fill text-center p-2 rounded-3" style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.15)" }}><div style={{ fontWeight: 800 }}>5K+</div><div style={{ fontSize: ".7rem", opacity: .7 }}>Offres</div></div>
                <div className="flex-fill text-center p-2 rounded-3" style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.15)" }}><div style={{ fontWeight: 800 }}>2K+</div><div style={{ fontSize: ".7rem", opacity: .7 }}>Entreprises</div></div>
                <div className="flex-fill text-center p-2 rounded-3" style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.15)" }}><div style={{ fontWeight: 800 }}>10K+</div><div style={{ fontSize: ".7rem", opacity: .7 }}>Candidats</div></div>
              </div>
            </div>

            <div className="col-lg-7 auth-right">
              <h3>Créer un compte</h3>
              <p className="subtitle">Rejoignez Job4Us gratuitement en quelques secondes</p>

              <form onSubmit={handleSubmit}>
                <div className="mb-4">
                  <label className="form-label">Je suis un :</label>
                  <div className="row g-2">
                    <div className="col-6">
                      <label className={`role-card ${role === "candidat" ? "selected" : ""}`} onClick={() => setRole("candidat")}>
                        <input type="radio" name="role" value="candidat" checked={role === "candidat"} onChange={() => setRole("candidat")} required />
                        <i className="bi bi-person-circle rc-icon" style={{ color: "#0066FF" }}></i>
                        <div className="rc-title">Candidat</div>
                        <div className="rc-desc">Je cherche un emploi</div>
                      </label>
                    </div>
                    <div className="col-6">
                      <label className={`role-card ${role === "recruteur" ? "selected-orange" : ""}`} onClick={() => setRole("recruteur")}>
                        <input type="radio" name="role" value="recruteur" checked={role === "recruteur"} onChange={() => setRole("recruteur")} />
                        <i className="bi bi-building rc-icon" style={{ color: "#FF6B35" }}></i>
                        <div className="rc-title">Recruteur</div>
                        <div className="rc-desc">Je recrute des talents</div>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label">Nom complet</label>
                  <input type="text" name="name" className="form-control" placeholder="Jean Dupont" required />
                </div>

                <div className="mb-3">
                  <label className="form-label">Email ou Téléphone</label>
                  <input type="text" name="login" className="form-control" placeholder="email@exemple.com ou +237 6XX XXX XXX" required />
                  <div className="form-text small text-muted mt-1"><i className="bi bi-info-circle me-1"></i>Entrez votre email ou votre numéro</div>
                </div>

                <div className="row g-3 mb-4">
                  <div className="col-md-6">
                    <label className="form-label">Mot de passe</label>
                    <div className="position-relative">
                      <input type={showPwd ? "text" : "password"} name="password" className="form-control" placeholder="Min. 8 caractères" required style={{ paddingRight: "3rem" }} />
                      <button type="button" onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: ".75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94A3B8", cursor: "pointer", padding: 0 }}><i className={`bi ${showPwd ? "bi-eye-slash" : "bi-eye"}`}></i></button>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Confirmer</label>
                    <div className="position-relative">
                      <input type={showPwd2 ? "text" : "password"} name="password_confirmation" className="form-control" placeholder="Répéter" required style={{ paddingRight: "3rem" }} />
                      <button type="button" onClick={() => setShowPwd2(!showPwd2)} style={{ position: "absolute", right: ".75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94A3B8", cursor: "pointer", padding: 0 }}><i className={`bi ${showPwd2 ? "bi-eye-slash" : "bi-eye"}`}></i></button>
                    </div>
                  </div>
                </div>

                {error && <div className="alert alert-danger py-2 small"><i className="bi bi-exclamation-circle me-1"></i>{error}</div>}

                <button type="submit" className="btn-auth" disabled={loading}>{loading ? "Création..." : <><i className="bi bi-person-plus me-2"></i>Créer mon compte</>}</button>

                <div className="auth-divider">ou</div>

                <p className="text-center text-muted small mb-0">Déjà inscrit ? <Link href="/login" className="text-primary fw-semibold text-decoration-none">Se connecter</Link></p>
              </form>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-footer">© {new Date().getFullYear()} Job4Us · Cameroun &nbsp;·&nbsp; <a href="#">Confidentialité</a> &nbsp;·&nbsp; <a href="#">Conditions d&apos;utilisation</a></div>
    </>
  );
}
