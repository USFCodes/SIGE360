'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { BsArrowRight, BsShieldLock } from 'react-icons/bs';
import { BiLockAlt, BiUser } from 'react-icons/bi';
import AuthShell from '@/components/auth-shell';
import { AUTH_API_BASE, clearGlobalUser } from '@/utils/globalAuth';
import '@/styles/welcome-screen.css';

const WELCOME_STORAGE_KEY = 'futurese-welcome-seen';
const WELCOME_CHANGE_EVENT = 'futurese-welcome-change';

function subscribeToWelcome(notify) {
  window.addEventListener('storage', notify);
  window.addEventListener(WELCOME_CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(WELCOME_CHANGE_EVENT, notify);
  };
}

function getWelcomeSnapshot() {
  return localStorage.getItem(WELCOME_STORAGE_KEY) !== 'true';
}

export default function HomePage() {
  const mostrarBoasVindas = useSyncExternalStore(
    subscribeToWelcome,
    getWelcomeSnapshot,
    () => null
  );
  const [animacaoPronta, setAnimacaoPronta] = useState(false);
  const [identificador, setIdentificador] = useState('');
  const [password, setPassword] = useState('');
  const [manterSessao, setManterSessao] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!mostrarBoasVindas) return undefined;
    const timer = setTimeout(() => setAnimacaoPronta(true), 2200);
    return () => clearTimeout(timer);
  }, [mostrarBoasVindas]);

  function continuarParaLogin() {
    localStorage.setItem(WELCOME_STORAGE_KEY, 'true');
    window.dispatchEvent(new Event(WELCOME_CHANGE_EVENT));
  }

  async function handleLogin(event) {
    event.preventDefault();
    setErro('');
    setLoading(true);

    try {
      const response = await fetch(`${AUTH_API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ login_id: identificador, password, manter: manterSessao }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Login ou senha incorretos.');
      }

      await clearGlobalUser();
      router.replace(data.data?.redirect || '/dashboard');
    } catch (error) {
      setErro(error.message || 'Não foi possível iniciar sessão.');
      setTimeout(() => setErro(''), 3000);
    } finally {
      setLoading(false);
    }
  }

  if (mostrarBoasVindas === null) {
    return <main className="welcome-container" aria-busy="true" />;
  }

  if (mostrarBoasVindas) {
    return (
      <main className="welcome-container">
        <div className="welcome-glow-bg" />
        <div className="welcome-grid-overlay" />
        <div className="welcome-content-wrapper">
          <div className={`welcome-logo-box ${animacaoPronta ? 'logo-stabilized' : 'logo-animating'}`}>
            <div className="logo-ring-pulse" />
            <div className="logo-img-wrapper">
              <Image
                src="/logo-futurese.png"
                alt="Future-Se"
                width={90}
                height={90}
                priority
                className="welcome-brand-logo"
              />
            </div>
          </div>
          <div className={`welcome-text-box ${animacaoPronta ? 'text-visible' : 'text-hidden'}`}>
            <span className="welcome-badge">Ecossistema Educativo Inteligente</span>
            <h1>Future-Se</h1>
            <p>Inovação, gestão académica e transparência pedagógica para o futuro da educação.</p>
          </div>
          <div className={`welcome-actions-box ${animacaoPronta ? 'actions-visible' : 'actions-hidden'}`}>
            <button type="button" className="welcome-btn-enter" onClick={continuarParaLogin}>
              <BsShieldLock size={18} />
              <span>Continuar</span>
              <BsArrowRight size={18} className="arrow-icon" />
            </button>
            <span className="welcome-footer-hint">Plataforma Académica Segura &amp; Multi-Tenant</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <AuthShell>
            <header className="formHeader">
              <span className="formEyebrow">ÁREA SEGURA</span>
              {erro ? (
                <div className="errorMsg" role="alert">{erro}</div>
              ) : (
                <h2 className="authTitle" id="signin-title">Iniciar sessão</h2>
              )}
              <p className="formDescription">Aceda à sua conta FUTURE-SE.</p>
            </header>

            <form onSubmit={handleLogin} className="authForm">
              <label className="fieldLabel" htmlFor="identificador">Login</label>
              <div className="inputWrapper">
                <BiUser className="inputIcon" />
                <input
                  id="identificador"
                  type="text"
                  autoComplete="username"
                  required
                  placeholder="O seu email ou código"
                  value={identificador}
                  onChange={(event) => setIdentificador(event.target.value)}
                  className="authInput"
                />
              </div>

              <label className="fieldLabel" htmlFor="password">Senha</label>
              <div className="inputWrapper">
                <BiLockAlt className="inputIcon" size={20} />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="A sua palavra-passe"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="authInput"
                />
                <button
                  type="button"
                  className="passwordToggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>

              <div className="authOptions">
                <label className="rememberLabel">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={manterSessao}
                    onChange={(event) => setManterSessao(event.target.checked)}
                  />
                  Manter sessão iniciada
                </label>
              </div>

              <button type="submit" disabled={loading} className="authButton">
                {loading ? 'A autenticar...' : 'Entrar'}
              </button>
            </form>

            <p className="formFooter">Acesso protegido à plataforma de gestão escolar.</p>
    </AuthShell>
  );
}
