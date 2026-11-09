'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { usePathname } from 'next/navigation';
import {
  BsArrowClockwise, BsBell, BsBuilding, BsCashCoin, BsCalendar3,
  BsFileEarmarkText, BsPeopleFill, BsPersonCheckFill, BsShieldCheck,
  BsSliders2, BsBook, BsLock, BsClockHistory
} from 'react-icons/bs';
import { useGlobalAuth } from '@/utils/globalAuth';
import { chaveLeituraNotificacoes, marcarNotificacoesVistas } from '@/utils/notificacoesLeitura';
import '@/styles/o2.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1/notificacoes`;

const CATEGORIAS = [
  { id: 'todos', nome: 'Todas' },
  { id: 'pagamento', nome: 'Tesouraria', icon: BsCashCoin },
  { id: 'matricula', nome: 'Matrículas', icon: BsPersonCheckFill },
  { id: 'documento', nome: 'Documentos', icon: BsFileEarmarkText },
  { id: 'turma', nome: 'Turmas', icon: BsPeopleFill },
  { id: 'ano', nome: 'Anos letivos', icon: BsCalendar3 },
  { id: 'academico', nome: 'Académico', icon: BsBook },
  { id: 'configuracao', nome: 'Configurações', icon: BsSliders2 },
  { id: 'seguranca', nome: 'Segurança', icon: BsLock },
  { id: 'anuncio', nome: 'Avisos do Owner', icon: BsBell },
  { id: 'auditoria', nome: 'Auditoria', icon: BsShieldCheck }
];
const CATEGORIAS_POR_PERFIL = {
  direcao: CATEGORIAS.filter((categoria) => categoria.id !== 'auditoria'),
  secretaria: CATEGORIAS.filter((categoria) => ['todos', 'matricula', 'documento', 'turma', 'ano', 'configuracao', 'seguranca', 'anuncio'].includes(categoria.id)),
  tesouraria: CATEGORIAS.filter((categoria) => ['todos', 'pagamento', 'anuncio'].includes(categoria.id)),
  professor: CATEGORIAS.filter((categoria) => ['todos', 'academico', 'turma', 'documento', 'anuncio'].includes(categoria.id))
};

