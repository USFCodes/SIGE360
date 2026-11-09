'use client';

import React, { useEffect, useState } from 'react';
import { BsArrowRight, BsBuilding, BsClock, BsGrid3X3, BsPencilSquare, BsPlusLg, BsPrinter, BsSearch, BsTrash } from 'react-icons/bs';
import '../../../../styles/s2.css';
import AdminHeader from '@/components/adminHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_V1 = `${API_BASE}/api/v1`;
const API_AUTH = `${API_V1}/auth`;
const API_ESCOLAS = `${API_V1}/escolas`;
const API_SECRETARIA = `${API_V1}/secretaria`;

const DIAS_SEMANA = [
  'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'
];

export default function GestaoHorariosPage() {
  const [escolas, setEscolas] = useState([]);
  const [selectedEscolaId, setSelectedEscolaId] = useState('');
  const [anosLetivos, setAnosLetivos] = useState([]);
  const [polos, setPolos] = useState([]);
  const [selectedAnoLetivoId, setSelectedAnoLetivoId] = useState('');
  const [selectedPoloId, setSelectedPoloId] = useState('');
  const [turmasDaEscola, setTurmasDaEscola] = useState([]);
  const [selectedClasse, setSelectedClasse] = useState(null);
  const [selectedTurmaAgenda, setSelectedTurmaAgenda] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [horarios, setHorarios] = useState([]);
  const [disciplinas, setDisciplinas] = useState([]);
  const [professores, setProfessores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalAgendaOpen, setModalAgendaOpen] = useState(false);
  const [modalFormOpen, setModalFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentHorarioId, setCurrentHorarioId] = useState(null);
  const [formHorario, setFormHorario] = useState({
    turma_id: '', dia_semana: 'Segunda-feira', hora_inicio: '08:00', hora_fim: '08:45', disciplina: '', professor: '',
    sala: ''
  });

  const carregarEscolas = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_AUTH}/me`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await res.json();
      const contaAtiva = data?.data?.conta_ativa;
      if (!res.ok || !data.success || !contaAtiva?.escola_id) {
        throw new Error(data.message || 'Não foi encontrada uma escola ativa.');
      }
      const escolaId = contaAtiva.escola_id;
      const [resAnos, resPolos] = await Promise.all([
        fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(escolaId)}/anos-letivos`, { credentials: 'include' }),
        fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(escolaId)}/polos`, { credentials: 'include' })
      ]);
      const [dadosAnos, dadosPolos] = await Promise.all([resAnos.json(), resPolos.json()]);
      if (!resAnos.ok || !dadosAnos.success) throw new Error(dadosAnos.message || 'Não foi possível carregar os anos letivos.');
      if (!resPolos.ok || !dadosPolos.success) throw new Error(dadosPolos.message || 'Não foi possível carregar os ramos.');
      const listaAnos = Array.isArray(dadosAnos.dados) ? dadosAnos.dados : [];
      setEscolas([{ id: escolaId, nome: contaAtiva.escola_nome }]);
      setAnosLetivos(listaAnos);
      setPolos((Array.isArray(dadosPolos.data) ? dadosPolos.data : []).filter((polo) => polo.ativo));
      setSelectedAnoLetivoId(
        listaAnos.find((ano) => ano.ativo)?.ano_letivo_id
        || listaAnos.find((ano) => ano.ativo)?.id
        || listaAnos[0]?.ano_letivo_id
        || listaAnos[0]?.id
        || ''
      );
      setSelectedPoloId('');
      setSelectedEscolaId(escolaId);
    } catch (err) {
      console.error('Erro ao carregar escolas:', err);
      setError(err.message || 'Erro ao carregar escola.');
    } finally {
      setLoading(false);
    }
  };

  const carregarDadosEscola = async (escolaId, anoLetivoId, poloId) => {
    try {
      setLoading(true);
      setError('');
      const filtros = new URLSearchParams({ ano_letivo_id: anoLetivoId });
      if (poloId) filtros.set('polo_id', poloId);
      const [resTurmas, resHorarios, resDisciplinas, resFuncionarios] = await Promise.all([
        fetch(`${API_ESCOLAS}/${encodeURIComponent(escolaId)}/turmas?${filtros}`, { credentials: 'include' }),
        fetch(`${API_SECRETARIA}/escolas/${encodeURIComponent(escolaId)}/horarios?${filtros}`, { credentials: 'include' }),
        fetch(`${API_ESCOLAS}/disciplinas`, { credentials: 'include' }),
        fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(escolaId)}/funcionarios`, { credentials: 'include' })
      ]);
      const dataTurmas = await resTurmas.json();
      const dataHorarios = await resHorarios.json();
      const dataDisciplinas = await resDisciplinas.json();
      const dataFuncionarios = await resFuncionarios.json();
      if (!resTurmas.ok || !dataTurmas.success) throw new Error(dataTurmas.message || 'Não foi possível carregar as turmas.');
      if (!resHorarios.ok || !dataHorarios.success) throw new Error(dataHorarios.message || 'Não foi possível carregar os horários.');

      const listaTurmas = Array.isArray(dataTurmas.data) ? dataTurmas.data : [];
      const listaHorarios = Array.isArray(dataHorarios.dados) ? dataHorarios.dados : [];
      setTurmasDaEscola(listaTurmas);
      setHorarios(listaHorarios);
      setDisciplinas(Array.isArray(dataDisciplinas.data) ? dataDisciplinas.data : []);
      setProfessores((Array.isArray(dataFuncionarios.data) ? dataFuncionarios.data : []).filter((funcionario) => String(funcionario.papel).toLowerCase() === 'professor'));

      const classesUnicas = Array.from(new Set(listaTurmas.map((turma) => turma.classe?.trim()).filter(Boolean))).sort();
      setSelectedClasse((atual) => classesUnicas.includes(atual) ? atual : (classesUnicas[0] || null));
      setSelectedTurmaAgenda((atual) => atual && listaTurmas.some((turma) => turma.id === atual.id) ? atual : null);
      setModalAgendaOpen(false);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
      setError(err.message || 'Erro ao carregar dados da escola.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(carregarEscolas);
  }, []);

  useEffect(() => {
    if (selectedEscolaId && selectedAnoLetivoId) {
      void Promise.resolve().then(() => carregarDadosEscola(selectedEscolaId, selectedAnoLetivoId, selectedPoloId));
    }
  }, [selectedEscolaId, selectedAnoLetivoId, selectedPoloId]);

  const classesDisponiveis = Array.from(new Set(
    (Array.isArray(turmasDaEscola) ? turmasDaEscola : []).map((turma) => turma.classe?.trim()).filter(Boolean)
  )).sort();

  const turmasDaClasseSelecionada = (Array.isArray(turmasDaEscola) ? turmasDaEscola : []).filter((turma) => {
    const matchClasse = !selectedClasse || turma.classe?.trim() === selectedClasse;
    const nome = (turma.nome_turma || turma.nome || '').toLowerCase();
    return matchClasse && nome.includes(searchTerm.toLowerCase());
  });

  const handleOpenNovaModal = (turmaId) => {
    setIsEditing(false);
    setCurrentHorarioId(null);
    const turmaObj = turmasDaEscola.find((turma) => String(turma.id) === String(turmaId));
    setFormHorario({
      turma_id: turmaId,
      dia_semana: 'Segunda-feira',
      hora_inicio: '08:00',
      hora_fim: '08:45',
      disciplina: '',
      professor: professores.length === 1 ? professores[0].nome : '',
      sala: turmaObj?.sala || 'Sala 01'
    });
    setModalFormOpen(true);
  };

  const handleSaveHorario = async (event) => {
    event.preventDefault();
    if (!formHorario.turma_id || !formHorario.disciplina || !formHorario.hora_inicio || !formHorario.hora_fim) {
      alert('Preencha os campos obrigatórios.');
      return;
    }
    try {
      const endpoint = isEditing ? `${API_SECRETARIA}/horarios/${currentHorarioId}` : `${API_SECRETARIA}/escolas/${selectedEscolaId}/horarios`;
      const method = isEditing ? 'PUT' : 'POST';
      const res = await fetch(endpoint, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formHorario)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        alert(isEditing ? 'Horário atualizado com sucesso!' : 'Bloco de horário criado com sucesso!');
        setModalFormOpen(false);
        carregarDadosEscola(selectedEscolaId, selectedAnoLetivoId, selectedPoloId);
      } else {
        alert(data.message || 'Erro ao guardar horário.');
      }
    } catch (err) {
      alert('Erro de conexão.');
    }
  };

  const handleDeleteHorario = async (id) => {
    if (!confirm('Deseja eliminar este bloco?')) return;
    try {
      const res = await fetch(`${API_SECRETARIA}/horarios/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        carregarDadosEscola(selectedEscolaId, selectedAnoLetivoId, selectedPoloId);
      } else {
        alert('Erro ao eliminar.');
      }
    } catch (err) {
      alert('Erro de conexão.');
    }
  };

  const horariosDaTurma = selectedTurmaAgenda
    ? horarios.filter((horario) => String(horario.turma_id) === String(selectedTurmaAgenda.id))
    : [];
  const totalAulas = horarios.length;

  return (
    <>

      <AdminHeader titulo="Turmas e horários" descricao="Gerencie as turmas e seus horários letivos." ><span className="secretary-classes-school">
          <BsBuilding aria-hidden="true" />
          {escolas[0]?.nome || 'Escola ativa'}
        </span></AdminHeader>

      <main className="sec-classes-page">
      {error && <div className="secretary-classes-alert" role="alert">{error}</div>}

      <section className="secretary-classes-filters" aria-label="Filtros de turmas">
        <label className="secretary-classes-filter">
          <span>Ano letivo</span>
          <select value={selectedAnoLetivoId} onChange={(event) => setSelectedAnoLetivoId(event.target.value)} disabled={anosLetivos.length === 0}>
            {anosLetivos.length === 0
              ? <option value="">Sem anos letivos</option>
              : anosLetivos.map((ano) => (
                <option key={ano.ano_letivo_id || ano.id} value={ano.ano_letivo_id || ano.id}>
                  {ano.ano_nome}{ano.ativo ? ' (Atual)' : ''}
                </option>
              ))}
          </select>
        </label>
        <label className="secretary-classes-filter">
          <span>Ramo / polo</span>
          <select value={selectedPoloId} onChange={(event) => setSelectedPoloId(event.target.value)}>
            <option value="">Todos os ramos</option>
            {polos.map((polo) => <option key={polo.id} value={polo.id}>{polo.nome}</option>)}
          </select>
        </label>
        <label className="secretary-classes-search">
          <span>Pesquisar turma</span>
          <span className="secretary-classes-search-input">
            <BsSearch aria-hidden="true" />
            <input
              type="search"
              placeholder="Digite o nome da turma..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              aria-label="Pesquisar turmas"
            />
          </span>
        </label>
      </section>

      <div className="secretary-classes-layout">
        <aside className="secretary-classes-sidebar">
          <header className="secretary-classes-sidebar-header">
            <div>
              <span className="secretary-classes-eyebrow">Níveis escolares</span>
              <h2>Classes</h2>
            </div>
            <span className="secretary-classes-count">{classesDisponiveis.length}</span>
          </header>
          <p className="secretary-classes-context">
            {anosLetivos.find((ano) => (ano.ano_letivo_id || ano.id) === selectedAnoLetivoId)?.ano_nome || 'Selecione um ano letivo'}
            {selectedPoloId ? ` · ${polos.find((polo) => polo.id === selectedPoloId)?.nome || ''}` : ' · Todos os ramos'}
          </p>
          <div className="secretary-classes-list">
            {loading ? (
              <p className="secretary-classes-empty" role="status">A carregar classes...</p>
            ) : classesDisponiveis.length > 0 ? (
              classesDisponiveis.map((classe) => {
                const isSelected = selectedClasse === classe;
                const totalTurmas = turmasDaEscola.filter((turma) => turma.classe?.trim() === classe).length;
                return (
                  <button
                    type="button"
                    key={classe}
                    onClick={() => setSelectedClasse(classe)}
                    className={`secretary-classes-item ${isSelected ? 'selected' : ''}`}
                    aria-pressed={isSelected}
                  >
                    <span><strong>{classe}</strong><small>{totalTurmas} turma(s)</small></span>
                    <BsArrowRight aria-hidden="true" />
                  </button>
                );
              })
            ) : (
              <p className="secretary-classes-empty">Nenhuma classe encontrada.</p>
            )}
          </div>
        </aside>

        <main className="secretary-classes-panel">
          <header className="secretary-classes-panel-header">
            <div>
              <span className="secretary-classes-eyebrow">Horários por classe</span>
              <h2>{selectedClasse ? `Turmas da classe ${selectedClasse}` : 'Selecione uma classe'}</h2>
              <p>Abra a agenda de uma turma para consultar ou editar os tempos letivos.</p>
            </div>
            {selectedClasse && <span className="secretary-classes-count">{turmasDaClasseSelecionada.length} turma(s)</span>}
          </header>

          {loading ? (
            <div className="secretary-classes-empty" role="status">A carregar turmas e horários...</div>
          ) : selectedClasse ? (
            turmasDaClasseSelecionada.length > 0 ? (
              <div className="secretary-classes-grid">
                {turmasDaClasseSelecionada.map((turma) => {
                  const totalAulasTurma = horarios.filter((horario) => String(horario.turma_id) === String(turma.id)).length;
                  return (
                    <article key={turma.id} className="secretary-classes-card">
                      <div className="secretary-classes-card-top">
                        <span className="secretary-classes-shift">{turma.turno || 'Manhã'}</span>
                        <span className="secretary-classes-lesson-count"><BsClock aria-hidden="true" /> {totalAulasTurma} aulas</span>
                      </div>
                      <div className="secretary-classes-card-info">
                        <h3>{turma.nome_turma || turma.nome}</h3>
                        <p><BsBuilding aria-hidden="true" /> Sala: <strong>{turma.sala || 'Não atribuída'}</strong></p>
                        {turma.polo_nome && <p className="secretary-classes-card-branch">Ramo: <strong>{turma.polo_nome}</strong></p>}
                      </div>
                      <button
                        type="button"
                        className="secretary-classes-open-agenda"
                        onClick={() => {
                          setSelectedTurmaAgenda(turma);
                          setModalAgendaOpen(true);
                        }}
                      >
                        <BsGrid3X3 aria-hidden="true" /> Ver agenda
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="secretary-classes-empty">
                <strong>Nenhuma turma nesta classe</strong>
                <span>Altere o polo ou a pesquisa para ver outros resultados.</span>
              </div>
            )
          ) : (
            <div className="secretary-classes-empty">
              <strong>Escolha uma classe</strong>
              <span>Selecione uma classe no painel lateral para consultar as turmas.</span>
            </div>
          )}
        </main>
      </div>

      {modalAgendaOpen && selectedTurmaAgenda && (
        <div className="secretary-classes-modal-backdrop" onClick={() => setModalAgendaOpen(false)}>
          <section
            className="secretary-classes-modal secretary-classes-agenda-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="secretary-classes-agenda-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="secretary-classes-modal-header no-print">
              <div>
                <span className="secretary-classes-eyebrow">Agenda da turma</span>
                <h2 id="secretary-classes-agenda-title">{selectedTurmaAgenda.nome_turma || selectedTurmaAgenda.nome}</h2>
                <p>{selectedTurmaAgenda.classe} · Sala: {selectedTurmaAgenda.sala || 'N/A'}</p>
              </div>
              <div className="secretary-classes-modal-actions">
                <button type="button" className="secretary-classes-secondary" onClick={() => window.print()}>
                  <BsPrinter aria-hidden="true" /> Imprimir horário
                </button>
                <button type="button" className="secretary-classes-close" onClick={() => setModalAgendaOpen(false)} aria-label="Fechar agenda">×</button>
              </div>
            </header>

            <div className="secretary-classes-print-heading only-print">
              <h1>Horário escolar</h1>
              <p>Turma: {selectedTurmaAgenda.nome_turma || selectedTurmaAgenda.nome} | Classe: {selectedTurmaAgenda.classe} | Sala: {selectedTurmaAgenda.sala || 'N/A'}</p>
            </div>

            <div className="secretary-classes-modal-content">
              {horariosDaTurma.length > 0 ? (
                <div className="secretary-classes-table-scroll">
                  <table className="secretary-classes-table">
                    <thead>
                      <tr><th>Dia</th><th>Horário</th><th>Disciplina</th><th>Professor</th><th>Sala</th><th className="no-print">Ações</th></tr>
                    </thead>
                    <tbody>
                      {[...horariosDaTurma]
                        .sort((a, b) => a.dia_semana.localeCompare(b.dia_semana) || a.hora_inicio.localeCompare(b.hora_inicio))
                        .map((horario) => (
                          <tr key={horario.id}>
                            <td><span className="secretary-classes-day">{horario.dia_semana}</span></td>
                            <td className="secretary-classes-time"><BsClock aria-hidden="true" /> {horario.hora_inicio} - {horario.hora_fim}</td>
                            <td><strong>{horario.disciplina}</strong></td>
                            <td>{horario.professor || 'Não atribuído'}</td>
                            <td>{horario.sala || selectedTurmaAgenda.sala || 'N/A'}</td>
                            <td className="no-print">
                              <div className="secretary-classes-row-actions">
                                <button
                                  type="button"
                                  className="secretary-classes-row-action"
                                  onClick={() => {
                                    setIsEditing(true);
                                    setCurrentHorarioId(horario.id);
                                    setFormHorario({
                                      turma_id: horario.turma_id,
                                      dia_semana: horario.dia_semana,
                                      hora_inicio: horario.hora_inicio,
                                      hora_fim: horario.hora_fim,
                                      disciplina: horario.disciplina,
                                      professor: horario.professor || '',
                                      sala: horario.sala || selectedTurmaAgenda.sala || ''
                                    });
                                    setModalAgendaOpen(false);
                                    setModalFormOpen(true);
                                  }}
                                  title="Editar"
                                  aria-label="Editar horário"
                                >
                                  <BsPencilSquare aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="secretary-classes-row-action is-delete"
                                  onClick={() => handleDeleteHorario(horario.id)}
                                  title="Eliminar"
                                  aria-label="Eliminar horário"
                                >
                                  <BsTrash aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="secretary-classes-empty">
                  <strong>Nenhum horário registado</strong>
                  <span>Adicione um bloco para começar a organizar esta turma.</span>
                </div>
              )}
            </div>

            <footer className="secretary-classes-modal-footer no-print">
              <button type="button" className="secretary-classes-primary" onClick={() => {
                setModalAgendaOpen(false);
                handleOpenNovaModal(selectedTurmaAgenda.id);
              }}>
                <BsPlusLg aria-hidden="true" /> Adicionar bloco de aula
              </button>
            </footer>
          </section>
        </div>
      )}

      {modalFormOpen && (
        <div className="secretary-classes-modal-backdrop" onClick={() => setModalFormOpen(false)}>
          <section
            className="secretary-classes-modal secretary-classes-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="secretary-classes-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="secretary-classes-modal-header">
              <div>
                <span className="secretary-classes-eyebrow">Gestão de horário</span>
                <h2 id="secretary-classes-form-title">{isEditing ? 'Editar bloco' : 'Adicionar tempo letivo'}</h2>
              </div>
              <button type="button" className="secretary-classes-close" onClick={() => setModalFormOpen(false)} aria-label="Fechar formulário">×</button>
            </header>

            <form onSubmit={handleSaveHorario} className="secretary-classes-form">
              <label>
                <span>Dia da semana *</span>
                <select value={formHorario.dia_semana} onChange={(event) => setFormHorario({ ...formHorario, dia_semana: event.target.value })} required>
                  {DIAS_SEMANA.map((dia) => <option key={dia} value={dia}>{dia}</option>)}
                </select>
              </label>
              <div className="secretary-classes-time-fields">
                <label>
                  <span>Início *</span>
                  <input type="time" value={formHorario.hora_inicio} onChange={(event) => setFormHorario({ ...formHorario, hora_inicio: event.target.value })} required />
                </label>
                <label>
                  <span>Fim *</span>
                  <input type="time" value={formHorario.hora_fim} onChange={(event) => setFormHorario({ ...formHorario, hora_fim: event.target.value })} required />
                </label>
              </div>
              <label>
                <span>Disciplina *</span>
                <select value={formHorario.disciplina} onChange={(event) => setFormHorario({ ...formHorario, disciplina: event.target.value })} required>
                  <option value="">Selecionar disciplina</option>
                  {disciplinas.map((disciplina) => <option key={disciplina.id} value={disciplina.nome}>{disciplina.nome}</option>)}
                </select>
              </label>
              <label>
                <span>Professor</span>
                {professores.length === 1 ? (
                  <input type="text" value={professores[0].nome} disabled />
                ) : (
                  <select value={formHorario.professor} onChange={(event) => setFormHorario({ ...formHorario, professor: event.target.value })}>
                    <option value="">Selecionar professor</option>
                    {professores.map((professor) => <option key={professor.id} value={professor.nome}>{professor.nome}</option>)}
                  </select>
                )}
              </label>
              <label>
                <span>Sala</span>
                <input type="text" value={formHorario.sala} onChange={(event) => setFormHorario({ ...formHorario, sala: event.target.value })} placeholder="Ex: Sala 01" />
              </label>
              <footer className="secretary-classes-modal-actions">
                <button type="button" className="secretary-classes-secondary" onClick={() => setModalFormOpen(false)}>Cancelar</button>
                <button type="submit" className="secretary-classes-primary">{isEditing ? 'Guardar alterações' : 'Confirmar bloco'}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
    </>
  );
}
