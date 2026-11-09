'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BsAward,
  BsCalendar3,
  BsCheck2Circle,
  BsClockHistory,
  BsEnvelope,
  BsExclamationCircle,
  BsGeoAlt,
  BsHouse,
  BsJournalCheck,
  BsPersonVcard,
  BsPrinter,
  BsSearch,
  BsTelephone,
  BsPeople,
  BsBook
} from 'react-icons/bs';
import { useTeacherPageHeader } from '@/components/teacher-dashboard-shell';
import '@/styles/dir-turma.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_PROFESSORES = `${API_BASE}/api/v1/professores`;

function valorTexto(valor, vazio = 'Não registado') {
  return valor === null || valor === undefined || valor === '' ? vazio : String(valor);
}

function formatarData(valor) {
  if (!valor) return 'Não registada';
  const data = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
  return Number.isNaN(data.getTime()) ? String(valor) : new Intl.DateTimeFormat('pt-PT').format(data);
}

function nomeAluno(aluno) {
  return `${aluno.nome || ''} ${aluno.apelido || ''}`.trim() || 'Aluno sem nome';
}

function resumoPresencas(registos = []) {
  return registos.reduce((resumo, registo) => {
    const estado = (registo.estado || '').toLocaleLowerCase();
    if (estado.includes('presen')) resumo.presencas += Number(registo.total) || 0;
    else if (estado.includes('falta') || estado.includes('ausen')) resumo.faltas += Number(registo.total) || 0;
    else resumo.outros += Number(registo.total) || 0;
    resumo.total += Number(registo.total) || 0;
    return resumo;
  }, { presencas: 0, faltas: 0, outros: 0, total: 0 });
}

function Campo({ label, value, icon: Icon }) {
  return (
    <div className="dt-field">
      <span className="dt-field-label">{Icon && <Icon aria-hidden="true" />} {label}</span>
      <strong>{valorTexto(value)}</strong>
    </div>
  );
}

