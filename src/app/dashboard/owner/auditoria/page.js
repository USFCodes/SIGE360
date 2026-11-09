'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_OWNER = `${API_BASE}/api/v1/owner`;

async function lerResposta(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) throw new Error(data.message || `Pedido falhou (HTTP ${response.status}).`);
  return data;
}

function dataHora(data) {
  return data ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data)) : '—';
}

export default function OwnerAuditoria() {
  const [eventos, setEventos] = useState([]);
  const [escolas, setEscolas] = useState([]);
  const [escolaId, setEscolaId] = useState('');
  const [pesquisa, setPesquisa] = useState('');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const params = new URLSearchParams();
      if (escolaId) params.set('escola_id', escolaId);
      const [auditResponse, schoolsResponse] = await Promise.all([
        fetch(`${API_OWNER}/audit?${params}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API_OWNER}/escolas/paginadas?page=1&limit=100`, { credentials: 'include', cache: 'no-store' })
      ]);
      const [audit, schools] = await Promise.all([lerResposta(auditResponse), lerResposta(schoolsResponse)]);
      setEventos(Array.isArray(audit.data) ? audit.data : []);
      setEscolas(Array.isArray(schools.data) ? schools.data : []);
    } catch (error) {
      setErro(error.message || 'Não foi possível carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, [escolaId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void carregar(), 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  const filtrados = useMemo(() => {
    const termo = pesquisa.trim().toLowerCase();
    if (!termo) return eventos;
    return eventos.filter((item) => [item.acao, item.entidade, item.actor_nome, item.escola_nome, item.ip_address, JSON.stringify(item.detalhes)]
      .some((value) => String(value || '').toLowerCase().includes(termo)));
  }, [eventos, pesquisa]);

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 };
  const input = { border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px', background: '#fff' };

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto', color: '#0f172a' }}>
      <header style={{ marginBottom: 22 }}>
        <p style={{ color: '#64748b', margin: 0 }}>Rastreabilidade da plataforma</p>
        <h1 style={{ margin: '6px 0' }}>Atividades</h1>
        <p style={{ color: '#64748b', margin: 0 }}>Histórico das operações registadas pela plataforma, com responsável e endereço IP quando disponíveis.</p>
      </header>
      {erro && <div role="alert" style={{ ...card, color: '#b91c1c', marginBottom: 14 }}>{erro}</div>}
      <section style={card}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <select aria-label="Filtrar escola" style={input} value={escolaId} onChange={(event) => setEscolaId(event.target.value)}>
            <option value="">Todas as escolas</option>
            {escolas.map((escola) => <option key={escola.id} value={escola.id}>{escola.nome}</option>)}
          </select>
          <input style={{ ...input, flex: 1, minWidth: 220 }} placeholder="Pesquisar ação, utilizador, escola ou IP…" value={pesquisa} onChange={(event) => setPesquisa(event.target.value)} />
          <button type="button" onClick={() => void carregar()} disabled={loading} style={{ ...input, cursor: 'pointer' }}>Atualizar</button>
        </div>
        {loading ? <p role="status">A carregar histórico…</p> : filtrados.length === 0 ? <p style={{ color: '#64748b' }}>Nenhum evento encontrado.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>{['Data', 'Ação', 'Responsável', 'Escola', 'Detalhes'].map((head) => <th key={head} style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #e2e8f0' }}>{head}</th>)}</tr></thead>
              <tbody>
                {filtrados.map((evento) => (
                  <tr key={evento.id}>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>{dataHora(evento.criado_em)}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}><strong>{String(evento.acao).replaceAll('_', ' ')}</strong><small style={{ display: 'block', color: '#64748b' }}>{evento.entidade} · {evento.entidade_id || '—'}</small></td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>
                      {evento.actor_nome || 'Conta removida'}
                      <small style={{ display: 'block', color: '#64748b' }}>IP: {evento.ip_address || 'Não registado'}</small>
                    </td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>{evento.escola_nome || 'Plataforma'}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', maxWidth: 380, wordBreak: 'break-word' }}>
                      <details>
                        <summary style={{ color: '#2563eb', cursor: 'pointer' }}>Ver pedido e resposta</summary>
                        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                          <section>
                            <strong>Dados enviados</strong>
                            <pre style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(evento.detalhes?.request_body ?? null, null, 2)}
                            </pre>
                          </section>
                          <section>
                            <strong>Parâmetros da rota</strong>
                            <pre style={{ maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(evento.detalhes?.route_params ?? null, null, 2)}
                            </pre>
                          </section>
                          <section>
                            <strong>Parâmetros</strong>
                            <pre style={{ maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(evento.detalhes?.query ?? null, null, 2)}
                            </pre>
                          </section>
                          <section>
                            <strong>Resposta HTTP {evento.detalhes?.status_http || '—'}</strong>
                            <pre style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(evento.detalhes?.response_body ?? null, null, 2)}
                            </pre>
                          </section>
                          <small>Rota: {evento.detalhes?.rota || evento.acao}</small>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
