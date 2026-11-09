'use client'

import { useEffect, useState } from "react";
import Link from "next/link";
import { MdSettings } from "react-icons/md";
import { BiLogOut } from "react-icons/bi";
import { logoutGlobalUser, useGlobalAuth } from "@/utils/globalAuth";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { chaveLeituraNotificacoes, temNotificacoesNovas } from "@/utils/notificacoesLeitura";
import "../styles/a1.css";
import '../styles/a2.css';
import '../styles/a4.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

export default function LayoutAdmin({ navList, children, papel: papelPadrao = '', sigla, theme = "default" }) {
  const { userInfo } = useGlobalAuth();
  const schoolColor = userInfo?.conta_ativa?.cor_primaria;
  const validSchoolColor = /^#[0-9a-f]{6}$/i.test(schoolColor || "") ? schoolColor : "#0284c7";
  const schoolSigla = userInfo?.conta_ativa?.escola_sigla || sigla;
  const papel = userInfo?.conta_ativa?.papel_norm || userInfo?.conta_ativa?.papel || userInfo?.tipo || papelPadrao;
  const pathname = usePathname();
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const escolaId = userInfo?.conta_ativa?.escola_id;
  const utilizadorId = userInfo?.id || userInfo?.utilizador_id || userInfo?.user?.id || '';
  const permiteNotificacoes = ['direcao', 'secretaria', 'tesouraria'].includes(String(papel).toLowerCase());
  const isOwner = String(papel).toLowerCase() === 'owner' || String(userInfo?.tipo_conta || '').toLowerCase() === 'owner';
  const mostraConfiguracao = !['aluno', 'estudante'].includes(String(papel).toLowerCase());
  const chaveLeitura = chaveLeituraNotificacoes(escolaId || (isOwner ? 'owner' : ''), utilizadorId);
  const { data: totalNotificacoes, mutate: atualizarContador } = useSWR(
    (permiteNotificacoes || String(papel).toLowerCase() === 'professor' || isOwner) && chaveLeitura
      ? [`${API_BASE}/api/v1/notificacoes?limit=200`, escolaId || 'owner', utilizadorId, chaveLeitura]
      : null,
    async ([url, , , chave]) => {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true || !Array.isArray(data.dados)) {
        throw new Error(data.message || `Não foi possível carregar as notificações (HTTP ${response.status}).`);
      }
      return temNotificacoesNovas(data.dados, chave);
    },
    {
      refreshInterval: 60000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
      onError: (error) => console.error('Erro ao carregar o indicador de notificações:', error)
    }
  );

  useEffect(() => {
    const atualizar = () => void atualizarContador();
    window.addEventListener('sige360:notificacoes-atualizadas', atualizar);
    return () => window.removeEventListener('sige360:notificacoes-atualizadas', atualizar);
  }, [atualizarContador]);

  async function logout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logoutGlobalUser();
      window.location.replace('/');
    } catch (error) {
      console.error('Erro ao terminar sessão:', error);
      setLogoutError(error.message || 'Não foi possível terminar a sessão.');
      setLoggingOut(false);
    }
  }

  return (
    <section className={`admin-layout admin-layout-${theme}`} style={theme === "school" ? { "--school-accent": validSchoolColor } : undefined} >
      
      <aside className="admin-bar">
        <div className="overlay-box">
          <div className="logo">
            <svg viewBox="0 0 40 52"> <path d="M17 3 4 15v24l13 10V3Zm6 8v34l13-12V9L23 20" /> <path d="M17 18v27m6-22v22" /> </svg>
            <p className="logo-nome">{schoolSigla}</p>
          </div>
          <nav className="main-nav">
            {navList.map((e, i) => {
              const isNotificationLink = e.href.endsWith('/notificacoes');
              const showCount = isNotificationLink && totalNotificacoes === true;
              return <Link key={i} href={e.href} title={e.title} className={`nav-item ${e.href === pathname ? "active" : ""}`}>
                {e.icon} 
                <span>{e.title}</span>
                {showCount && (
                  <span className="notification-count-badge" aria-label="Há notificações novas" title="Há notificações novas" />
                )}
              </Link>;
            })}
          </nav>
          <div className="footer-nav">
            {logoutError && <p role="alert">{logoutError}</p>}
            {mostraConfiguracao && (
              <Link href={`/dashboard/${papel}/configuracao`} className={`config ${pathname.includes('configuracao') ? 'active' : ''}`} aria-label="Configuração">
                <MdSettings className="nav-icons-foot" />
              </Link>
            )}
            <button type="button" className="auth" onClick={logout} disabled={loggingOut} aria-label="Terminar sessão">
              <BiLogOut className="nav-icons-foot" />
            </button>
          </div>
        </div>
      </aside>

      <aside className="admin-guard">
        <div className="admin-content">
          {children}
        </div>
      </aside>
    </section>
  );
}