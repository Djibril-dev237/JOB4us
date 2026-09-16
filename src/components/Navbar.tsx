"use client";

import Link from "next/link";
import { useState } from "react";

export function Navbar({ isLoggedIn, role }: { isLoggedIn: boolean; role?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="navbar-accueil d-flex justify-content-between align-items-center">
      <Link href="/" className="text-decoration-none d-flex align-items-center gap-2">
        <div className="logo-badge">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <div className="sep d-none d-sm-block"></div>
        <div>
          <div><span className="logo-job">Job</span><span className="logo-4us">4Us</span></div>
          <div className="logo-tagline">Cameroun · Afrique</div>
        </div>
      </Link>

      {/* Desktop links */}
      <div className="d-none d-lg-flex align-items-center gap-4">
        <Link href="/offres" className="nav-link-custom">Offres d'emploi</Link>
        <a href="#categories" className="nav-link-custom">Catégories</a>
        <a href="#comment" className="nav-link-custom">Comment ça marche</a>
      </div>

      {/* Desktop auth */}
      <div className="d-none d-md-flex align-items-center gap-2">
        {isLoggedIn ? (
          <>
            {role === "candidat" && <Link href="/candidat" className="btn btn-primary btn-sm rounded-pill px-3">Mon espace</Link>}
            {role === "recruteur" && <Link href="/recruteur" className="btn btn-primary btn-sm rounded-pill px-3">Mon espace</Link>}
            {role === "admin" && <Link href="/admin" className="btn btn-primary btn-sm rounded-pill px-3">Admin</Link>}
          </>
        ) : (
          <>
            <Link href="/login" className="btn btn-outline-primary btn-sm rounded-pill px-3" style={{ fontSize: ".875rem" }}>Connexion</Link>
            <Link href="/register" className="btn btn-primary btn-sm rounded-pill px-3" style={{ fontSize: ".875rem" }}>S&apos;inscrire</Link>
          </>
        )}
      </div>

      {/* Mobile hamburger */}
      <button
        className="d-lg-none btn btn-light rounded-3 p-2 border"
        onClick={() => setOpen(!open)}
        aria-label="Menu"
        aria-expanded={open}
        style={{ width: 42, height: 42 }}
      >
        <i className={`bi ${open ? "bi-x-lg" : "bi-list"}`} style={{ fontSize: "1.25rem" }}></i>
      </button>

      {/* Mobile menu */}
      {open && (
        <div className="mobile-menu">
          <Link href="/offres" onClick={() => setOpen(false)} className="mobile-link"><i className="bi bi-briefcase me-2"></i>Offres d'emploi</Link>
          <a href="#categories" onClick={() => setOpen(false)} className="mobile-link"><i className="bi bi-grid me-2"></i>Catégories</a>
          <a href="#comment" onClick={() => setOpen(false)} className="mobile-link"><i className="bi bi-question-circle me-2"></i>Comment ça marche</a>
          <hr className="my-2" />
          {isLoggedIn ? (
            <Link href={role === "candidat" ? "/candidat" : role === "recruteur" ? "/recruteur" : "/admin"} onClick={() => setOpen(false)} className="btn btn-primary w-100 rounded-pill">Mon espace</Link>
          ) : (
            <div className="d-flex flex-column gap-2">
              <Link href="/login" onClick={() => setOpen(false)} className="btn btn-outline-primary w-100 rounded-pill">Connexion</Link>
              <Link href="/register" onClick={() => setOpen(false)} className="btn btn-primary w-100 rounded-pill">S&apos;inscrire</Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
