'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { format } from 'date-fns';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { LuReceiptIndianRupee } from 'react-icons/lu';
import { GiTeacher } from 'react-icons/gi';
import { PiStudent } from 'react-icons/pi';
import { BiFilterAlt } from 'react-icons/bi';
import { BsArrowDownRight, BsArrowUpRight, BsBellFill, BsCalendarEvent, BsExclamationTriangle, BsInfoCircle, BsPeopleFill, BsReceipt, BsX } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import DashboardFeedback from '@/components/dashboardFeedback';
import useDashboardSWR from '@/hooks/useDashboardSWR';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_URL = `${API_BASE}/api/v1`;
const CORES_RAMO = ['#4b5d8b', '#f5b025', '#38a169', '#8b5cf6', '#e11d48', '#0891b2'];
const FILTROS_PAGAMENTO = [
    { id: 'todos', label: 'Todos' },
    { id: 'aprovado', label: 'Aprovado' },
    { id: 'pendente_aprovacao', label: 'Pendente' },
    { id: 'flagged', label: 'Sinalizado' },
    { id: 'rejeitado', label: 'Rejeitado' }
];

async function pedirJson(path) {
    const response = await fetch(`${API_URL}${path}`, {credentials: 'include', cache: 'no-store' });
    const texto = await response.text();
    let data;
    try { data = texto ? JSON.parse(texto) : {}; } 
    catch { throw new Error(`A API respondeu num formato inválido (HTTP ${response.status}).`); }
    if (!response.ok || data.success !== true || !data.dados) {
        throw new Error(data.message || `Falha no pedido à API (HTTP ${response.status}).`);
    }
    return data.dados;
}

async function buscarDadosDashboard([, anoLetivoId]) {
    const query = anoLetivoId ? `?ano_letivo_id=${encodeURIComponent(anoLetivoId)}` : '';
    const [dashboard, notificacoes] = await Promise.all([
        pedirJson(`/direcao/relatorios/desempenho${query}`),
        pedirJson('/secretaria/notificacoes')
    ]);

    if (!Array.isArray(dashboard.anos_letivos) || !Array.isArray(dashboard.matriculas_ramo) || !Array.isArray(dashboard.melhores_alunos) || !Array.isArray(dashboard.pagamentos) || !Array.isArray(notificacoes)) { throw new Error('A API devolveu dados incompletos para o dashboard da Direção.'); }

    return { dashboard, notificacoes, atualizadoEm: new Date().toISOString() };
}

function nomeCompleto(nome, apelido) {
    return [nome, apelido].filter(Boolean).join(' ') || 'Aluno sem nome registado';
}

function iniciais(nome, apelido) {
    return nomeCompleto(nome, apelido)
        .split(/\s+/)
        .slice(0, 2)
        .map((parte) => parte.charAt(0).toUpperCase())
        .join('');
}

function formatarData(valor) {
    if (!valor) return '—';
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? '—' : data.toLocaleDateString('pt-PT');
}

function formatarDataHora(valor) {
    if (!valor) return 'Data não registada';
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? 'Data não registada' : data.toLocaleString('pt-PT');
}

