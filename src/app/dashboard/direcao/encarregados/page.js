'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  BsSearch, BsEnvelope, BsEye, BsPencilSquare, BsCheck2Square, BsSquare, 
  BsSend, BsX, BsChevronLeft, BsChevronRight, BsCheckCircle 
} from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import GuineaBissauPhoneInput from '@/components/GuineaBissauPhoneInput';
import '../../../../styles/s2.css';

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '')}/api`;

function alunosCorrespondentes(encarregado, classe, turmaId, pesquisa) {
  const termo = pesquisa.trim().toLocaleLowerCase();
  const alunos = Array.isArray(encarregado.alunos) ? encarregado.alunos : [];
  const alunosDaClasseETurma = alunos.filter((aluno) => (
    (classe === 'Todas' || aluno.classe?.trim() === classe) &&
    (turmaId === 'Todas' || String(aluno.turma_id) === String(turmaId))
  ));
  if (!termo) return alunosDaClasseETurma;

  const alunosDaPesquisa = alunosDaClasseETurma.filter((aluno) => (
    `${aluno.nome || ''} ${aluno.apelido || ''} ${aluno.email || ''} ${aluno.login_id || ''}`
      .toLocaleLowerCase()
      .includes(termo)
  ));
  const encarregadoCorresponde = `${encarregado.encarregado_nome || ''} ${encarregado.encarregado_apelido || ''} ${encarregado.encarregado_email || ''} ${encarregado.encarregado_telefone || ''}`
    .toLocaleLowerCase()
    .includes(termo);

  return encarregadoCorresponde ? alunosDaClasseETurma : alunosDaPesquisa;
}

export default function GestaoEncarregadosDirecaoPage() {
  const [escolas, setEscolas] = useState([]);
  const [selectedEscolaId, setSelectedEscolaId] = useState('');
  
  const [turmasDaEscola, setTurmasDaEscola] = useState([]);
  const [classesDisponiveis, setClassesDisponiveis] = useState([]);

  // Filtros
  const [selectedClasse, setSelectedClasse] = useState('Todas');
  const [selectedTurmaId, setSelectedTurmaId] = useState('Todas');
  const [pesquisa, setPesquisa] = useState('');

  // Dados e Paginação (Máx 25 por página)
  const [encarregados, setEncarregados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingEscolas, setLoadingEscolas] = useState(true);
  const [erro, setErro] = useState('');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 25;

  // Seleção e Checkboxes
  const [emailsSelecionados, setEmailsSelecionados] = useState([]);
  const [marcarTudo, setMarcarTudo] = useState(false);

  // Painel Lateral de Edição / Info (Deslizante)
  const [encarregadoAtivo, setEncarregadoAtivo] = useState(null);
  const [modoEdicao, setModoEdicao] = useState(false);
  const [formDataEdit, setFormDataEdit] = useState({});

  // Modais de Email / Mensagem em Lote
  const [modalMensagemOpen, setModalMensagemOpen] = useState(false);
  const [formMensagem, setFormMensagem] = useState({ assunto: '', mensagem: '' });
  const [modalEmailOpen, setModalEmailOpen] = useState(false);
  const [destinatarioEmail, setDestinatarioEmail] = useState('');
  const [formEmailIndividual, setFormEmailIndividual] = useState({ assunto: '', mensagem: '' });

  const carregarEscolas = useCallback(async () => {
    try {
      setLoadingEscolas(true);
      const sessionRes = await fetch(`${API_URL}/v1/auth/me`, { credentials: 'include' });
      const session = await sessionRes.json();
      if (!sessionRes.ok || !session.success) throw new Error(session.message || 'Erro ao verificar sessão.');
      
      if (session.data?.tipo !== 'owner') {
        const conta = session.data?.conta_ativa;
        if (!conta?.escola_id) throw new Error('Esta conta não tem uma escola ativa.');
        const escola = { id: conta.escola_id, nome: conta.escola_nome, local: conta.escola_sigla };
        setEscolas([escola]);
        setSelectedEscolaId(escola.id);
        return;
      }
      const res = await fetch(`${API_URL}/v1/owner/escolas/paginadas?page=1&limit=100`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Erro ao carregar escolas.');
      const lista = Array.isArray(data.data) ? data.data : [];
      setEscolas(lista);
      setSelectedEscolaId((atual) => (lista.some((e) => (e.id_raw || e.id) === atual) ? atual : (lista[0]?.id_raw || lista[0]?.id || '')));
    } catch (err) {
      setErro(err.message || 'Erro ao carregar escolas.');
    } finally {
      setLoadingEscolas(false);
    }
  }, []);

  const carregarEncarregados = useCallback(async (escolaId) => {
    if (!escolaId) return;
    try {
      setLoading(true);
      setErro('');
      const url = `${API_URL}/v1/alunos/escolas/${encodeURIComponent(escolaId)}/encarregados`;
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Erro ao carregar encarregados.');
      
      const listaEncarregados = Array.isArray(data.dados) ? data.dados : [];
      const turmas = new Map();
      const classes = new Set();
      listaEncarregados.forEach((enc) => {
        (Array.isArray(enc.alunos) ? enc.alunos : []).forEach((aluno) => {
          const classe = aluno.classe?.trim();
          if (classe) classes.add(classe);
          if (aluno.turma_id && aluno.turma_nome) {
            turmas.set(aluno.turma_id, { id: aluno.turma_id, nome: aluno.turma_nome, classe });
          }
        });
      });
      setEncarregados(listaEncarregados);
      setTurmasDaEscola([...turmas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')));
      setClassesDisponiveis([...classes].sort((a, b) => a.localeCompare(b, 'pt')));
      setPaginaAtual(1);
    } catch (err) {
      setEncarregados([]);
      setErro(err.message || 'Erro ao carregar encarregados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void carregarEscolas(), 0);
    return () => window.clearTimeout(timer);
  }, [carregarEscolas]);

  useEffect(() => {
    if (!selectedEscolaId) return;
    const timer = window.setTimeout(() => void carregarEncarregados(selectedEscolaId), 0);
    return () => window.clearTimeout(timer);
  }, [selectedEscolaId, carregarEncarregados]);

  const encarregadosFiltrados = useMemo(() => {
    return encarregados.filter((enc) => alunosCorrespondentes(enc, selectedClasse, selectedTurmaId, pesquisa).length > 0);
  }, [encarregados, selectedTurmaId, selectedClasse, pesquisa]);

  const totalPaginas = Math.ceil(encarregadosFiltrados.length / itensPorPagina) || 1;
  const encarregadosPaginados = useMemo(() => {
    const inicio = (paginaAtual - 1) * itensPorPagina;
    return encarregadosFiltrados.slice(inicio, inicio + itensPorPagina);
  }, [encarregadosFiltrados, paginaAtual]);

  const encarregadoAtivoFiltrado = encarregadoAtivo ? encarregadosFiltrados.find((e) => e.encarregado_id === encarregadoAtivo.encarregado_id) || null : null;
  const alunosDoEncarregadoAtivo = encarregadoAtivoFiltrado ? alunosCorrespondentes(encarregadoAtivoFiltrado, selectedClasse, selectedTurmaId, pesquisa) : [];

  const turmasFiltradasPorClasse = useMemo(() => {
    if (selectedClasse === 'Todas') return turmasDaEscola;
    return turmasDaEscola.filter(t => t.classe?.trim() === selectedClasse);
  }, [turmasDaEscola, selectedClasse]);

  const abrirPainelEditar = (enc, e) => {
    if (e) e.stopPropagation();
    setEncarregadoAtivo(enc);
    setModoEdicao(true);
    setFormDataEdit({
      nome: enc.encarregado_nome || '',
      apelido: enc.encarregado_apelido || '',
      telefone: enc.encarregado_telefone || '',
      email: enc.encarregado_email || '',
      parentesco: enc.parentesco || 'Encarregado',
      ocupacao: enc.encarregado_occupacao || '',
      morada: enc.encarregado_morada || ''
    });
  };

  const abrirPainelInfo = (enc, e) => {
    if (e) e.stopPropagation();
    setEncarregadoAtivo(enc);
    setModoEdicao(false);
  };

  const handleSalvarEdicao = async (e) => {
    e.preventDefault();
    const encId = encarregadoAtivo?.encarregado_id;
    try {
      const res = await fetch(`${API_URL}/v1/alunos/escolas/encarregados/${encodeURIComponent(encId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formDataEdit)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || 'Dados do encarregado atualizados com sucesso!');
        setModoEdicao(false);
        await carregarEncarregados(selectedEscolaId);
      } else {
        throw new Error(data.message || 'Erro ao atualizar dados.');
      }
    } catch (err) {
      alert(err.message || 'Não foi possível salvar as alterações.');
    }
  };

  const handleToggleMarcarTudo = () => {
    if (marcarTudo) {
      setMarcarTudo(false);
      setEmailsSelecionados([]);
    } else {
      setMarcarTudo(true);
      const emailsFiltrados = encarregadosFiltrados.map(e => e.encarregado_email).filter(Boolean);
      setEmailsSelecionados(emailsFiltrados);
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

  return (
    <div className="sec-guardians-page">
      <AdminHeader
        titulo="Gestão de Encarregados"
        descricao="Consulte encarregados, edite informações e envie comunicações institucionais."
        escolaIdLogada={selectedEscolaId}
        onRefresh={() => carregarEncarregados(selectedEscolaId)}
        loading={loading || loadingEscolas}
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
        <label className="secretary-guardians-filter">
          <span>Escola</span>
          <select
            value={selectedEscolaId}
            onChange={(event) => {
              setSelectedEscolaId(event.target.value);
              setSelectedClasse('Todas');
              setSelectedTurmaId('Todas');
              setEncarregadoAtivo(null);
            }}
            disabled={loadingEscolas || escolas.length === 0}
          >
            {escolas.map((escola) => {
              const id = escola.id_raw || escola.id;
              return <option key={id} value={id}>{escola.nome}</option>;
            })}
          </select>
        </label>
        <label className="secretary-guardians-filter">
          <span>Classe</span>
          <select value={selectedClasse} onChange={(event) => {
            setSelectedClasse(event.target.value);
            setSelectedTurmaId('Todas');
            setPaginaAtual(1);
          }}>
            <option value="Todas">Todas as classes</option>
            {classesDisponiveis.map((classe) => <option key={classe} value={classe}>{classe}</option>)}
          </select>
        </label>
        <label className="secretary-guardians-filter">
          <span>Turma</span>
          <select value={selectedTurmaId} onChange={(event) => {
            setSelectedTurmaId(event.target.value);
            setPaginaAtual(1);
          }}>
            <option value="Todas">Todas as turmas</option>
            {turmasFiltradasPorClasse.map((turma) => <option key={turma.id} value={turma.id}>{turma.nome_turma || turma.nome}</option>)}
          </select>
        </label>
        <label className="secretary-guardians-search">
          <BsSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Nome, aluno, email..."
            value={pesquisa}
            onChange={(event) => {
              setPesquisa(event.target.value);
              setPaginaAtual(1);
            }}
            aria-label="Pesquisar encarregados"
          />
        </label>
        <button
          type="button"
          className="secretary-guardians-refresh"
          onClick={() => carregarEncarregados(selectedEscolaId)}
          disabled={!selectedEscolaId || loading || loadingEscolas}
        >
          {loading ? 'A carregar...' : 'Atualizar lista'}
        </button>
      </section>

      <section className="secretary-guardians-summary" aria-label="Resumo">
        <article className="secretary-guardians-stat">
          <span>Encarregados encontrados</span>
          <strong>{encarregadosFiltrados.length}</strong>
        </article>
        <article className="secretary-guardians-stat">
          <span>Com email</span>
          <strong>{encarregadosFiltrados.filter((item) => Boolean(item.encarregado_email)).length}</strong>
        </article>
        <article className="secretary-guardians-stat">
          <span>Selecionados para mensagem</span>
          <strong>{emailsSelecionados.length}</strong>
        </article>
      </section>

      <div className={`secretary-guardians-layout ${encarregadoAtivoFiltrado ? 'has-selection' : ''}`}>
        <main className="secretary-guardians-panel">
          <header className="secretary-guardians-panel-header">
            <div>
              <span className="secretary-guardians-eyebrow">Comunidade escolar</span>
              <h2>Encarregados de educação</h2>
            </div>
            <button type="button" className="secretary-guardians-select-all" onClick={handleToggleMarcarTudo} aria-pressed={marcarTudo}>
              {marcarTudo ? <BsCheck2Square aria-hidden="true" /> : <BsSquare aria-hidden="true" />}
              <span>Selecionar todos</span>
              <strong>{encarregadosFiltrados.length}</strong>
            </button>
          </header>

          <div className="secretary-guardians-table-scroll">
            {loading || loadingEscolas ? (
              <div className="secretary-guardians-empty" role="status">A carregar encarregados...</div>
            ) : encarregadosFiltrados.length > 0 ? (
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
                  {encarregadosPaginados.map((encarregado) => {
                    const isSelected = Boolean(encarregado.encarregado_email) && emailsSelecionados.includes(encarregado.encarregado_email);
                    const isActive = encarregadoAtivoFiltrado?.encarregado_id === encarregado.encarregado_id;
                    const qtdAlunos = alunosCorrespondentes(encarregado, selectedClasse, selectedTurmaId, pesquisa).length;
                    const iniciais = `${encarregado.encarregado_nome || ''} ${encarregado.encarregado_apelido || ''}`.trim().slice(0, 2).toUpperCase() || 'EN';

                    return (
                      <tr
                        key={encarregado.encarregado_id || encarregado.encarregado_email}
                        className={isActive ? 'selected' : ''}
                        onClick={(event) => abrirPainelInfo(encarregado, event)}
                      >
                        <td className="secretary-guardians-checkbox-column">
                          <button
                            type="button"
                            className="secretary-guardians-checkbox"
                            onClick={(event) => encarregado.encarregado_email && handleToggleCheckbox(encarregado.encarregado_email, event)}
                            disabled={!encarregado.encarregado_email}
                            aria-label={`${isSelected ? 'Desmarcar' : 'Selecionar'} ${encarregado.encarregado_nome} para mensagem`}
                            aria-pressed={isSelected}
                          >
                            {isSelected ? <BsCheck2Square aria-hidden="true" /> : <BsSquare aria-hidden="true" />}
                          </button>
                        </td>
                        <td>
                          <div className="secretary-guardians-person">
                            <span className="secretary-guardians-avatar" aria-hidden="true">{iniciais}</span>
                            <span>
                              <strong>{encarregado.encarregado_nome} {encarregado.encarregado_apelido}</strong>
                              <small>Profissão: {encarregado.encarregado_occupacao || 'N/A'}</small>
                            </span>
                          </div>
                        </td>
                        <td><span className="secretary-guardians-relation">{encarregado.parentesco || 'Encarregado'}</span></td>
                        <td className="secretary-guardians-contact">
                          <span>{encarregado.encarregado_telefone || 'Sem telemóvel'}</span>
                          <small>{encarregado.encarregado_email || 'Sem email'}</small>
                        </td>
                        <td><span className="secretary-guardians-student-count">{qtdAlunos} aluno(s)</span></td>
                        <td>
                          <div className="secretary-guardians-actions" onClick={(event) => event.stopPropagation()}>
                            <button type="button" className="secretary-guardians-action" onClick={(event) => abrirPainelInfo(encarregado, event)} title="Ver alunos associados">
                              <BsEye aria-hidden="true" /><span>Ver</span>
                            </button>
                            <button type="button" className="secretary-guardians-action" onClick={(event) => abrirPainelEditar(encarregado, event)} title="Editar encarregado">
                              <BsPencilSquare aria-hidden="true" /><span>Editar</span>
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

          {totalPaginas > 1 && (
            <footer className="secretary-guardians-panel-header">
              <span>Página <strong>{paginaAtual}</strong> de <strong>{totalPaginas}</strong></span>
              <div className="secretary-guardians-actions">
                <button type="button" className="secretary-guardians-action" disabled={paginaAtual === 1} onClick={() => setPaginaAtual((pagina) => Math.max(pagina - 1, 1))}>
                  <BsChevronLeft aria-hidden="true" /> Anterior
                </button>
                <button type="button" className="secretary-guardians-action" disabled={paginaAtual === totalPaginas} onClick={() => setPaginaAtual((pagina) => Math.min(pagina + 1, totalPaginas))}>
                  Seguinte <BsChevronRight aria-hidden="true" />
                </button>
              </div>
            </footer>
          )}
        </main>

        {encarregadoAtivoFiltrado && (
          <aside className="secretary-guardians-details">
            <header className="secretary-guardians-details-header">
              <div>
                <span className="secretary-guardians-eyebrow">{modoEdicao ? 'Editar encarregado' : 'Encarregado selecionado'}</span>
                <h2>{encarregadoAtivoFiltrado.encarregado_nome} {encarregadoAtivoFiltrado.encarregado_apelido}</h2>
              </div>
              <button type="button" className="secretary-guardians-close" onClick={() => { setEncarregadoAtivo(null); setModoEdicao(false); }} aria-label="Fechar detalhes">
                <BsX aria-hidden="true" />
              </button>
            </header>
            {modoEdicao ? (
              <form onSubmit={handleSalvarEdicao} className="secretary-guardians-form">
                <label><span>Nome *</span><input type="text" value={formDataEdit.nome} onChange={(event) => setFormDataEdit({ ...formDataEdit, nome: event.target.value })} required /></label>
                <label><span>Apelido *</span><input type="text" value={formDataEdit.apelido} onChange={(event) => setFormDataEdit({ ...formDataEdit, apelido: event.target.value })} required /></label>
                <label><span>Telemóvel</span><GuineaBissauPhoneInput value={formDataEdit.telefone} onChange={(value) => setFormDataEdit((current) => ({ ...current, telefone: value }))} /></label>
                <label><span>Email</span><input type="email" value={formDataEdit.email} onChange={(event) => setFormDataEdit({ ...formDataEdit, email: event.target.value })} /></label>
                <label><span>Parentesco</span><input type="text" value={formDataEdit.parentesco} onChange={(event) => setFormDataEdit({ ...formDataEdit, parentesco: event.target.value })} /></label>
                <label><span>Profissão</span><input type="text" value={formDataEdit.ocupacao} onChange={(event) => setFormDataEdit({ ...formDataEdit, ocupacao: event.target.value })} /></label>
                <label><span>Morada</span><input type="text" value={formDataEdit.morada} onChange={(event) => setFormDataEdit({ ...formDataEdit, morada: event.target.value })} /></label>
                <footer className="secretary-guardians-modal-actions">
                  <button type="button" className="secretary-guardians-secondary" onClick={() => setModoEdicao(false)}>Cancelar</button>
                  <button type="submit" className="secretary-guardians-primary"><BsCheckCircle aria-hidden="true" /> Guardar alterações</button>
                </footer>
              </form>
            ) : (
              <div className="secretary-guardians-details-content">
                <section className="secretary-guardians-section">
                  <div className="secretary-guardians-section-title">
                    <h3>Alunos associados</h3>
                    <span>{alunosDoEncarregadoAtivo.length}</span>
                  </div>
                  {alunosDoEncarregadoAtivo.length > 0 ? (
                    <div className="secretary-guardians-student-list">
                      {alunosDoEncarregadoAtivo.map((aluno) => (
                        <article key={aluno.aluno_id} className="secretary-guardians-student">
                          <div className="secretary-guardians-student-person">
                            {aluno.foto_url
                              ? <img src={aluno.foto_url} alt="" className="secretary-guardians-student-avatar" />
                              : <span className="secretary-guardians-student-avatar secretary-guardians-student-avatar-fallback" aria-hidden="true">{(aluno.nome || 'AL').slice(0, 2).toUpperCase()}</span>}
                            <span>
                              <strong>{aluno.nome} {aluno.apelido}</strong>
                              <code>{aluno.turma_nome || 'Sem turma'} · {aluno.classe || 'Classe N/A'}</code>
                              {aluno.estado_matricula === 'pendente' && <small>Matrícula pendente</small>}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="secretary-guardians-email-student"
                            onClick={() => {
                              setDestinatarioEmail(aluno.email || encarregadoAtivoFiltrado.encarregado_email);
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
                  <p><strong>Morada:</strong> {encarregadoAtivoFiltrado.encarregado_morada || 'Não indicada'}</p>
                  <p><strong>Telemóvel:</strong> {encarregadoAtivoFiltrado.encarregado_telefone || 'N/D'}</p>
                  <p><strong>Email:</strong> {encarregadoAtivoFiltrado.encarregado_email || 'N/D'}</p>
                  <p><strong>Parentesco:</strong> {encarregadoAtivoFiltrado.parentesco || 'Encarregado'}</p>
                  <p><strong>Profissão:</strong> {encarregadoAtivoFiltrado.encarregado_occupacao || 'N/A'}</p>
                </section>
                <div className="secretary-guardians-actions">
                  <button type="button" className="secretary-guardians-action" onClick={(event) => abrirPainelEditar(encarregadoAtivoFiltrado, event)}>
                    <BsPencilSquare aria-hidden="true" /><span>Editar dados</span>
                  </button>
                  <button
                    type="button"
                    className="secretary-guardians-action"
                    disabled={!encarregadoAtivoFiltrado.encarregado_email}
                    onClick={() => {
                      setDestinatarioEmail(encarregadoAtivoFiltrado.encarregado_email);
                      setModalEmailOpen(true);
                    }}
                  >
                    <BsEnvelope aria-hidden="true" /><span>Enviar email</span>
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {modalMensagemOpen && (
        <div className="secretary-guardians-modal-backdrop" onClick={() => setModalMensagemOpen(false)}>
          <section className="secretary-guardians-modal" role="dialog" aria-modal="true" aria-labelledby="direcao-guardians-bulk-title" onClick={(event) => event.stopPropagation()}>
            <header className="secretary-guardians-modal-header">
              <div>
                <span className="secretary-guardians-eyebrow">Comunicação em lote</span>
                <h2 id="direcao-guardians-bulk-title">Enviar mensagem</h2>
                <p>{emailsSelecionados.length} encarregado(s) selecionado(s)</p>
              </div>
              <button type="button" className="secretary-guardians-close" onClick={() => setModalMensagemOpen(false)} aria-label="Fechar"><BsX aria-hidden="true" /></button>
            </header>
            <form onSubmit={async (event) => {
              event.preventDefault();
              try {
                const res = await fetch(`${API_URL}/v1/alunos/escolas/encarregados/enviar-mensagem`, {
                  credentials: 'include', method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ escola_id: selectedEscolaId, emails: emailsSelecionados, ...formMensagem })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                  alert(data.message);
                  setModalMensagemOpen(false);
                  setFormMensagem({ assunto: '', mensagem: '' });
                } else throw new Error(data.message || 'Erro ao enviar.');
              } catch (err) {
                alert(err.message);
              }
            }} className="secretary-guardians-form">
              <label><span>Assunto da mensagem *</span><input type="text" value={formMensagem.assunto} onChange={(event) => setFormMensagem({ ...formMensagem, assunto: event.target.value })} required /></label>
              <label><span>Conteúdo da mensagem *</span><textarea rows="5" value={formMensagem.mensagem} onChange={(event) => setFormMensagem({ ...formMensagem, mensagem: event.target.value })} required /></label>
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
          <section className="secretary-guardians-modal" role="dialog" aria-modal="true" aria-labelledby="direcao-guardians-email-title" onClick={(event) => event.stopPropagation()}>
            <header className="secretary-guardians-modal-header">
              <div>
                <span className="secretary-guardians-eyebrow">Comunicação individual</span>
                <h2 id="direcao-guardians-email-title">Enviar email</h2>
              </div>
              <button type="button" className="secretary-guardians-close" onClick={() => setModalEmailOpen(false)} aria-label="Fechar"><BsX aria-hidden="true" /></button>
            </header>
            <form onSubmit={async (event) => {
              event.preventDefault();
              try {
                const res = await fetch(`${API_URL}/v1/alunos/escolas/enviar-email-individual`, {
                  credentials: 'include', method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ escola_id: selectedEscolaId, destinatario: destinatarioEmail, ...formEmailIndividual })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                  alert(data.message);
                  setModalEmailOpen(false);
                  setFormEmailIndividual({ assunto: '', mensagem: '' });
                } else throw new Error(data.message || 'Erro ao enviar email.');
              } catch (err) {
                alert(err.message);
              }
            }} className="secretary-guardians-form">
              <label><span>Destinatário</span><input type="text" value={destinatarioEmail} disabled /></label>
              <label><span>Assunto *</span><input type="text" value={formEmailIndividual.assunto} onChange={(event) => setFormEmailIndividual({ ...formEmailIndividual, assunto: event.target.value })} required /></label>
              <label><span>Mensagem *</span><textarea rows="4" value={formEmailIndividual.mensagem} onChange={(event) => setFormEmailIndividual({ ...formEmailIndividual, mensagem: event.target.value })} required /></label>
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