'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  BsPersonBadge, BsJournalPlus, BsShieldLock, BsSave, BsCalendarEvent, BsBuilding, BsBook,
  BsGear, BsPeople, BsCalendarCheck, BsShieldCheck
} from 'react-icons/bs';
import { useTeacherPageHeader } from '@/components/teacher-dashboard-shell';
import '@/styles/adm-alunos.css';
import '@/styles/a7.css';
import '@/styles/teacher-settings.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_ESCOLAS = `${API_BASE}/api/v1/escolas`;
const API_PROFESSORES = `${API_BASE}/api/v1/professores`;
const API_NOTAS = `${API_BASE}/api/v1/notas`;

async function lerRespostaApi(response) {
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`A API respondeu num formato inválido (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha no pedido à API (HTTP ${response.status}).`);
  }
  return data;
}

export default function ConfiguracoesProfessorPage() {
  const [abaAtiva, setAbaAtiva] = useState('perfil'); // 'perfil', 'notas', 'seguranca'
  const secoes = [
    { id: 'perfil', title: 'Meu perfil', description: 'Dados da conta docente', icon: BsPersonBadge },
    { id: 'notas', title: 'Avaliação', description: 'Turmas e períodos', icon: BsJournalPlus },
    { id: 'seguranca', title: 'Segurança', description: 'Palavra-passe', icon: BsShieldLock }
  ];
  
  // Dados do Perfil do Utilizador / Professor
  const [perfil, setPerfil] = useState(null);
  const [loadingPerfil, setLoadingPerfil] = useState(true);
  const [erroPerfil, setErroPerfil] = useState('');

  // Estados para a Estrutura de Notas
  const [turmas, setTurmas] = useState([]);
  const [trimestres, setTrimestres] = useState([]);
  const [escalaNota, setEscalaNota] = useState('0-20');

  // Estados para Segurança (Senha)
  const [formSenha, setFormSenha] = useState({ senhaAtual: '', novaSenha: '', confirmarSenha: '' });
  const [savingSenha, setSavingSenha] = useState(false);

  const [msg, setMsg] = useState({ tipo: '', texto: '' });

  const carregarPerfilCompleto = async (signal) => {
    try {
      setLoadingPerfil(true);
      setErroPerfil('');
      const res = await fetch(`${API_PROFESSORES}/meu-perfil`, { credentials: 'include', cache: 'no-store', signal });
      const data = await lerRespostaApi(res);
      setPerfil(data.data || null);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Erro ao carregar perfil:', err);
        setErroPerfil(err.message || 'Não foi possível carregar o perfil do professor.');
      }
    } finally {
      if (!signal?.aborted) setLoadingPerfil(false);
    }
  };

  const carregarTurmas = async (signal) => {
    try {
      const res = await fetch(`${API_PROFESSORES}/meu-painel/turmas`, { credentials: 'include', cache: 'no-store', signal });
      const data = await lerRespostaApi(res);
      const todas = [...(data.turmasDiretor || []), ...(data.turmasLecionadas || [])];
      const unicas = Array.from(new Map(todas.map((turma) => [turma.turma_id, turma])).values());
      setTurmas(unicas);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Erro ao carregar turmas:', err);
        setTurmas([]);
        setMsg({ tipo: 'erro', texto: err.message || 'Não foi possível carregar as turmas.' });
      }
    }
  };

  const carregarTrimestres = async (signal) => {
    try {
      const res = await fetch(`${API_NOTAS}/trimestres`, { credentials: 'include', cache: 'no-store', signal });
      const data = await lerRespostaApi(res);
      const lista = Array.isArray(data.dados) ? data.dados : [];
      setTrimestres(lista);
      setEscalaNota(data.escala_nota || '0-20');
      if (lista.length === 0) setMsg({ tipo: 'erro', texto: 'Não há períodos ativos configurados para a escola.' });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Erro ao carregar períodos:', err);
        setTrimestres([]);
        setMsg({ tipo: 'erro', texto: err.message || 'Não foi possível carregar os períodos letivos.' });
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void Promise.all([
        carregarPerfilCompleto(controller.signal),
        carregarTurmas(controller.signal),
        carregarTrimestres(controller.signal)
      ]);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const handleAlterarSenha = async (e) => {
    e.preventDefault();
    if (formSenha.novaSenha !== formSenha.confirmarSenha) {
      setMsg({ tipo: 'erro', texto: 'As novas senhas não coincidem.' });
      return;
    }

    try {
      setSavingSenha(true);
      setMsg({ tipo: '', texto: '' });
      const res = await fetch(`${API_ESCOLAS}/utilizadores/alterar-senha`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha_atual: formSenha.senhaAtual, nova_senha: formSenha.novaSenha })
      });
      const data = await lerRespostaApi(res);
      setMsg({ tipo: 'sucesso', texto: data.message || 'Senha alterada com sucesso!' });
      setFormSenha({ senhaAtual: '', novaSenha: '', confirmarSenha: '' });
      setTimeout(() => setMsg({ tipo: '', texto: '' }), 4000);
    } catch (err) {
      setMsg({ tipo: 'erro', texto: err.message });
    } finally {
      setSavingSenha(false);
    }
  };

  useTeacherPageHeader({
    title: 'CONFIGURAÇÕES DO DOCENTE',
    description: 'Gira o seu perfil, a estrutura de avaliações e a segurança da conta.',
    onRefresh: () => Promise.all([
      carregarPerfilCompleto(),
      carregarTurmas(),
      carregarTrimestres()
    ]),
    actions: [{
      label: 'Segurança da conta',
      icon: <BsShieldLock />,
      onClick: () => setAbaAtiva('seguranca')
    }]
  });

  const conta = perfil || {};
  const utilizador = perfil || {};
  const cotacaoMaxima = Number(escalaNota.split('-')[1]) || 20;

  return (
    <div className="owner-config-page teacher-settings-page">
      {msg.texto && (
        <div className={`owner-config-message ${msg.tipo === 'erro' ? 'is-error' : 'is-success'}`} role="alert">
          {msg.tipo === 'erro' ? <BsShieldLock /> : <BsShieldCheck />}
          {msg.texto}
        </div>
      )}
      {loadingPerfil && <p className="owner-config-message" role="status">A carregar a ficha institucional…</p>}
      {erroPerfil && <p className="owner-config-message is-error" role="alert">{erroPerfil}</p>}

      <section className="owner-config-summary" aria-label="Resumo das configurações do professor">
        <article className="owner-config-summary-card">
          <span className="owner-config-summary-icon is-blue"><BsPeople /></span>
          <span><small>Turmas atribuídas</small><strong>{loadingPerfil ? '—' : turmas.length}</strong></span>
        </article>
        <article className="owner-config-summary-card">
          <span className="owner-config-summary-icon is-violet"><BsCalendarCheck /></span>
          <span><small>Períodos letivos</small><strong>{loadingPerfil ? '—' : trimestres.length}</strong></span>
        </article>
        <article className="owner-config-summary-card">
          <span className="owner-config-summary-icon is-green"><BsJournalPlus /></span>
          <span><small>Escala de avaliação</small><strong>{escalaNota}</strong></span>
        </article>
      </section>

      <div className="owner-config-workspace">
        <aside className="owner-config-sidebar">
          <div className="owner-config-sidebar-heading">
            <BsGear />
            <div><strong>Centro de controlo</strong><small>Configurações do docente</small></div>
          </div>
          <nav className="owner-config-nav" aria-label="Configurações do professor">
            {secoes.map((secao) => {
              const Icon = secao.icon;
              const isActive = abaAtiva === secao.id;
              return (
                <button
                  key={secao.id}
                  type="button"
                  onClick={() => setAbaAtiva(secao.id)}
                  className={`owner-config-nav-item${isActive ? ' is-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="owner-config-nav-icon"><Icon /></span>
                  <span><strong>{secao.title}</strong><small>{secao.description}</small></span>
                  <span className="owner-config-nav-marker" />
                </button>
              );
            })}
          </nav>
          <div className="owner-config-sidebar-note">
            <BsShieldCheck />
            <p>Consulte os seus dados, turmas e períodos letivos. A palavra-passe pode ser atualizada na secção Segurança.</p>
          </div>
        </aside>

        <main className="owner-config-main">

      {/* ========================================================== */}
      {/* ABA 1: PERFIL DO PROFESSOR (Com foto em círculo e dados completos) */}
      {/* ========================================================== */}
      {abaAtiva === 'perfil' && (
        <div className="teacher-settings-profile-layout">
          <div className="teacher-settings-profile-card">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              {conta.foto_url ? (
                <img src={conta.foto_url} alt={`Fotografia de ${conta.nome || 'professor'}`} style={{ width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #0284c7' }} />
              ) : (
                <div style={{ width: '90px', height: '90px', borderRadius: '50%', background: '#0284c7', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 'bold' }}>
                  {(conta.nome || 'PR').substring(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 4px 0' }}>{conta.nome || 'Professor'}</h3>
            <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold' }}>
              {conta.cargo || 'Professor'}
            </span>
            <p style={{ margin: '12px 0 0', fontSize: '12px', color: '#475569' }}>{conta.escola_nome || 'Escola não identificada'}</p>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>{conta.polo_nome || 'Polo não atribuído'}</p>
          </div>

          <div className="owner-config-panel teacher-settings-account-card">
            <header className="owner-config-panel-heading">
              <div>
                <span className="owner-config-eyebrow">Informações da conta</span>
                <h2>Dados do docente</h2>
                <p>Informações pessoais e institucionais associadas ao seu acesso.</p>
              </div>
            </header>

            <div className="teacher-settings-account-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '13px' }}>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>NOME COMPLETO</span>
                <strong style={{ color: '#0f172a' }}>{conta.nome || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>EMAIL INSTITUCIONAL</span>
                <strong style={{ color: '#0284c7' }}>{conta.email || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>TELEFONE</span>
                <strong style={{ color: '#0f172a' }}>{conta.telefone || 'Não registado'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>ID DE LOGIN</span>
                <code style={{ color: '#0284c7' }}>{utilizador.login_id || 'N/A'}</code>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>ESCOLA ATIVA</span>
                <strong style={{ color: '#0f172a' }}>{conta.escola_nome || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>ESTADO DA CONTA</span>
                <span style={{ color: conta.status_ativo ? '#166534' : '#991b1b', fontWeight: 'bold' }}>{conta.status_ativo ? 'Ativo' : 'Inativo'}</span>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>DOCUMENTO / CÉDULA</span>
                <strong style={{ color: '#0f172a' }}>{conta.bi_ou_cedula || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>NIF PESSOAL</span>
                <strong style={{ color: '#0f172a' }}>{conta.nif_pessoal || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>DATA DE NASCIMENTO</span>
                <strong style={{ color: '#0f172a' }}>{conta.data_nascimento ? new Date(conta.data_nascimento).toLocaleDateString('pt-PT') : 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>GÉNERO / ESTADO CIVIL</span>
                <strong style={{ color: '#0f172a' }}>{[conta.genero, conta.estado_civil].filter(Boolean).join(' · ') || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>NACIONALIDADE</span>
                <strong style={{ color: '#0f172a' }}>{conta.nacionalidade || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>HABILITAÇÕES</span>
                <strong style={{ color: '#0f172a' }}>{conta.habilitacao_complementar || conta.habilitacoes_literarias || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>ESPECIALIDADE / GRAU</span>
                <strong style={{ color: '#0f172a' }}>{[conta.especialidade, conta.grau_academico].filter(Boolean).join(' · ') || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>REGIME / EXPERIÊNCIA</span>
                <strong style={{ color: '#0f172a' }}>{[conta.regime_trabalho, conta.anos_experiencia ? `${conta.anos_experiencia} anos` : null].filter(Boolean).join(' · ') || 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>DATA DE ADMISSÃO</span>
                <strong style={{ color: '#0f172a' }}>{conta.data_admissao ? new Date(conta.data_admissao).toLocaleDateString('pt-PT') : 'N/A'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px', fontWeight: 'bold' }}>MORADA</span>
                <strong style={{ color: '#0f172a' }}>{[conta.morada, conta.bairro, conta.regiao].filter(Boolean).join(' · ') || 'N/A'}</strong>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ========================================================== */}
      {/* ABA 2: NOTAS TRIMESTRAIS */}
      {/* ========================================================== */}
      {abaAtiva === 'notas' && (
        <section className="owner-config-panel">
          <header className="owner-config-panel-heading">
            <div>
              <span className="owner-config-eyebrow">Configuração pedagógica</span>
              <h2>Pauta de notas trimestrais</h2>
              <p>
            O lançamento é feito por aluno e disciplina na pauta, com N1, N2, N3, N4, MAC, prova final e média final.
              </p>
            </div>
          </header>
          <div className="teacher-settings-lists">
            <div>
              <h3>
                <BsBuilding color="#0284c7" /> Turmas atribuídas ({turmas.length})
              </h3>
              {turmas.length ? (
                <ul style={{ margin: 0, paddingLeft: '20px', color: '#334155', fontSize: '13px' }}>
                  {turmas.map((turma) => <li key={turma.turma_id}>{turma.nome_turma}{turma.classe ? ` · ${turma.classe}` : ''}</li>)}
                </ul>
              ) : <p style={{ color: '#64748b', fontSize: '13px' }}>Nenhuma turma atribuída.</p>}
            </div>
            <div>
              <h3>
                <BsCalendarEvent color="#0284c7" /> Períodos letivos ({trimestres.length})
              </h3>
              {trimestres.length ? (
                <ul style={{ margin: 0, paddingLeft: '20px', color: '#334155', fontSize: '13px' }}>
                  {trimestres.map((trimestre) => <li key={trimestre.id}>{trimestre.ano_nome} · {trimestre.nome}</li>)}
                </ul>
              ) : <p style={{ color: '#64748b', fontSize: '13px' }}>Nenhum período letivo ativo.</p>}
            </div>
          </div>
          <p className="teacher-settings-scale-note">
            Escala de notas definida pela Direção: <strong>{cotacaoMaxima} ({escalaNota})</strong>.
          </p>
          <Link href="/dashboard/professor/notas" className="owner-config-primary-button">
            <BsBook /> Abrir pauta de notas
          </Link>
        </section>
      )}

      {/* ========================================================== */}
      {/* ABA 3: SEGURANÇA & ALTERAÇÃO DE SENHA */}
      {/* ========================================================== */}
      {abaAtiva === 'seguranca' && (
        <section className="owner-config-panel teacher-settings-security">
          <header className="owner-config-panel-heading">
            <div>
              <span className="owner-config-eyebrow">Segurança da conta</span>
              <h2>Alterar palavra-passe</h2>
              <p>Atualize a sua palavra-passe para proteger o acesso ao sistema escolar.</p>
            </div>
          </header>

          <form onSubmit={handleAlterarSenha} className="teacher-settings-password-form">
            <div className="owner-config-field">
              <label htmlFor="teacher-current-password">SENHA ATUAL</label>
              <input id="teacher-current-password" type="password" autoComplete="current-password" value={formSenha.senhaAtual} onChange={(e) => setFormSenha({ ...formSenha, senhaAtual: e.target.value })} required />
            </div>
            <div className="owner-config-field">
              <label htmlFor="teacher-new-password">NOVA SENHA</label>
              <input id="teacher-new-password" type="password" autoComplete="new-password" value={formSenha.novaSenha} onChange={(e) => setFormSenha({ ...formSenha, novaSenha: e.target.value })} required />
            </div>
            <div className="owner-config-field">
              <label htmlFor="teacher-confirm-password">CONFIRMAR NOVA SENHA</label>
              <input id="teacher-confirm-password" type="password" autoComplete="new-password" value={formSenha.confirmarSenha} onChange={(e) => setFormSenha({ ...formSenha, confirmarSenha: e.target.value })} required />
            </div>
            <div className="configuracao-form-actions">
              <button type="submit" disabled={savingSenha} className="ce-btn-submit">
                <BsSave /> {savingSenha ? 'A atualizar...' : 'Atualizar Senha'}
              </button>
            </div>
          </form>
        </section>
      )}

        </main>
      </div>
    </div>
  );
}