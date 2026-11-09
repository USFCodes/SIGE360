'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BsSearch, BsArrowDownLeft, BsArrowUpRight, BsWallet2 } from 'react-icons/bs';
import '@/styles/a2.css';
import AdminHeader from '@/components/adminHeader';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_TESOURARIA = `${API_BASE}/api/v1/tesouraria`;

function dataFormatada(valor) {
    if (!valor) return '—';
    const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
    return ano && mes && dia ? `${dia}/${mes}/${ano}` : String(valor);
}

function valorFormatado(valor) {
    return `${Number(valor || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} CFA`;
}

function periodoLabel(periodo) {
    return ({
        hoje: 'Hoje',
        ultimos_7_dias: 'Últimos 7 dias',
        este_mes: 'Este mês',
        todos: 'Todos os períodos'
    })[periodo] || 'Todos os períodos';
}

function movimentoLabel(movimento) {
    return movimento.tipo === 'saida' ? 'Despesa' : 'Pagamento / Entrada';
}

function estadoLabel(estado) {
    if (estado === 'aprovado') return 'Confirmado';
    if (estado === 'registado') return 'Registado';
    if (estado === 'flagged') return 'Atenção';
    return estado || '—';
}

function obterNome(movimento) {
    return movimento.nome_pagador || '—';
}

