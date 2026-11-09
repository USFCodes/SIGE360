'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BsCheckCircleFill, BsExclamationCircleFill, BsReceiptCutoff } from 'react-icons/bs';
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
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Não foi possível carregar a conta financeira (HTTP ${response.status}).`);
  }
  return data;
}

function formatarMoeda(valor) {
  return `${Number(valor || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} CFA`;
}

function ordenarAnosLetivos(anos) {
  return [...anos].sort((a, b) => {
    if (Boolean(a.ativo) !== Boolean(b.ativo)) return a.ativo ? -1 : 1;
    return String(b.data_inicio || '').localeCompare(String(a.data_inicio || '')) ||
      String(a.ano_nome || '').localeCompare(String(b.ano_nome || ''), 'pt');
  });
}

export default function AlunoFinancasPage() {
  const [escolaId, setEscolaId] = useState('');
  const [escolaNome, setEscolaNome] = useState('');
  const [anos, setAnos] = useState([]);
  const [polos, setPolos] = useState([]);
  const [anoId, setAnoId] = useState('');
  const [poloId, setPoloId] = useState('');
  const [conta, setConta] = useState(null);
  const [loadingEstrutura, setLoadingEstrutura] = useState(true);
  const [loadingConta, setLoadingConta] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const carregarEstrutura = async () => {
      try {
        const sessao = await lerRespostaApi(await fetch(`${API_AUTH}/me`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        }));
        const escolaAtiva = sessao.data?.conta_ativa;
        if (!escolaAtiva?.escola_id) throw new Error('Não foi encontrada uma escola ativa para esta conta.');
        setEscolaId(escolaAtiva.escola_id);
        setEscolaNome(escolaAtiva.escola_nome || '');

        const [anosData, polosData] = await Promise.all([
          lerRespostaApi(await fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(escolaAtiva.escola_id)}/anos-letivos`, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          })),
          lerRespostaApi(await fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(escolaAtiva.escola_id)}/polos`, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          }))
        ]);
        const listaAnos = ordenarAnosLetivos(Array.isArray(anosData.dados) ? anosData.dados : []);
        const listaPolos = Array.isArray(polosData.data) ? polosData.data.filter((polo) => polo.ativo) : [];
        setAnos(listaAnos);
        setPolos(listaPolos);
        const anoAtivo = listaAnos.find((ano) => ano.ativo) || listaAnos[0];
        if (anoAtivo) setAnoId(String(anoAtivo.ano_letivo_id || anoAtivo.id));
        if (listaPolos.length) setPoloId(String(listaPolos[0].id));
      } catch (error) {
        if (!controller.signal.aborted) setErro(error.message || 'Não foi possível carregar os dados escolares.');
      } finally {
        if (!controller.signal.aborted) setLoadingEstrutura(false);
      }
    };
    void carregarEstrutura();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!escolaId || !anoId || !poloId) return undefined;
    const controller = new AbortController();
    const carregarConta = async () => {
      try {
        setLoadingConta(true);
        setErro('');
        const params = new URLSearchParams({
          ano_letivo_id: anoId,
          polo_id: poloId,
          por_pagina: '25'
        });
        const data = await lerRespostaApi(await fetch(`${API_TESOURARIA}/rastreio-alunos?${params}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        }));
        if (!controller.signal.aborted) setConta(data.dados?.[0] || null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setConta(null);
          setErro(error.message || 'Não foi possível consultar a sua conta financeira.');
        }
      } finally {
        if (!controller.signal.aborted) setLoadingConta(false);
      }
    };
    void carregarConta();
    return () => controller.abort();
  }, [anoId, escolaId, poloId]);

  const anoSelecionado = useMemo(() => anos.find((ano) =>
    String(ano.ano_letivo_id || ano.id) === anoId
  ), [anoId, anos]);
  const historico = conta?.historico || [];

  return (
    <main className="aluno-finance-page">
      <header className="rastreio-header">
        <div>
          <h1>{escolaNome || 'A minha conta financeira'}</h1>
          <p>Consulte cobranças do ano letivo, pagamentos confirmados e o valor ainda por liquidar.</p>
        </div>
      </header>

      {erro && <div className="recibos-alert" role="alert">{erro}</div>}
      <section className="rastreio-toolbar">
        <div className="rastreio-field">
          <label htmlFor="aluno-ano-financeiro">Ano letivo</label>
          <select
            id="aluno-ano-financeiro"
            className="rastreio-select"
            value={anoId}
            onChange={(event) => setAnoId(event.target.value)}
            disabled={loadingEstrutura}
          >
            {anos.map((ano) => {
              const id = String(ano.ano_letivo_id || ano.id);
              return <option key={id} value={id}>{ano.ano_nome}{ano.ativo ? ' (Ativo)' : ''}</option>;
            })}
          </select>
        </div>
        <div className="rastreio-field">
          <label htmlFor="aluno-polo-financeiro">Ramo</label>
          <select
            id="aluno-polo-financeiro"
            className="rastreio-select"
            value={poloId}
            onChange={(event) => setPoloId(event.target.value)}
            disabled={loadingEstrutura}
          >
            {polos.map((polo) => <option key={polo.id} value={String(polo.id)}>{polo.nome}</option>)}
          </select>
        </div>
      </section>

      {loadingEstrutura || loadingConta ? (
        <div className="sec-card">A carregar a sua conta a partir dos registos da escola...</div>
      ) : conta ? (
        <>
          <section className="aluno-conta-identificacao">
            <div>
              <span>Aluno</span>
              <strong>{conta.nome}</strong>
            </div>
            <div>
              <span>Matrícula · Turma</span>
              <strong>{conta.matricula} · {conta.turma}</strong>
            </div>
            <div>
              <span>Ano letivo</span>
              <strong>{anoSelecionado?.ano_nome || '—'}</strong>
            </div>
          </section>

          <div className="rastreio-summary-grid">
            <article className="summary-card">
              <span>Total previsto no ano</span>
              <div className="val val-total">{formatarMoeda(conta.totalEscola)}</div>
            </article>
            <article className="summary-card">
              <span>Total pago e confirmado</span>
              <div className="val val-pago">{formatarMoeda(conta.jaPagou)}</div>
            </article>
            <article className="summary-card">
              <span>Saldo em falta</span>
              <div className="val val-sobra">{formatarMoeda(conta.sobra)}</div>
            </article>
          </div>

          {Number(conta.credito) > 0 && (
            <div className="aluno-conta-credito">
              Crédito ainda não aplicado: <strong>{formatarMoeda(conta.credito)}</strong>
            </div>
          )}

          <section className="sec-card aluno-conta-section">
            <h2><BsReceiptCutoff aria-hidden="true" /> Conta por item</h2>
            <div className="rastreio-table-wrap">
              <table className="rastreio-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Parcelas previstas</th>
                    <th style={{ textAlign: 'right' }}>Previsto</th>
                    <th style={{ textAlign: 'right' }}>Pago</th>
                    <th style={{ textAlign: 'right' }}>Em falta</th>
                  </tr>
                </thead>
                <tbody>
                  {conta.conta_itens?.length ? conta.conta_itens.map((item) => (
                    <tr key={item.id}>
                      <td>{item.nome}</td>
                      <td>{item.parcelas_previstas}</td>
                      <td style={{ textAlign: 'right' }}>{formatarMoeda(item.total_previsto)}</td>
                      <td style={{ textAlign: 'right', color: '#059669' }}>{formatarMoeda(item.total_pago)}</td>
                      <td style={{ textAlign: 'right', color: item.saldo > 0 ? '#dc2626' : '#059669' }}>{formatarMoeda(item.saldo)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5">Não há cobranças configuradas para esta conta.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="sec-card aluno-conta-section">
            <h2>Histórico de pagamentos</h2>
            <div className="rastreio-table-wrap">
              <table className="rastreio-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Item</th>
                    <th>Referência</th>
                    <th>Método</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.length ? historico.map((pagamento) => (
                    <tr key={pagamento.id}>
                      <td>{new Date(`${pagamento.data}T00:00:00`).toLocaleDateString('pt-PT')}</td>
                      <td>{pagamento.item}</td>
                      <td>{pagamento.referencia || '—'}</td>
                      <td>{pagamento.metodo || '—'}</td>
                      <td style={{ textAlign: 'right', color: '#059669' }}>{formatarMoeda(pagamento.valor)}</td>
                      <td><span className="badge-status-pago"><BsCheckCircleFill aria-hidden="true" /> Confirmado</span></td>
                    </tr>
                  )) : (
                    <tr><td colSpan="6">Não há pagamentos confirmados para este ano letivo.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : !erro ? (
        <div className="sec-card aluno-conta-vazia">
          <BsExclamationCircleFill aria-hidden="true" />
          <p>Não foi encontrada uma matrícula sua neste ano letivo e ramo.</p>
        </div>
      ) : null}
    </main>
  );
}
