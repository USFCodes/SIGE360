'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BsEye, BsSearch, BsX, BsReceiptCutoff, BsCheckCircleFill, BsExclamationCircleFill } from 'react-icons/bs';
import '@/styles/s3.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_TESOURARIA = `${API_BASE}/api/v1/tesouraria`;
const API_ESCOLAS = `${API_BASE}/api/v1/escolas`;
const API_AUTH = `${API_BASE}/api/v1/auth`;

async function lerRespostaApi(response) {
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Resposta inválida da API (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha no servidor (HTTP ${response.status}).`);
  }
  return data;
}

function ordenarAnosLetivos(anos) {
  return [...anos].sort((a, b) => {
    if (Boolean(a.ativo) !== Boolean(b.ativo)) return a.ativo ? -1 : 1;
    return String(b.data_inicio || '').localeCompare(String(a.data_inicio || '')) ||
      String(a.ano_nome || '').localeCompare(String(b.ano_nome || ''), 'pt');
  });
}

export default function RastreioPagamentosPage({ escolaIdProp }) {
  const [escolaId, setEscolaId] = useState(escolaIdProp || '');
  
  // Filtros Globais
  const [anosLetivos, setAnosLetivos] = useState([]);
  const [anoLetivoId, setAnoLetivoId] = useState('');
  const [polos, setPolos] = useState([]);
  const [poloId, setPoloId] = useState('');
  const [turmas, setTurmas] = useState([]);
  const [turmaId, setTurmaId] = useState('');
  const [buscaAluno, setBuscaAluno] = useState('');
  const [pagina, setPagina] = useState(1);
  const [paginacao, setPaginacao] = useState({ pagina: 1, por_pagina: 25, total_registos: 0, total_paginas: 0 });

  // Dados dos Alunos e Extrato
  const [alunos, setAlunos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  const [alunoExtrato, setAlunoExtrato] = useState(null);

  // 1. Carregar Ano Letivo Corrente, Polos e Turmas
  useEffect(() => {
    const controller = new AbortController();
    const carregarEstrutura = async () => {
      try {
        let idEscola = escolaIdProp || '';
        if (!idEscola) {
          const sessaoRes = await fetch(`${API_AUTH}/me`, { credentials: 'include', signal: controller.signal });
          const sessaoData = await lerRespostaApi(sessaoRes);
          idEscola = sessaoData.data?.conta_ativa?.escola_id || '';
          setEscolaId(idEscola);
        }
        if (!idEscola) return;

        const [resAnos, resPolos] = await Promise.all([
          fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(idEscola)}/anos-letivos`, { credentials: 'include', signal: controller.signal }),
          fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(idEscola)}/polos`, { credentials: 'include', signal: controller.signal })
        ]);

        const [dataAnos, dataPolos] = await Promise.all([lerRespostaApi(resAnos), lerRespostaApi(resPolos)]);
        const listaAnos = ordenarAnosLetivos(Array.isArray(dataAnos.dados) ? dataAnos.dados : []);
        const listaPolos = Array.isArray(dataPolos.data) ? dataPolos.data : [];

        setAnosLetivos(listaAnos);
        // Ano Letivo Selecionado Automaticamente (Corrente/Ativo)
        const anoAtivo = listaAnos.find(a => a.ativo) || listaAnos[0];
        if (anoAtivo) setAnoLetivoId(String(anoAtivo.ano_letivo_id || anoAtivo.id));

        setPolos(listaPolos);
        if (listaPolos.length) setPoloId(String(listaPolos[0].id));
      } catch (err) {
        if (!controller.signal.aborted) {
          setErro(err.message || 'Não foi possível carregar a estrutura escolar.');
        }
      }
    };
    carregarEstrutura();
    return () => controller.abort();
  }, [escolaIdProp]);

  // 2. Carregar Turmas com base no Ano e Polo selecionados
  useEffect(() => {
    if (!escolaId || !anoLetivoId || !poloId) return;
    const controller = new AbortController();
    const carregarTurmas = async () => {
      try {
        const res = await fetch(`${API_ESCOLAS}/${encodeURIComponent(escolaId)}/turmas?ano_letivo_id=${anoLetivoId}&polo_id=${poloId}`, { credentials: 'include', signal: controller.signal });
        const data = await lerRespostaApi(res);
        const listaTurmas = Array.isArray(data.dados) ? data.dados : [];
        setTurmas(listaTurmas);
        setTurmaId('');
      } catch (err) {
        if (!controller.signal.aborted) {
          setTurmas([]);
          setTurmaId('');
          setErro(err.message || 'Não foi possível carregar as turmas.');
        }
      }
    };
    carregarTurmas();
    return () => controller.abort();
  }, [escolaId, anoLetivoId, poloId]);

  // 3. Carregar Rastreio de Pagamentos dos Alunos
  const carregarRastreio = useCallback(async (signal) => {
    if (!anoLetivoId || !poloId) return;
    try {
      setLoading(true);
      setErro('');
      const params = new URLSearchParams({
        ano_letivo_id: anoLetivoId,
        polo_id: poloId,
        pagina: String(pagina),
        por_pagina: '25'
      });
      if (turmaId) params.set('turma_id', turmaId);
      if (buscaAluno.trim()) params.set('busca', buscaAluno.trim());

      const res = await fetch(`${API_TESOURARIA}/rastreio-alunos?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
        signal
      });
      const data = await lerRespostaApi(res);
      if (!Array.isArray(data.dados) || !data.paginacao) {
        throw new Error('A API não devolveu a conta financeira dos alunos.');
      }
      setAlunos(data.dados);
      setPaginacao(data.paginacao);
    } catch (err) {
      if (signal?.aborted) return;
      console.error('Erro ao carregar rastreio de alunos:', err);
      setAlunos([]);
      setPaginacao({ pagina, por_pagina: 25, total_registos: 0, total_paginas: 0 });
      setErro(err.message || 'Erro ao consultar o rastreio de alunos.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [anoLetivoId, poloId, turmaId, buscaAluno, pagina]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => carregarRastreio(controller.signal));
    return () => controller.abort();
  }, [carregarRastreio]);

  // Totais da Turma / Seleção
  const totalTurmaConstante = useMemo(() => alunos.reduce((sum, a) => sum + Number(a.totalEscola || 0), 0), [alunos]);
  const totalTurmaPago = useMemo(() => alunos.reduce((sum, a) => sum + Number(a.jaPagou || 0), 0), [alunos]);
  const totalTurmaSobra = useMemo(() => alunos.reduce((sum, a) => sum + Number(a.sobra || 0), 0), [alunos]);

  // Visualizar Extrato do Aluno
  const verExtratoAluno = (aluno) => {
    setAlunoExtrato(aluno);
  };

  return (
    <>
      <header className="rastreio-header">
        <div>
          <h1>Contas financeiras dos alunos</h1>
          <p>Consulte as cobranças definidas pela escola, os pagamentos confirmados e o saldo de cada matrícula.</p>
        </div>
      </header>

      {erro && <div className="recibos-alert" role="alert">{erro}</div>}

      {/* BARRA DE FILTROS HIERÁRQUICA: ANO LETIVO -> POLO -> TURMA -> PESQUISA */}
      <section className="rastreio-toolbar">
        <div className="rastreio-field">
          <label htmlFor="rastreio-ano-letivo">Ano letivo</label>
          <select id="rastreio-ano-letivo" value={anoLetivoId} onChange={(e) => { setAnoLetivoId(e.target.value); setPagina(1); }} className="rastreio-select">
            {anosLetivos.map(a => (
              <option key={a.ano_letivo_id || a.id} value={a.ano_letivo_id || a.id}>
                {a.ano_nome}{a.ativo ? ' (Ativo)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="rastreio-field">
          <label>Ramo / Polo</label>
          <select value={poloId} onChange={(e) => { setPoloId(e.target.value); setPagina(1); }} className="rastreio-select">
            {polos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>

        <div className="rastreio-field">
          <label>Turma</label>
          <select value={turmaId} onChange={(e) => { setTurmaId(e.target.value); setPagina(1); }} className="rastreio-select">
            <option value="">Todas as Turmas</option>
            {turmas.map(t => <option key={t.id} value={t.id}>{t.nome || t.classe}</option>)}
          </select>
        </div>

        <div className="rastreio-field" style={{ flex: 1.5 }}>
          <label>Pesquisar Aluno</label>
          <input
            type="search"
            placeholder="Nome ou Número de Matrícula..."
            value={buscaAluno}
            onChange={(e) => { setBuscaAluno(e.target.value); setPagina(1); }}
            className="rastreio-input"
          />
        </div>
      </section>

      {/* SUMÁRIO FINANCEIRO DA SELEÇÃO */}
      <div className="rastreio-summary-grid">
        <div className="summary-card">
          <span>Total previsto no ano (esta página)</span>
          <div className="val val-total">{totalTurmaConstante.toLocaleString('pt-PT')} CFA</div>
        </div>
        <div className="summary-card">
          <span>Total já pago (esta página)</span>
          <div className="val val-pago">+ {totalTurmaPago.toLocaleString('pt-PT')} CFA</div>
        </div>
        <div className="summary-card">
          <span>Saldo em falta (esta página)</span>
          <div className="val val-sobra">{totalTurmaSobra.toLocaleString('pt-PT')} CFA</div>
        </div>
      </div>

      {/* TABELA DE ALUNOS COM PROPINAS E SALDOS */}
      <div className="rastreio-table-wrap">
        <table className="rastreio-table">
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>Nome do Aluno</th>
              <th>Turma</th>
              <th style={{ textAlign: 'right' }}>Previsto no ano</th>
              <th style={{ textAlign: 'right' }}>Já Pagou</th>
              <th style={{ textAlign: 'right' }}>Sobra (Dívida)</th>
              <th>Estado da Conta</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>A calcular saldos dos alunos...</td></tr>
            ) : alunos.length ? (
              alunos.map((aluno) => {
                const quitado = aluno.sobra <= 0;
                const temCredito = Number(aluno.credito) > 0;
                return (
                  <tr key={aluno.id}>
                    <td><code>{aluno.matricula}</code></td>
                    <td><strong>{aluno.nome}</strong></td>
                    <td>{aluno.turma}</td>
                    <td style={{ textAlign: 'right', fontWeight: '600' }}>{Number(aluno.totalEscola).toLocaleString('pt-PT')} CFA</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#059669' }}>
                      + {Number(aluno.jaPagou).toLocaleString('pt-PT')} CFA
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: quitado ? '#059669' : '#dc2626' }}>
                      {Number(aluno.sobra).toLocaleString('pt-PT')} CFA
                    </td>
                    <td>
                      <span className={quitado ? 'badge-status-pago' : 'badge-status-devedor'}>
                        {quitado
                          ? <><BsCheckCircleFill /> {temCredito ? 'Com crédito' : 'Liquidado'}</>
                          : <><BsExclamationCircleFill /> Por liquidar</>}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn-extrato" onClick={() => verExtratoAluno(aluno)}>
                        <BsEye /> Ver Extrato
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr><td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>Nenhum aluno encontrado nesta seleção.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className="rastreio-pagination" aria-label="Paginação das contas dos alunos">
        <span>
          {paginacao.total_registos
            ? `A mostrar ${(pagina - 1) * paginacao.por_pagina + 1}–${Math.min(pagina * paginacao.por_pagina, paginacao.total_registos)} de ${paginacao.total_registos} alunos`
            : 'Sem alunos nesta seleção'}
        </span>
        <div>
          <button type="button" onClick={() => setPagina((atual) => Math.max(1, atual - 1))} disabled={loading || pagina <= 1}>
            Anterior
          </button>
          <span>Página {paginacao.total_paginas ? pagina : 0} de {paginacao.total_paginas}</span>
          <button type="button" onClick={() => setPagina((atual) => Math.min(paginacao.total_paginas, atual + 1))} disabled={loading || pagina >= paginacao.total_paginas}>
            Seguinte
          </button>
        </div>
      </nav>

      {/* MODAL DE EXTRATO DO ALUNO */}
      {alunoExtrato && (
        <div className="rastreio-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAlunoExtrato(null); }}>
          <section className="rastreio-modal" role="dialog" aria-modal="true">
            <div className="rastreio-modal-header">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#1e3a8a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BsReceiptCutoff /> Extrato de Pagamentos · {alunoExtrato.nome}
              </h2>
              <button type="button" onClick={() => setAlunoExtrato(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}>
                <BsX />
              </button>
            </div>

            <div style={{ marginBottom: '16px', background: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.85rem' }}>
              <div><strong>Matrícula:</strong> {alunoExtrato.matricula} | <strong>Turma:</strong> {alunoExtrato.turma}</div>
              <div style={{ marginTop: '4px', display: 'flex', gap: '16px' }}>
                <span>Total Escola: <strong>{alunoExtrato.totalEscola.toLocaleString()} CFA</strong></span>
                <span style={{ color: '#059669' }}>Pago: <strong>{alunoExtrato.jaPagou.toLocaleString()} CFA</strong></span>
                <span style={{ color: alunoExtrato.sobra > 0 ? '#dc2626' : '#059669' }}>Falta: <strong>{alunoExtrato.sobra.toLocaleString()} CFA</strong></span>
              </div>
              {Number(alunoExtrato.credito) > 0 && (
                <div style={{ marginTop: '4px', color: '#0369a1' }}>
                  Crédito não aplicado: <strong>{Number(alunoExtrato.credito).toLocaleString('pt-PT')} CFA</strong>
                </div>
              )}
            </div>

            <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#475569', marginBottom: '8px' }}>Conta por item de pagamento</h4>
            <div className="rastreio-table-wrap">
              <table className="rastreio-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Parcelas</th>
                    <th style={{ textAlign: 'right' }}>Previsto</th>
                    <th style={{ textAlign: 'right' }}>Pago</th>
                    <th style={{ textAlign: 'right' }}>Em falta</th>
                  </tr>
                </thead>
                <tbody>
                  {alunoExtrato.conta_itens?.length ? alunoExtrato.conta_itens.map((item) => (
                    <tr key={item.id}>
                      <td>{item.nome}</td>
                      <td>{item.parcelas_previstas}</td>
                      <td style={{ textAlign: 'right' }}>{Number(item.total_previsto).toLocaleString('pt-PT')} CFA</td>
                      <td style={{ textAlign: 'right', color: '#059669' }}>{Number(item.total_pago).toLocaleString('pt-PT')} CFA</td>
                      <td style={{ textAlign: 'right', color: item.saldo > 0 ? '#dc2626' : '#059669' }}>{Number(item.saldo).toLocaleString('pt-PT')} CFA</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5" style={{ textAlign: 'center', color: '#64748b' }}>Não há cobranças configuradas para esta conta.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#475569', marginBottom: '8px' }}>Histórico de Recibos no Ano Letivo</h4>
            
            <table className="rastreio-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Item de Pagamento</th>
                  <th style={{ textAlign: 'right' }}>Valor Pago</th>
                  <th>Referência</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {alunoExtrato.historico && alunoExtrato.historico.length > 0 ? (
                  alunoExtrato.historico.map((recibo) => (
                    <tr key={recibo.id}>
                      <td>{recibo.data}</td>
                      <td>{recibo.item}</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#059669' }}>
                        + {Number(recibo.valor).toLocaleString()} CFA
                      </td>
                      <td>{recibo.referencia || '—'}</td>
                      <td><span className="badge-status-pago">{recibo.estado === 'aprovado' ? 'Confirmado' : recibo.estado}</span></td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="5" style={{ textAlign: 'center', color: '#64748b' }}>Sem recibos registados para este aluno.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  );
}