export default function GestaoFinanceiraDirecao() {
    const [movimentos, setMovimentos] = useState([]);
    const [resumo, setResumo] = useState({ total_entradas: 0, total_saidas: 0, saldo_liquido: 0 });
    const [paginacao, setPaginacao] = useState({ pagina: 1, por_pagina: 25, total_registos: 0, total_paginas: 0 });
    const [escola, setEscola] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingEscola, setLoadingEscola] = useState(true);
    const [imprimirRelatorio, setImprimirRelatorio] = useState(false);
    const [dataEmissao, setDataEmissao] = useState('');
    const [mensagem, setMensagem] = useState({ texto: '', tipo: '' });
    const [abaPeriodo, setAbaPeriodo] = useState('hoje');
    const [tipoMovimento, setTipoMovimento] = useState('todos');
    const [paginaAtual, setPaginaAtual] = useState(1);
    const [termoBusca, setTermoBusca] = useState('');
    const [termoBuscaAplicado, setTermoBuscaAplicado] = useState('');

    const carregarDados = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams({
                periodo: abaPeriodo,
                tipo: tipoMovimento,
                pagina: String(paginaAtual),
                por_pagina: '25'
            });
            if (termoBuscaAplicado) params.set('busca', termoBuscaAplicado);
            const response = await fetch(`${API_TESOURARIA}/livro-caixa?${params}`, {
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await response.json();
            if (!response.ok || data.success !== true) {
                throw new Error(data.message || 'Não foi possível carregar os movimentos financeiros.');
            }
            setMovimentos(Array.isArray(data.dados) ? data.dados : []);
            setResumo(data.resumo || { total_entradas: 0, total_saidas: 0, saldo_liquido: 0 });
            setPaginacao(data.paginacao || { pagina: 1, por_pagina: 25, total_registos: 0, total_paginas: 0 });
        } catch (error) {
            console.error('Erro ao carregar movimentos financeiros da Direção:', error);
            setMensagem({
                texto: error.message || 'Erro de comunicação ao carregar os movimentos.',
                tipo: 'erro'
            });
        } finally {
            setLoading(false);
        }
    }, [abaPeriodo, paginaAtual, termoBuscaAplicado, tipoMovimento]);

    useEffect(() => {
        const timer = window.setTimeout(() => setTermoBuscaAplicado(termoBusca.trim()), 400);
        return () => window.clearTimeout(timer);
    }, [termoBusca]);

    useEffect(() => {
        void Promise.resolve().then(carregarDados);
    }, [carregarDados]);

    useEffect(() => {
        const terminarImpressao = () => setImprimirRelatorio(false);
        window.addEventListener('afterprint', terminarImpressao);
        return () => window.removeEventListener('afterprint', terminarImpressao);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const carregarEscola = async () => {
            try {
                const respostaSessao = await fetch(`${API_BASE}/api/v1/auth/me`, {
                    credentials: 'include',
                    cache: 'no-store',
                    signal: controller.signal
                });
                const sessao = await respostaSessao.json();
                if (!respostaSessao.ok || sessao.success !== true) {
                    throw new Error(sessao.message || 'Não foi possível carregar os dados da sessão.');
                }
                const escolaId = sessao.data?.conta_ativa?.escola_id;
                if (!escolaId) throw new Error('Não foi encontrada uma escola ativa para esta conta.');

                const respostaEscola = await fetch(
                    `${API_BASE}/api/v1/accounts/escolas/${encodeURIComponent(escolaId)}`,
                    { credentials: 'include', cache: 'no-store', signal: controller.signal }
                );
                const dadosEscola = await respostaEscola.json();
                if (!respostaEscola.ok || dadosEscola.success !== true || !dadosEscola.data) {
                    throw new Error(dadosEscola.message || 'Não foi possível carregar os dados da escola.');
                }
                setEscola(dadosEscola.data);
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error('Erro ao carregar identificação da escola para impressão:', error);
                setMensagem({
                    texto: error.message || 'Não foi possível carregar a identificação da escola.',
                    tipo: 'erro'
                });
            } finally {
                if (!controller.signal.aborted) setLoadingEscola(false);
            }
        };
        void carregarEscola();
        return () => controller.abort();
    }, []);

    const imprimirMovimentos = () => {
        setDataEmissao(new Date().toLocaleDateString('pt-PT'));
        setImprimirRelatorio(true);
        window.setTimeout(() => window.print(), 150);
    };

    const totalEntradas = Number(resumo.total_entradas || 0);
    const totalSaidas = Number(resumo.total_saidas || 0);
    const saldoLiquido = Number(resumo.saldo_liquido ?? totalEntradas - totalSaidas);
    const nomeTipoFiltro = tipoMovimento === 'entrada'
        ? 'Pagamentos / Entradas'
        : tipoMovimento === 'saida' ? 'Despesas / Saídas' : 'Todos os movimentos';

    return (
        <div className="escolas-container direcao-financas-page">
            <AdminHeader
                titulo="Gestão Financeira"
                descricao="Consulte pagamentos e despesas da escola, sem fluxo de aprovação."
                onRefresh={() => void carregarDados()}
                onPrint={imprimirMovimentos}
                printText="Imprimir movimentos"
                loading={loading || loadingEscola}
            />

            {mensagem.texto && (
                <div role={mensagem.tipo === 'erro' ? 'alert' : 'status'} className={`direcao-financas-alert ${mensagem.tipo}`}>
                    <span>{mensagem.texto}</span>
                </div>
            )}

            <section className="direcao-financas-summary" aria-label="Resumo de entradas e saídas">
                <article className="direcao-financas-summary-card entrada">
                    <span><BsArrowDownLeft aria-hidden="true" /> Total de entradas</span>
                    <strong>{valorFormatado(totalEntradas)}</strong>
                    <small>{Number(resumo.quantidade_entradas || 0)} pagamento(s) / entrada(s) no período</small>
                </article>
                <article className="direcao-financas-summary-card saida">
                    <span><BsArrowUpRight aria-hidden="true" /> Total de despesas</span>
                    <strong>{valorFormatado(totalSaidas)}</strong>
                    <small>{Number(resumo.quantidade_saidas || 0)} despesa(s) no período</small>
                </article>
                <article className={`direcao-financas-summary-card saldo ${saldoLiquido < 0 ? 'negativo' : ''}`}>
                    <span><BsWallet2 aria-hidden="true" /> Saldo líquido</span>
                    <strong>{valorFormatado(saldoLiquido)}</strong>
                    <small>Entradas menos despesas · {periodoLabel(abaPeriodo)}</small>
                </article>
            </section>

            <section className="escolas-filter-card no-print direcao-financas-controls" aria-label="Pesquisa e filtros financeiros">
                <label className="direcao-financas-search">
                    <span>Pesquisar movimentos</span>
                    <span className="escolas-search-input-wrapper">
                        <BsSearch className="escolas-search-icon" aria-hidden="true" />
                        <input
                            type="search"
                            placeholder="Referência, nome, matrícula ou descrição..."
                            value={termoBusca}
                            onChange={(event) => {
                                setPaginaAtual(1);
                                setTermoBusca(event.target.value);
                            }}
                            className="ce-input"
                        />
                    </span>
                </label>

                <div className="direcao-financas-filter-row">
                    <div className="direcao-financas-periods" role="group" aria-label="Filtrar movimentos por período">
                        {[
                            ['hoje', 'Hoje'],
                            ['ultimos_7_dias', 'Últimos 7 dias'],
                            ['este_mes', 'Este mês'],
                            ['todos', 'Todos']
                        ].map(([periodo, label]) => (
                            <button
                                key={periodo}
                                type="button"
                                className={`direcao-financas-period-button ${abaPeriodo === periodo ? 'active' : ''}`}
                                onClick={() => {
                                    setPaginaAtual(1);
                                    setAbaPeriodo(periodo);
                                }}
                                aria-pressed={abaPeriodo === periodo}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <label className="direcao-financas-type-filter">
                        <span>Mostrar</span>
                        <select value={tipoMovimento} onChange={(event) => {
                            setPaginaAtual(1);
                            setTipoMovimento(event.target.value);
                        }}>
                            <option value="todos">Pagamentos e despesas</option>
                            <option value="entrada">Pagamentos / entradas</option>
                            <option value="saida">Despesas / saídas</option>
                        </select>
                    </label>
                </div>
            </section>

            <div className="escolas-table-card">
                <div className="table-top-bar no-print">
                    <h2>{nomeTipoFiltro}</h2>
                    <span className="counter-pill">{paginacao.total_registos} registo(s)</span>
                </div>
                <div className="escolas-table">
                    <table className="escolas-custom-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Tipo</th>
                                <th>Aluno / Destinatário</th>
                                <th>Descrição / Item</th>
                                <th>Banco / Referência</th>
                                <th>Valor (CFA)</th>
                                <th>Registo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan="7" className="empty-table-row">A carregar movimentos financeiros...</td></tr>
                            ) : movimentos.length ? movimentos.map((movimento) => (
                                <tr key={`${movimento.origem_registo}-${movimento.id}`}>
                                    <td>{dataFormatada(movimento.data_pagamento)}</td>
                                    <td>
                                        <span className={`direcao-financas-type ${movimento.tipo}`}>
                                            {movimentoLabel(movimento)}
                                        </span>
                                    </td>
                                    <td>
                                        <strong>{obterNome(movimento)}</strong>
                                        <small>{movimento.numero_matricula ? `Mat: ${movimento.numero_matricula}` : movimento.origem_registo === 'movimento_manual' ? 'Movimento manual' : '—'}</small>
                                    </td>
                                    <td>
                                        <span className="direcao-financas-item">{movimento.descricao || '—'}</span>
                                        {movimento.codigo_talao && <small className="direcao-financas-ref">TAL ID: {movimento.codigo_talao}</small>}
                                    </td>
                                    <td className="cell-details">
                                        <strong>{movimento.banco_origem || movimento.metodo || '—'}</strong>
                                        <span>{movimento.referencia_banco || 'Sem referência'}</span>
                                    </td>
                                    <td>
                                        <strong className={`direcao-financas-amount ${movimento.tipo}`}>
                                            {valorFormatado(movimento.valor)}
                                        </strong>
                                    </td>
                                    <td><span className={`direcao-financas-status ${movimento.estado}`}>{estadoLabel(movimento.estado)}</span></td>
                                </tr>
                            )) : (
                                <tr><td colSpan="7" className="empty-table-row">Nenhum movimento encontrado para este período ou pesquisa.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <nav className="direcao-financas-pagination no-print" aria-label="Paginação dos movimentos financeiros">
                <span>
                    {paginacao.total_registos
                        ? `A mostrar ${((paginaAtual - 1) * 25) + 1}–${Math.min(paginaAtual * 25, paginacao.total_registos)} de ${paginacao.total_registos}`
                        : 'Nenhum registo'}
                </span>
                <div>
                    <button
                        type="button"
                        onClick={() => setPaginaAtual((atual) => Math.max(1, atual - 1))}
                        disabled={loading || paginaAtual <= 1}
                    >
                        Anterior
                    </button>
                    <strong>Página {paginacao.total_paginas ? paginaAtual : 0} / {paginacao.total_paginas}</strong>
                    <button
                        type="button"
                        onClick={() => setPaginaAtual((atual) => Math.min(paginacao.total_paginas, atual + 1))}
                        disabled={loading || paginaAtual >= paginacao.total_paginas}
                    >
                        Seguinte
                    </button>
                </div>
            </nav>

            {imprimirRelatorio && (
                <section id="printable-escola-ficha" className="escolas-table-card direcao-financas-print-report" aria-label="Relatório de movimentos financeiros">
                    <header className="direcao-financas-print-header">
                        <div className="direcao-financas-print-mark">{(escola?.sigla || escola?.nome || 'SIGE').slice(0, 4)}</div>
                        <div>
                            <p>Relatório financeiro</p>
                            <h1>{escola?.nome || 'Escola'}</h1>
                            <span>{escola?.sigla || 'Gestão financeira escolar'}</span>
                        </div>
                        <div className="direcao-financas-print-document">
                            <strong>{nomeTipoFiltro}</strong>
                            <span>{periodoLabel(abaPeriodo)}</span>
                        </div>
                    </header>

                    <dl className="direcao-financas-print-meta">
                        <div><dt>Escola</dt><dd>{escola?.nome || '—'}{escola?.sigla ? ` (${escola.sigla})` : ''}</dd></div>
                        <div><dt>Localização</dt><dd>{escola?.endereco || escola?.localizacao || escola?.cidade || escola?.regiao || '—'}</dd></div>
                        <div><dt>Contacto</dt><dd>{escola?.telefone || escola?.contacto || escola?.email || '—'}</dd></div>
                        <div><dt>Período</dt><dd>{periodoLabel(abaPeriodo)}</dd></div>
                        <div><dt>Pesquisa</dt><dd>{termoBuscaAplicado || 'Sem pesquisa'}</dd></div>
                        <div><dt>Registos exibidos nesta página</dt><dd>{movimentos.length}</dd></div>
                        <div><dt>Total de entradas</dt><dd>{valorFormatado(totalEntradas)}</dd></div>
                        <div><dt>Total de despesas</dt><dd>{valorFormatado(totalSaidas)}</dd></div>
                        <div><dt>Saldo líquido</dt><dd>{valorFormatado(saldoLiquido)}</dd></div>
                        <div><dt>Emitido em</dt><dd>{dataEmissao || '—'}</dd></div>
                    </dl>

                    <table className="escolas-custom-table direcao-financas-print-table">
                        <thead>
                            <tr>
                                <th>N.º</th>
                                <th>Data</th>
                                <th>Tipo</th>
                                <th>Aluno / Destinatário</th>
                                <th>Descrição</th>
                                <th>Banco / Referência</th>
                                <th>Valor (CFA)</th>
                                <th>Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {movimentos.map((movimento, index) => (
                                <tr key={`${movimento.origem_registo}-${movimento.id}`}>
                                    <td>{index + 1}</td>
                                    <td>{dataFormatada(movimento.data_pagamento)}</td>
                                    <td>{movimentoLabel(movimento)}</td>
                                    <td>{obterNome(movimento)}</td>
                                    <td>{[movimento.descricao, movimento.codigo_talao ? `TAL ID: ${movimento.codigo_talao}` : ''].filter(Boolean).join(' · ') || '—'}</td>
                                    <td>{[movimento.banco_origem || movimento.metodo, movimento.referencia_banco].filter(Boolean).join(' · ') || '—'}</td>
                                    <td>{valorFormatado(movimento.valor)}</td>
                                    <td>{estadoLabel(movimento.estado)}</td>
                                </tr>
                            ))}
                            {!movimentos.length && <tr><td colSpan="8">Nenhum movimento para os critérios selecionados.</td></tr>}
                        </tbody>
                    </table>

                    <footer className="direcao-financas-print-signatures">
                        <div><span>A Direção</span><i>Nome e assinatura</i></div>
                        <div><span>Tesouraria</span><i>Nome e assinatura</i></div>
                    </footer>
                    <div className="direcao-financas-print-footer">
                        <span>{escola?.nome || 'Escola'} · Relatório gerado pelo SIGE360</span>
                        <span>{dataEmissao || ''}</span>
                    </div>
                </section>
            )}
        </div>
    );
}
