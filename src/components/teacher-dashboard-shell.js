'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BsArrowClockwise, BsCalendarEvent } from 'react-icons/bs';
import { useGlobalAuth } from '@/utils/globalAuth';
import '@/styles/dash-teacher.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_NOTAS = `${API_BASE}/api/v1/notas`;
const TeacherDashboardContext = createContext(null);
const DEFAULT_HEADERS = {
  '/dashboard/professor': {
    title: 'PAINEL DO PROFESSOR',
    description: 'Acompanhe o seu desempenho, horário, turmas e avisos pedagógicos.'
  },
  '/dashboard/professor/presencas': {
    title: 'REGISTO DE PRESENÇAS E ASSIDUIDADE',
    description: 'Marque presenças, faltas, atrasos e justificações por turma e data.'
  },
  '/dashboard/professor/dir-turma': {
    title: 'ACOMPANHAMENTO DA TURMA',
    description: 'Alunos, percurso académico, família e assiduidade num só dossier.'
  },
  '/dashboard/professor/alunos': {
    title: 'TURMAS E ALUNOS',
    description: 'Consulte as turmas atribuídas e acompanhe o percurso académico dos alunos.'
  },
  '/dashboard/professor/notas': {
    title: 'GESTÃO DE NOTAS TRIMESTRAIS',
    description: 'Registe e consulte as avaliações dos alunos por disciplina e período.'
  },
  '/dashboard/professor/turmas': {
    title: 'CONSULTA DE PAUTA TRIMESTRAL',
    description: 'Consulte as notas e médias da turma organizadas por disciplina.'
  },
  '/dashboard/professor/configuracao': {
    title: 'CONFIGURAÇÕES DO DOCENTE',
    description: 'Gira o seu perfil, a estrutura de avaliações e a segurança da conta.'
  },
  '/dashboard/professor/matriculas': {
    title: 'MATRÍCULAS',
    description: 'Consulte e acompanhe as informações de matrícula das suas turmas.'
  }
};

async function lerRespostaApi(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha ao carregar anos letivos (HTTP ${response.status}).`);
  }
  return data;
}

export function useTeacherDashboard() {
  const context = useContext(TeacherDashboardContext);
  if (!context) {
    throw new Error('useTeacherDashboard deve ser usado dentro de TeacherDashboardShell.');
  }
  return context;
}

export function useTeacherPageHeader({ title, description, onRefresh, actions = [] }) {
  const context = useContext(TeacherDashboardContext);
  const pathname = usePathname();
  const latestConfig = useRef({ title, description, onRefresh, actions });

  if (!context) {
    throw new Error('useTeacherPageHeader deve ser usado dentro de TeacherDashboardShell.');
  }

  const { registerHeader } = context;
  const actionsKey = JSON.stringify(actions.map(({ label, href, disabled, variant }) => ({
    label,
    href,
    disabled: Boolean(disabled),
    variant: variant || 'primary'
  })));

  useEffect(() => {
    latestConfig.current = { title, description, onRefresh, actions };
  });

  useEffect(() => {
    const current = latestConfig.current;
    registerHeader({
      pathname,
      title: current.title,
      description: current.description,
      onRefresh: () => latestConfig.current.onRefresh?.(),
      actions: current.actions.map((action, index) => ({
        ...action,
        onClick: (...args) => latestConfig.current.actions[index]?.onClick?.(...args)
      }))
    });
    return () => registerHeader(null);
  }, [registerHeader, pathname, title, description, actionsKey]);
}

export default function TeacherDashboardShell({ children }) {
  const { userInfo } = useGlobalAuth();
  const pathname = usePathname();
  const [anosLetivos, setAnosLetivos] = useState([]);
  const [anoLetivoId, setAnoLetivoId] = useState(null);
  const [erroAnosLetivos, setErroAnosLetivos] = useState('');
  const [pageHeader, setPageHeader] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const registerHeader = useCallback((header) => setPageHeader(header), []);
  const schoolColor = userInfo?.conta_ativa?.cor_primaria;
  const corEscola = /^#[0-9a-f]{6}$/i.test(schoolColor || '') ? schoolColor : '#0284c7';
  const isDashboardHome = pathname === '/dashboard/professor';
  const header = pageHeader?.pathname === pathname ? pageHeader : DEFAULT_HEADERS[pathname] || {
    title: 'ÁREA DO PROFESSOR',
    description: 'Aceda às ferramentas pedagógicas da sua conta.'
  };
  const refreshPage = async () => {
    if (!header.onRefresh) {
      window.location.reload();
      return;
    }

    try {
      setRefreshing(true);
      await header.onRefresh();
    } catch (error) {
      console.error('Erro ao atualizar a página do professor:', error);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();

    async function carregarAnosLetivos() {
      try {
        const response = await fetch(`${API_NOTAS}/anos-letivos`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        });
        const data = await lerRespostaApi(response);
        const lista = Array.isArray(data.dados) ? data.dados : [];
        setAnosLetivos(lista);
        setAnoLetivoId(String(lista.find((ano) => ano.ativo)?.id || lista[0]?.id || ''));
        setErroAnosLetivos('');
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Erro ao carregar anos letivos:', error);
        setAnosLetivos([]);
        setAnoLetivoId('');
        setErroAnosLetivos(error.message || 'Não foi possível carregar os anos letivos.');
      }
    }

    carregarAnosLetivos();
    return () => controller.abort();
  }, []);

  const nomeProfessor = userInfo?.nome || 'Painel do Professor';

  return (
    <TeacherDashboardContext.Provider value={{ anoLetivoId, registerHeader }}>
      <div className="teacher-dashboard-shell">
        <header className="teacher-welcome-panel" style={{ '--teacher-school-color': corEscola }}>
          <div className="teacher-welcome-copy">
            <h1>{header.title}</h1>
            <p className="teacher-welcome-description">{header.description}</p>
            {isDashboardHome && (
              <div className="teacher-ano-letivo-box">
                <BsCalendarEvent />
                <select
                  aria-label="Ano letivo"
                  value={anoLetivoId || ''}
                  onChange={(event) => setAnoLetivoId(event.target.value)}
                  disabled={anosLetivos.length === 0}
                  title={erroAnosLetivos || undefined}
                >
                  {anosLetivos.length === 0 && (
                    <option value="">{erroAnosLetivos ? 'Erro ao carregar anos' : 'Sem anos letivos'}</option>
                  )}
                  {anosLetivos.map((ano) => (
                    <option key={ano.id} value={String(ano.id)}>{ano.ano_nome || ano.nome}</option>
                  ))}
                </select>
              </div>
            )}
            {erroAnosLetivos && <span className="teacher-year-error" role="alert">{erroAnosLetivos}</span>}
          </div>

          <div className="teacher-welcome-actions">
            <button
              type="button"
              className="teacher-refresh-button"
              aria-label="Atualizar página"
              onClick={refreshPage}
              disabled={refreshing}
            >
              <BsArrowClockwise />
            </button>
            {header.actions?.map((action) => action.href ? (
              <Link
                key={action.label}
                href={action.href}
                className={`teacher-btn-action ${action.variant || 'primary'}`}
              >
                {action.icon} {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                className={`teacher-btn-action ${action.variant || 'primary'}`}
                onClick={action.onClick}
                disabled={Boolean(action.disabled)}
              >
                {action.icon} {action.label}
              </button>
            ))}
          </div>
        </header>
        {children}
      </div>
    </TeacherDashboardContext.Provider>
  );
}
