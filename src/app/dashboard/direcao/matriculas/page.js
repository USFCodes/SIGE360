'use client';

import React, { useEffect, useState } from 'react';
import useSWR from 'swr';
import { BsArrowClockwise, BsCheckCircle, BsExclamationTriangle, BsXCircle } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_V1 = `${API_BASE}/api/v1`;

async function fetchApi(url, options = {}) {
  const headers = new Headers(options.headers || {});

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
    cache: 'no-store'
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`A API respondeu num formato inválido (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha no pedido à API (HTTP ${response.status}).`);
  }
  return data;
}

const fetcher = (url) => fetchApi(url);

function formatarMoeda(valor) {
  return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(Number(valor) || 0)} CFA`;
}

export default function DecisaoMatriculasPage() {
  const [escolaId, setEscolaId] = useState('');
  const [anoLetivoId, setAnoLetivoId] = useState('');
  const [comentarios, setComentarios] = useState({});
  const [matriculasSelecionadas, setMatriculasSelecionadas] = useState([]);
  const [pedido, setPedido] = useState('');
  const [feedback, setFeedback] = useState(null);

  const { data: sessao, error: erroSessao } = useSWR(`${API_V1}/auth/me`, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false
  });

  useEffect(() => {
    const escola = sessao?.data?.conta_ativa?.escola_id;
    if (escola) setEscolaId(escola);
  }, [sessao]);

  const { data: anosResposta, error: erroAnos, isLoading: carregandoAnos } = useSWR(
    escolaId ? `${API_V1}/escolas/escolas/${encodeURIComponent(escolaId)}/anos-letivos` : null,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const anosLetivos = Array.isArray(anosResposta?.dados) ? anosResposta.dados : [];

  useEffect(() => {
    if (!anosLetivos.length) return;
    const anoAtivo = anosLetivos.find((ano) => ano.ativo);
    if (!anoLetivoId) setAnoLetivoId(anoAtivo?.ano_letivo_id || anoAtivo?.id || '');
  }, [anosLetivos, anoLetivoId]);

  const { data: pendentesResposta, error: erroPendentes, isLoading, mutate } = useSWR(
    anoLetivoId ? `${API_V1}/direcao/matriculas/pendentes?ano_letivo_id=${encodeURIComponent(anoLetivoId)}` : null,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const pendentes = Array.isArray(pendentesResposta?.dados) ? pendentesResposta.dados : [];

  const decidir = async (matricula, decisao) => {
    const texto = String(comentarios[matricula.matricula_id] || '').trim();
    setPedido(matricula.matricula_id);
    setFeedback(null);
    try {
      const resposta = await fetchApi(
        `${API_V1}/direcao/matriculas/${encodeURIComponent(matricula.matricula_id)}/decisao`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decisao, comentario: texto })
        }
      );
      setFeedback({ tipo: 'sucesso', texto: resposta.message || 'Decisão registada.' });
      setMatriculasSelecionadas((atuais) => atuais.filter((id) => id !== matricula.matricula_id));
      try {
        await mutate();
      } catch (errorAtualizacao) {
        setFeedback({
          tipo: 'erro',
          texto: `A decisão foi registada, mas a lista não foi atualizada: ${errorAtualizacao.message}`
        });
      }
    } catch (error) {
      setFeedback({ tipo: 'erro', texto: error.message || 'Não foi possível guardar a decisão.' });
    } finally {
      setPedido('');
    }
  };

  const decidirEmLote = async (matriculas, tipo, decisao) => {
    if (!matriculas.length || pedido) return;
    const acao = decisao === 'aprovado' ? 'aprovação' : 'reprovação';
    const participio = decisao === 'aprovado' ? 'aprovadas' : 'reprovadas';
    const confirmacao = tipo === 'todas'
      ? `Confirma a ${acao} de todas as ${matriculas.length} matrículas pendentes deste ano letivo?`
      : `Confirma a ${acao} das ${matriculas.length} matrículas selecionadas?`;
    if (!window.confirm(confirmacao)) return;

    setPedido(`lote-${tipo}-${decisao}`);
    setFeedback(null);
    const falhas = [];
    for (const matricula of matriculas) {
      try {
        await fetchApi(
          `${API_V1}/direcao/matriculas/${encodeURIComponent(matricula.matricula_id)}/decisao`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decisao,
              comentario: String(comentarios[matricula.matricula_id] || '').trim()
            })
          }
        );
      } catch (error) {
        falhas.push({
          matriculaId: matricula.matricula_id,
          nome: `${matricula.nome} ${matricula.apelido || ''}`.trim(),
          mensagem: error.message || `Falha ao ${decisao === 'aprovado' ? 'aprovar' : 'reprovar'}.`
        });
      }
    }

    setMatriculasSelecionadas(falhas.map((falha) => falha.matriculaId));

    let erroAtualizacao = '';
    try {
      await mutate();
    } catch (error) {
      erroAtualizacao = ` A lista não foi atualizada: ${error.message}`;
    }

    const concluidas = matriculas.length - falhas.length;
    const resumoFalhas = falhas.length
      ? ` Falhas: ${falhas.slice(0, 5).map((falha) => `${falha.nome}: ${falha.mensagem}`).join(' | ')}${falhas.length > 5 ? ` | e mais ${falhas.length - 5}.` : ''}`
      : '';
    setFeedback({
      tipo: falhas.length || erroAtualizacao ? 'erro' : 'sucesso',
      texto: `${concluidas} de ${matriculas.length} matrículas ${participio}.${resumoFalhas}${erroAtualizacao}`
    });
    setPedido('');
  };

  const todasSelecionadas = pendentes.length > 0
    && pendentes.every((matricula) => matriculasSelecionadas.includes(matricula.matricula_id));

  return (
    <>
    <AdminHeader titulo="Decisão de Matrículas" descricao="Analise os dados e as notas do ano anterior; a sugestão nunca substitui a decisão da Direção." onRefresh={mutate} />

      {(erroSessao || erroAnos || erroPendentes || feedback) && (
        <div role={feedback?.tipo === 'sucesso' ? 'status' : 'alert'} style={{ marginBottom: '18px', padding: '12px 16px', borderRadius: '8px', background: feedback?.tipo === 'sucesso' ? '#dcfce7' : '#fee2e2', color: feedback?.tipo === 'sucesso' ? '#166534' : '#991b1b' }}>
          {feedback?.texto || erroSessao?.message || erroAnos?.message || erroPendentes?.message}
        </div>
      )}

      <section style={{ marginBottom: '20px', padding: '16px 18px', border: '1px solid #e2e8f0', borderRadius: '10px', background: '#fff' }}>
        <label htmlFor="ano-decisao-matricula" style={{ display: 'block', marginBottom: '7px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>ANO LETIVO</label>
        <select
          id="ano-decisao-matricula"
          value={anoLetivoId}
          onChange={(event) => setAnoLetivoId(event.target.value)}
          disabled={carregandoAnos || anosLetivos.length === 0}
          style={{ width: 'min(100%, 420px)', padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#fff' }}
        >
          <option value="">{carregandoAnos ? 'A carregar anos letivos...' : 'Todos os anos letivos'}</option>
          {anosLetivos.map((ano) => (
            <option key={ano.ano_letivo_id || ano.id} value={ano.ano_letivo_id || ano.id}>
              {ano.ano_nome}{ano.ativo ? ' (Atual)' : ''}
            </option>
          ))}
        </select>
      </section>

      {!anoLetivoId && !carregandoAnos ? (
        <section style={{ padding: '36px 20px', textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#fff', color: '#64748b' }}>
          Selecione um ano letivo para consultar as matrículas pendentes.
        </section>
      ) : isLoading ? (
        <p role="status" style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>A carregar matrículas pendentes...</p>
      ) : pendentes.length === 0 ? (
        <section style={{ padding: '44px 20px', textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#fff', color: '#64748b' }}>
          <BsCheckCircle size={28} color="#16a34a" />
          <p style={{ marginBottom: 0 }}>Não existem matrículas pendentes para este ano letivo.</p>
        </section>
      ) : (
        <>
          <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', padding: '14px 16px', border: '1px solid #e2e8f0', borderRadius: '10px', background: '#fff' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#334155', fontSize: '14px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={todasSelecionadas}
                disabled={Boolean(pedido)}
                onChange={(event) => setMatriculasSelecionadas(event.target.checked ? pendentes.map((matricula) => matricula.matricula_id) : [])}
              />
              Selecionar todas ({pendentes.length})
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                onClick={() => void decidirEmLote(pendentes.filter((matricula) => matriculasSelecionadas.includes(matricula.matricula_id)), 'selecionadas', 'aprovado')}
                disabled={Boolean(pedido) || matriculasSelecionadas.length === 0}
                style={{ padding: '10px 14px', border: '1px solid #15803d', borderRadius: '8px', background: '#fff', color: '#15803d', fontWeight: 700, cursor: pedido || matriculasSelecionadas.length === 0 ? 'not-allowed' : 'pointer' }}
              >
                Aprovar selecionadas ({matriculasSelecionadas.filter((id) => pendentes.some((matricula) => matricula.matricula_id === id)).length})
              </button>
              <button
                type="button"
                onClick={() => void decidirEmLote(pendentes.filter((matricula) => matriculasSelecionadas.includes(matricula.matricula_id)), 'selecionadas', 'reprovado')}
                disabled={Boolean(pedido) || matriculasSelecionadas.length === 0}
                style={{ padding: '10px 14px', border: '1px solid #dc2626', borderRadius: '8px', background: '#fff', color: '#b91c1c', fontWeight: 700, cursor: pedido || matriculasSelecionadas.length === 0 ? 'not-allowed' : 'pointer' }}
              >
                Reprovar selecionadas ({matriculasSelecionadas.filter((id) => pendentes.some((matricula) => matricula.matricula_id === id)).length})
              </button>
              <button
                type="button"
                onClick={() => void decidirEmLote(pendentes, 'todas', 'aprovado')}
                disabled={Boolean(pedido)}
                style={{ padding: '10px 14px', border: 0, borderRadius: '8px', background: '#15803d', color: '#fff', fontWeight: 700, cursor: pedido ? 'wait' : 'pointer' }}
              >
                {pedido === 'lote-todas-aprovado' ? 'A aprovar...' : `Aprovar todas (${pendentes.length})`}
              </button>
            </div>
          </section>
          <div style={{ display: 'grid', gap: '16px' }}>
          {pendentes.map((matricula) => {
            const sugestaoAprovada = matricula.resultado_sugerido === 'aprovado';
            const sugestaoReprovada = matricula.resultado_sugerido === 'reprovado';
            return (
              <article key={matricula.matricula_id} style={{ padding: '20px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#fff', boxShadow: '0 1px 3px rgba(15, 23, 42, .04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar matrícula de ${matricula.nome} ${matricula.apelido || ''}`}
                      checked={matriculasSelecionadas.includes(matricula.matricula_id)}
                      disabled={Boolean(pedido)}
                      onChange={(event) => setMatriculasSelecionadas((atuais) => (
                        event.target.checked
                          ? [...atuais, matricula.matricula_id]
                          : atuais.filter((id) => id !== matricula.matricula_id)
                      ))}
                      style={{ marginTop: '5px' }}
                    />
                    <div>
                    {matricula.foto_url && (
                      <img src={matricula.foto_url} alt={`Fotografia de ${matricula.nome}`} style={{ width: '56px', height: '56px', marginBottom: '8px', borderRadius: '50%', objectFit: 'cover' }} />
                    )}
                    <h2 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>{matricula.nome} {matricula.apelido || ''}</h2>
                    <p style={{ margin: '6px 0', color: '#64748b', fontSize: '13px' }}>
                      ID: {matricula.login_id || '—'} · {matricula.telefone || 'Sem telemóvel'} · Matrícula {matricula.numero_matricula}
                    </p>
                    </div>
                  </div>
                  <div style={{ alignSelf: 'flex-start', padding: '7px 10px', borderRadius: '7px', background: sugestaoAprovada ? '#dcfce7' : sugestaoReprovada ? '#fee2e2' : '#fef3c7', color: sugestaoAprovada ? '#166534' : sugestaoReprovada ? '#991b1b' : '#92400e', fontSize: '12px', fontWeight: 700 }}>
                    {sugestaoAprovada ? 'Sugestão: aprovado' : sugestaoReprovada ? 'Sugestão: reprovado' : 'Revisão manual'}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px', margin: '16px 0', padding: '14px', background: '#f8fafc', borderRadius: '8px', color: '#334155', fontSize: '13px' }}>
                  <div><strong>Ano letivo:</strong> {matricula.ano_nome || '—'}</div>
                  <div><strong>Polo / turma:</strong> {[matricula.polo_nome, matricula.turma_nome, matricula.classe].filter(Boolean).join(' · ') || '—'}</div>
                  <div><strong>Talão:</strong> {matricula.codigo_talao || '—'}</div>
                  <div>
                    <strong>Pagamento:</strong>{' '}
                    {matricula.pagamento_valor === null || matricula.pagamento_valor === undefined
                      ? 'Sem pagamento registado'
                      : `${formatarMoeda(matricula.pagamento_valor)}${matricula.pagamento_estado ? ` · ${matricula.pagamento_estado}` : ''}`}
                  </div>
                  <div><strong>Matrícula anterior:</strong> {matricula.ano_origem_nome || 'Novo aluno'}</div>
                  <div><strong>Média final anterior:</strong> {matricula.media_final === null ? 'Sem notas' : `${matricula.media_final}/20`} ({matricula.quantidade_notas || 0} notas)</div>
                </div>

                {!matricula.ano_origem_nome || !matricula.quantidade_notas ? (
                  <p style={{ display: 'flex', alignItems: 'center', gap: '7px', color: '#92400e', fontSize: '13px' }}>
                    <BsExclamationTriangle /> Sem notas finais anteriores; a decisão deve ser analisada manualmente.
                  </p>
                ) : null}

                <label htmlFor={`comentario-${matricula.matricula_id}`} style={{ display: 'block', marginBottom: '6px', fontWeight: 700, fontSize: '12px', color: '#475569' }}>Comentário da Direção (opcional)</label>
                <textarea
                  id={`comentario-${matricula.matricula_id}`}
                  value={comentarios[matricula.matricula_id] || ''}
                  onChange={(event) => setComentarios((atual) => ({ ...atual, [matricula.matricula_id]: event.target.value }))}
                  maxLength={2000}
                  rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '10px', marginTop: '14px' }}>
                  <button type="button" onClick={() => void decidir(matricula, 'reprovado')} disabled={Boolean(pedido)} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '10px 14px', border: '1px solid #fecaca', borderRadius: '8px', background: '#fff', color: '#b91c1c', fontWeight: 700, cursor: pedido ? 'wait' : 'pointer' }}>
                    <BsXCircle /> {pedido === matricula.matricula_id ? 'A guardar...' : 'Reprovar'}
                  </button>
                  <button type="button" onClick={() => void decidir(matricula, 'aprovado')} disabled={Boolean(pedido)} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '10px 14px', border: 0, borderRadius: '8px', background: '#15803d', color: '#fff', fontWeight: 700, cursor: pedido ? 'wait' : 'pointer' }}>
                    <BsCheckCircle /> {pedido === matricula.matricula_id ? 'A guardar...' : 'Aprovar'}
                  </button>
                </div>
              </article>
            );
          })}
          </div>
        </>
      )}
    </>
  );
}
