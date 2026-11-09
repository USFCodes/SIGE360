'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/auth-shell';
import { AUTH_API_BASE, clearGlobalUser, logoutGlobalUser } from '@/utils/globalAuth';

const API = `${AUTH_API_BASE}/api/v1/auth`;

export default function SelecionarContaPage() {
  const router = useRouter();
  const [contas, setContas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [selecionando, setSelecionando] = useState(false);

  useEffect(() => {
    async function carregar() {
      try {
        const res = await fetch(`${API}/contas`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Erro ao carregar contas');
        }
        setContas(data.contas || []);
        if ((data.contas || []).length === 0) {
          router.replace('/');
        }
      } catch (e) {
        setErro(e.message);
        setTimeout(() => router.replace('/'), 2000);
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, [router]);

  async function escolherConta(associacao_id) {
    setErro('');
    setSelecionando(true);
    try {
      const res = await fetch(`${API}/mudar-conta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ associacao_id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Erro ao selecionar conta');
      }

      const user = data.data || {};
      const redirectUrl = user.redirect || '/dashboard';

      await clearGlobalUser();
      router.replace(redirectUrl);
    } catch (e) {
      setErro(e.message);
    } finally {
      setSelecionando(false);
      setTimeout(() => setErro(''), 2500);
    }
  }

  async function voltarAoLogin() {
    setErro('');
    try {
      await logoutGlobalUser();
      router.replace('/');
    } catch (error) {
      setErro(error.message || 'Não foi possível terminar a sessão.');
    }
  }

  return (
    <AuthShell>
    <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
      <header className="formHeader">
        <span className="formEyebrow">SELECIONAR CONTA</span>
        {erro ? <div className="errorMsg" role="alert">{erro}</div> : <h2 className="authTitle">Escolha onde entrar</h2>}
        <p className="formDescription">Tem mais de uma conta associada. Selecione a que pretende aceder.</p>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
        {loading && <p style={{ textAlign: 'center', color: '#666' }}>A carregar...</p>}
        {!loading && contas.map((c, idx) => (
          <button
            key={c.associacao_id || c.conta_id || idx}
            onClick={() => escolherConta(c.associacao_id)}
            disabled={selecionando}
            style={{
              textAlign: 'left',
              padding: '14px 18px',
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: selecionando ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
            }}
          >
            <div style={{ fontWeight: 600, color: '#111827' }}>{c.escola_nome || 'Escola'}</div>
            <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>Papel: {c.papel}</div>
          </button>
        ))}
      </div>

      <p className="formFooter" style={{ marginTop: 24 }}>
        <button
          type="button"
          onClick={voltarAoLogin}
          style={{ background: 'none', border: 'none', color: '#075a9e', cursor: 'pointer', padding: 0 }}
        >
          Voltar ao login
        </button>
      </p>
    </div>
    </AuthShell>
  );
}