async function buscarNotificacoes(url) {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`A API respondeu num formato inválido (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true || !Array.isArray(data.dados)) {
    throw new Error(data.message || `Não foi possível carregar as notificações (HTTP ${response.status}).`);
  }
  return {
    notificacoes: data.dados,
    total: Number(data.total || 0),
    atualizadoEm: new Date().toISOString()
  };
}

function formatarData(valor) {
  if (!valor) return 'Data não registada';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? 'Data não registada' : data.toLocaleString('pt-PT');
}

function rotuloPapel(papel) {
  const rotulos = {
    owner: 'Owner',
    direcao: 'Direção',
    secretaria: 'Secretaria',
    tesouraria: 'Tesouraria',
    professor: 'Professor'
  };
  return rotulos[String(papel || '').toLowerCase()] || 'Utilizador';
}

function iconeCategoria(categoria) {
  return CATEGORIAS.find((item) => item.id === categoria)?.icon || BsBell;
}

function formatarJson(valor) {
  if (valor === undefined || valor === null) return 'Nenhum conteúdo registado.';
  return JSON.stringify(valor, null, 2);
}

export default function NotificationsCenter() {
  const pathname = usePathname();
  const perfil = pathname.split('/')[2] || '';
  const { userInfo, loadingAuth } = useGlobalAuth();
  const escolaId = userInfo?.conta_ativa?.escola_id || (perfil === 'owner' ? 'owner' : '');
  const utilizadorId = userInfo?.id || userInfo?.utilizador_id;
  const chaveLeitura = chaveLeituraNotificacoes(escolaId, utilizadorId);
  const temSessao = Boolean(escolaId && utilizadorId);
  const corEscola = userInfo?.conta_ativa?.cor_primaria;
  const estiloTema = /^#[0-9a-f]{6}$/i.test(corEscola || '')
    ? { '--notifications-primary': corEscola }
    : undefined;
  const { data: paginas, error, isLoading, isValidating, mutate, size, setSize } = useSWRInfinite(
    (indice, paginaAnterior) => {
      if (!temSessao || (paginaAnterior && paginaAnterior.notificacoes.length === 0)) return null;
      const params = new URLSearchParams({ limit: '100', offset: String(indice * 100) });
      return `${API_URL}?${params}`;
    },
    buscarNotificacoes,
    { revalidateOnFocus: true, revalidateOnReconnect: true, shouldRetryOnError: false }
  );

  const carregando = loadingAuth || isLoading;
  const notificacoes = useMemo(
    () => paginas?.flatMap((pagina) => pagina.notificacoes) || [],
    [paginas]
  );
  const total = paginas?.[0]?.total || 0;
  const ultimaAtualizacao = paginas?.[0]?.atualizadoEm ? new Date(paginas[0].atualizadoEm) : null;
  const isOwner = perfil === 'owner';
  const categoriasVisiveis = isOwner
    ? CATEGORIAS.filter((categoria) => ['todos', 'auditoria'].includes(categoria.id))
    : CATEGORIAS_POR_PERFIL[perfil] || CATEGORIAS_POR_PERFIL.direcao;

  const [abaAtiva, setAbaAtiva] = useState('todos');
  const notificacoesFiltradas = useMemo(() => (
    abaAtiva === 'todos'
      ? notificacoes
      : notificacoes.filter((item) => item.categoria === abaAtiva)
  ), [abaAtiva, notificacoes]);

  useEffect(() => {
    if (chaveLeitura && paginas?.length) marcarNotificacoesVistas(chaveLeitura);
  }, [chaveLeitura, paginas]);

  async function atualizar() {
    try {
      await mutate();
    } catch (erroAtualizacao) {
      console.error('Erro ao atualizar notificações:', erroAtualizacao);
    }
  }

  const temMais = notificacoes.length < total;

  return (
    <div className="notifications-page" style={estiloTema}>
      <header className="notifications-header">
        <div>
          <span className="notifications-eyebrow">{rotuloPapel(perfil)} · Centro de avisos</span>
          <h1>{isOwner ? 'Notificações e Auditoria Operacional' : 'Notificações e atividade'}</h1>
          <p>{isOwner
            ? 'Auditoria global das ações e consultas realizadas no sistema.'
            : `Acompanhe as atualizações relevantes para ${rotuloPapel(perfil)}.`}</p>
        </div>
        <div className="notifications-header-actions">
          <span className="notifications-updated">
            <BsClockHistory aria-hidden="true" />
            {ultimaAtualizacao
              ? `Sincronizado: ${ultimaAtualizacao.toLocaleTimeString('pt-PT')}`
              : 'A aguardar consulta'}
          </span>
          <button type="button" onClick={() => void atualizar()} disabled={isValidating} aria-label="Atualizar notificações">
            <BsArrowClockwise className={isValidating ? 'notifications-spin' : ''} />
          </button>
        </div>
      </header>

      {error && <div className="notifications-error" role="alert">{error.message}</div>}

      <div className="notifications-split">
        <aside className="notifications-sidebar">
          <div className="notifications-sidebar-title"><BsBuilding aria-hidden="true" /> Categorias</div>
          <nav className="notifications-tabs" aria-label="Filtrar notificações">
            {categoriasVisiveis.map((categoria) => {
              const Icon = categoria.icon || BsBell;
              const total = categoria.id === 'todos'
                ? (paginas?.[0]?.total ?? notificacoes.length)
                : notificacoes.filter((item) => item.categoria === categoria.id).length;
              return (
                <button
                  key={categoria.id}
                  type="button"
                  className={abaAtiva === categoria.id ? 'active' : ''}
                  onClick={() => setAbaAtiva(categoria.id)}
                  aria-pressed={abaAtiva === categoria.id}
                >
                  <span><Icon aria-hidden="true" /> {categoria.nome}</span>
                  <span className="notifications-count">{total}</span>
                </button>
              );
            })}
          </nav>
          {isOwner && (
            <p className="notifications-privacy"><BsShieldCheck aria-hidden="true" /> Os endereços IP são visíveis apenas ao Owner.</p>
          )}
        </aside>

        <main className="notifications-feed" aria-live="polite">
          {carregando ? (
            <div className="notifications-state"><BsArrowClockwise className="notifications-spin" /> A carregar atividade…</div>
          ) : notificacoesFiltradas.length ? (
            <div className="notifications-timeline">
              {notificacoesFiltradas.map((item) => {
                const Icon = iconeCategoria(item.categoria);
                return (
                  <article key={`${item.categoria}:${item.id}`} className={`notifications-item ${item.categoria}`}>
                    <span className="notifications-icon"><Icon aria-hidden="true" /></span>
                    <div className="notifications-item-body">
                      <div className="notifications-item-heading">
                        <h2>{item.titulo}</h2>
                        <time dateTime={item.data_hora || undefined}>{formatarData(item.data_hora)}</time>
                      </div>
                      <p>{item.mensagem}</p>
                      <div className="notifications-meta">
                        <span>Responsável: <strong>{item.autor || 'Não identificado'}</strong></span>
                        {item.escola_nome && <span>Escola: <strong>{item.escola_nome}</strong></span>}
                        {isOwner && item.papel && <span>Perfil: <strong>{rotuloPapel(item.papel)}</strong></span>}
                        {isOwner && item.ip_address && <span>IP: <strong>{item.ip_address}</strong></span>}
                        <span className={`notifications-badge ${item.categoria}`}>
                          {CATEGORIAS.find((categoria) => categoria.id === item.categoria)?.nome || item.categoria}
                        </span>
                      </div>
                      {isOwner && item.detalhes && (
                        <details className="notifications-audit-details">
                          <summary>Ver pedido e resposta da API</summary>
                          <div className="notifications-audit-grid">
                            <section>
                              <h3>Dados enviados</h3>
                              <pre>{formatarJson(item.detalhes.request_body)}</pre>
                            </section>
                            <section>
                              <h3>Parâmetros da rota</h3>
                              <pre>{formatarJson(item.detalhes.route_params)}</pre>
                            </section>
                            <section>
                              <h3>Parâmetros da consulta</h3>
                              <pre>{formatarJson(item.detalhes.query)}</pre>
                            </section>
                            <section>
                              <h3>Resposta da API · HTTP {item.detalhes.status_http || '—'}</h3>
                              <pre>{formatarJson(item.detalhes.response_body)}</pre>
                            </section>
                          </div>
                        </details>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="notifications-empty">
              <BsBell aria-hidden="true" />
              <strong>{error ? 'Não foi possível carregar as notificações.' : 'Ainda não há atividade nesta categoria.'}</strong>
              <span>As atualizações relevantes aparecerão aqui.</span>
            </div>
          )}
          {!carregando && !error && temMais && (
            <button
              type="button"
              className="notifications-load-more"
              onClick={() => void setSize(size + 1)}
              disabled={isValidating}
            >
              {isValidating ? 'A carregar…' : 'Carregar atividade anterior'}
            </button>
          )}
        </main>
      </div>
    </div>
  );
}