export default function DossierDirecaoTurma() {
  const [turmas, setTurmas] = useState([]);
  const [turmaId, setTurmaId] = useState('');
  const [alunos, setAlunos] = useState([]);
  const [alunoId, setAlunoId] = useState('');
  const [pesquisa, setPesquisa] = useState('');
  const [separador, setSeparador] = useState('resumo');
  const [loadingTurmas, setLoadingTurmas] = useState(true);
  const [loadingAlunos, setLoadingAlunos] = useState(false);
  const [erro, setErro] = useState('');

  const turmaAtiva = turmas.find((turma) => turma.turma_id === turmaId) || null;
  const alunoAtivo = alunos.find((aluno) => aluno.aluno_id === alunoId) || null;

  const carregarTurmas = async (signal) => {
    setLoadingTurmas(true);
    setErro('');
    try {
      const resposta = await fetch(`${API_PROFESSORES}/meu-painel/turmas`, {
        credentials: 'include',
        cache: 'no-store',
        signal
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok || dados.success !== true) {
        throw new Error(dados.message || `Não foi possível carregar as turmas (HTTP ${resposta.status}).`);
      }
      const lista = Array.isArray(dados.turmasDiretor) ? dados.turmasDiretor : [];
      setTurmas(lista);
      setTurmaId((atual) => lista.some((turma) => turma.turma_id === atual) ? atual : (lista[0]?.turma_id || ''));
    } catch (error) {
      if (error.name !== 'AbortError') {
        setTurmas([]);
        setErro(error.message || 'Não foi possível carregar as turmas atribuídas.');
      }
    } finally {
      if (!signal?.aborted) setLoadingTurmas(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void carregarTurmas(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!turmaId) return undefined;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingAlunos(true);
      setErro('');
      setPesquisa('');
      setSeparador('resumo');
      try {
        const resposta = await fetch(
          `${API_PROFESSORES}/turmas/${encodeURIComponent(turmaId)}/diretor-alunos-completo`,
          { credentials: 'include', cache: 'no-store', signal: controller.signal }
        );
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok || dados.success !== true) {
          throw new Error(dados.message || `Não foi possível carregar o dossier da turma (HTTP ${resposta.status}).`);
        }
        const lista = Array.isArray(dados.dados) ? dados.dados : [];
        setAlunos(lista);
        setAlunoId((atual) => lista.some((aluno) => aluno.aluno_id === atual) ? atual : (lista[0]?.aluno_id || ''));
      } catch (error) {
        if (error.name !== 'AbortError') {
          setAlunos([]);
          setAlunoId('');
          setErro(error.message || 'Não foi possível carregar os dossiers dos alunos.');
        }
      } finally {
        if (!controller.signal.aborted) setLoadingAlunos(false);
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [turmaId]);

  const alunosFiltrados = useMemo(() => {
    const termo = pesquisa.trim().toLocaleLowerCase();
    if (!termo) return alunos;
    return alunos.filter((aluno) => (
      `${nomeAluno(aluno)} ${aluno.numero_matricula || ''} ${aluno.encarregado_nome || ''} ${aluno.encarregado_telefone || ''}`
        .toLocaleLowerCase()
        .includes(termo)
    ));
  }, [alunos, pesquisa]);

  const totalAvaliacoes = alunos.reduce((total, aluno) => total + (aluno.notas?.length || 0), 0);
  const totalRegistosPresenca = alunos.reduce((total, aluno) => (
    total + (aluno.frequencia_resumo || []).reduce((subtotal, item) => subtotal + (Number(item.total) || 0), 0)
  ), 0);
  const totalEncarregados = alunos.filter((aluno) => aluno.encarregado_id).length;
  const presencasAtivas = alunoAtivo ? resumoPresencas(alunoAtivo.frequencia_resumo || []) : null;

  const imprimir = () => window.print();
  useTeacherPageHeader({
    title: 'ACOMPANHAMENTO DA TURMA',
    description: 'Alunos, percurso académico, família e assiduidade num só dossier.',
    actions: [{
      label: 'Imprimir turma',
      icon: <BsPrinter aria-hidden="true" />,
      disabled: !turmaAtiva || loadingAlunos,
      onClick: imprimir
    }]
  });

  return (
    <div className="admin-page-layout dt-page">
      {erro && <div className="dt-error" role="alert"><BsExclamationCircle aria-hidden="true" /> {erro}</div>}

      {loadingTurmas ? (
        <div className="dt-empty-state" role="status">A carregar as turmas atribuídas…</div>
      ) : turmas.length === 0 ? (
        <div className="dt-empty-state">
          <BsAward aria-hidden="true" />
          <h2>Sem turmas atribuídas</h2>
          <p>Quando a Direção atribuir uma turma ao seu perfil, os alunos aparecerão aqui.</p>
        </div>
      ) : (
        <>
          <section className="dt-class-bar" aria-label="Turmas atribuídas">
            <div className="dt-class-picker">
              <span className="dt-picker-label">A MINHA TURMA</span>
              <select
                value={turmaId}
                onChange={(event) => {
                  setAlunos([]);
                  setAlunoId('');
                  setTurmaId(event.target.value);
                }}
                aria-label="Selecionar turma"
              >
                {turmas.map((turma) => (
                  <option key={turma.turma_id} value={turma.turma_id}>
                    {turma.nome_turma} · {turma.classe || 'Classe não indicada'}
                  </option>
                ))}
              </select>
            </div>
            {turmaAtiva && (
              <div className="dt-class-meta">
                <span>{turmaAtiva.turno || 'Turno não indicado'}</span>
                <span>{turmaAtiva.sala || 'Sala não indicada'}</span>
                <span>{turmaAtiva.classe || 'Classe não indicada'}</span>
              </div>
            )}
          </section>

          <section className="dt-metrics" aria-label="Resumo da turma">
            <div className="dt-metric dt-metric-primary"><span>Alunos matriculados</span><strong>{alunos.length}</strong><BsPeople aria-hidden="true" /></div>
            <div className="dt-metric"><span>Encarregados ligados</span><strong>{totalEncarregados}</strong><BsPersonVcard aria-hidden="true" /></div>
            <div className="dt-metric"><span>Avaliações registadas</span><strong>{totalAvaliacoes}</strong><BsJournalCheck aria-hidden="true" /></div>
            <div className="dt-metric"><span>Registos de presença</span><strong>{totalRegistosPresenca}</strong><BsClockHistory aria-hidden="true" /></div>
          </section>

          <div className="dt-workspace">
            <section className="dt-roster" aria-label="Lista de alunos">
              <div className="dt-section-heading">
                <div>
                  <span className="dt-eyebrow">TURMA ATUAL</span>
                  <h2>{turmaAtiva?.nome_turma || 'Alunos'}</h2>
                </div>
                <span className="dt-count">{alunosFiltrados.length} / {alunos.length}</span>
              </div>
              <label className="dt-search">
                <BsSearch aria-hidden="true" />
                <input
                  type="search"
                  value={pesquisa}
                  onChange={(event) => setPesquisa(event.target.value)}
                  placeholder="Pesquisar aluno, matrícula ou encarregado"
                  aria-label="Pesquisar alunos"
                />
              </label>

              {loadingAlunos ? (
                <div className="dt-roster-loading" role="status">A carregar dossiers…</div>
              ) : alunosFiltrados.length === 0 ? (
                <div className="dt-roster-empty">{alunos.length ? 'Nenhum aluno corresponde à pesquisa.' : 'Ainda não há alunos matriculados nesta turma.'}</div>
              ) : (
                <div className="dt-student-list">
                  {alunosFiltrados.map((aluno) => (
                    <button
                      className={`dt-student-row${alunoId === aluno.aluno_id ? ' is-selected' : ''}`}
                      key={aluno.aluno_id}
                      type="button"
                      onClick={() => setAlunoId(aluno.aluno_id)}
                    >
                      <span className="dt-avatar">
                        {aluno.foto_url
                          ? <img src={aluno.foto_url} alt="" />
                          : nomeAluno(aluno).slice(0, 2).toLocaleUpperCase()}
                      </span>
                      <span className="dt-student-main">
                        <strong>{nomeAluno(aluno)}</strong>
                        <small>{valorTexto(aluno.numero_matricula, 'Sem número de matrícula')}</small>
                      </span>
                      <span className="dt-student-side">
                        <span>{aluno.encarregado_nome || 'Sem encarregado'}</span>
                        <small>{aluno.ano_nome || 'Ano letivo não indicado'}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <aside className="dt-dossier" aria-label="Ficha do aluno selecionado">
              {!alunoAtivo ? (
                <div className="dt-dossier-empty">
                  <BsPersonVcard aria-hidden="true" />
                  <p>Selecione um aluno para abrir o dossier completo.</p>
                </div>
              ) : (
                <>
                  <div className="dt-profile-head">
                    <span className="dt-avatar dt-avatar-large">
                      {alunoAtivo.foto_url
                        ? <img src={alunoAtivo.foto_url} alt="" />
                        : nomeAluno(alunoAtivo).slice(0, 2).toLocaleUpperCase()}
                    </span>
                    <div className="dt-profile-name">
                      <span className="dt-eyebrow">DOSSIER DO ALUNO</span>
                      <h2>{nomeAluno(alunoAtivo)}</h2>
                      <small>{valorTexto(alunoAtivo.numero_matricula, 'Sem matrícula')}</small>
                    </div>
                  </div>

                  <div className="dt-tabs" role="tablist" aria-label="Secções do dossier">
                    <button type="button" role="tab" aria-selected={separador === 'resumo'} onClick={() => setSeparador('resumo')}>Resumo</button>
                    <button type="button" role="tab" aria-selected={separador === 'academico'} onClick={() => setSeparador('academico')}>Académico</button>
                    <button type="button" role="tab" aria-selected={separador === 'familia'} onClick={() => setSeparador('familia')}>Família e dados</button>
                  </div>

                  <div className="dt-dossier-content">
                    {separador === 'resumo' && (
                      <div className="dt-tab-content">
                        <div className="dt-mini-metrics">
                          <div><span>Trimestres</span><strong>{alunoAtivo.notas?.length || 0}</strong></div>
                          <div><span>Presenças</span><strong>{presencasAtivas?.presencas || 0}</strong></div>
                          <div><span>Faltas</span><strong>{presencasAtivas?.faltas || 0}</strong></div>
                        </div>
                        <div className="dt-detail-section">
                          <h3><BsPersonVcard aria-hidden="true" /> Identificação</h3>
                          <div className="dt-fields-grid">
                            <Campo label="Data de nascimento" value={formatarData(alunoAtivo.data_nascimento)} icon={BsCalendar3} />
                            <Campo label="Género" value={alunoAtivo.genero} />
                            <Campo label="Nacionalidade" value={alunoAtivo.nacionalidade} />
                            <Campo label="Documento" value={alunoAtivo.numero_identificacao} />
                          </div>
                        </div>
                        <div className="dt-detail-section">
                          <h3><BsJournalCheck aria-hidden="true" /> Matrícula atual</h3>
                          <div className="dt-fields-grid">
                            <Campo label="Ano letivo" value={alunoAtivo.ano_nome} />
                            <Campo label="Data de matrícula" value={formatarData(alunoAtivo.data_matricula)} />
                            <Campo label="Polo" value={alunoAtivo.polo_nome} />
                            <Campo label="Estado" value={alunoAtivo.estado_matricula} />
                          </div>
                        </div>
                        <div className="dt-detail-section">
                          <h3><BsTelephone aria-hidden="true" /> Contacto do aluno</h3>
                          <div className="dt-fields-grid">
                            <Campo label="Telefone" value={alunoAtivo.telefone} icon={BsTelephone} />
                            <Campo label="Email" value={alunoAtivo.email} icon={BsEnvelope} />
                          </div>
                        </div>
                      </div>
                    )}

                    {separador === 'academico' && (
                      <div className="dt-tab-content">
                        <div className="dt-detail-section">
                          <h3><BsBook aria-hidden="true" /> Avaliações e notas</h3>
                          {alunoAtivo.notas?.length ? (
                            <div className="dt-grade-list">
                              {alunoAtivo.notas.map((nota, index) => (
                                <div className="dt-grade-row" key={`${nota.disciplina}-${nota.trimestre_nome}-${index}`}>
                                  <div>
                                    <strong>{nota.disciplina || 'Disciplina geral'}</strong>
                                    <span>{nota.ano_nome ? `${nota.ano_nome} · ` : ''}{nota.trimestre_nome || `Trimestre ${nota.trimestre_numero || ''}`}</span>
                                    <small>{[
                                      ['N1', nota.n1], ['N2', nota.n2], ['N3', nota.n3], ['N4', nota.n4],
                                      ['MAC', nota.mac], ['PF', nota.prova_final]
                                    ].filter(([, valor]) => valor !== null && valor !== undefined && valor !== '')
                                      .map(([rotulo, valor]) => `${rotulo}: ${valor}`).join(' · ') || 'Sem notas lançadas'}</small>
                                  </div>
                                  <b>MF: {valorTexto(nota.mf, '—')}</b>
                                </div>
                              ))}
                            </div>
                          ) : <p className="dt-muted">Ainda não existem notas trimestrais registadas para este aluno nesta turma.</p>}
                        </div>
                        <div className="dt-detail-section">
                          <h3><BsClockHistory aria-hidden="true" /> Assiduidade</h3>
                          {alunoAtivo.frequencia_resumo?.length ? (
                            <div className="dt-attendance-list">
                              {alunoAtivo.frequencia_resumo.map((item) => (
                                <div className="dt-attendance-row" key={item.estado}>
                                  <span>{item.estado || 'Estado não indicado'}</span>
                                  <strong>{item.total}</strong>
                                  <small>Último registo: {formatarData(item.ultima_data)}</small>
                                </div>
                              ))}
                            </div>
                          ) : <p className="dt-muted">Ainda não existem presenças registadas.</p>}
                          {alunoAtivo.frequencia_recente?.length > 0 && (
                            <div className="dt-recent-attendance">
                              <h4>Registos recentes</h4>
                              {alunoAtivo.frequencia_recente.map((item, index) => (
                                <div className="dt-history-row" key={`${item.data_presenca}-${index}`}>
                                  <span>{formatarData(item.data_presenca)}</span>
                                  <strong>{item.estado}</strong>
                                  {item.observacoes && <small>{item.observacoes}</small>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="dt-detail-section">
                          <h3><BsAward aria-hidden="true" /> Percurso anterior</h3>
                          <div className="dt-fields-grid">
                            <Campo label="Escola anterior" value={alunoAtivo.escola_anterior} />
                            <Campo label="Última nota informada" value={alunoAtivo.ultima_nota} />
                          </div>
                        </div>
                      </div>
                    )}

                    {separador === 'familia' && (
                      <div className="dt-tab-content">
                        <div className="dt-detail-section">
                          <h3><BsPeople aria-hidden="true" /> Encarregado de educação</h3>
                          <div className="dt-fields-grid">
                            <Campo label="Nome" value={alunoAtivo.encarregado_nome} />
                            <Campo label="Parentesco" value={alunoAtivo.encarregado_parentesco} />
                            <Campo label="Telefone" value={alunoAtivo.encarregado_telefone} icon={BsTelephone} />
                            <Campo label="Email" value={alunoAtivo.encarregado_email} icon={BsEnvelope} />
                            <Campo label="Ocupação" value={alunoAtivo.encarregado_ocupacao} />
                            <Campo label="Morada" value={alunoAtivo.encarregado_morada} icon={BsGeoAlt} />
                          </div>
                        </div>
                        <div className="dt-detail-section">
                          <h3><BsHouse aria-hidden="true" /> Morada e origem</h3>
                          <div className="dt-fields-grid">
                            <Campo label="Endereço" value={alunoAtivo.endereco_morada} icon={BsGeoAlt} />
                            <Campo label="Região" value={alunoAtivo.regiao_morada} />
                            <Campo label="Setor" value={alunoAtivo.setor_morada} />
                            <Campo label="Região de origem" value={alunoAtivo.regiao_origem} />
                            <Campo label="Local de origem" value={alunoAtivo.local_origem} />
                          </div>
                        </div>
                        <div className="dt-detail-section">
                          <h3><BsPeople aria-hidden="true" /> Irmãos na escola</h3>
                          {alunoAtivo.irmaos?.length ? (
                            <div className="dt-sibling-list">
                              {alunoAtivo.irmaos.map((irmao) => (
                                <div className="dt-sibling-row" key={`${irmao.aluno_id}-${irmao.turma_nome}`}>
                                  <span className="dt-sibling-avatar">{`${irmao.nome || ''}`.slice(0, 1).toLocaleUpperCase()}</span>
                                  <strong>{`${irmao.nome || ''} ${irmao.apelido || ''}`.trim()}</strong>
                                  <small>{irmao.turma_nome || 'Sem turma'}</small>
                                </div>
                              ))}
                            </div>
                          ) : <p className="dt-muted">Não há irmãos matriculados identificados nesta escola.</p>}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}