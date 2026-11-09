'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BsArrowDownCircleFill,
  BsArrowUpCircleFill,
  BsEye,
  BsPrinterFill,
  BsSearch,
  BsX,
  BsPlusLg
} from 'react-icons/bs';
import '@/styles/t1.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_TESOURARIA = `${API_BASE}/api/v1/tesouraria`;

const ESTADOS = {
  aprovado: 'Aprovado',
  flagged: 'Atenção',
  registado: 'Registado'
};

function dataLocalISO() {
  const hoje = new Date();
  return new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function lerRespostaApi(response) {
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Resposta inválida da API (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha ao consultar o livro-caixa (HTTP ${response.status}).`);
  }
  return data;
}

function formatarData(valor) {
  if (!valor) return '—';
  const data = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleDateString('pt-PT');
}

function formatarValor(valor) {
  return `${Number(valor || 0).toLocaleString('pt-PT')} CFA`;
}

function nomePagador(item) {
  if (item.origem_registo === 'movimento_manual') return item.nome_pagador || 'Não especificado';
  if (item.tipo_registo === 'aluno_registado') {
    return [item.aluno_nome, item.aluno_apelido].filter(Boolean).join(' ') || 'Aluno não identificado';
  }
  return item.nome_pagador || item.nome_candidato || 'Candidato não identificado';
}

export default function RecibosTesourariaPage() {
  const [registos, setRegistos] = useState([]);
  const [resumo, setResumo] = useState({
    total_entradas: 0,
    total_saidas: 0,
    saldo_liquido: 0,
    quantidade: 0
  });
  const [periodo, setPeriodo] = useState('hoje');
  const [datas, setDatas] = useState({ inicio: '', fim: '' });
  const [hoje, setHoje] = useState('');
  const [termoBusca, setTermoBusca] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [registoSelecionado, setRegistoSelecionado] = useState(null);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);
  const [erroDetalhes, setErroDetalhes] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const dataAtual = dataLocalISO();
      setHoje(dataAtual);
      setDatas({ inicio: dataAtual, fim: dataAtual });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const carregarRegistos = useCallback(async (signal) => {
    setLoading(true);
    setErro('');
    try {
      const params = new URLSearchParams({ periodo });
      if (periodo === 'intervalo') {
        params.set('data_inicio', datas.inicio);
        params.set('data_fim', datas.fim);
      }
      if (termoBusca.trim()) params.set('busca', termoBusca.trim());
      if (filtroEstado) params.set('estado', filtroEstado);
      if (filtroTipo !== 'todos') params.set('tipo', filtroTipo);

      const data = await lerRespostaApi(await fetch(`${API_TESOURARIA}/livro-caixa?${params}`, {
        credentials: 'include',
        cache: 'no-store',
        signal
      }));
      setRegistos(Array.isArray(data.dados) ? data.dados : []);
      setResumo(data.resumo || { total_entradas: 0, total_saidas: 0, saldo_liquido: 0, quantidade: 0 });
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Erro ao carregar livro-caixa:', error);
        setErro(error.message || 'Não foi possível carregar os recibos.');
        setRegistos([]);
        setResumo({ total_entradas: 0, total_saidas: 0, saldo_liquido: 0, quantidade: 0 });
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [periodo, datas, termoBusca, filtroEstado, filtroTipo]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => carregarRegistos(controller.signal));
    return () => controller.abort();
  }, [carregarRegistos]);

  const verDetalhes = async (item) => {
    setErroDetalhes('');
    if (item.origem_registo === 'movimento_manual') {
      setRegistoSelecionado(item);
      return;
    }

    setRegistoSelecionado(null);
    setCarregandoDetalhes(true);
    try {
      const data = await lerRespostaApi(await fetch(
        `${API_TESOURARIA}/pagamentos/${encodeURIComponent(item.id)}`,
        { credentials: 'include', cache: 'no-store' }
      ));
      setRegistoSelecionado({ ...item, ...data.dados });
    } catch (error) {
      console.error('Erro ao carregar detalhes do recibo:', error);
      setErroDetalhes(error.message || 'Não foi possível carregar os detalhes.');
    } finally {
      setCarregandoDetalhes(false);
    }
  };

  const dataTitulo = periodo === 'hoje'
    ? (hoje ? `Hoje · ${formatarData(hoje)}` : 'Hoje')
    : periodo === 'ultimos_7_dias'
      ? 'Últimos 7 dias'
      : periodo === 'este_mes'
        ? 'Este mês'
        : `${formatarData(datas.inicio)} – ${formatarData(datas.fim)}`;

  return (
    <>
      <header className="t1-recibos-header">
        <div>
          <span className="t1-recibos-kicker">TESOURARIA / CONSULTA</span>
          <h1>Livro de recibos</h1>
          <p>Consulte as entradas e saídas reais e filtre o período que precisa.</p>
        </div>
        <div className="t1-recibos-actions">
          <button type="button" className="btn-imprimir-balanco" onClick={() => window.print()} disabled={!registos.length}>
            <BsPrinterFill aria-hidden="true" /> Imprimir tabela
          </button>
          <Link className="t1-recibos-new" href="/dashboard/tesouraria/propinas">
            <BsPlusLg aria-hidden="true" /> Novo movimento
          </Link>
        </div>
      </header>

      <section className="t1-recibos-summary" aria-label="Resumo do período">
        <div className="t1-recibos-summary-card">
          <span>Entradas</span>
          <strong className="entrada">+ {formatarValor(resumo.total_entradas)}</strong>
        </div>
        <div className="t1-recibos-summary-card">
          <span>Saídas</span>
          <strong className="saida">− {formatarValor(resumo.total_saidas)}</strong>
        </div>
        <div className="t1-recibos-summary-card">
          <span>Saldo líquido</span>
          <strong className={resumo.saldo_liquido >= 0 ? 'entrada' : 'saida'}>{formatarValor(resumo.saldo_liquido)}</strong>
        </div>
        <div className="t1-recibos-summary-card">
          <span>Registos no período</span>
          <strong>{resumo.quantidade}</strong>
        </div>
      </section>

      {erro && <div className="msg-alerta msg-erro" role="alert">{erro}</div>}

      <section className="t1-recibos-panel">
        <div className="t1-recibos-panel-heading">
          <div>
            <h2>Movimentos financeiros</h2>
            <p>{dataTitulo} · Dados consultados na base de dados</p>
          </div>
        </div>

        <div className="t1-recibos-filters" aria-label="Filtros do livro de recibos">
          <label className="t1-recibos-search">
            <BsSearch aria-hidden="true" />
            <input
              type="search"
              value={termoBusca}
              onChange={(event) => setTermoBusca(event.target.value)}
              placeholder="Pesquisar nome, referência ou descrição"
              aria-label="Pesquisar movimentos"
            />
          </label>
          <select value={periodo} onChange={(event) => setPeriodo(event.target.value)} aria-label="Período">
            <option value="hoje">Hoje</option>
            <option value="ultimos_7_dias">Últimos 7 dias</option>
            <option value="este_mes">Este mês</option>
            <option value="intervalo">Intervalo de datas</option>
          </select>
          <select value={filtroTipo} onChange={(event) => setFiltroTipo(event.target.value)} aria-label="Tipo de movimento">
            <option value="todos">Entradas e saídas</option>
            <option value="entrada">Só entradas</option>
            <option value="saida">Só saídas</option>
          </select>
          <select value={filtroEstado} onChange={(event) => setFiltroEstado(event.target.value)} aria-label="Estado do pagamento">
            <option value="">Todos os estados</option>
            <option value="aprovado">Aprovado</option>
            <option value="flagged">Atenção</option>
            <option value="registado">Registado</option>
          </select>
          <button type="button" className="t1-recibos-refresh" onClick={() => void carregarRegistos()} disabled={loading}>
            Atualizar
          </button>
        </div>

        {periodo === 'intervalo' && (
          <div className="t1-recibos-date-range">
            <label>
              Data inicial
              <input type="date" value={datas.inicio} max={datas.fim} onChange={(event) => setDatas((atual) => ({ ...atual, inicio: event.target.value }))} />
            </label>
            <label>
              Data final
              <input type="date" value={datas.fim} min={datas.inicio} max={hoje || undefined} onChange={(event) => setDatas((atual) => ({ ...atual, fim: event.target.value }))} />
            </label>
          </div>
        )}

        <div className="t1-recibos-table-wrap">
          <table className="t1-recibos-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Data</th>
                <th>Pagador / destinatário</th>
                <th>Referência / TAL ID</th>
                <th>Descrição</th>
                <th className="t1-recibos-number">Montante</th>
                <th>Estado</th>
                <th aria-label="Ação" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" className="t1-recibos-empty">A consultar os movimentos…</td></tr>
              ) : registos.length ? registos.map((item) => {
                const ehEntrada = item.tipo === 'entrada';
                return (
                  <tr key={`${item.origem_registo}-${item.id}`}>
                    <td>
                      <span className={`t1-recibos-type ${ehEntrada ? 'entrada' : 'saida'}`}>
                        {ehEntrada ? <BsArrowDownCircleFill aria-hidden="true" /> : <BsArrowUpCircleFill aria-hidden="true" />}
                      </span>
                    </td>
                    <td>{formatarData(item.data_pagamento || item.criado_em)}</td>
                    <td>
                      <strong>{nomePagador(item)}</strong>
                      {item.numero_matricula && <small>Matrícula {item.numero_matricula}</small>}
                      {item.classe && <small>Classe {item.classe}</small>}
                    </td>
                    <td>
                      <code>{item.referencia_banco || '—'}</code>
                      {item.codigo_talao && <small>TAL ID: {item.codigo_talao}</small>}
                    </td>
                    <td>{item.item_nome || item.descricao || '—'}</td>
                    <td className={`t1-recibos-number ${ehEntrada ? 'entrada' : 'saida'}`}>
                      {ehEntrada ? '+' : '−'} {formatarValor(item.valor)}
                    </td>
                    <td><span className={`t1-recibos-state ${item.estado}`}>{ESTADOS[item.estado] || item.estado}</span></td>
                    <td>
                      <button type="button" className="t1-recibos-view" onClick={() => void verDetalhes(item)} aria-label={`Ver detalhes ${item.referencia_banco || ''}`}>
                        <BsEye aria-hidden="true" /> Ver
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan="8" className="t1-recibos-empty">Não existem registos para este período e filtros.</td></tr>
              )}
            </tbody>
            {registos.length > 0 && (
              <tfoot>
                <tr>
                  <th colSpan="5">Totais do período · {resumo.quantidade} registos</th>
                  <th className="t1-recibos-total-cell">
                    <span className="entrada">+ {formatarValor(resumo.total_entradas)}</span>
                    <span className="saida">− {formatarValor(resumo.total_saidas)}</span>
                  </th>
                  <th colSpan="2">Saldo: {formatarValor(resumo.saldo_liquido)}</th>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {(carregandoDetalhes || erroDetalhes || registoSelecionado) && (
        <div className="t1-recibos-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setRegistoSelecionado(null);
            setErroDetalhes('');
          }
        }}>
          <section className="t1-recibos-modal" role="dialog" aria-modal="true" aria-labelledby="t1-recibos-detail-title">
            <div className="t1-recibos-modal-heading">
              <div>
                <span>DETALHES DO MOVIMENTO</span>
                <h2 id="t1-recibos-detail-title">Detalhes do movimento</h2>
              </div>
              <button type="button" aria-label="Fechar" onClick={() => { setRegistoSelecionado(null); setErroDetalhes(''); }}>
                <BsX aria-hidden="true" />
              </button>
            </div>
            {carregandoDetalhes ? <p>A carregar detalhes…</p> : erroDetalhes ? (
              <p className="t1-recibos-alert" role="alert">{erroDetalhes}</p>
            ) : registoSelecionado && (
              <>
                <dl className="t1-recibos-details">
                  <div><dt>Tipo</dt><dd>{registoSelecionado.tipo === 'saida' ? 'Saída' : 'Entrada'}</dd></div>
                  <div><dt>Data</dt><dd>{formatarData(registoSelecionado.data_pagamento || registoSelecionado.data_movimento)}</dd></div>
                  <div><dt>Pagador / destinatário</dt><dd>{nomePagador(registoSelecionado)}</dd></div>
                  <div><dt>Referência / TAL ID</dt><dd>{registoSelecionado.codigo_talao || registoSelecionado.referencia_banco || '—'}</dd></div>
                  <div><dt>Método</dt><dd>{registoSelecionado.banco_origem || registoSelecionado.metodo || '—'}</dd></div>
                  <div><dt>Descrição</dt><dd>{registoSelecionado.item_nome || registoSelecionado.descricao || '—'}</dd></div>
                  {registoSelecionado.classe && <div><dt>Classe</dt><dd>{registoSelecionado.classe}</dd></div>}
                  <div><dt>Montante</dt><dd>{formatarValor(registoSelecionado.valor)}</dd></div>
                  <div><dt>Estado</dt><dd>{ESTADOS[registoSelecionado.estado] || registoSelecionado.estado || '—'}</dd></div>
                  <div className="t1-recibos-detail-wide"><dt>Observações</dt><dd>{registoSelecionado.observacoes || 'Sem observações.'}</dd></div>
                </dl>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