function formatarHora(valor) {
    if (!valor) return '';
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? '' : data.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

function formatarMoeda(valor) {
    return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(Number(valor) || 0)} CFA`;
}

function nomeEstadoPagamento(estado) {
    const nomes = {
        aprovado: 'Aprovado',
        pendente_aprovacao: 'Pendente',
        flagged: 'Sinalizado',
        rejeitado: 'Rejeitado',
        rejected: 'Rejeitado'
    };
    return nomes[estado] || estado || 'Sem estado';
}

function Bar3D({ fill, x, y, width, height, shadowColor }) {
    const depth = 10;
    if (height <= 0) return null;
    return (
        <g>
            <rect x={x} y={y} width={width} height={height} fill={fill} rx={3} />
            <path
                d={`M ${x + width} ${y} L ${x + width + depth} ${y - depth / 2} L ${x + width + depth} ${y + height - depth / 2} L ${x + width} ${y + height} Z`}
                fill={shadowColor || '#312352'}
                opacity={0.85}
            />
            <path
                d={`M ${x} ${y} L ${x + depth} ${y - depth / 2} L ${x + width + depth} ${y - depth / 2} L ${x + width} ${y} Z`}
                fill={fill}
                filter="brightness(1.2)"
            />
        </g>
    );
}

export default function SmartDashboardOverview() {
    const [selectedAnoId, setSelectedAnoId] = useState('');
    const [date, setDate] = useState(null);
    const [isMounted, setIsMounted] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [filterPayment, setFilterPayment] = useState('todos');
    const [selectedPayment, setSelectedPayment] = useState(null);
    const [selectedNotification, setSelectedNotification] = useState(null);
    const {data: dadosDashboard, error, isLoading, isValidating, mutate } = useDashboardSWR(
        ['direcao-dashboard', selectedAnoId], buscarDadosDashboard );
    const dashboard = dadosDashboard?.dashboard || null;
    const notificacoes = dadosDashboard?.notificacoes || [];
    const loading = isLoading;
    const atualizadoEm = dadosDashboard?.atualizadoEm ? new Date(dadosDashboard.atualizadoEm) : null;
    const atualizarDashboard = () => mutate().catch((erroAtualizacao) => { console.error('Erro ao atualizar dashboard da Direção:', erroAtualizacao); });

    useEffect(() => { setIsMounted(true); setDate(new Date()); }, []);

    const eventosPorDia = useMemo(() => notificacoes.reduce((eventos, item) => {
        if (!item.data_hora) return eventos;
        const data = new Date(item.data_hora);
        if (Number.isNaN(data.getTime())) return eventos;
        const chave = format(data, 'yyyy-MM-dd');
        if (!eventos[chave]) eventos[chave] = [];
        eventos[chave].push(item);
        return eventos;
    }, {}), [notificacoes]);

    const dateKey = date ? format(date, 'yyyy-MM-dd') : '';
    const currentDayEvents = dateKey ? (eventosPorDia[dateKey] || []) : [];
    const tileContent = ({ date: dataTile, view }) => {
        if (view === 'month' && eventosPorDia[format(dataTile, 'yyyy-MM-dd')]) {
            return <div className="calendar-event-dot" />;
        }
        return null;
    };

    const pagamentosFiltrados = (dashboard?.pagamentos || []).filter((pagamento) =>
        filterPayment === 'todos' || pagamento.estado === filterPayment
    );
    const pagamentosExibidos = pagamentosFiltrados.slice(0, 5);
    const kpis = dashboard ? [
        { nome: 'Saldo líquido', value: formatarMoeda(dashboard.tesouraria.saldo_liquido), color: 'pink', icon: <LuReceiptIndianRupee /> },
        { nome: 'Professores ativos', value: dashboard.professores.length, color: 'purple', icon: <GiTeacher /> },
        { nome: 'Alunos matriculados', value: dashboard.alunos.alunos_ativos, color: 'yellow', icon: <PiStudent /> },
        { nome: 'Despesas registadas', value: formatarMoeda(dashboard.tesouraria.total_saidas), color: 'green', icon: <BsArrowDownRight /> }
    ] : [];
    const polos = (dashboard?.matriculas_ramo || []).map((ramo, index) => ({
        poloId: ramo.polo_id,
        label: ramo.ramo,
        value: ramo.alunos,
        pending: ramo.pagamentos_pendentes,
        awaitingClass: ramo.aguardam_turma,
        color: CORES_RAMO[index % CORES_RAMO.length],
        shadowColor: CORES_RAMO[index % CORES_RAMO.length]
    }));

    const mudarAnoLetivo = (event) => {
        const anoId = event.target.value; 
        setSelectedAnoId(anoId);
    };

    const dataNotificacaoSelecionada = selectedNotification ? formatarDataHora(selectedNotification.data_hora) : '';

    return (
        <>
            <AdminHeader dashboard={dashboard} atualizadoEm={atualizadoEm} loading={isValidating} titulo={dashboard?.escola_nome || (loading ? 'A carregar escola...' : 'Dashboard da Direção')} descricao='1º Sistema Integral de Gestão Escola em Mama Guiné' anoVal={selectedAnoId || dashboard?.ano_letivo?.id || ''} mudarAnoLetivo={mudarAnoLetivo} onRefresh={atualizarDashboard} />
            <DashboardFeedback dashboard={dashboard} error={error} isLoading={isLoading} isValidating={isValidating} onRetry={atualizarDashboard} loadingMessage="A carregar dados reais da escola..." />

            {loading && !dashboard ? 
                (<div className="dashboard-state">A carregar dados reais da escola...</div>) :
            dashboard ? 
                (<>
                    <section className="kpi-row" aria-label="Indicadores da escola">
                        {kpis.map((item) => (
                            <article key={item.nome} className={`kpi-card ${item.color}`}>
                                <div className={`icon-box ${item.color}`}>{item.icon}</div>
                                <div className="line" />
                                <div className="kpi-data">
                                    <span className="kpi-label">{item.nome}</span>
                                    <strong className="kpi-number">{item.value}</strong>
                                </div>
                            </article>
                        ))}
                    </section>

                    <section className="calendar-row">
                        <article className="cale-notif-row">
                            <div className="cale-wrapper">
                                <div className="card-header">
                                    <BsCalendarEvent className="card-icon" />
                                    <h2>Atividade da escola</h2>
                                </div>
                                {isMounted && date && (
                                    <Calendar onChange={setDate} value={date} onClickDay={() => setIsModalOpen(true)} tileContent={tileContent} className="calendar" />
                                )}
                                {isModalOpen && date && (
                                    <div className="cale-modal" onClick={() => setIsModalOpen(false)}>
                                        <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                                            <div className="modal-header">
                                                <h3>Atividade em {format(date, 'dd/MM/yyyy')}</h3>
                                                <button type="button" onClick={() => setIsModalOpen(false)} className="modal-close-btn" aria-label="Fechar">
                                                    <BsX size={22} />
                                                </button>
                                            </div>
                                            <div className="modal-events-list">
                                                {currentDayEvents.length ? currentDayEvents.map((item) => (
                                                    <article className="modal-event-item" key={`${item.categoria}:${item.id}`}>
                                                        <strong>{item.titulo}</strong>
                                                        <span>{item.mensagem}</span>
                                                    </article>
                                                )) : <p className="modal-empty-text">Não há atividade registada nesta data.</p>}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="notif-wrapper">
                                <div className="card-header">
                                    <BsBellFill className="card-icon" />
                                    <h2>Notificações</h2>
                                    <span className="notif-badge">{notificacoes.length}</span>
                                </div>
                                <div className="notif-list">
                                    {notificacoes.slice(0, 5).map((item) => {
                                        const warning = item.categoria === 'pagamento' && item.mensagem.toLowerCase().includes('pendente');
                                        return (
                                            <button type="button" key={`${item.categoria}:${item.id}`} className={`notif-card ${warning ? 'warning' : 'info'}`} onClick={() => setSelectedNotification(item)} >
                                                <span className="notif-card-icon">
                                                    {warning ? <BsExclamationTriangle /> : <BsInfoCircle />}
                                                </span>
                                                <span className="notif-card-body">
                                                    <span className="notif-top">
                                                        <strong className="notif-title">{item.titulo}</strong>
                                                        <time className="notif-time">{formatarHora(item.data_hora)}</time>
                                                    </span>
                                                    <span className="notif-desc">{item.mensagem}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {!notificacoes.length && <p className="modal-empty-text">Não há atividade registada.</p>}
                                </div>
                                <Link href="/dashboard/direcao/notificacoes" className="dashboard-view-link">
                                    <p>Ver todas as Notificações <BsArrowUpRight /></p>
                                </Link>
                            </div>
                        </article>

                        <article className="stage-card">
                            <div className="card-header">
                                <h2>Alunos por ramo</h2>
                                <span className="card-sub-info">Matrículas e talões por validar no ano letivo</span>
                            </div>
                            {polos.length ? (
                                <>
                                    <div className="stage-3d-layout">
                                        <div className="stage-legend-list">
                                            {polos.map((ramo) => (
                                                <div className="stage-legend-item" key={ramo.poloId || ramo.label}>
                                                    <span className="direcao-page-js-c993be970 stage-dot" style={{"--page-js-background-color": (ramo.color)}} />
                                                    <div className="stage-info">
                                                        <strong className="stage-name">{ramo.label}</strong>
                                                        <span className="stage-count">{ramo.value}</span>
                                                        {ramo.pending > 0 && (
                                                            <small>{ramo.pending} {ramo.pending === 1 ? 'pagamento pendente' : 'pagamentos pendentes'}</small>
                                                        )}
                                                        {ramo.awaitingClass > 0 && (
                                                            <small>{ramo.awaitingClass} {ramo.awaitingClass === 1 ? 'aguarda turma' : 'aguardam turma'}</small>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="chart-container-3d">
                                            <ResponsiveContainer>
                                                <BarChart data={polos}>
                                                    <XAxis dataKey="label" hide />
                                                    <YAxis allowDecimals={false} domain={[0, 'dataMax']} stroke="#bbb" fontSize={11} />
                                                    <Tooltip cursor={{ fill: 'transparent' }} formatter={(value) => [`${value} alunos`, 'Total']} />
                                                    <Bar
                                                        dataKey="value"
                                                        shape={(props) => <Bar3D {...props} shadowColor={props.payload.shadowColor} />}
                                                        barSize={32}
                                                        className="bars"
                                                    >
                                                        {polos.map((ramo) => <Cell key={ramo.poloId || ramo.label} fill={ramo.color} />)}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                </>
                            ) : <p className="modal-empty-text">Não há ramos configurados para esta escola.</p>}
                        </article>
                    </section>

                    <section className="bottom-row">
                        <article className="podium-section-wrapper">
                            <div className="podium-header-row">
                                <h2>Melhores alunos <span>Com notas registadas</span></h2>
                                <Link href="/dashboard/direcao/alunos" className="view-all-btn">
                                    Ver alunos <BsArrowUpRight size={12} />
                                </Link>
                            </div>
                            <div className="podium-cards-container">
                                {dashboard.melhores_alunos.map((aluno, index) => (
                                    <article className={`podium-card ${['green-podium', 'purple-podium', 'yellow-podium'][index % 3]}`} key={aluno.aluno_id}>
                                        <div className="student-avatar-wrap">
                                            {aluno.foto_url ? (
                                                <Image
                                                    src={aluno.foto_url}
                                                    alt={`Fotografia de ${nomeCompleto(aluno.nome, aluno.apelido)}`}
                                                    className="student-photo-img"
                                                    width={68}
                                                    height={68}
                                                    unoptimized
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            ) : (
                                                <span aria-hidden="true">{iniciais(aluno.nome, aluno.apelido)}</span>
                                            )}
                                        </div>
                                        <h3 className="student-name">{nomeCompleto(aluno.nome, aluno.apelido)}</h3>
                                        <span className="student-turma">{aluno.turma_nome}</span>
                                        <strong className="student-score">{aluno.media} / 20</strong>
                                        <div className="podium-rank-badge">Melhor da turma</div>
                                    </article>
                                ))}
                                {!dashboard.melhores_alunos.length && (
                                    <p className="modal-empty-text">Ainda não há notas para calcular classificações.</p>
                                )}
                            </div>
                        </article>

                        <article className="smart-card glass-payments-card">
                            <div className="payments-header">
                                <div>
                                    <h2><BsReceipt /> Pagamentos e propinas</h2>
                                    <p className="payments-subtext">Transações reais do ano letivo selecionado</p>
                                </div>
                                <div className="payment-stand">
                                    <div className="payments-filter-group">
                                        <BiFilterAlt className="filter-icon" />
                                        {FILTROS_PAGAMENTO.map((filtro) => (
                                            <button
                                                type="button"
                                                key={filtro.id}
                                                className={`filter-btn ${filterPayment === filtro.id ? 'active' : ''}`}
                                                onClick={() => setFilterPayment(filtro.id)}
                                            >
                                                {filtro.label}
                                            </button>
                                        ))}
                                    </div>
                                    <Link href="/dashboard/direcao/financas" className="view-all-btn">
                                        Ver tudo <BsArrowUpRight size={12} />
                                    </Link>
                                </div>
                            </div>
                            <div className="payments-table-container">
                                <table className="glass-table">
                                    <thead>
                                        <tr>
                                            <th>Referência</th>
                                            <th>Aluno / Candidato</th>
                                            <th>Item</th>
                                            <th>Valor</th>
                                            <th>Método</th>
                                            <th>Estado</th>
                                            <th>Data</th>
                                            <th>Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pagamentosExibidos.map((pagamento) => (
                                            <tr key={pagamento.id}>
                                                <td>
                                                    <span className="trx-code">{pagamento.referencia_banco || pagamento.id}</span>
                                                    {pagamento.codigo_talao && <small style={{ display: 'block' }}>TAL ID: {pagamento.codigo_talao}</small>}
                                                </td>
                                                <td>
                                                    <strong className="student-cell-name">{pagamento.aluno_nome}</strong>
                                                    {pagamento.turma_nome && <span className="student-cell-stage">{pagamento.turma_nome}</span>}
                                                </td>
                                                <td>{pagamento.item_nome || pagamento.tipo_registo || 'Pagamento'}</td>
                                                <td><strong className="amount-text">{formatarMoeda(pagamento.valor)}</strong></td>
                                                <td><span className="method-badge">{pagamento.banco_origem || '—'}</span></td>
                                                <td><span className={`status-badge ${pagamento.estado}`}>{nomeEstadoPagamento(pagamento.estado)}</span></td>
                                                <td>{formatarData(pagamento.data_pagamento || pagamento.criado_em)}</td>
                                                <td>
                                                    <button type="button" className="btn-view-receipt" onClick={() => setSelectedPayment(pagamento)}>
                                                        Detalhes
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {!pagamentosExibidos.length && (
                                            <tr><td colSpan="8" className="dashboard-empty-cell">Não há pagamentos para este filtro e ano letivo.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </article>
                    </section>
                </>
            ) : !error ? (
                <div className="dashboard-state">Não há dados disponíveis para esta escola.</div>
            ) : null}

            {selectedNotification && (
                <div className="cale-modal" onClick={() => setSelectedNotification(null)}>
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Detalhes da atividade</h3>
                            <button type="button" onClick={() => setSelectedNotification(null)} className="modal-close-btn" aria-label="Fechar">
                                <BsX size={22} />
                            </button>
                        </div>
                        <strong>{selectedNotification.titulo}</strong>
                        <p>{selectedNotification.mensagem}</p>
                        <time>{dataNotificacaoSelecionada}</time>
                    </div>
                </div>
            )}

            {selectedPayment && (
                <div className="glass-modal-overlay" onClick={() => setSelectedPayment(null)}>
                    <div className="glass-modal-card payment-detail-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Detalhes do pagamento</h3>
                            <button type="button" onClick={() => setSelectedPayment(null)} className="modal-close-btn" aria-label="Fechar">
                                <BsX size={22} />
                            </button>
                        </div>
                        <div className="payment-receipt-content">
                            <div className="receipt-row"><span>Aluno / Candidato:</span><strong>{selectedPayment.aluno_nome}</strong></div>
                            <div className="receipt-row"><span>Referência:</span><strong>{selectedPayment.referencia_banco || selectedPayment.id}</strong></div>
                            <div className="receipt-row"><span>TAL ID:</span><strong>{selectedPayment.codigo_talao || '—'}</strong></div>
                            <div className="receipt-row"><span>Item:</span><strong>{selectedPayment.item_nome || selectedPayment.tipo_registo || 'Pagamento'}</strong></div>
                            <div className="receipt-row"><span>Valor:</span><strong>{formatarMoeda(selectedPayment.valor)}</strong></div>
                            <div className="receipt-row"><span>Método:</span><strong>{selectedPayment.banco_origem || '—'}</strong></div>
                            <div className="receipt-row"><span>Estado:</span><strong>{nomeEstadoPagamento(selectedPayment.estado)}</strong></div>
                            <div className="receipt-row"><span>Data:</span><strong>{formatarDataHora(selectedPayment.data_pagamento || selectedPayment.criado_em)}</strong></div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
