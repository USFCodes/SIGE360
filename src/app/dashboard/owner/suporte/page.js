'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BsBell, BsBuilding, BsChevronDown, BsChevronUp, BsPeople, BsPersonPlus, BsSearch, BsTicketPerforated } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_OWNER = `${API_BASE}/api/v1/owner`;
const ESTADOS = [
  ['aberto', 'Aberto'],
  ['em_andamento', 'Em andamento'],
  ['aguardando_escola', 'A aguardar escola'],
  ['resolvido', 'Resolvido'],
  ['cancelado', 'Cancelado']
];

async function lerResposta(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`A API respondeu num formato inválido (HTTP ${response.status}).`);
  }
  if (!response.ok || data?.success !== true) throw new Error(data?.message || `Pedido falhou (HTTP ${response.status}).`);
  return data;
}

function dataHora(data) {
  if (!data) return '—';
  const valor = new Date(data);
  return Number.isNaN(valor.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(valor);
}

export default function OwnerSuporte() {
  const [tickets, setTickets] = useState([]);
  const [errosAutomaticos, setErrosAutomaticos] = useState([]);
  const [escolas, setEscolas] = useState([]);
  const [utilizadores, setUtilizadores] = useState([]);
  const [destinatarios, setDestinatarios] = useState([]);
  const [pesquisaDestinatario, setPesquisaDestinatario] = useState('');
  const [erroPesquisa, setErroPesquisa] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [secaoAberta, setSecaoAberta] = useState('notificacao');
  const [form, setForm] = useState({ escola_id: '', titulo: '', categoria: 'erro_tecnico', prioridade: 'normal', descricao: '' });
  const [formNotificacao, setFormNotificacao] = useState({ titulo: '', mensagem: '' });
  const [notas, setNotas] = useState({});
  const [estados, setEstados] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingDestinatarios, setLoadingDestinatarios] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [erroErrosAutomaticos, setErroErrosAutomaticos] = useState('');
  const [mensagem, setMensagem] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const params = filtroEstado ? `?estado=${encodeURIComponent(filtroEstado)}` : '';
      const [ticketsResponse, escolasResponse] = await Promise.all([
        fetch(`${API_OWNER}/support/tickets${params}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API_OWNER}/escolas/paginadas?page=1&limit=100`, { credentials: 'include', cache: 'no-store' })
      ]);
      const [ticketsData, escolasData] = await Promise.all([lerResposta(ticketsResponse), lerResposta(escolasResponse)]);
      setTickets(Array.isArray(ticketsData.data) ? ticketsData.data : []);
      setEscolas(Array.isArray(escolasData.data) ? escolasData.data : []);
    } catch (errorCarregamento) {
      setErro(errorCarregamento.message || 'Não foi possível carregar o suporte.');
    } finally {
      setLoading(false);
    }
    try {
      const errosData = await lerResposta(await fetch(`${API_OWNER}/support/errors`, {
        credentials: 'include',
        cache: 'no-store'
      }));
      setErrosAutomaticos(Array.isArray(errosData.data) ? errosData.data : []);
      setErroErrosAutomaticos('');
    } catch (errorCarregamento) {
      setErroErrosAutomaticos(errorCarregamento.message || 'Não foi possível carregar os erros automáticos.');
    }
  }, [filtroEstado]);

  useEffect(() => {
    const timer = window.setTimeout(() => void carregar(), 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  useEffect(() => {
    let ativo = true;
    const atualizarErros = async () => {
      try {
        const data = await lerResposta(await fetch(`${API_OWNER}/support/errors`, {
          credentials: 'include',
          cache: 'no-store'
        }));
        if (ativo) {
          setErrosAutomaticos(Array.isArray(data.data) ? data.data : []);
          setErroErrosAutomaticos('');
        }
      } catch (errorAtualizacao) {
        if (ativo) setErroErrosAutomaticos(errorAtualizacao.message || 'Não foi possível atualizar os erros automáticos.');
      }
    };
    const intervalo = window.setInterval(() => void atualizarErros(), 30_000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, []);

  useEffect(() => {
    const termo = pesquisaDestinatario.trim();
    if (termo.length < 2) return undefined;
    let ativo = true;
    const timer = window.setTimeout(async () => {
      setLoadingDestinatarios(true);
      setErroPesquisa('');
      try {
        const params = new URLSearchParams({ q: termo });
        const data = await lerResposta(await fetch(`${API_OWNER}/support/recipients?${params}`, {
          credentials: 'include',
          cache: 'no-store'
        }));
        if (ativo) setUtilizadores(Array.isArray(data.data) ? data.data : []);
      } catch (errorPesquisa) {
        if (ativo) setErroPesquisa(errorPesquisa.message || 'Não foi possível pesquisar utilizadores.');
      } finally {
        if (ativo) setLoadingDestinatarios(false);
      }
    }, 250);
    return () => {
      ativo = false;
      window.clearTimeout(timer);
    };
  }, [pesquisaDestinatario]);

  const criarTicket = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro('');
    setMensagem('');
    try {
      await lerResposta(await fetch(`${API_OWNER}/support/tickets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      }));
      setForm({ escola_id: '', titulo: '', categoria: 'erro_tecnico', prioridade: 'normal', descricao: '' });
      setMensagem('Ocorrência registada.');
      await carregar();
    } catch (errorEnvio) {
      setErro(errorEnvio.message || 'Não foi possível registar a ocorrência.');
    } finally {
      setSalvando(false);
    }
  };

  const enviarNotificacao = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro('');
    setMensagem('');
    try {
      const data = await lerResposta(await fetch(`${API_OWNER}/support/notifications`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: formNotificacao.titulo,
          mensagem: formNotificacao.mensagem,
          destinatarios: destinatarios.map((utilizador) => utilizador.id)
        })
      }));
      setFormNotificacao({ titulo: '', mensagem: '' });
      setDestinatarios([]);
      setPesquisaDestinatario('');
      setUtilizadores([]);
      setMensagem(data.message || 'Notificação enviada.');
    } catch (errorEnvio) {
      setErro(errorEnvio.message || 'Não foi possível enviar a notificação.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarDestinatario = (utilizador) => {
    if (destinatarios.some((item) => item.id === utilizador.id)) {
      setDestinatarios((atuais) => atuais.filter((item) => item.id !== utilizador.id));
      return;
    }
    if (destinatarios.length >= 100) {
      setErro('Pode selecionar no máximo 100 destinatários por notificação.');
      return;
    }
    setDestinatarios((atuais) => (
      atuais.some((item) => item.id === utilizador.id) ? atuais : [...atuais, utilizador]
    ));
  };

  const atualizarTicket = async (ticket) => {
    setSalvando(true);
    setErro('');
    setMensagem('');
    try {
      await lerResposta(await fetch(`${API_OWNER}/support/tickets/${encodeURIComponent(ticket.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estado: estados[ticket.id] || ticket.estado,
          nota: notas[ticket.id] ?? ticket.ultima_nota ?? ''
        })
      }));
      setMensagem('Ocorrência atualizada.');
      await carregar();
    } catch (errorAtualizacao) {
      setErro(errorAtualizacao.message || 'Não foi possível atualizar a ocorrência.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarSecao = (secao) => {
    setSecaoAberta((atual) => atual === secao ? '' : secao);
  };

  return (
    <main className="owner-support-page">
      <AdminHeader
        titulo="Suporte e notificações"
        descricao="Acompanhe ocorrências e envie avisos diretamente aos utilizadores da plataforma."
        onRefresh={carregar}
        loading={loading || salvando}
      />

      {erro && <div className="owner-support-message owner-support-message-error" role="alert">{erro}</div>}
      {mensagem && <div className="owner-support-message owner-support-message-success" role="status">{mensagem}</div>}

      <section className="owner-support-intro">
        <div>
          <span className="owner-support-eyebrow">CENTRO DE OPERAÇÕES</span>
          <h2>Como podemos ajudar?</h2>
          <p>Escolha uma ação para comunicar com utilizadores ou gerir os pedidos de suporte.</p>
        </div>
        <div className="owner-support-stats">
          <div><BsPeople aria-hidden="true" /><span><strong>{destinatarios.length}</strong><small>destinatários</small></span></div>
          <div><BsTicketPerforated aria-hidden="true" /><span><strong>{tickets.length + errosAutomaticos.length}</strong><small>ocorrências</small></span></div>
          <div><BsBuilding aria-hidden="true" /><span><strong>{escolas.length}</strong><small>escolas</small></span></div>
        </div>
      </section>

      <div className="owner-support-accordions">
      <section className={`owner-support-accordion${secaoAberta === 'notificacao' ? ' is-open' : ''}`}>
        <button
          type="button"
          className="owner-support-accordion-trigger"
          aria-expanded={secaoAberta === 'notificacao'}
          aria-controls="support-notification-panel"
          onClick={() => alternarSecao('notificacao')}
        >
          <strong><BsBell aria-hidden="true" /> Enviar notificação</strong>
          <span>{destinatarios.length ? `${destinatarios.length} selecionado${destinatarios.length === 1 ? '' : 's'}` : 'Nova comunicação'} {secaoAberta === 'notificacao' ? <BsChevronUp aria-hidden="true" /> : <BsChevronDown aria-hidden="true" />}</span>
        </button>
        {secaoAberta === 'notificacao' && <form id="support-notification-panel" className="owner-support-panel" onSubmit={enviarNotificacao}>
          <div className="modal-grid-2">
            <div className="ce-field-group">
              <label htmlFor="support-notification-title">Título</label>
              <input
                id="support-notification-title"
                className="ce-input"
                value={formNotificacao.titulo}
                onChange={(event) => setFormNotificacao((atual) => ({ ...atual, titulo: event.target.value }))}
                maxLength={180}
                required
                placeholder="Ex.: Manutenção programada"
              />
            </div>
            <div className="ce-field-group">
              <label htmlFor="support-recipient-search">Pesquisar destinatários (nome, email ou utilizador)</label>
              <div>
                <BsSearch aria-hidden="true" />
                <input
                  id="support-recipient-search"
                  className="ce-input"
                  value={pesquisaDestinatario}
                  onChange={(event) => {
                    const valor = event.target.value;
                    setPesquisaDestinatario(valor);
                    if (valor.trim().length < 2) {
                      setUtilizadores([]);
                      setErroPesquisa('');
                      setLoadingDestinatarios(false);
                    }
                  }}
                  minLength={2}
                  placeholder="Escreva pelo menos 2 caracteres"
                />
              </div>
              {loadingDestinatarios && <small role="status">A pesquisar utilizadores ativos…</small>}
              {erroPesquisa && <small role="alert">{erroPesquisa}</small>}
              {pesquisaDestinatario.trim().length >= 2 && !loadingDestinatarios && !erroPesquisa && !utilizadores.length && (
                <small>Nenhum utilizador ativo encontrado.</small>
              )}
            </div>
            <div className="ce-field-group">
              <p><strong>Resultados da pesquisa</strong></p>
              <div id="support-recipient-results" className="ficha-info-box" role="group" aria-label="Resultados da pesquisa">
                {utilizadores.map((utilizador) => (
                  <label key={utilizador.id}>
                    <input
                      type="checkbox"
                      checked={destinatarios.some((item) => item.id === utilizador.id)}
                      onChange={() => alternarDestinatario(utilizador)}
                    />
                    <span>
                      <strong>{utilizador.nome}</strong>
                      <small>{utilizador.email || utilizador.login_id || 'Sem email'} · {utilizador.papel || 'Utilizador'}{utilizador.escolas ? ` · ${utilizador.escolas}` : ''}</small>
                    </span>
                  </label>
                ))}
                {!utilizadores.length && !loadingDestinatarios && <small>Os resultados aparecerão aqui.</small>}
              </div>
            </div>
            <div className="ce-field-group">
              <label>Destinatários selecionados</label>
              <div className="ficha-info-box">
                {destinatarios.map((utilizador) => (
                  <div key={utilizador.id} className="ficha-header-badge">
                    <span>{utilizador.nome} · {utilizador.email || utilizador.login_id}</span>
                    <button className="ce-btn-back" type="button" onClick={() => alternarDestinatario(utilizador)}>Remover</button>
                  </div>
                ))}
                {!destinatarios.length && <small>Selecione um ou mais utilizadores.</small>}
              </div>
            </div>
            <div className="ce-field-group">
              <label htmlFor="support-notification-message">Mensagem</label>
              <textarea
                id="support-notification-message"
                className="ce-input"
                rows={4}
                value={formNotificacao.mensagem}
                onChange={(event) => setFormNotificacao((atual) => ({ ...atual, mensagem: event.target.value }))}
                maxLength={4000}
                required
                placeholder="Escreva a informação que os destinatários devem receber."
              />
              <small>{formNotificacao.mensagem.length}/4000 caracteres</small>
            </div>
          </div>
          <div className="modal-footer-actions">
            <button className="ce-btn-submit" type="submit" disabled={salvando || !destinatarios.length}>
              <BsPersonPlus aria-hidden="true" /> {salvando ? 'A enviar…' : 'Enviar notificação'}
            </button>
          </div>
        </form>}
      </section>

      <section className={`owner-support-accordion${secaoAberta === 'registo' ? ' is-open' : ''}`}>
        <button
          type="button"
          className="owner-support-accordion-trigger"
          aria-expanded={secaoAberta === 'registo'}
          aria-controls="support-ticket-panel"
          onClick={() => alternarSecao('registo')}
        >
          <strong><BsTicketPerforated aria-hidden="true" /> Registar ocorrência</strong>
          <span>Novo pedido {secaoAberta === 'registo' ? <BsChevronUp aria-hidden="true" /> : <BsChevronDown aria-hidden="true" />}</span>
        </button>
        {secaoAberta === 'registo' && <form id="support-ticket-panel" className="owner-support-panel" onSubmit={criarTicket}>
          <div className="modal-grid-2">
            <div className="ce-field-group">
              <label htmlFor="support-school">Escola</label>
              <select id="support-school" className="ce-select" value={form.escola_id} onChange={(event) => setForm({ ...form, escola_id: event.target.value })}>
                <option value="">Plataforma / sem escola específica</option>
                {escolas.map((escola) => <option key={escola.id} value={escola.id}>{escola.nome}</option>)}
              </select>
            </div>
            <div className="ce-field-group">
              <label htmlFor="support-category">Categoria</label>
              <select id="support-category" className="ce-select" value={form.categoria} onChange={(event) => setForm({ ...form, categoria: event.target.value })}>
                <option value="erro_tecnico">Erro técnico</option>
                <option value="acesso">Acesso</option>
                <option value="matricula">Matrícula</option>
                <option value="pagamentos">Pagamentos</option>
                <option value="notas">Notas</option>
                <option value="dados">Dados</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div className="ce-field-group">
              <label htmlFor="support-priority">Prioridade</label>
              <select id="support-priority" className="ce-select" value={form.prioridade} onChange={(event) => setForm({ ...form, prioridade: event.target.value })}>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>
            <div className="ce-field-group">
              <label htmlFor="support-title">Título</label>
              <input id="support-title" className="ce-input" required maxLength={200} value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} />
            </div>
            <div className="ce-field-group">
              <label htmlFor="support-description">Descrição do caso (não inclua senhas ou segredos)</label>
              <textarea id="support-description" className="ce-input" rows={4} required maxLength={5000} value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} />
            </div>
          </div>
          <div className="modal-footer-actions">
            <button className="ce-btn-submit" disabled={salvando} type="submit">{salvando ? 'A guardar…' : 'Registar ocorrência'}</button>
          </div>
        </form>}
      </section>

      <section className={`owner-support-accordion${secaoAberta === 'ocorrencias' ? ' is-open' : ''}`}>
        <button
          type="button"
          className="owner-support-accordion-trigger"
          aria-expanded={secaoAberta === 'ocorrencias'}
          aria-controls="support-tickets-panel"
          onClick={() => alternarSecao('ocorrencias')}
        >
          <strong>Ocorrências</strong>
          <span>{tickets.length + errosAutomaticos.length} registo{tickets.length + errosAutomaticos.length === 1 ? '' : 's'} {secaoAberta === 'ocorrencias' ? <BsChevronUp aria-hidden="true" /> : <BsChevronDown aria-hidden="true" />}</span>
        </button>
        {secaoAberta === 'ocorrencias' && <div id="support-tickets-panel" className="owner-support-panel">
          <div className="ficha-header-badge">
            <strong>Filtrar pedidos de suporte</strong>
            <select aria-label="Filtrar por estado" className="ce-select" value={filtroEstado} onChange={(event) => setFiltroEstado(event.target.value)}>
              <option value="">Todos os estados</option>
              {ESTADOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        {loading ? <p role="status">A carregar ocorrências…</p> : (
          <div className="modal-admin-body">
            {erroErrosAutomaticos && <p className="owner-support-message owner-support-message-error" role="alert">{erroErrosAutomaticos}</p>}
            {errosAutomaticos.length > 0 && <>
              <h3>Erros automáticos (mais recentes primeiro, atualização a cada 30 segundos)</h3>
              {errosAutomaticos.map((item) => (
                <article key={`erro-${item.id}`} className="ficha-info-box">
                  <div className="ficha-header-badge">
                    <div>
                      <strong>{item.status_http ? `HTTP ${item.status_http}` : item.tipo === 'rede' ? 'Erro de rede' : 'Erro JavaScript'} · {item.metodo || 'CLIENT'} {item.rota}</strong>
                      <small>{item.tipo} · Página: {item.pagina} · {dataHora(item.criado_em)}</small>
                    </div>
                  </div>
                  <p>{item.mensagem}</p>
                  {item.user_agent && <small>Navegador: {item.user_agent}</small>}
                  {item.stack && <details>
                    <summary>Detalhes técnicos</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.stack}</pre>
                  </details>}
                </article>
              ))}
            </>}
            <h3>Pedidos de suporte</h3>
            {tickets.length === 0
              ? <p>Não há pedidos de suporte para este filtro.</p>
              : tickets.map((ticket) => (
              <article key={ticket.id} className="ficha-info-box">
                <div className="ficha-header-badge">
                  <div>
                    <strong>{ticket.titulo}</strong>
                    <small>{ticket.escola_nome || 'Plataforma'} · {ticket.categoria} · Prioridade {ticket.prioridade} · {dataHora(ticket.atualizado_em)}</small>
                  </div>
                  <small>Registado por {ticket.criado_por_nome || 'Owner'}</small>
                </div>
                <p>{ticket.descricao}</p>
                <div className="modal-grid-2">
                  <div className="ce-field-group">
                    <label htmlFor={`ticket-state-${ticket.id}`}>Estado</label>
                    <select id={`ticket-state-${ticket.id}`} className="ce-select" value={estados[ticket.id] ?? ticket.estado} onChange={(event) => setEstados({ ...estados, [ticket.id]: event.target.value })}>
                      {ESTADOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                  <div className="ce-field-group">
                    <label htmlFor={`ticket-note-${ticket.id}`}>Nota de acompanhamento</label>
                    <input id={`ticket-note-${ticket.id}`} className="ce-input" maxLength={2000} value={notas[ticket.id] ?? ticket.ultima_nota ?? ''} onChange={(event) => setNotas({ ...notas, [ticket.id]: event.target.value })} />
                  </div>
                </div>
                <div className="modal-footer-actions">
                  <button disabled={salvando} type="button" className="ce-btn-back" onClick={() => void atualizarTicket(ticket)}>Guardar alterações</button>
                </div>
              </article>
            ))}
            {tickets.length === 0 && errosAutomaticos.length === 0 && <p>Não há ocorrências para este filtro.</p>}
          </div>
        )}
        </div>}
      </section>
      </div>
    </main>
  );
}
