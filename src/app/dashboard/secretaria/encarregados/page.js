'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BsSearch, BsEnvelope, BsEye, BsCheck2Square, BsSquare, BsSend, BsX } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import '../../../../styles/s2.css';

const API_URL = `${process.env.NEXT_PUBLIC_API_URL}/api`;

export default function GestaoEncarregadosPage() {
  const [selectedEscolaId, setSelectedEscolaId] = useState('');
  const [anosLetivos, setAnosLetivos] = useState([]);
  const [polos, setPolos] = useState([]);
  const [selectedAnoLetivoId, setSelectedAnoLetivoId] = useState('');
  const [selectedPoloId, setSelectedPoloId] = useState('');
  const [encarregados, setEncarregados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingEscolas, setLoadingEscolas] = useState(true);
  const [erro, setErro] = useState('');

  // Filtros ("Escolha Por:")
  const [pesquisa, setPesquisa] = useState('');
  const [filtroParentesco, setFiltroParentesco] = useState('Todos');

  // Seleção e Checkboxes
  const [emailsSelecionados, setEmailsSelecionados] = useState([]);
  const [marcarTudo, setMarcarTudo] = useState(false);

  // Painel Dividido 70% / 30% (Encarregado selecionado para ver alunos)
  const [encarregadoAtivo, setEncarregadoAtivo] = useState(null);

  // Modal de Envio de Mensagem
  const [modalMensagemOpen, setModalMensagemOpen] = useState(false);
  const [formMensagem, setFormMensagem] = useState({ assunto: '', mensagem: '' });

  // Modal de Email Individual
  const [modalEmailOpen, setModalEmailOpen] = useState(false);
  const [destinatarioEmail, setDestinatarioEmail] = useState('');
  const [formEmailIndividual, setFormEmailIndividual] = useState({ assunto: '', mensagem: '' });

  const carregarEscolas = useCallback(async () => {
  try {
    setLoadingEscolas(true);
    const sessionRes = await fetch(`${API_URL}/v1/auth/me`, {
      credentials: 'include'
      });
      const session = await sessionRes.json();
      if (!sessionRes.ok || !session.success) {
        throw new Error(session.message || 'Não foi possível verificar a sessão.');
      }

      const conta = session.data?.conta_ativa;
      if (!conta?.escola_id) {
        throw new Error('Esta conta não tem uma escola ativa. Selecione a escola no acesso antes de continuar.');
      }
      setSelectedEscolaId(conta.escola_id);
    } catch (err) {
      console.error('Erro ao carregar escolas:', err);
      setErro(err.message || 'Não foi possível carregar a escola da sessão.');
    } finally {
      setLoadingEscolas(false);
    }
  }, []);

  const carregarEncarregados = useCallback(async (escolaId, termoPesquisa = pesquisa, parentesco = filtroParentesco) => {
    if (!escolaId || !selectedAnoLetivoId) return;
    try {
      setLoading(true);
      setErro('');
      const params = new URLSearchParams({ parentesco });
      params.set('ano_letivo_id', selectedAnoLetivoId);
      if (selectedPoloId) params.set('polo_id', selectedPoloId);
      if (termoPesquisa.trim()) params.set('pesquisa', termoPesquisa.trim());
      const url = `${API_URL}/v1/alunos/escolas/${encodeURIComponent(escolaId)}/encarregados?${params}`;

      const res = await fetch(url, {
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Não foi possível carregar os encarregados.');
      }
      const lista = Array.isArray(data.dados) ? data.dados : [];
      setEncarregados(lista);
      setEmailsSelecionados((selecionados) => (
        selecionados.filter((email) => lista.some((enc) => enc.encarregado_email === email))
      ));
      setEncarregadoAtivo((atual) => (
        atual ? lista.find((enc) => enc.encarregado_id === atual.encarregado_id) || null : null
      ));
    } catch (err) {
      console.error('Erro ao carregar encarregados:', err);
      setEncarregados([]);
      setEncarregadoAtivo(null);
      setErro(err.message || 'Não foi possível carregar os encarregados.');
    } finally {
      setLoading(false);
    }
  }, [pesquisa, filtroParentesco, selectedAnoLetivoId, selectedPoloId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void carregarEscolas();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [carregarEscolas]);

  useEffect(() => {
    if (!selectedEscolaId) return;
    let cancelado = false;
    const carregarFiltros = async () => {
      try {
        setErro('');
        const [resAnos, resPolos] = await Promise.all([
          fetch(`${API_URL}/v1/escolas/escolas/${encodeURIComponent(selectedEscolaId)}/anos-letivos`, {
            credentials: 'include'
          }),
          fetch(`${API_URL}/v1/escolas/escolas/${encodeURIComponent(selectedEscolaId)}/polos`, {
            credentials: 'include'
          })
        ]);
        const [dadosAnos, dadosPolos] = await Promise.all([resAnos.json(), resPolos.json()]);
        if (!resAnos.ok || !dadosAnos.success) throw new Error(dadosAnos.message || 'Não foi possível carregar os anos letivos.');
        if (!resPolos.ok || !dadosPolos.success) throw new Error(dadosPolos.message || 'Não foi possível carregar os ramos.');
        if (cancelado) return;
        const listaAnos = Array.isArray(dadosAnos.dados) ? dadosAnos.dados : [];
        const listaPolos = Array.isArray(dadosPolos.data) ? dadosPolos.data : [];
        setAnosLetivos(listaAnos);
        setPolos(listaPolos.filter((polo) => polo.ativo));
        setSelectedAnoLetivoId((atual) => (
          listaAnos.some((ano) => (ano.ano_letivo_id || ano.id) === atual)
            ? atual
            : (listaAnos.find((ano) => ano.ativo)?.ano_letivo_id
              || listaAnos.find((ano) => ano.ativo)?.id
              || listaAnos[0]?.ano_letivo_id
              || listaAnos[0]?.id
              || '')
        ));
        setSelectedPoloId((atual) => listaPolos.some((polo) => polo.id === atual && polo.ativo) ? atual : '');
      } catch (err) {
        if (!cancelado) {
          setAnosLetivos([]);
          setPolos([]);
          setSelectedAnoLetivoId('');
          setErro(err.message || 'Não foi possível carregar os filtros da escola.');
        }
      }
    };
    void carregarFiltros();
    return () => { cancelado = true; };
  }, [selectedEscolaId]);

  useEffect(() => {
    if (!selectedEscolaId || !selectedAnoLetivoId) return;
    const timer = window.setTimeout(() => {
      void carregarEncarregados(selectedEscolaId, pesquisa, filtroParentesco);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedEscolaId, selectedAnoLetivoId, selectedPoloId, pesquisa, filtroParentesco, carregarEncarregados]);

  // Marcar / Desmarcar Todos
  const handleToggleMarcarTudo = () => {
    if (marcarTudo) {
      setMarcarTudo(false);
      setEmailsSelecionados([]);
    } else {
      setMarcarTudo(true);
      setEmailsSelecionados(encarregados.map((e) => e.encarregado_email).filter(Boolean));
    }
  };

  const handleToggleCheckbox = (email, e) => {
    e.stopPropagation();
    if (emailsSelecionados.includes(email)) {
      setEmailsSelecionados(emailsSelecionados.filter(item => item !== email));
      setMarcarTudo(false);
    } else {
      setEmailsSelecionados([...emailsSelecionados, email]);
    }
  };

  // Enviar Mensagem em Lote
  const handleEnviarMensagemLote = async (e) => {
    e.preventDefault();
    if (emailsSelecionados.length === 0) {
      alert('Selecione pelo menos um encarregado.');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/v1/alunos/escolas/encarregados/enviar-mensagem`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escola_id: selectedEscolaId, emails: emailsSelecionados, ...formMensagem })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message);
        setModalMensagemOpen(false);
        setFormMensagem({ assunto: '', mensagem: '' });
      } else {
        throw new Error(data.message || `Falha ao enviar mensagem (HTTP ${res.status}).`);
      }
    } catch (err) {
      alert(err.message || 'Erro ao comunicar com o servidor.');
    }
  };

  // Enviar Email Individual
  const handleEnviarEmailIndividual = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/v1/alunos/escolas/enviar-email-individual`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escola_id: selectedEscolaId,
          destinatario: destinatarioEmail,
          ...formEmailIndividual
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message);
        setModalEmailOpen(false);
        setFormEmailIndividual({ assunto: '', mensagem: '' });
      } else {
        throw new Error(data.message || `Falha ao enviar email (HTTP ${res.status}).`);
      }
    } catch (err) {
      alert(err.message || 'Erro ao enviar email.');
    }
  };

  return (
    <div className="sec-guardians-page">
      <AdminHeader
        titulo="Gestão de Encarregados"
        descricao="Consulte encarregados, alunos associados e envie comunicações."
      >
        <button
          type="button"
          className="secretary-guardians-primary"
          onClick={() => {
            if (emailsSelecionados.length === 0) {
              alert('Selecione pelo menos um encarregado para enviar mensagem.');
              return;
            }
            setModalMensagemOpen(true);
          }}
        >
          <BsSend aria-hidden="true" /> Enviar mensagem <span>{emailsSelecionados.length}</span>
        </button>
      </AdminHeader>

      {erro && <div className="secretary-guardians-alert" role="alert">{erro}</div>}

      <section className="secretary-guardians-filters" aria-label="Filtros de encarregados">
        <label className="secretary-guardians-search">
          <BsSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquisar nome, email ou telemóvel..."
            value={pesquisa}
            onChange={(event) => setPesquisa(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && carregarEncarregados(selectedEscolaId, pesquisa, filtroParentesco)}
            aria-label="Pesquisar encarregados"
          />
        </label>
        <label className="secretary-guardians-filter">
          <span>Ano letivo</span>
          <select value={selectedAnoLetivoId} onChange={(event) => setSelectedAnoLetivoId(event.target.value)} disabled={anosLetivos.length === 0}>
            {anosLetivos.length === 0
              ? <option value="">Sem anos letivos configurados</option>
              : anosLetivos.map((ano) => (
                <option key={ano.ano_letivo_id || ano.id} value={ano.ano_letivo_id || ano.id}>
                  {ano.ano_nome}{ano.ativo ? ' (Atual)' : ''}
                </option>
              ))}
          </select>
        </label>
        <label className="secretary-guardians-filter">
          <span>Ramo / polo</span>
          <select value={selectedPoloId} onChange={(event) => setSelectedPoloId(event.target.value)}>
            <option value="">Todos os ramos</option>
            {polos.map((polo) => <option key={polo.id} value={polo.id}>{polo.nome}</option>)}
          </select>
        </label>
        <label className="secretary-guardians-filter">
          <span>Parentesco</span>
          <select value={filtroParentesco} onChange={(event) => setFiltroParentesco(event.target.value)}>
            <option value="Todos">Todos os parentescos</option>
            <option value="Pai">Pai</option>
            <option value="Mãe">Mãe</option>
            <option value="Tio(a)">Tio(a)</option>
            <option value="Tutor Legal">Tutor legal</option>
          </select>
        </label>
        <button
          type="button"
          className="secretary-guardians-refresh"
          onClick={() => carregarEncarregados(selectedEscolaId, pesquisa, filtroParentesco)}
          disabled={!selectedEscolaId || !selectedAnoLetivoId || loading}
        >
          {loading ? 'A carregar...' : 'Atualizar lista'}
        </button>
      </section>

      <section className="secretary-guardians-summary" aria-label="Resumo">
        <article className="secretary-guardians-stat">
          <span>Encarregados encontrados</span>
          <strong>{encarregados.length}</strong>
        </article>
        <article className="secretary-guardians-stat">
          <span>Com email</span>
          <strong>{encarregados.filter((item) => Boolean(item.encarregado_email)).length}</strong>
        </article>
        <article className="secretary-guardians-stat">
          <span>Selecionados para mensagem</span>
          <strong>{emailsSelecionados.length}</strong>
        </article>
      </section>

      <div className={`secretary-guardians-layout ${encarregadoAtivo ? 'has-selection' : ''}`}>
        <main className="secretary-guardians-panel">
          <header className="secretary-guardians-panel-header">
            <div>
              <span className="secretary-guardians-eyebrow">Comunidade escolar</span>
              <h2>Encarregados de educação</h2>
            </div>
            <button type="button" className="secretary-guardians-select-all" onClick={handleToggleMarcarTudo} aria-pressed={marcarTudo}>
              {marcarTudo ? <BsCheck2Square aria-hidden="true" /> : <BsSquare aria-hidden="true" />}
              <span>Selecionar todos</span>
              <strong>{encarregados.length}</strong>
            </button>
          </header>

          <div className="secretary-guardians-table-scroll">
            {loading || loadingEscolas ? (
              <div className="secretary-guardians-empty" role="status">A carregar encarregados...</div>
            ) : encarregados.length > 0 ? (
              <table className="secretary-guardians-table">
                <thead>
                  <tr>
                    <th className="secretary-guardians-checkbox-column"><span className="visually-hidden">Selecionar</span></th>
                    <th>Encarregado</th>
                    <th>Parentesco</th>
                    <th>Contacto</th>
                    <th>Alunos</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {encarregados.map((enc) => {
                    const isSelected = Boolean(enc.encarregado_email) && emailsSelecionados.includes(enc.encarregado_email);
                    const isActive = encarregadoAtivo?.encarregado_email === enc.encarregado_email;
                    const qtdAlunos = enc.alunos?.length || 0;
                    return (
                      <tr
                        key={enc.encarregado_id || enc.encarregado_email}
                        className={isActive ? 'selected' : ''}
                        onClick={() => setEncarregadoAtivo(isActive ? null : enc)}
                      >
                        <td className="secretary-guardians-checkbox-column">
                          <button
                            type="button"
                            className="secretary-guardians-checkbox"
                            onClick={(event) => enc.encarregado_email && handleToggleCheckbox(enc.encarregado_email, event)}
                            disabled={!enc.encarregado_email}
                            aria-label={`${isSelected ? 'Desmarcar' : 'Selecionar'} ${enc.encarregado_nome} para mensagem`}
                            aria-pressed={isSelected}
                          >
                            {isSelected ? <BsCheck2Square aria-hidden="true" /> : <BsSquare aria-hidden="true" />}
                          </button>
                        </td>
                        <td>
                          <div className="secretary-guardians-person">
                            <span className="secretary-guardians-avatar" aria-hidden="true">
                              {`${enc.encarregado_nome || ''} ${enc.encarregado_apelido || ''}`.trim().slice(0, 2).toUpperCase() || 'EN'}
                            </span>
                            <span>
                              <strong>{enc.encarregado_nome} {enc.encarregado_apelido}</strong>
                              <small>Profissão: {enc.encarregado_occupacao || 'N/A'}</small>
                            </span>
                          </div>
                        </td>
                        <td><span className="secretary-guardians-relation">{enc.parentesco || 'Encarregado'}</span></td>
                        <td className="secretary-guardians-contact">
                          <span>{enc.encarregado_telefone || 'Sem telemóvel'}</span>
                          <small>{enc.encarregado_email || 'Sem email'}</small>
                        </td>
                        <td><span className="secretary-guardians-student-count">{qtdAlunos} aluno(s)</span></td>
                        <td>
                          <div className="secretary-guardians-actions" onClick={(event) => event.stopPropagation()}>
                            <button type="button" className="secretary-guardians-action" onClick={() => setEncarregadoAtivo(enc)} title="Ver alunos associados">
                              <BsEye aria-hidden="true" /><span>Ver</span>
                            </button>
                            <button
                              type="button"
                              className="secretary-guardians-action"
                              disabled={!enc.encarregado_email}
                              onClick={() => {
                                setDestinatarioEmail(enc.encarregado_email);
                                setModalEmailOpen(true);
                              }}
                              title="Enviar email"
                            >
                              <BsEnvelope aria-hidden="true" /><span>Email</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="secretary-guardians-empty">
                <strong>Nenhum encarregado encontrado</strong>
                <span>Altere a pesquisa ou os filtros para consultar outros resultados.</span>
              </div>
            )}
          </div>
        </main>

        {encarregadoAtivo && (
          <aside className="secretary-guardians-details">
            <header className="secretary-guardians-details-header">
              <div>
                <span className="secretary-guardians-eyebrow">Encarregado selecionado</span>
                <h2>{encarregadoAtivo.encarregado_nome} {encarregadoAtivo.encarregado_apelido}</h2>
              </div>
              <button type="button" className="secretary-guardians-close" onClick={() => setEncarregadoAtivo(null)} aria-label="Fechar detalhes">
                <BsX aria-hidden="true" />
              </button>
            </header>
            <div className="secretary-guardians-details-content">
              <section className="secretary-guardians-section">
                <div className="secretary-guardians-section-title">
                  <h3>Alunos associados</h3>
                  <span>{encarregadoAtivo.alunos?.length || 0}</span>
                </div>
                {encarregadoAtivo.alunos?.length > 0 ? (
                  <div className="secretary-guardians-student-list">
                    {encarregadoAtivo.alunos.map((aluno) => (
                      <article key={aluno.aluno_id} className="secretary-guardians-student">
                        <div className="secretary-guardians-student-person">
                          {aluno.foto_url
                            ? <img src={aluno.foto_url} alt="" className="secretary-guardians-student-avatar" />
                            : <span className="secretary-guardians-student-avatar secretary-guardians-student-avatar-fallback" aria-hidden="true">{(aluno.nome || 'AL').slice(0, 2).toUpperCase()}</span>}
                          <span>
                            <strong>{aluno.nome} {aluno.apelido}</strong>
                            <code>{aluno.login_id}</code>
                          </span>
                        </div>
                        <button
                          type="button"
                          className="secretary-guardians-email-student"
                          onClick={() => {
                            setDestinatarioEmail(aluno.email || encarregadoAtivo.encarregado_email);
                            setModalEmailOpen(true);
                          }}
                          title="Enviar email sobre este aluno"
                          aria-label={`Enviar email sobre ${aluno.nome} ${aluno.apelido || ''}`}
                        >
                          <BsEnvelope aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="secretary-guardians-empty-note">Nenhum aluno registado para este encarregado.</p>
                )}
              </section>
              <section className="secretary-guardians-contact-card">
                <h3>Contactos e morada</h3>
                <p><strong>Morada:</strong> {encarregadoAtivo.encarregado_regiao_morada || 'SAB'} / {encarregadoAtivo.encarregado_setor_morada || 'Bissau'}</p>
                <p><strong>Telemóvel:</strong> {encarregadoAtivo.encarregado_telefone || 'N/D'}</p>
                <p><strong>Email:</strong> {encarregadoAtivo.encarregado_email || 'N/D'}</p>
              </section>
            </div>
          </aside>
        )}
      </div>

      {modalMensagemOpen && (
        <div className="secretary-guardians-modal-backdrop" onClick={() => setModalMensagemOpen(false)}>
          <section className="secretary-guardians-modal" role="dialog" aria-modal="true" aria-labelledby="secretary-guardians-bulk-title" onClick={(event) => event.stopPropagation()}>
            <header className="secretary-guardians-modal-header">
              <div>
                <span className="secretary-guardians-eyebrow">Comunicação em lote</span>
                <h2 id="secretary-guardians-bulk-title">Enviar mensagem</h2>
                <p>{emailsSelecionados.length} encarregado(s) selecionado(s)</p>
              </div>
              <button type="button" className="secretary-guardians-close" onClick={() => setModalMensagemOpen(false)} aria-label="Fechar">
                <BsX aria-hidden="true" />
              </button>
            </header>
            <form onSubmit={handleEnviarMensagemLote} className="secretary-guardians-form">
              <label>
                <span>Assunto da mensagem *</span>
                <input type="text" placeholder="Ex: Reunião de Pais e Encarregados" value={formMensagem.assunto} onChange={(event) => setFormMensagem({ ...formMensagem, assunto: event.target.value })} required />
              </label>
              <label>
                <span>Conteúdo da mensagem *</span>
                <textarea rows="5" placeholder="Escreva aqui a mensagem que será enviada..." value={formMensagem.mensagem} onChange={(event) => setFormMensagem({ ...formMensagem, mensagem: event.target.value })} required />
              </label>
              <footer className="secretary-guardians-modal-actions">
                <button type="button" className="secretary-guardians-secondary" onClick={() => setModalMensagemOpen(false)}>Cancelar</button>
                <button type="submit" className="secretary-guardians-primary"><BsSend aria-hidden="true" /> Enviar mensagens</button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {modalEmailOpen && (
        <div className="secretary-guardians-modal-backdrop" onClick={() => setModalEmailOpen(false)}>
          <section className="secretary-guardians-modal" role="dialog" aria-modal="true" aria-labelledby="secretary-guardians-email-title" onClick={(event) => event.stopPropagation()}>
            <header className="secretary-guardians-modal-header">
              <div>
                <span className="secretary-guardians-eyebrow">Comunicação individual</span>
                <h2 id="secretary-guardians-email-title">Enviar email</h2>
              </div>
              <button type="button" className="secretary-guardians-close" onClick={() => setModalEmailOpen(false)} aria-label="Fechar">
                <BsX aria-hidden="true" />
              </button>
            </header>
            <form onSubmit={handleEnviarEmailIndividual} className="secretary-guardians-form">
              <label>
                <span>Destinatário</span>
                <input type="text" value={destinatarioEmail} disabled />
              </label>
              <label>
                <span>Assunto *</span>
                <input type="text" placeholder="Assunto do email" value={formEmailIndividual.assunto} onChange={(event) => setFormEmailIndividual({ ...formEmailIndividual, assunto: event.target.value })} required />
              </label>
              <label>
                <span>Mensagem *</span>
                <textarea rows="4" placeholder="Escreva o email..." value={formEmailIndividual.mensagem} onChange={(event) => setFormEmailIndividual({ ...formEmailIndividual, mensagem: event.target.value })} required />
              </label>
              <footer className="secretary-guardians-modal-actions">
                <button type="button" className="secretary-guardians-secondary" onClick={() => setModalEmailOpen(false)}>Cancelar</button>
                <button type="submit" className="secretary-guardians-primary"><BsEnvelope aria-hidden="true" /> Enviar email</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}