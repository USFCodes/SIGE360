'use client';

import React, { useEffect, useState } from 'react';
import { BsCalendar3, BsCheckCircle, BsClock, BsSave, BsXCircle } from 'react-icons/bs';
import { useTeacherPageHeader } from '@/components/teacher-dashboard-shell';
import '@/styles/adm-alunos.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_PROFESSORES = `${API_BASE}/api/v1/professores`;
const API_PRESENCAS = `${API_PROFESSORES}/presencas`;
const ESTADOS_PRESENCA = [
  { value: 'presente', label: 'Presente', color: '#137a53' },
  { value: 'falta', label: 'Falta', color: '#b33f43' },
  { value: 'atraso', label: 'Atraso', color: '#a66b08' },
  { value: 'falta_justificada', label: 'Falta justificada', color: '#315b91' }
];

async function lerRespostaApi(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha no pedido à API (HTTP ${response.status}).`);
  }
  return data;
}

export default function PresencasProfessorPage() {
  const [turmas, setTurmas] = useState([]);
  const [turmaSelecionada, setTurmaSelecionada] = useState('');
  const [dataPresenca, setDataPresenca] = useState('');
  const [listaAlunos, setListaAlunos] = useState([]);
  const [loadingTurmas, setLoadingTurmas] = useState(true);
  const [loadingAlunos, setLoadingAlunos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const agora = new Date();
      const deslocamento = agora.getTimezoneOffset() * 60000;
      setDataPresenca(new Date(agora.getTime() - deslocamento).toISOString().slice(0, 10));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const carregarMinhasTurmas = async (signal) => {
    try {
      setLoadingTurmas(true);
      setError('');
      const response = await fetch(`${API_PROFESSORES}/meu-painel/turmas`, {
        credentials: 'include',
        cache: 'no-store',
        signal
      });
      const data = await lerRespostaApi(response);
      const todasTurmas = [...(data.turmasDiretor || []), ...(data.turmasLecionadas || [])];
      const turmasUnicas = [...new Map(todasTurmas.map((turma) => [turma.turma_id, turma])).values()];
      setTurmas(turmasUnicas);
      setTurmaSelecionada((atual) => (
        turmasUnicas.some((turma) => turma.turma_id === atual)
          ? atual
          : (turmasUnicas[0]?.turma_id || '')
      ));
    } catch (loadError) {
      if (loadError.name !== 'AbortError') {
        setTurmas([]);
        setTurmaSelecionada('');
        setError(loadError.message || 'Não foi possível carregar as suas turmas.');
      }
    } finally {
      if (!signal?.aborted) setLoadingTurmas(false);
    }
  };

  const carregarPresencasTurma = async (turmaId, data, signal) => {
    try {
      setLoadingAlunos(true);
      setError('');
      setSuccessMsg('');
      const query = new URLSearchParams({ data });
      const response = await fetch(
        `${API_PRESENCAS}/turma/${encodeURIComponent(turmaId)}?${query}`,
        { credentials: 'include', cache: 'no-store', signal }
      );
      const result = await lerRespostaApi(response);
      setListaAlunos(Array.isArray(result.dados) ? result.dados : []);
    } catch (loadError) {
      if (loadError.name !== 'AbortError') {
        setListaAlunos([]);
        setError(loadError.message || 'Não foi possível carregar a chamada.');
      }
    } finally {
      if (!signal?.aborted) setLoadingAlunos(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void carregarMinhasTurmas(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!turmaSelecionada || !dataPresenca) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void carregarPresencasTurma(turmaSelecionada, dataPresenca, controller.signal),
      0
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [turmaSelecionada, dataPresenca]);

  const alterarEstado = (matriculaId, estado) => {
    setListaAlunos((alunos) => alunos.map((aluno) => (
      aluno.matricula_id === matriculaId ? { ...aluno, estado } : aluno
    )));
  };

  const alterarObservacao = (matriculaId, observacoes) => {
    setListaAlunos((alunos) => alunos.map((aluno) => (
      aluno.matricula_id === matriculaId ? { ...aluno, observacoes } : aluno
    )));
  };

  const marcarTodos = (estado) => {
    setListaAlunos((alunos) => alunos.map((aluno) => ({ ...aluno, estado })));
  };

  const guardarPresencas = async (event) => {
    event?.preventDefault();
    if (!turmaSelecionada || !dataPresenca || listaAlunos.length === 0) return;

    try {
      setSaving(true);
      setError('');
      setSuccessMsg('');
      const response = await fetch(`${API_PRESENCAS}/salvar-lote`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turma_id: turmaSelecionada,
          data_presenca: dataPresenca,
          presencas: listaAlunos.map((aluno) => ({
            matricula_id: aluno.matricula_id,
            estado: aluno.estado || 'presente',
            observacoes: aluno.observacoes?.trim() || null
          }))
        })
      });
      const result = await lerRespostaApi(response);
      setSuccessMsg(result.message || 'Presenças guardadas com sucesso.');
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível guardar as presenças.');
    } finally {
      setSaving(false);
    }
  };

  const resumo = listaAlunos.reduce((contagem, aluno) => {
    const estado = aluno.estado || 'presente';
    contagem[estado] = (contagem[estado] || 0) + 1;
    return contagem;
  }, {});

  useTeacherPageHeader({
    title: 'REGISTO DE PRESENÇAS E ASSIDUIDADE',
    description: 'Marque presenças, faltas, atrasos e justificações por turma e data.',
    onRefresh: async () => {
      await carregarMinhasTurmas();
      if (turmaSelecionada && dataPresenca) {
        await carregarPresencasTurma(turmaSelecionada, dataPresenca);
      }
    },
    actions: [{
      label: saving ? 'A guardar chamada…' : 'Guardar chamada',
      icon: <BsSave />,
      disabled: saving || loadingAlunos || !turmaSelecionada || listaAlunos.length === 0,
      onClick: guardarPresencas
    }]
  });

  return (
    <div className="admin-page-layout teacher-attendance-page">
      {error && (
        <div role="alert" style={{ color: '#991b1b', marginBottom: '16px', padding: '12px 14px', background: '#fee2e2', borderRadius: '6px' }}>
          <BsXCircle style={{ marginRight: '8px', verticalAlign: 'middle' }} />{error}
        </div>
      )}
      {successMsg && (
        <div role="status" style={{ color: '#166534', marginBottom: '16px', padding: '12px 14px', background: '#dcfce7', borderRadius: '6px', fontWeight: '700' }}>
          <BsCheckCircle style={{ marginRight: '8px', verticalAlign: 'middle' }} />{successMsg}
        </div>
      )}

      <section className="teacher-attendance-filters">
        <div className="teacher-attendance-field teacher-attendance-class-field">
          <label htmlFor="attendance-class">TURMA</label>
          <select
            id="attendance-class"
            className="teacher-attendance-input"
            value={turmaSelecionada}
            onChange={(event) => {
              setListaAlunos([]);
              setTurmaSelecionada(event.target.value);
            }}
            disabled={loadingTurmas || turmas.length === 0}
          >
            {turmas.length > 0 ? turmas.map((turma) => (
              <option key={turma.turma_id} value={turma.turma_id}>
                {turma.nome_turma} · {turma.classe || 'Classe N/A'} · {turma.turno || 'Turno N/A'}
              </option>
            )) : <option value="">{loadingTurmas ? 'A carregar turmas…' : 'Nenhuma turma atribuída'}</option>}
          </select>
        </div>
        <div className="teacher-attendance-field teacher-attendance-date-field">
          <label htmlFor="attendance-date">DATA DA AULA</label>
          <input
            id="attendance-date"
            className="teacher-attendance-input"
            type="date"
            value={dataPresenca}
            onChange={(event) => {
              setListaAlunos([]);
              setDataPresenca(event.target.value);
            }}
          />
        </div>
        <div className="teacher-attendance-bulk-actions">
          <button type="button" data-state="presente" disabled={!listaAlunos.length || saving} onClick={() => marcarTodos('presente')}>Todos presentes</button>
          <button type="button" data-state="falta" disabled={!listaAlunos.length || saving} onClick={() => marcarTodos('falta')}>Todas faltas</button>
          <button type="button" data-state="falta_justificada" disabled={!listaAlunos.length || saving} onClick={() => marcarTodos('falta_justificada')}>Todas justificadas</button>
        </div>
      </section>

      <section className="teacher-attendance-call-card">
        <div className="teacher-attendance-call-heading">
          <div>
            <h2 style={{ fontSize: '17px', fontWeight: '800', color: '#152536', margin: 0 }}>Chamada diária</h2>
            <p style={{ fontSize: '11px', color: '#637586', margin: '4px 0 0' }}>
              {listaAlunos.length} aluno(s) · {dataPresenca || 'Selecione uma data'}
            </p>
          </div>
        </div>

        <div className="teacher-attendance-summary" aria-live="polite">
          {ESTADOS_PRESENCA.map((item) => (
            <span key={item.value} style={{ color: item.color, background: `${item.color}14`, borderRadius: '4px', padding: '5px 8px', fontSize: '10px', fontWeight: '800' }}>
              {item.label}: {resumo[item.value] || 0}
            </span>
          ))}
        </div>

        {loadingAlunos ? (
          <p role="status" style={{ textAlign: 'center', padding: '40px', color: '#637586' }}><BsClock style={{ marginRight: '7px' }} />A carregar chamada…</p>
        ) : listaAlunos.length > 0 ? (
          <div className="table-responsive-wrapper teacher-attendance-table-wrapper">
            <table className="admin-data-table teacher-attendance-table">
              <thead>
                <tr style={{ background: '#f5f8f8', borderBottom: '1px solid #d7e1e8' }}>
                  <th style={{ padding: '10px', textAlign: 'left', width: '44px' }}>#</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>ALUNO</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>MATRÍCULA</th>
                  <th style={{ padding: '10px', textAlign: 'center' }}>ESTADO</th>
                  <th style={{ padding: '10px', textAlign: 'left', minWidth: '180px' }}>OBSERVAÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {listaAlunos.map((aluno, index) => {
                  const estadoAtual = aluno.estado || 'presente';
                  return (
                    <tr key={aluno.matricula_id} style={{ borderBottom: '1px solid #edf1f3' }}>
                      <td style={{ padding: '10px', color: '#637586' }}>{index + 1}</td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                          {aluno.foto_url ? (
                            <img src={aluno.foto_url} alt="" style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', borderRadius: '50%', background: '#087c78', color: '#fff', fontSize: '11px', fontWeight: '800' }}>
                              {(aluno.nome || 'AL').slice(0, 2).toLocaleUpperCase()}
                            </span>
                          )}
                          <strong>{aluno.nome} {aluno.apelido}</strong>
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}><code>{aluno.numero_matricula || '—'}</code></td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px' }}>
                          {ESTADOS_PRESENCA.map((item) => {
                            const ativo = estadoAtual === item.value;
                            return (
                              <button
                                key={item.value}
                                type="button"
                                aria-pressed={ativo}
                                onClick={() => alterarEstado(aluno.matricula_id, item.value)}
                                style={{ padding: '6px 8px', borderRadius: '5px', border: `1px solid ${ativo ? item.color : '#d7e1e8'}`, background: ativo ? item.color : '#fff', color: ativo ? '#fff' : '#475569', fontSize: '10px', fontWeight: '700', cursor: 'pointer' }}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="text"
                          value={aluno.observacoes || ''}
                          onChange={(event) => alterarObservacao(aluno.matricula_id, event.target.value)}
                          placeholder="Motivo ou nota"
                          aria-label={`Observação de ${aluno.nome} ${aluno.apelido || ''}`}
                          style={{ width: '100%', minWidth: '160px', height: '34px', border: '1px solid #d7e1e8', borderRadius: '5px', padding: '0 8px', fontSize: '11px' }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '38px 16px', color: '#637586', background: '#f7f9fa', borderRadius: '6px' }}>
            {turmas.length === 0 ? 'Não existem turmas atribuídas a este perfil.' : 'Não há alunos matriculados nesta turma para a data selecionada.'}
          </div>
        )}
      </section>
    </div>
  );
}
