'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BsFileEarmarkSpreadsheet, BsPrinterFill } from 'react-icons/bs';
import '@/styles/t1.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_TESOURARIA = `${API_BASE}/api/v1/tesouraria`;

async function lerRespostaApi(response) {
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Resposta inválida da API (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Não foi possível carregar o relatório (HTTP ${response.status}).`);
  }
  return data;
}

function formatarData(valor) {
  if (!valor) return '—';
  const data = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleDateString('pt-PT');
}

function formatarValor(valor) {
  return `${Number(valor || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} CFA`;
}

function formatarMes(mes) {
  const data = new Date(`${mes}-01T00:00:00`);
  return Number.isNaN(data.getTime())
    ? mes
    : data.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
}

function opcoesFechoMensal(ano) {
  if (!ano?.data_inicio || !ano?.data_fim) return [];
  const inicio = new Date(`${ano.data_inicio.slice(0, 10)}T00:00:00Z`);
  const fim = new Date(`${ano.data_fim.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) return [];

  const opcoes = [];
  let anoAtual = inicio.getUTCFullYear();
  let mesAtual = inicio.getUTCMonth();
  const anoFim = fim.getUTCFullYear();
  const mesFim = fim.getUTCMonth();
  while (anoAtual < anoFim || (anoAtual === anoFim && mesAtual <= mesFim)) {
    const mes = `${anoAtual}-${String(mesAtual + 1).padStart(2, '0')}`;
    const ultimoDia = new Date(Date.UTC(anoAtual, mesAtual + 1, 0)).toISOString().slice(0, 10);
    const dataFecho = ultimoDia > ano.data_fim.slice(0, 10) ? ano.data_fim.slice(0, 10) : ultimoDia;
    
    // 1. Obtemos o nome do mês em minúsculas (ex: "janeiro")
    const mesFormatado = formatarMes(mes);
    
    // 2. Transformamos a primeira letra em maiúscula e juntamos com o resto do texto
    const mesComMaiuscula = mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);

    opcoes.push({
      mes,
      dataFecho,
      // 3. Usamos a nova variável aqui
      label: `${mesComMaiuscula} · ${formatarData(dataFecho)}`
    });
    
    mesAtual += 1;
    if (mesAtual === 12) {
      mesAtual = 0;
      anoAtual += 1;
    }
  }
  return opcoes;
}


function nomeResponsavel(registo) {
  return registo.nome_responsavel || 'Não especificado';
}

function estadoLabel(estado) {
  if (estado === 'aprovado') return 'Registado';
  if (estado === 'registado') return 'Registado';
  if (estado === 'flagged') return 'Sinalizado';
  return estado || '—';
}

function Lancamento({ registo, estado = false, tipo }) {
  return (
    <div className={`t1-demonstrativo-lancamento ${tipo}`}>
      <div>
        <strong>{registo.descricao || 'Movimento de tesouraria'}</strong>
        <small>{nomeResponsavel(registo)} · {formatarData(registo.data_registo)}</small>
        {estado && (
          <span className={`t1-demonstrativo-estado ${registo.estado}`}>
            {estadoLabel(registo.estado)}
          </span>
        )}
      </div>
      <b>{formatarValor(registo.valor)}</b>
    </div>
  );
}

export default function RelatorioFinanceiro() {
  const [anosLetivos, setAnosLetivos] = useState([]);
  const [anoId, setAnoId] = useState('');
  const [mes, setMes] = useState('');
  const [nomeEscola, setNomeEscola] = useState('');
  const [relatorio, setRelatorio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const pedidoRef = useRef(null);

  const carregarRelatorio = useCallback(async (anoLetivoId, mesFecho) => {
    if (!anoLetivoId || !mesFecho) return;
    pedidoRef.current?.abort();
    const controller = new AbortController();
    pedidoRef.current = controller;
    setLoading(true);
    setErro('');
    try {
      const params = new URLSearchParams({ ano_letivo_id: anoLetivoId, mes: mesFecho });
      const data = await lerRespostaApi(await fetch(`${API_TESOURARIA}/relatorio-anual?${params}`, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal
      }));
      setNomeEscola(data.dados.escola_nome || '');
      setAnosLetivos(data.dados.anos_letivos || []);
      setRelatorio(data.dados.relatorio || null);
    } catch (error) {
      if (error.name !== 'AbortError' && !controller.signal.aborted) {
        console.error('Erro ao carregar demonstrativo do ano letivo:', error);
        setErro(error.message || 'Não foi possível carregar o demonstrativo.');
        setRelatorio(null);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const inicializar = async () => {
      setLoading(true);
      setErro('');
      try {
        const data = await lerRespostaApi(await fetch(`${API_TESOURARIA}/relatorio-anual`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        }));
        const dados = data.dados;
        const anoSelecionado = dados.anos_letivos?.find((ano) => ano.id === dados.relatorio?.ano_letivo?.id)
          || dados.anos_letivos?.[0];
        setNomeEscola(dados.escola_nome || '');
        setAnosLetivos(dados.anos_letivos || []);
        if (anoSelecionado && dados.relatorio) {
          setAnoId(anoSelecionado.id);
          setMes(dados.relatorio.mes);
          setRelatorio(dados.relatorio);
        } else {
          setAnoId('');
          setMes('');
          setRelatorio(null);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Erro ao iniciar demonstrativo:', error);
          setErro(error.message || 'Não foi possível carregar os anos letivos.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void inicializar();
    return () => {
      controller.abort();
      pedidoRef.current?.abort();
    };
  }, []);

  const anoSelecionado = anosLetivos.find((ano) => ano.id === anoId);
  const meses = useMemo(() => opcoesFechoMensal(anoSelecionado), [anoSelecionado]);
  const registos = relatorio?.registos || [];
  const totais = relatorio?.totais || {};
  const despesas = registos.filter((registo) => registo.tipo === 'saida');
  const receitasConfirmadas = registos.filter((registo) =>
    registo.tipo === 'entrada' && ['aprovado', 'registado'].includes(registo.estado)
  );
  const receitasSinalizadas = registos.filter((registo) =>
    registo.tipo === 'entrada' && registo.estado === 'flagged'
  );
  const resultadoLiquido = Number(totais.resultado_liquido || 0);
  const resultadoPositivo = resultadoLiquido > 0;
  const mesSelecionado = meses.find((item) => item.mes === mes);

  const selecionarAno = (event) => {
    const novoAnoId = event.target.value;
    const novoAno = anosLetivos.find((ano) => ano.id === novoAnoId);
    const novasOpcoes = opcoesFechoMensal(novoAno);
    const mesAtual = new Date().toISOString().slice(0, 7);
    const novoMes = novasOpcoes.find((opcao) => opcao.mes === mesAtual)?.mes
      || novasOpcoes.at(-1)?.mes
      || '';
    setAnoId(novoAnoId);
    setMes(novoMes);
    void carregarRelatorio(novoAnoId, novoMes);
  };

  return (
    <main className="t1-recibos-page t1-relatorio-page">
      <header className="t1-recibos-header t1-relatorio-header">
        <div>
          <span className="t1-recibos-kicker">TESOURARIA / CONTABILIDADE</span>
          <h1>Demonstrativo de resultados</h1>
          <p>Receitas registadas, despesas e pagamentos sinalizados do ano letivo.</p>
        </div>
        <div className="t1-recibos-actions">
          <button type="button" className="btn-imprimir-balanco" onClick={() => window.print()} disabled={!relatorio}>
            <BsPrinterFill aria-hidden="true" /> Imprimir demonstrativo
          </button>
          <button
            type="button"
            className="t1-recibos-refresh"
            onClick={() => void carregarRelatorio(anoId, mes)}
            disabled={loading || !anoId || !mes}
          >
            <BsFileEarmarkSpreadsheet aria-hidden="true" /> {loading ? 'A calcular…' : 'Atualizar valores'}
          </button>
        </div>
      </header>

      <section className="t1-recibos-panel t1-demonstrativo-panel">
        <div className="t1-recibos-filters t1-demonstrativo-filtros" aria-label="Seleção do ano letivo e fecho mensal">
          <label>
            Ano letivo
            <select value={anoId} onChange={selecionarAno} disabled={!anosLetivos.length}>
              {anosLetivos.length
                ? anosLetivos.map((ano) => <option key={ano.id} value={ano.id}>{ano.ano_nome}</option>)
                : <option value="">Sem ano letivo configurado</option>}
            </select>
          </label>
          <label>
            Mês de fecho
            <select
              value={mes}
              onChange={(event) => {
                const novoMes = event.target.value;
                setMes(novoMes);
                void carregarRelatorio(anoId, novoMes);
              }}
              disabled={!meses.length}
            >
              {meses.map((opcao) => <option key={opcao.mes} value={opcao.mes}>{opcao.label}</option>)}
            </select>
          </label>
          <p>O cálculo é acumulado desde o início do ano letivo até à data de fecho selecionada.</p>
        </div>

        {erro && <div className="msg-alerta msg-erro" role="alert">{erro}</div>}

        {!loading && !anosLetivos.length && !erro && (
          <div className="t1-recibos-empty t1-demonstrativo-sem-ano">
            Configure as datas de início e fim de um ano letivo para emitir este demonstrativo.
          </div>
        )}

        {relatorio && (
          <>
            <header className="t1-demonstrativo-cabecalho">
              <strong>{nomeEscola}</strong>
              <h2>Demonstração de resultados do ano letivo</h2>
              <p>{relatorio.ano_letivo?.ano_nome} · Período de {formatarData(relatorio.data_inicio)} até {formatarData(relatorio.data_fim)}</p>
              <p className="t1-demonstrativo-data-fecho">
                Demonstrativo acumulado até {mesSelecionado?.label || formatarData(relatorio.data_fim)}
              </p>
            </header>

            {loading && <div className="t1-demonstrativo-loading">A atualizar os valores do período…</div>}

            <div className={`t1-demonstrativo-colunas ${loading ? 'atualizando' : ''}`}>
              <section className="t1-demonstrativo-lado debito">
                <header><span>Débito</span><strong>Despesas / Saídas</strong><span>Valor</span></header>
                <div className="t1-demonstrativo-corpo">
                  {despesas.length ? despesas.map((registo) => (
                    <Lancamento key={`${registo.origem_registo}-${registo.id}`} registo={registo} tipo="saida" />
                  )) : <p className="t1-demonstrativo-vazio">Sem despesas ou saídas registadas.</p>}
                  {resultadoPositivo && (
                    <div className="t1-demonstrativo-lancamento resultado">
                      <div><strong>Excedente do período</strong><small>Receitas confirmadas superiores às despesas</small></div>
                      <b>{formatarValor(totais.resultado_liquido)}</b>
                    </div>
                  )}
                </div>
                <footer><strong>Total do débito</strong><b>{formatarValor(totais.total_debito)}</b></footer>
              </section>

              <section className="t1-demonstrativo-lado credito">
                <header><span>Crédito</span><strong>Receitas / Entradas</strong><span>Valor</span></header>
                <div className="t1-demonstrativo-corpo">
                  {receitasConfirmadas.length ? receitasConfirmadas.map((registo) => (
                    <Lancamento key={`${registo.origem_registo}-${registo.id}`} registo={registo} estado tipo="entrada" />
                  )) : <p className="t1-demonstrativo-vazio">Sem receitas confirmadas ou registadas.</p>}
                  {resultadoLiquido < 0 && (
                    <div className="t1-demonstrativo-lancamento resultado">
                      <div><strong>Défice do período</strong><small>Despesas superiores às receitas confirmadas</small></div>
                      <b>{formatarValor(Math.abs(resultadoLiquido))}</b>
                    </div>
                  )}
                </div>
                <footer><strong>Total do crédito</strong><b>{formatarValor(totais.total_credito)}</b></footer>
              </section>
            </div>

            <section className="t1-demonstrativo-pendentes">
              <header>
                <div>
                  <h3>Pagamentos sinalizados</h3>
                  <p>Não incluídas no resultado contabilístico registado.</p>
                </div>
                <strong>{formatarValor(totais.receitas_sinalizadas)}</strong>
              </header>
              {receitasSinalizadas.length ? (
                <div className="t1-demonstrativo-pendentes-lista">
                  {receitasSinalizadas.map((registo) => (
                    <Lancamento key={`${registo.origem_registo}-${registo.id}`} registo={registo} estado tipo="pendente" />
                  ))}
                </div>
              ) : <p className="t1-demonstrativo-vazio">Não há pagamentos sinalizados.</p>}
            </section>

            <footer className="t1-demonstrativo-resultado">
              <span>
                {resultadoLiquido > 0 ? 'Resultado líquido · Excedente'
                  : resultadoLiquido < 0 ? 'Resultado líquido · Défice' : 'Resultado líquido · Equilibrado'}
              </span>
              <strong className={resultadoLiquido > 0 ? 'entrada' : resultadoLiquido < 0 ? 'saida' : ''}>
                {formatarValor(Math.abs(resultadoLiquido))}
              </strong>
              <small>Valores apresentados em CFA · {Number(totais.quantidade || 0)} lançamentos no período</small>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}
