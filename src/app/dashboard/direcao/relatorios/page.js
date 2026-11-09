'use client';
import '@/styles/direcao-inline-relatorios.css';

import React, { useState } from 'react';
import useSWR from 'swr';
import {
    BsArrowClockwise, BsBuilding, BsCashCoin,
    BsCalendarCheck, BsExclamationTriangleFill, BsPeopleFill, BsPersonBadge
} from 'react-icons/bs';
import '../../../../styles/direcao-relatorios.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1`;

async function buscarRelatorio(anoLetivoId, trimestreId) {
    const parametros = new URLSearchParams();
    if (anoLetivoId) parametros.set('ano_letivo_id', anoLetivoId);
    if (trimestreId) parametros.set('trimestre_id', trimestreId);

    const queryString = parametros.toString();
    const query = queryString ? `?${queryString}` : '';
    const response = await fetch(`${API_URL}/direcao/relatorios/desempenho${query}`, {
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
    if (!response.ok || data.success !== true || !data.dados) {
        throw new Error(data.message || `Falha no pedido à API (HTTP ${response.status}).`);
    }
    return data.dados;
}

function formatarNumero(valor) {
    return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 }).format(Number(valor) || 0);
}

function formatarMoeda(valor) {
    return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(Number(valor) || 0)} CFA`;
}

function formatarMedia(valor) {
    return valor === null || valor === undefined ? '—' : formatarNumero(valor);
}

function calcularPercentagem(valor, total) {
    return total > 0 ? Math.min(100, Math.max(0, (Number(valor) / Number(total)) * 100)) : 0;
}

function CartaoIndicador({ titulo, valor, detalhe }) {
    return (
        <article className="ds-metric-card">
            <span>{titulo}</span>
            <strong>{valor}</strong>
            {detalhe && <small>{detalhe}</small>}
        </article>
    );
}

export default function DirecaoRelatorios() {
    const [anoSelecionado, setAnoSelecionado] = useState(null);
    const [trimestreSelecionado, setTrimestreSelecionado] = useState(null);
    const {
        data: resultadoRelatorio,
        error,
        isLoading,
        isValidating,
        mutate
    } = useSWR(
        ['direcao-relatorio', anoSelecionado ?? '', trimestreSelecionado ?? ''],
        async ([, anoLetivoId, trimestreId]) => ({
            dados: await buscarRelatorio(anoLetivoId, trimestreId),
            atualizadoEm: new Date().toISOString()
        }),
        {
            revalidateIfStale: false,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            shouldRetryOnError: false
        }
    );
    const dados = resultadoRelatorio?.dados || null;
    const loading = isLoading;
    const atualizadoEm = resultadoRelatorio?.atualizadoEm
        ? new Date(resultadoRelatorio.atualizadoEm)
        : null;
    const atualizarRelatorio = () => mutate().catch((erroAtualizacao) => {
        console.error('Erro ao atualizar relatório da Direção:', erroAtualizacao);
    });

    const mudarAnoLetivo = (event) => {
        setAnoSelecionado(event.target.value);
        setTrimestreSelecionado('');
    };

    const mudarTrimestre = (event) => {
        setTrimestreSelecionado(event.target.value);
    };

    const totalMatriculasRamo = dados?.matriculas_ramo.reduce((total, ramo) => total + ramo.matriculas, 0) || 0;
    const totalNotasTrimestre = dados?.desempenho_trimestres.reduce((total, trimestre) => total + trimestre.notas_registadas, 0) || 0;

    return (
        <main className="ds-container">
            <header className="ds-header">
                <div>
                    <span className="ds-eyebrow">Relatório de desempenho escolar</span>
                    <h1>{dados?.escola_nome || 'Desempenho da escola'}</h1>
                    <p>Indicadores calculados a partir dos registos reais da escola selecionada.</p>
                </div>
                <div className="ds-header-actions">
                    <label className="ds-filter">
                        <span>Ano letivo</span>
                        <select value={anoSelecionado ?? dados?.ano_letivo?.id ?? ''} onChange={mudarAnoLetivo} disabled={!dados || loading}>
                            {!dados?.anos_letivos.length && <option value="">Sem anos letivos</option>}
                            {dados?.anos_letivos.map((ano) => (
                                <option key={ano.id} value={ano.id}>{ano.ano_nome}</option>
                            ))}
                        </select>
                    </label>
                    <label className="ds-filter">
                        <span>Trimestre</span>
                        <select value={trimestreSelecionado ?? dados?.trimestre_id ?? ''} onChange={mudarTrimestre} disabled={!dados || loading}>
                            <option value="">Todos os trimestres</option>
                            {dados?.trimestres.map((trimestre) => (
                                <option key={trimestre.id} value={trimestre.id}>{trimestre.nome}</option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={() => void atualizarRelatorio()}
                        className="ds-btn-refresh direcao-refresh-button"
                        disabled={isValidating}
                        aria-label="Atualizar relatório"
                        title="Atualizar relatório"
                    >
                        <BsArrowClockwise className={isValidating ? 'spin' : ''} />
                    </button>
                </div>
            </header>

            {atualizadoEm && (
                <p className="ds-updated">Dados consultados em {atualizadoEm.toLocaleString('pt-PT')}</p>
            )}

            {error && (
                <div className="ds-alert erro" role="alert">
                    <BsExclamationTriangleFill /> <span>{error.message || 'Não foi possível carregar o relatório da escola.'}</span>
                </div>
            )}

            {loading && !dados ? (
                <div className="ds-state">A carregar indicadores reais da escola...</div>
            ) : dados ? (
                <>
                    <section className="ds-section">
                        <div className="ds-section-heading">
                            <BsCashCoin />
                            <div><h2>1. Desempenho da Tesouraria</h2><p>Pagamentos associados ao ano letivo selecionado.</p></div>
                        </div>
                        <div className="ds-metrics-grid">
                            <CartaoIndicador titulo="Total arrecadado" valor={formatarMoeda(dados.tesouraria.total_arrecadado)} detalhe={`${formatarNumero(dados.tesouraria.pagamentos_aprovados)} pagamentos aprovados`} />
                            <CartaoIndicador titulo="Valor pendente" valor={formatarMoeda(dados.tesouraria.total_pendente)} detalhe={`${formatarNumero(dados.tesouraria.pagamentos_pendentes)} pagamentos por tratar`} />
                            <CartaoIndicador titulo="Pagamentos registados" valor={formatarNumero(dados.tesouraria.pagamentos_total)} detalhe="Registos do backend para este ano letivo" />
                        </div>
                    </section>

                    <section className="ds-section">
                        <div className="ds-section-heading">
                            <BsPersonBadge />
                            <div><h2>2. Desempenho dos Professores</h2><p>Atribuições e registos de notas no período selecionado; não representa uma avaliação subjetiva.</p></div>
                        </div>
                        <div className="ds-metrics-grid">
                            <CartaoIndicador titulo="Professores ativos" valor={formatarNumero(dados.professores.length)} />
                            <CartaoIndicador titulo="Disciplinas atribuídas" valor={formatarNumero(dados.professores.reduce((total, professor) => total + professor.disciplinas_atribuidas, 0))} />
                            <CartaoIndicador titulo="Registos de notas" valor={formatarNumero(dados.professores.reduce((total, professor) => total + professor.pautas_registadas, 0))} />
                        </div>
                        <div className="ds-table-scroll">
                            <table className="ds-table">
                                <thead><tr><th>Professor</th><th>Disciplinas atribuídas</th><th>Registos de notas</th><th>Alunos avaliados</th><th>Média das notas</th></tr></thead>
                                <tbody>
                                    {dados.professores.length ? dados.professores.map((professor) => (
                                        <tr key={professor.id}>
                                            <td>{professor.nome}</td>
                                            <td>{professor.disciplinas_atribuidas}</td>
                                            <td>{professor.pautas_registadas}</td>
                                            <td>{professor.alunos_avaliados}</td>
                                            <td>{formatarMedia(professor.media_notas)}</td>
                                        </tr>
                                    )) : <tr><td colSpan="5" className="ds-empty">Não há professores ativos associados a esta escola.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section className="ds-section">
                        <div className="ds-section-heading">
                            <BsPeopleFill />
                            <div><h2>3. Desempenho dos Alunos</h2><p>Médias calculadas sobre as notas registadas; aprovação considera média igual ou superior a 10.</p></div>
                        </div>
                        <div className="ds-metrics-grid">
                            <CartaoIndicador titulo="Alunos ativos" valor={formatarNumero(dados.alunos.alunos_ativos)} detalhe={`${formatarNumero(dados.alunos.matriculas_ativas)} matrículas ativas`} />
                            <CartaoIndicador titulo="Alunos com notas" valor={formatarNumero(dados.alunos.alunos_com_notas)} detalhe={`${formatarNumero(dados.alunos.taxa_avaliados)}% das matrículas têm notas registadas`} />
                            <CartaoIndicador titulo="Média geral" valor={formatarMedia(dados.alunos.media_notas)} detalhe="Escala configurada na escola" />
                            <CartaoIndicador titulo="Médias ≥ 10" valor={formatarNumero(dados.alunos.aprovados)} detalhe="Média individual das notas disponíveis" />
                        </div>
                    </section>

                    <section className="ds-section">
                        <div className="ds-section-heading">
                            <BsBuilding />
                            <div><h2>4. Matrículas por Ramo</h2><p>Matrículas ativas agrupadas pelos ramos registados na escola.</p></div>
                        </div>
                        <div className="ds-table-scroll">
                            <table className="ds-table">
                                <thead><tr><th>Ramo</th><th>Matrículas ativas</th><th>Alunos</th><th>Percentagem das matrículas</th></tr></thead>
                                <tbody>
                                    {dados.matriculas_ramo.length ? dados.matriculas_ramo.map((ramo) => {
                                        const percentagem = calcularPercentagem(ramo.matriculas, totalMatriculasRamo);
                                        return (
                                            <tr key={ramo.ramo}>
                                                <td>{ramo.ramo}</td>
                                                <td>{ramo.matriculas}</td>
                                                <td>{ramo.alunos}</td>
                                                <td>
                                                    <div className="ds-progress-cell">
                                                        <div className="ds-progress"><span className="direcao-relatorios-9d096d236" style={{"--relatorios-width": (`${percentagem}%`)}} /></div>
                                                        <span>{formatarNumero(percentagem)}%</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    }) : <tr><td colSpan="4" className="ds-empty">Não há matrículas ativas para este ano letivo.</td></tr>}
                                </tbody>
                                {dados.matriculas_ramo.length > 0 && (
                                    <tfoot><tr><th>Total</th><th>{totalMatriculasRamo}</th><th colSpan="2">Matrículas ativas no período</th></tr></tfoot>
                                )}
                            </table>
                        </div>
                    </section>

                    <section className="ds-section">
                        <div className="ds-section-heading">
                            <BsCalendarCheck />
                            <div><h2>5. Desempenho por Trimestre</h2><p>Comparação das médias e notas lançadas em cada trimestre do ano letivo.</p></div>
                        </div>
                        {trimestreSelecionado && <p className="ds-filter-note">Os indicadores das outras secções respeitam o trimestre selecionado. Esta tabela mantém todos os trimestres do ano para comparação.</p>}
                        <div className="ds-table-scroll">
                            <table className="ds-table">
                                <thead><tr><th>Trimestre</th><th>Registos de notas</th><th>Média</th><th>Notas ≥ 10</th><th>Percentagem de notas ≥ 10</th></tr></thead>
                                <tbody>
                                    {dados.desempenho_trimestres.length ? dados.desempenho_trimestres.map((trimestre) => {
                                        const taxa = calcularPercentagem(trimestre.aprovados, trimestre.notas_registadas);
                                        return (
                                            <tr key={trimestre.id}>
                                                <td>{trimestre.nome}</td>
                                                <td>{trimestre.notas_registadas}</td>
                                                <td>{formatarMedia(trimestre.media_notas)}</td>
                                                <td>{trimestre.aprovados}</td>
                                                <td>{trimestre.notas_registadas ? `${formatarNumero(taxa)}%` : '—'}</td>
                                            </tr>
                                        );
                                    }) : <tr><td colSpan="5" className="ds-empty">Não há trimestres associados a este ano letivo.</td></tr>}
                                </tbody>
                                {totalNotasTrimestre > 0 && (
                                    <tfoot><tr><th>Total anual</th><th>{totalNotasTrimestre}</th><th colSpan="3">Registos de notas nos trimestres apresentados</th></tr></tfoot>
                                )}
                            </table>
                        </div>
                    </section>
                </>
            ) : !error ? (
                <div className="ds-state">Não há dados disponíveis para os filtros selecionados.</div>
            ) : null}
        </main>
    );
}
