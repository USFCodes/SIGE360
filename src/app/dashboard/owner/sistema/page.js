'use client';

import React, { useCallback, useEffect, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_OWNER = `${API_BASE}/api/v1/owner`;

function dataHora(data) {
  return data ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(data)) : '—';
}

function duracao(segundos) {
  const total = Math.max(0, Number(segundos) || 0);
  const dias = Math.floor(total / 86400);
  const horas = Math.floor((total % 86400) / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  return `${dias}d ${horas}h ${minutos}min`;
}

export default function OwnerSistema() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  const verificar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const response = await fetch(`${API_OWNER}/operations/health`, { credentials: 'include', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        setStatus(data.data || null);
        throw new Error(data.message || `Verificação falhou (HTTP ${response.status}).`);
      }
      setStatus(data.data);
    } catch (error) {
      setErro(error.message || 'Não foi possível verificar o sistema.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void verificar(); }, [verificar]);

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 };

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: '0 auto', color: '#0f172a' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <p style={{ color: '#64748b', margin: 0 }}>Diagnóstico operacional</p>
          <h1 style={{ margin: '6px 0' }}>Sistema</h1>
          <p style={{ color: '#64748b', margin: 0 }}>Estado do backend e conectividade real com a base de dados.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => void verificar()} style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>
          {loading ? 'A verificar…' : 'Executar verificação'}
        </button>
      </header>
      {erro && <div role="alert" style={{ ...card, color: '#b91c1c', marginBottom: 16 }}>{erro}</div>}
      {loading && !status ? <p role="status">A testar ligação à base de dados…</p> : status && (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {[
              ['Backend', status.backend],
              ['Base de dados', status.base_dados],
              ['Latência DB', status.latencia_base_dados_ms == null ? '—' : `${status.latencia_base_dados_ms} ms`],
              ['Uptime deste processo', duracao(status.uptime_segundos)],
              ['Node.js', status.versao_node || '—'],
              ['Última verificação', dataHora(status.verificado_em)]
            ].map(([label, valor]) => (
              <article key={label} style={card}>
                <span style={{ color: '#64748b', fontSize: 14 }}>{label}</span>
                <strong style={{ display: 'block', fontSize: 20, marginTop: 9, color: valor === 'operacional' ? '#15803d' : '#0f172a' }}>{valor}</strong>
              </article>
            ))}
          </section>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 16 }}>Este diagnóstico verifica o processo do backend e uma consulta simples à base de dados; não representa uptime histórico nem monitoriza serviços externos.</p>
        </>
      )}
    </main>
  );
}
