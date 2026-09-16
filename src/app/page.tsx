import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Job4Us — Trouvez votre emploi au Cameroun",
  description: "La plateforme de recrutement #1 en Afrique centrale. Des milliers d'offres vérifiées vous attendent.",
};

export default async function AccueilPage() {
  const session = await getServerSession(authOptions);

  // Stats
  let stats = { offres: 0, entreprises: 0, candidats: 0 };
  let categories: any[] = [];
  let offres: any[] = [];

  try {
    const [offresCount, entreprisesCount, candidatsCount, cats, offs] = await Promise.all([
      prisma.offre.count({ where: { isActive: true } }),
      prisma.entreprise.count(),
      prisma.candidat.count(),
      prisma.categorie.findMany({ include: { _count: { select: { offres: true } } }, take: 12, orderBy: { nom: "asc" } }),
      prisma.offre.findMany({
        where: { isActive: true },
        include: { entreprise: true, categorie: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
    ]);
    stats = { offres: offresCount, entreprises: entreprisesCount, candidats: candidatsCount };
    categories = cats.map((c: any) => ({ ...c, offres_count: c._count.offres }));
    offres = offs;
  } catch (e) {
    // BDD vide ou non connectée -> on garde 0
  }

  const catIcons: Record<string, string> = {
    Informatique: "bi-laptop",
    Finance: "bi-cash-stack",
    Marketing: "bi-megaphone",
    RH: "bi-people",
    Commerce: "bi-bag",
    Santé: "bi-heart-pulse",
    Éducation: "bi-book",
    BTP: "bi-building",
    Transport: "bi-truck",
    Juridique: "bi-balance",
    Agriculture: "bi-tree",
    Hôtellerie: "bi-cup-hot",
    Médias: "bi-camera-video",
    Art: "bi-palette",
    Autre: "bi-grid",
  };

  function iconFor(nom: string) {
    for (const [k, v] of Object.entries(catIcons)) if (nom.includes(k)) return v;
    return "bi-briefcase";
  }

  return (
    <>
      <style>{`
        :root { --primary:#0066FF; --primary-dark:#0044BB; --secondary:#FF6B35; }
        body { background:#fff; color:#0F172A; }
        .navbar-accueil { background:#fff; border-bottom:1px solid #E2E8F0; padding:.85rem 2rem; position:sticky; top:0; z-index:100; box-shadow:0 1px 8px rgba(0,0,0,.05); }
        .logo-badge { width:38px; height:38px; background:#0066FF; border-radius:11px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .logo-job { font-size:1.25rem; font-weight:900; color:#0066FF; letter-spacing:-.5px; }
        .logo-4us { font-size:1.25rem; font-weight:900; color:#FF6B35; letter-spacing:-.5px; }
        .logo-tagline { font-size:.58rem; font-weight:600; color:#94A3B8; letter-spacing:.15em; text-transform:uppercase; }
        .sep { width:1.5px; height:26px; background:#E2E8F0; border-radius:2px; }
        .hero { background:linear-gradient(135deg, #0044BB 0%, #0066FF 60%, #3B82F6 100%); padding:5rem 0 4rem; position:relative; overflow:hidden; }
        .hero::before{content:''; position:absolute; top:-100px; right:-100px; width:500px; height:500px; border-radius:50%; background:rgba(255,255,255,.05);}
        .hero::after{content:''; position:absolute; bottom:-80px; left:-80px; width:350px; height:350px; border-radius:50%; background:rgba(255,255,255,.04);}
        .hero-title{font-size:3rem; font-weight:900; color:#fff; line-height:1.15; letter-spacing:-.8px;}
        .hero-title span{color:#FF6B35;}
        .hero-subtitle{color:rgba(255,255,255,.8); font-size:1.1rem; line-height:1.6;}
        .hero-search{background:#fff; border-radius:14px; padding:.5rem .5rem .5rem 1rem; display:flex; align-items:center; gap:.5rem; box-shadow:0 8px 32px rgba(0,0,0,.15);}
        .hero-search input{border:none; outline:none; flex-grow:1; font-size:.95rem; color:#0F172A; background:transparent;}
        .hero-search input::placeholder{color:#94A3B8;}
        .hero-search .sep-v{width:1px; height:24px; background:#E2E8F0; flex-shrink:0;}
        .hero-search .city-input{border:none; outline:none; width:160px; font-size:.95rem; color:#0F172A; background:transparent;}
        .btn-search{background:var(--primary); color:#fff; border:none; border-radius:10px; padding:.75rem 1.5rem; font-weight:700; font-size:.9rem; white-space:nowrap; transition:all .2s; flex-shrink:0;}
        .btn-search:hover{background:var(--primary-dark);}
        .hero-stats{display:flex; gap:2rem; margin-top:2rem;}
        .hero-stat .hs-number{font-size:1.5rem; font-weight:800; color:#fff; letter-spacing:-.3px;}
        .hero-stat .hs-label{font-size:.78rem; color:rgba(255,255,255,.7); font-weight:500;}
        .hero-tags{display:flex; flex-wrap:wrap; gap:.5rem; margin-top:1.25rem;}
        .hero-tag{background:rgba(255,255,255,.15); color:#fff; border:1px solid rgba(255,255,255,.2); border-radius:20px; padding:.3rem .85rem; font-size:.8rem; font-weight:500; text-decoration:none; transition:all .2s;}
        .hero-tag:hover{background:rgba(255,255,255,.25); color:#fff;}
        section{padding:4rem 0;}
        .section-title{font-size:1.75rem; font-weight:800; color:#0F172A; letter-spacing:-.4px;}
        .section-subtitle{color:#64748B; font-size:.95rem;}
        .cat-card{background:#F8FAFF; border:1.5px solid #E2E8F0; border-radius:14px; padding:1.25rem; text-decoration:none; transition:all .2s; display:block;}
        .cat-card:hover{border-color:var(--primary); background:#EFF6FF; transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,102,255,.1);}
        .cat-icon{width:46px; height:46px; border-radius:12px; background:#EFF6FF; display:flex; align-items:center; justify-content:center; font-size:1.2rem; color:var(--primary); margin-bottom:.75rem;}
        .cat-name{font-size:.9rem; font-weight:700; color:#0F172A;}
        .cat-count{font-size:.75rem; color:#64748B; margin-top:.2rem;}
        .offre-card{border:1.5px solid #E2E8F0; border-radius:14px; padding:1.25rem; transition:all .2s; background:#fff; text-decoration:none; display:block;}
        .offre-card:hover{border-color:var(--primary); box-shadow:0 8px 24px rgba(0,102,255,.08); transform:translateY(-2px);}
        .offre-logo{width:46px; height:46px; border-radius:10px; background:#EFF6FF; display:flex; align-items:center; justify-content:center; font-size:.85rem; font-weight:700; color:var(--primary); flex-shrink:0;}
        .offre-titre{font-size:.95rem; font-weight:700; color:#0F172A;}
        .offre-entreprise{font-size:.82rem; color:var(--primary); font-weight:600;}
        .offre-tag{display:inline-flex; align-items:center; padding:.2rem .65rem; border-radius:20px; font-size:.74rem; font-weight:500;}
        .tag-contrat{background:#EFF6FF; color:#0066FF;}
        .tag-lieu{background:#FFF7ED; color:#E07A00;}
        .tag-niveau{background:#ECFDF5; color:#059669;}
        .how-bg{background:#F8FAFF;}
        .step-card{background:#fff; border:1.5px solid #E2E8F0; border-radius:16px; padding:1.75rem; height:100%; transition:all .2s;}
        .step-card:hover{border-color:var(--primary); box-shadow:0 8px 24px rgba(0,102,255,.08);}
        .step-number{width:40px; height:40px; border-radius:10px; background:var(--primary); color:#fff; display:flex; align-items:center; justify-content:center; font-size:1rem; font-weight:800; margin-bottom:1rem;}
        .step-title{font-size:1rem; font-weight:700; color:#0F172A; margin-bottom:.5rem;}
        .step-desc{font-size:.875rem; color:#64748B; line-height:1.6;}
        .cta-section{background:linear-gradient(135deg, #0044BB 0%, #0066FF 100%); padding:5rem 0; position:relative; overflow:hidden;}
        .cta-section::before{content:''; position:absolute; top:-80px; right:-80px; width:300px; height:300px; border-radius:50%; background:rgba(255,255,255,.06);}
        .cta-title{font-size:2rem; font-weight:800; color:#fff; letter-spacing:-.4px;}
        .cta-subtitle{color:rgba(255,255,255,.8); font-size:1rem;}
        .btn-cta-white{background:#fff; color:var(--primary); border:none; border-radius:10px; padding:.85rem 2rem; font-weight:700; font-size:.95rem; text-decoration:none; transition:all .2s; display:inline-block;}
        .btn-cta-white:hover{background:#EFF6FF; color:var(--primary-dark); transform:translateY(-1px);}
        .btn-cta-outline{background:transparent; color:#fff; border:2px solid rgba(255,255,255,.4); border-radius:10px; padding:.85rem 2rem; font-weight:700; font-size:.95rem; text-decoration:none; transition:all .2s; display:inline-block;}
        .btn-cta-outline:hover{border-color:#fff; color:#fff; background:rgba(255,255,255,.1);}
        .footer{background:#0F172A; color:#94A3B8; padding:3rem 0 1.5rem;}
        .footer-logo-job{font-size:1.25rem; font-weight:900; color:#fff; letter-spacing:-.5px;}
        .footer-logo-4us{font-size:1.25rem; font-weight:900; color:#FF6B35; letter-spacing:-.5px;}
        .footer-desc{font-size:.875rem; color:#64748B; line-height:1.7; margin-top:.5rem;}
        .footer-title{font-size:.8rem; font-weight:700; color:#fff; text-transform:uppercase; letter-spacing:.1em; margin-bottom:1rem;}
        .footer-link{display:block; color:#64748B; font-size:.875rem; text-decoration:none; margin-bottom:.5rem; transition:color .15s;}
        .footer-link:hover{color:#fff;}
        .footer-bottom{border-top:1px solid #1E293B; margin-top:2rem; padding-top:1.5rem; font-size:.8rem;}
      `}</style>

      {/* NAVBAR */}
      <nav className="navbar-accueil d-flex justify-content-between align-items-center">
        <Link href="/" className="text-decoration-none d-flex align-items-center gap-2">
          <div className="logo-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div className="sep"></div>
          <div>
            <div><span className="logo-job">Job</span><span className="logo-4us">4Us</span></div>
            <div className="logo-tagline">Cameroun · Afrique</div>
          </div>
        </Link>

        <div className="d-none d-lg-flex align-items-center gap-4">
          <Link href="/offres" className="text-decoration-none text-muted fw-medium" style={{ fontSize: ".9rem" }}>Offres d'emploi</Link>
          <a href="#categories" className="text-decoration-none text-muted fw-medium" style={{ fontSize: ".9rem" }}>Catégories</a>
          <a href="#comment" className="text-decoration-none text-muted fw-medium" style={{ fontSize: ".9rem" }}>Comment ça marche</a>
        </div>

        <div className="d-flex align-items-center gap-2">
          {session ? (
            <>
              {session.user.role === "candidat" && <Link href="/candidat" className="btn btn-primary btn-sm rounded-pill px-3">Mon espace</Link>}
              {session.user.role === "recruteur" && <Link href="/recruteur" className="btn btn-primary btn-sm rounded-pill px-3">Mon espace</Link>}
              {session.user.role === "admin" && <Link href="/admin" className="btn btn-primary btn-sm rounded-pill px-3">Admin</Link>}
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-outline-primary btn-sm rounded-pill px-3" style={{ fontSize: ".875rem" }}>Connexion</Link>
              <Link href="/register" className="btn btn-primary btn-sm rounded-pill px-3" style={{ fontSize: ".875rem" }}>S&apos;inscrire</Link>
            </>
          )}
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="container position-relative" style={{ zIndex: 1 }}>
          <div className="row align-items-center">
            <div className="col-lg-7">
              <h1 className="hero-title mb-3">Trouvez votre<br />emploi idéal au<br /><span>Cameroun</span> 🇨🇲</h1>
              <p className="hero-subtitle mb-4">La plateforme de recrutement #1 en Afrique centrale.<br />Des milliers d&apos;offres vérifiées vous attendent.</p>

              <form action="/offres" method="GET">
                <div className="hero-search">
                  <i className="bi bi-search text-muted" style={{ fontSize: "1rem", flexShrink: 0 }}></i>
                  <input type="text" name="q" placeholder="Titre du poste, compétence..." />
                  <div className="sep-v"></div>
                  <i className="bi bi-geo-alt text-muted" style={{ fontSize: "1rem", flexShrink: 0 }}></i>
                  <input type="text" name="ville" className="city-input" placeholder="Ville..." />
                  <button type="submit" className="btn-search"><i className="bi bi-search me-1"></i>Rechercher</button>
                </div>
              </form>

              <div className="hero-tags">
                <span style={{ color: "rgba(255,255,255,.6)", fontSize: ".8rem", alignSelf: "center" }}>Populaire :</span>
                {["Développeur", "Comptable", "Commercial", "Marketing", "RH"].map((tag) => (
                  <Link key={tag} href={`/offres?q=${encodeURIComponent(tag)}`} className="hero-tag">{tag}</Link>
                ))}
              </div>

              <div className="hero-stats">
                <div className="hero-stat"><div className="hs-number">{stats.offres}+</div><div className="hs-label">Offres actives</div></div>
                <div className="hero-stat"><div className="hs-number">{stats.entreprises}+</div><div className="hs-label">Entreprises</div></div>
                <div className="hero-stat"><div className="hs-number">{stats.candidats}+</div><div className="hs-label">Candidats</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CATEGORIES */}
      <section id="categories">
        <div className="container">
          <div className="d-flex justify-content-between align-items-end mb-4">
            <div>
              <h2 className="section-title mb-1">Parcourir par catégorie</h2>
              <p className="section-subtitle mb-0">Trouvez des offres dans votre domaine</p>
            </div>
            <Link href="/offres" className="btn btn-outline-primary rounded-pill px-4 d-none d-md-inline-flex">Voir toutes les offres</Link>
          </div>

          <div className="row g-3">
            {categories.length === 0 ? (
              <div className="col-12 text-muted text-center py-4">Aucune catégorie — ajoute-en via Prisma Studio</div>
            ) : categories.map((c: any) => (
              <div key={c.id} className="col-lg-2 col-md-3 col-sm-4 col-6">
                <Link href={`/offres?categorie=${c.id}`} className="cat-card">
                  <div className="cat-icon"><i className={`bi ${iconFor(c.nom)}`}></i></div>
                  <div className="cat-name">{c.nom}</div>
                  <div className="cat-count">{c.offres_count} offre(s)</div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* OFFRES RECENTES */}
      <section style={{ background: "#F8FAFF", padding: "4rem 0" }}>
        <div className="container">
          <div className="d-flex justify-content-between align-items-end mb-4">
            <div>
              <h2 className="section-title mb-1">Offres récentes</h2>
              <p className="section-subtitle mb-0">Les dernières opportunités publiées</p>
            </div>
            <Link href="/offres" className="btn btn-outline-primary rounded-pill px-4 d-none d-md-inline-flex">Voir toutes les offres</Link>
          </div>

          <div className="row g-3">
            {offres.length === 0 ? (
              <div className="col-12 text-center text-muted py-4">
                <i className="bi bi-briefcase fs-1 d-block mb-3 opacity-25"></i>
                <div>Aucune offre disponible pour le moment</div>
              </div>
            ) : offres.map((o: any) => (
              <div key={o.id} className="col-lg-4 col-md-6">
                <Link href={`/offres/${o.id}`} className="offre-card">
                  <div className="d-flex align-items-start gap-3 mb-3">
                    <div className="offre-logo">{(o.entreprise?.nom || "E").slice(0, 2).toUpperCase()}</div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="offre-titre text-truncate">{o.titre}</div>
                      <div className="offre-entreprise">{o.entreprise?.nom || "Entreprise"}</div>
                    </div>
                  </div>
                  <div className="d-flex flex-wrap gap-1 mb-3">
                    <span className="offre-tag tag-contrat"><i className="bi bi-briefcase me-1"></i>{o.typeContrat}</span>
                    <span className="offre-tag tag-lieu"><i className="bi bi-geo-alt me-1"></i>{o.ville}</span>
                    {o.categorie && <span className="offre-tag tag-niveau">{o.categorie.nom}</span>}
                  </div>
                  <div className="d-flex justify-content-between align-items-center">
                    <span style={{ fontSize: ".75rem", color: "#94A3B8" }}><i className="bi bi-clock me-1"></i>{new Date(o.createdAt).toLocaleDateString("fr-FR")}</span>
                    <span style={{ fontSize: ".78rem", color: "var(--primary)", fontWeight: 600 }}>Voir l&apos;offre →</span>
                  </div>
                </Link>
              </div>
            ))}
          </div>

          <div className="text-center mt-4 d-md-none">
            <Link href="/offres" className="btn btn-outline-primary rounded-pill px-4">Voir toutes les offres</Link>
          </div>
        </div>
      </section>

      {/* COMMENT CA MARCHE */}
      <section className="how-bg" id="comment">
        <div className="container">
          <div className="text-center mb-5">
            <h2 className="section-title mb-2">Comment ça marche ?</h2>
            <p className="section-subtitle">Simple, rapide et efficace</p>
          </div>

          <div className="row g-4">
            <div className="col-lg-6">
              <div className="mb-3"><span className="badge rounded-pill px-3 py-2" style={{ background: "#EFF6FF", color: "#0066FF", fontSize: ".8rem", fontWeight: 700 }}><i className="bi bi-person me-1"></i>Pour les candidats</span></div>
              <div className="row g-3">
                {[
                  { num: "1", title: "Créez votre profil", desc: "Inscrivez-vous gratuitement et complétez votre profil avec votre CV et vos compétences." },
                  { num: "2", title: "Cherchez des offres", desc: "Parcourez les milliers d'offres disponibles et filtrez selon vos critères." },
                  { num: "3", title: "Postulez en 1 clic", desc: "Envoyez votre candidature directement depuis la plateforme et suivez son statut." },
                ].map((s) => (
                  <div key={s.num} className="col-12">
                    <div className="step-card d-flex gap-3 align-items-start">
                      <div className="step-number flex-shrink-0">{s.num}</div>
                      <div><div className="step-title">{s.title}</div><div className="step-desc">{s.desc}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-lg-6">
              <div className="mb-3"><span className="badge rounded-pill px-3 py-2" style={{ background: "#FFF7ED", color: "#FF6B35", fontSize: ".8rem", fontWeight: 700 }}><i className="bi bi-building me-1"></i>Pour les recruteurs</span></div>
              <div className="row g-3">
                {[
                  { num: "1", title: "Créez votre espace", desc: "Inscrivez votre entreprise et complétez votre profil pour attirer les meilleurs candidats." },
                  { num: "2", title: "Publiez vos offres", desc: "Rédigez et publiez vos offres d'emploi en quelques minutes." },
                  { num: "3", title: "Gérez les candidatures", desc: "Recevez et gérez les candidatures, échangez avec les candidats par messagerie." },
                ].map((s) => (
                  <div key={s.num} className="col-12">
                    <div className="step-card d-flex gap-3 align-items-start">
                      <div className="step-number flex-shrink-0" style={{ background: "#FF6B35" }}>{s.num}</div>
                      <div><div className="step-title">{s.title}</div><div className="step-desc">{s.desc}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="container text-center position-relative" style={{ zIndex: 1 }}>
          <h2 className="cta-title mb-3">Prêt à trouver votre prochain emploi ?</h2>
          <p className="cta-subtitle mb-4">Rejoignez des milliers de candidats et recruteurs sur Job4Us</p>
          <div className="d-flex gap-3 justify-content-center flex-wrap">
            <Link href="/register" className="btn-cta-white"><i className="bi bi-person-plus me-2"></i>Créer un compte gratuit</Link>
            <Link href="/offres" className="btn-cta-outline"><i className="bi bi-search me-2"></i>Parcourir les offres</Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container">
          <div className="row g-4">
            <div className="col-lg-4">
              <div className="d-flex align-items-center gap-2 mb-2">
                <div style={{ width: 34, height: 34, background: "#0066FF", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg>
                </div>
                <span className="footer-logo-job">Job</span><span className="footer-logo-4us">4Us</span>
              </div>
              <p className="footer-desc">La plateforme de recrutement #1 au Cameroun et en Afrique centrale.<br />Connectez talents et opportunités.</p>
            </div>
            <div className="col-lg-2 col-6">
              <div className="footer-title">Candidats</div>
              <Link href="/offres" className="footer-link">Offres d&apos;emploi</Link>
              <Link href="/register" className="footer-link">Créer un profil</Link>
              <Link href="/login" className="footer-link">Se connecter</Link>
            </div>
            <div className="col-lg-2 col-6">
              <div className="footer-title">Recruteurs</div>
              <Link href="/register" className="footer-link">Publier une offre</Link>
              <Link href="/login" className="footer-link">Espace recruteur</Link>
            </div>
            <div className="col-lg-2 col-6">
              <div className="footer-title">Catégories</div>
              {categories.slice(0, 5).map((c: any) => (
                <Link key={c.id} href={`/offres?categorie=${c.id}`} className="footer-link">{c.nom}</Link>
              ))}
            </div>
            <div className="col-lg-2 col-6">
              <div className="footer-title">Contact</div>
              <span className="footer-link">contact@job4us.cm</span>
              <span className="footer-link">+237 6XX XXX XXX</span>
              <span className="footer-link">Douala, Cameroun</span>
            </div>
          </div>
          <div className="footer-bottom d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span>© {new Date().getFullYear()} Job4Us · Tous droits réservés</span>
            <div className="d-flex gap-3">
              <a href="#" className="footer-link mb-0">Confidentialité</a>
              <a href="#" className="footer-link mb-0">Conditions d&apos;utilisation</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
