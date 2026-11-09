'use client';

import AdminHeader from '@/components/adminHeader';
import React, { useState, useEffect } from 'react';
import { BsSearch, BsEye, BsPrinter, BsX} from 'react-icons/bs';
import '../../../../styles/s2.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_V1 = `${API_BASE}/api/v1`;
const API_AUTH = `${API_V1}/auth`;
const API_PROFESSORES = `${API_V1}/professores`;

export default function GestaoProfessoresSecretariaPage() {
  const [escolas, setEscolas] = useState([]);
  const [selectedEscolaId, setSelectedEscolaId] = useState('');
  const [professores, setProfessores] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Professor Selecionado (Painel Lateral Direito)
  const [professorAtivo, setProfessorAtivo] = useState(null);
  const [turmasDoProfessor, setTurmasDoProfessor] = useState([]);
  const [horariosDoProfessor, setHorariosDoProfessor] = useState([]);
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);

  // Modal para ver e imprimir alunos de uma turma específica do professor
  const [turmaAlunosModal, setTurmaAlunosModal] = useState(null);
  const [alunosDaTurma, setAlunosDaTurma] = useState([]);
  const [loadingAlunos, setLoadingAlunos] = useState(false);

  const carregarEscolaAtiva = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_AUTH}/me`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      const contaAtiva = data?.data?.conta_ativa;
      if (!res.ok || !data.success || !contaAtiva?.escola_id) {
        throw new Error(data.message || 'Não foi encontrada uma escola ativa para esta sessão.');
      }
      setEscolas([{ id: contaAtiva.escola_id, nome: contaAtiva.escola_nome }]);
      setSelectedEscolaId(contaAtiva.escola_id);
    } catch (err) {
      console.error('Erro ao carregar escola:', err);
      setError(err.message || 'Erro ao carregar sessão.');
    } finally {
      setLoading(false);
    }
  };

  const carregarProfessores = async (escolaId) => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_PROFESSORES}/${encodeURIComponent(escolaId)}/professores-detalhes`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || `Não foi possível carregar professores (HTTP ${res.status}).`);
      }
      setProfessores(Array.isArray(data.dados) ? data.dados : []);
    } catch (err) {
      console.error('Erro ao carregar professores:', err);
      setProfessores([]);
      setError(err.message || 'Erro ao carregar lista de professores.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelecionarProfessor = async (prof) => {
    setProfessorAtivo(prof);
    setTurmasDoProfessor([]);
    setHorariosDoProfessor([]);
    setError('');
    try {
      setLoadingDetalhes(true);
      const res = await fetch(`${API_PROFESSORES}/${encodeURIComponent(prof.funcionario_id)}/turmas-horarios`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || `Não foi possível carregar os detalhes (HTTP ${res.status}).`);
      }
      setTurmasDoProfessor(Array.isArray(data.turmas) ? data.turmas : []);
      setHorariosDoProfessor(Array.isArray(data.horarios) ? data.horarios : []);
    } catch (err) {
      console.error('Erro ao carregar turmas do professor:', err);
      setError(err.message || 'Erro ao carregar turmas e horários do professor.');
    } finally {
      setLoadingDetalhes(false);
    }
  };

  const handleVerAlunosTurma = async (turma) => {
    setTurmaAlunosModal(turma);
    setAlunosDaTurma([]);
    setError('');
    try {
      setLoadingAlunos(true);
      const res = await fetch(`${API_PROFESSORES}/${encodeURIComponent(turma.turma_id)}/alunos`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || `Não foi possível carregar os alunos (HTTP ${res.status}).`);
      }
      setAlunosDaTurma(Array.isArray(data.dados) ? data.dados : []);
    } catch (err) {
      console.error('Erro ao carregar alunos da turma:', err);
      setAlunosDaTurma([]);
      setError(err.message || 'Erro ao carregar alunos da turma.');
    } finally {
      setLoadingAlunos(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void carregarEscolaAtiva(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!selectedEscolaId) return;
    const timer = window.setTimeout(() => void carregarProfessores(selectedEscolaId), 0);
    return () => window.clearTimeout(timer);
  }, [selectedEscolaId]);

  const professoresFiltrados = professores.filter(p => {
    const nomeCompleto = `${p.nome || ''} ${p.apelido || ''}`.toLowerCase();
    const turmaDir = (p.turma_diretor_nome || '').toLowerCase();
    const termo = searchTerm.toLowerCase();
    return nomeCompleto.includes(termo) || turmaDir.includes(termo);
  });

  const professoresAtivos = professores.filter((professor) => professor.estado === 'Ativo').length;
  const professoresDiretores = professores.filter((professor) => Boolean(professor.turma_diretor_nome)).length;

  return (
    <div className="sec-professores-page">
      <AdminHeader titulo="Gestão de Professores" descricao="Consulte a equipa docente, turmas atribuídas, horários e pautas de alunos" />
      <section className="secretary-teachers-toolbar">
        <label className="secretary-teachers-search">
          <BsSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquisar por nome ou turma de direção..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            aria-label="Pesquisar professores"
          />
        </label>
      </section>

      {error && <div className="secretary-teachers-alert" role="alert">{error}</div>}

      <section className="secretary-teachers-overview" aria-label="Resumo dos professores">
        <article className="secretary-teachers-stat">
          <span className="secretary-teachers-stat-label">Professores</span>
          <strong>{professores.length}</strong>
          <span className="secretary-teachers-stat-note">Na equipa docente</span>
        </article>
        <article className="secretary-teachers-stat">
          <span className="secretary-teachers-stat-label">Ativos</span>
          <strong>{professoresAtivos}</strong>
          <span className="secretary-teachers-stat-note">Com acesso ativo</span>
        </article>
        <article className="secretary-teachers-stat">
          <span className="secretary-teachers-stat-label">Diretores de turma</span>
          <strong>{professoresDiretores}</strong>
          <span className="secretary-teachers-stat-note">Turmas atribuídas</span>
        </article>
      </section>

      <div className={`secretary-teachers-layout ${professorAtivo ? 'has-selection' : ''}`}>
        <main className="secretary-teachers-panel">
          <header className="secretary-teachers-panel-header">
            <div>
              <span className="secretary-teachers-eyebrow">Equipa escolar</span>
              <h2>Professores</h2>
            </div>
            <span className="secretary-teachers-count">{professoresFiltrados.length} encontrados</span>
          </header>

          <div className="secretary-teachers-table-scroll">
            {loading ? (
              <div className="secretary-teachers-empty" role="status">A carregar professores...</div>
            ) : professoresFiltrados.length > 0 ? (
              <table className="secretary-teachers-table">
                <thead>
                  <tr>
                    <th>Professor</th>
                    <th>Direção de turma</th>
                    <th>Contacto</th>
                    <th>Estado</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {professoresFiltrados.map((prof) => {
                    const nomeCompleto = `${prof.nome || ''} ${prof.apelido || ''}`.trim();
                    const isActive = professorAtivo?.funcionario_id === prof.funcionario_id;
                    return (
                      <tr key={prof.funcionario_id} className={isActive ? 'selected' : ''}>
                        <td>
                          <button
                            type="button"
                            className="secretary-teachers-person"
                            onClick={() => handleSelecionarProfessor(prof)}
                            aria-pressed={isActive}
                          >
                            {prof.foto_url ? (
                              <img src={prof.foto_url} alt="" className="secretary-teachers-avatar" />
                            ) : (
                              <span className="secretary-teachers-avatar secretary-teachers-avatar-fallback" aria-hidden="true">
                                {nomeCompleto.substring(0, 2).toUpperCase() || 'PR'}
                              </span>
                            )}
                            <span className="secretary-teachers-person-copy">
                              <strong>{nomeCompleto}</strong>
                              <span>{prof.email || 'Sem email'}</span>
                            </span>
                          </button>
                        </td>
                        <td>
                          {prof.turma_diretor_nome
                            ? <span className="secretary-teachers-class-badge">{prof.turma_diretor_nome}</span>
                            : <span className="secretary-teachers-muted">Não atribuído</span>}
                        </td>
                        <td>{prof.telefone || 'N/A'}</td>
                        <td>
                          <span className={`secretary-teachers-status ${prof.estado === 'Ativo' ? 'active' : 'inactive'}`}>
                            {prof.estado || 'Indisponível'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secretary-teachers-view"
                            onClick={() => handleSelecionarProfessor(prof)}
                            aria-label={`Ver perfil de ${nomeCompleto}`}
                          >
                            <BsEye aria-hidden="true" /> Perfil
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="secretary-teachers-empty">
                <strong>Nenhum professor encontrado</strong>
                <span>Experimente alterar os termos da pesquisa.</span>
              </div>
            )}
          </div>
        </main>

        {professorAtivo && (
          <aside className="secretary-teachers-details">
            <header className="secretary-teachers-details-header">
              <div>
                <span className="secretary-teachers-eyebrow">Perfil docente</span>
                <h2>{professorAtivo.nome} {professorAtivo.apelido}</h2>
              </div>
              <button
                type="button"
                className="secretary-teachers-close"
                onClick={() => setProfessorAtivo(null)}
                aria-label="Fechar perfil do professor"
              >
                <BsX aria-hidden="true" />
              </button>
            </header>

            {loadingDetalhes ? (
              <div className="secretary-teachers-empty" role="status">A carregar turmas e horários...</div>
            ) : (
              <div className="secretary-teachers-details-content">
                <section className="secretary-teachers-section">
                  <div className="secretary-teachers-section-heading">
                    <h3>Turmas associadas</h3>
                    <span>{turmasDoProfessor.length}</span>
                  </div>
                  {turmasDoProfessor.length > 0 ? (
                    <div className="secretary-teachers-list">
                      {turmasDoProfessor.map((turma) => (
                        <button
                          type="button"
                          key={turma.turma_id}
                          onClick={() => handleVerAlunosTurma(turma)}
                          className="secretary-teachers-class-card"
                        >
                          <span>
                            <strong>{turma.nome_turma}</strong>
                            <small>{turma.classe} · Sala: {turma.sala || 'N/A'}</small>
                          </span>
                          <span className="secretary-teachers-class-link">Ver alunos <BsEye aria-hidden="true" /></span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="secretary-teachers-hint">Nenhuma turma associada a este professor.</p>
                  )}
                </section>

                <section className="secretary-teachers-section">
                  <div className="secretary-teachers-section-heading">
                    <h3>Grelha horária</h3>
                    <span>{horariosDoProfessor.length}</span>
                  </div>
                  {horariosDoProfessor.length > 0 ? (
                    <div className="secretary-teachers-list">
                      {horariosDoProfessor.map((horario) => (
                        <article key={horario.id} className="secretary-teachers-schedule-card">
                          <div>
                            <strong>{horario.dia_semana}</strong>
                            <span>{horario.hora_inicio} - {horario.hora_fim}</span>
                          </div>
                          <p><strong>{horario.disciplina}</strong> · {horario.nome_turma}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="secretary-teachers-hint">Sem horários registados.</p>
                  )}
                </section>
              </div>
            )}
          </aside>
        )}
      </div>

      {turmaAlunosModal && (
        <div className="secretary-teachers-modal-backdrop" onClick={() => setTurmaAlunosModal(null)}>
          <section
            className="secretary-teachers-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="secretary-teachers-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="secretary-teachers-modal-header no-print">
              <div>
                <span className="secretary-teachers-eyebrow">Turma {turmaAlunosModal.classe}</span>
                <h2 id="secretary-teachers-modal-title">Lista de alunos</h2>
                <p>{turmaAlunosModal.nome_turma} · Professor: {professorAtivo?.nome} {professorAtivo?.apelido}</p>
              </div>
              <div className="secretary-teachers-modal-actions">
                <button type="button" className="secretary-teachers-print" onClick={handlePrint}>
                  <BsPrinter aria-hidden="true" /> Imprimir lista
                </button>
                <button type="button" className="secretary-teachers-close" onClick={() => setTurmaAlunosModal(null)} aria-label="Fechar lista">
                  <BsX aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="secretary-teachers-print-heading only-print">
              <h1>Lista de alunos da turma</h1>
              <p>Turma: {turmaAlunosModal.nome_turma} | Classe: {turmaAlunosModal.classe} | Docente: {professorAtivo?.nome} {professorAtivo?.apelido}</p>
            </div>

            <div className="secretary-teachers-modal-content">
              {loadingAlunos ? (
                <div className="secretary-teachers-empty" role="status">A carregar alunos...</div>
              ) : alunosDaTurma.length > 0 ? (
                <div className="secretary-teachers-table-scroll">
                  <table className="secretary-teachers-table secretary-teachers-students-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Nome do aluno</th>
                        <th>Matrícula / ID</th>
                        <th>Encarregado</th>
                        <th>Contacto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alunosDaTurma.map((aluno, index) => (
                        <tr key={aluno.aluno_id}>
                          <td>{index + 1}</td>
                          <td><strong>{aluno.nome} {aluno.apelido}</strong></td>
                          <td><code>{aluno.numero_matricula}</code></td>
                          <td>{aluno.encarregado_nome || 'N/A'}</td>
                          <td>{aluno.encarregado_telefone || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="secretary-teachers-empty">Nenhum aluno matriculado nesta turma.</div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}