'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BsArrowUpRight, BsBookHalf, BsCalendar3,BsCashCoin, BsFileEarmarkTextFill, BsInfoCircle, BsPeopleFill, BsPersonBadge, BsWallet2 } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import DashboardFeedback from '@/components/dashboardFeedback';
import useDashboardSWR from '@/hooks/useDashboardSWR';
import { useGlobalAuth } from '@/utils/globalAuth';
import '@/styles/s1.css';


const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_URL = `${API_BASE}/api/v1`;
const EMPTY_NOTIFICATIONS = [];
const CORES_POLO = ['#0284c7', '#16a34a', '#f59e0b', '#8b5cf6', '#e11d48', '#0891b2'];

async function pedirJson(path) {
    const response = await fetch(`${API_URL}${path}`, { credentials: 'include',cache: 'no-store' });
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

async function buscarDadosDashboard([, anoLetivoId]) {
    const query = anoLetivoId ? `?ano_letivo_id=${encodeURIComponent(anoLetivoId)}` : '';
    const [dashboardResult, notificacoesResult] = await Promise.all([
        pedirJson(`/secretaria/dashboard${query}`),
        pedirJson(`/secretaria/notificacoes${query}`)
    ]);
    const dashboard = dashboardResult.dados;
    const notificacoes = notificacoesResult.dados;
    if (!dashboard || !Array.isArray(dashboard.anos_letivos) || !Array.isArray(dashboard.polos) || !Array.isArray(dashboard.alocacoes_talao_por_item) || !Array.isArray(notificacoes)) {
        throw new Error('A API devolveu dados incompletos para o painel da Secretaria.');
    }
    const dataAtual = new Date();
    const dataLimite = new Date(dataAtual.getTime() - dataAtual.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 10);
    const parametrosAtraso = new URLSearchParams({ ate: dataLimite, resumo: 'true' });
    const anoFinanceiroId = anoLetivoId || dashboard.ano_letivo_id;
    if (anoFinanceiroId) parametrosAtraso.set('ano_letivo_id', anoFinanceiroId);
    const atrasoResult = await pedirJson(`/tesouraria/devedores?${parametrosAtraso}`);
    dashboard.total_previsto = atrasoResult.dados.total_previsto;
    return { dashboard, notificacoes, atualizadoEm: new Date().toISOString() };
}

function formatarMoeda(valor) {
    return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(Number(valor) || 0)} CFA`;
}

function formatarData(valor) {
    if (!valor) return 'Data não registada';
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? 'Data não registada' : data.toLocaleString('pt-PT');
}

function nomeCategoria(categoria) {
    const nomes = {
        ano: 'Ano letivo',
        matricula: 'Matrícula',
        pagamento: 'Pagamento',
        documento: 'Documento',
        turma: 'Turma'
    };
    return nomes[categoria] || 'Atividade';
}

function iconeCategoria(categoria) {
    if (categoria === 'pagamento') return <BsCashCoin aria-hidden="true" />;
    if (categoria === 'documento') return <BsFileEarmarkTextFill aria-hidden="true" />;
    if (categoria === 'matricula') return <BsPeopleFill aria-hidden="true" />;
    if (categoria === 'turma') return <BsBookHalf aria-hidden="true" />;
    return <BsInfoCircle aria-hidden="true" />;
}

function rotuloFatiaPagamento({ cx, cy, midAngle, outerRadius, percent, payload }) {
    const angulo = (-midAngle * Math.PI) / 180;
    const raio = outerRadius + 14;
    const x = cx + raio * Math.cos(angulo);
    const y = cy + raio * Math.sin(angulo);
    const ancora = x > cx ? 'start' : 'end';

    return (
        <text x={x} y={y} fill={payload.color} textAnchor={ancora} dominantBaseline="central" className="sec-pie-label" >
            {`${payload.name} ${Math.round(percent * 100)}%`}
        </text>
    );
}

export default function SecretariaDashboardProfissional() {
    const [anoSelecionado, setAnoSelecionado] = useState('');
    const { userInfo } = useGlobalAuth();
    const { data: dashboardData, error, isLoading, isValidating, mutate } = useDashboardSWR(
        ['secretaria-dashboard', anoSelecionado],
        buscarDadosDashboard,
        { revalidateIfStale: true, revalidateOnFocus: true }
    );
    const dashboard = dashboardData?.dashboard || null;
    const notificacoes = dashboardData?.notificacoes || EMPTY_NOTIFICATIONS;
    const [dataCalendario, setDataCalendario] = useState(null);
    const [filtrarPorData, setFiltrarPorData] = useState(false);
    const [calendarioMontado, setCalendarioMontado] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setCalendarioMontado(true);
            setDataCalendario(new Date());
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    const atualizarDashboard = () => mutate().catch((refreshError) => { console.error('Erro ao atualizar dashboard da Secretaria:', refreshError); });

    const eventosPorDia = useMemo(() => notificacoes.reduce((eventos, item) => {
        if (!item.data_hora) return eventos;
        const data = new Date(item.data_hora);
        if (Number.isNaN(data.getTime())) return eventos;
        const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
        if (!eventos[chave]) eventos[chave] = [];
        eventos[chave].push(item);
        return eventos;
    }, {}), [notificacoes]);

    const dataSelecionadaKey = dataCalendario
        ? `${dataCalendario.getFullYear()}-${String(dataCalendario.getMonth() + 1).padStart(2, '0')}-${String(dataCalendario.getDate()).padStart(2, '0')}`
        : '';
    const eventosSelecionados = dataSelecionadaKey ? (eventosPorDia[dataSelecionadaKey] || []) : [];
    const atividadesExibidas = filtrarPorData
        ? eventosSelecionados.slice(0, 5)
        : notificacoes.slice(0, 5);
    const alocacoesPorItem = (dashboard?.alocacoes_talao_por_item || [])
        .filter((item) => Number(item.montante) > 0)
        .map((item, index) => ({
            ...item,
            montante: Number(item.montante),
            quantidade_taloes: Number(item.quantidade_taloes),
            color: CORES_POLO[index % CORES_POLO.length]
        }));

    const tileContent = ({ date, view }) => {
        const chave = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const total = eventosPorDia[chave]?.length || 0;
        if (view !== 'month' || !total) return null;
        return <span className="sec-calendar-dot" aria-label={`${total} atividades`} />;
    };

    const mudarAnoLetivo = (event) => {
        const anoId = event.target.value;
        setAnoSelecionado(anoId);
        setFiltrarPorData(false);
    };

    return (
        <>
            <AdminHeader titulo={userInfo?.nome ? `Bem Vindo ${userInfo.nome} - O Painel da Secretaria` : isLoading ? 'A carregar Secretaria...' : 'Painel da Secretaria'} descricao={dashboard?.escola_nome ? `Acompanhe os indicadores e a atividade de ${dashboard.escola_nome}.` : 'Acompanhe os indicadores académicos e administrativos da escola.'} dashboard={dashboard} atualizadoEm={dashboardData?.atualizadoEm} anoVal={anoSelecionado || dashboard?.ano_letivo_id || ''} mudarAnoLetivo={mudarAnoLetivo} loading={isValidating} onRefresh={atualizarDashboard} />
            <DashboardFeedback dashboard={dashboard} error={error} isLoading={isLoading} isValidating={isValidating}
                onRetry={atualizarDashboard}
                loadingMessage="A carregar indicadores reais da escola..."
            />

            {dashboard && (
                <>
                    <section className="sec-prof-metrics" aria-label="Indicadores da escola">
                        <article className="prof-metric-card">
                            <div className="metric-icon-wrap blue"><BsPeopleFill size={22} /></div>
                            <div className="metric-info">
                                <span>Alunos matriculados</span>
                                <h2>{dashboard.alunos_ativos}</h2>
                                <small className="trend">Matrículas ativas no ano letivo</small>
                            </div>
                        </article>
                        <article className="prof-metric-card">
                            <div className="metric-icon-wrap purple"><BsBookHalf size={22} /></div>
                            <div className="metric-info">
                                <span>Turmas ativas</span>
                                <h2>{dashboard.turmas_ativas}</h2>
                                <small className="trend">Registadas nesta escola</small>
                            </div>
                        </article>
                        <article className="prof-metric-card">
                            <div className="metric-icon-wrap amber"><BsPersonBadge size={22} /></div>
                            <div className="metric-info">
                                <span>Professores ativos</span>
                                <h2>{dashboard.professores_ativos}</h2>
                                <small className="trend">Associados à escola</small>
                            </div>
                        </article>
                        <article className="prof-metric-card">
                            <div className="metric-icon-wrap green"><BsWallet2 size={22} /></div>
                            <div className="metric-info">
                                <span>Total previsto no ano</span>
                                <h2>{formatarMoeda(dashboard.total_previsto)}</h2>
                                <small className="trend">Cobranças obrigatórias do ano letivo</small>
                            </div>
                        </article>
                    </section>

                    <section className="sec-dashboard-chart-grid" aria-label="Montantes e distribuição dos talões">
                        <article className="prof-card sec-dashboard-panel">
                            <div className="prof-card-header">
                                <div>
                                    <h3>Montante distribuído por item</h3>
                                    <p>Valores dos talões associados pela Secretaria às cobranças do ano letivo selecionado</p>
                                </div>
                                <BsWallet2 className="sec-dashboard-panel-icon" />
                            </div>
                            {alocacoesPorItem.length ? (
                                <ResponsiveContainer width="100%" height={300}>
                                    <LineChart data={alocacoesPorItem} margin={{ top: 12, right: 18, left: 6, bottom: 6 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" />
                                        <XAxis dataKey="nome" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                                        <YAxis
                                            tickFormatter={(valor) => new Intl.NumberFormat('pt-PT', { notation: 'compact', maximumFractionDigits: 1 }).format(valor)}
                                            tick={{ fill: '#64748b', fontSize: 10 }}
                                            axisLine={{ stroke: '#cbd5e1' }}
                                            tickLine={false}
                                        />
                                        <Tooltip
                                            formatter={(valor) => [formatarMoeda(valor), 'Montante distribuído']}
                                            contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                                        />
                                        <Legend />
                                        <Line type="monotone" dataKey="montante" name="Montante distribuído" stroke="#0284c7" strokeWidth={3} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <p className="sec-dashboard-state">Ainda não há talões distribuídos por item neste ano letivo.</p>
                            )}
                        </article>

                        <article className="prof-card sec-dashboard-panel">
                            <div className="prof-card-header">
                                <div>
                                    <h3>Talões associados por item</h3>
                                    <p>Um talão pode ser distribuído por mais de um item de pagamento</p>
                                </div>
                                <BsCashCoin className="sec-dashboard-panel-icon payment" />
                            </div>
                            {alocacoesPorItem.length ? (
                                <div className="sec-payment-chart-layout">
                                    <ResponsiveContainer width="100%" height={290}>
                                        <PieChart margin={{ top: 16, right: 0, bottom: 14, left: 0 }}>
                                            <Pie
                                                data={alocacoesPorItem}
                                                dataKey="quantidade_taloes"
                                                nameKey="nome"
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={74}
                                                paddingAngle={2}
                                                stroke="#fff"
                                                strokeWidth={2}
                                                label={rotuloFatiaPagamento}
                                                labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                                            >
                                                {alocacoesPorItem.map((item) => (
                                                    <Cell key={item.propina_taxa_id} fill={item.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                formatter={(valor) => [`${valor} talão(ões)`, 'Associados ao item']}
                                                contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="sec-payment-legend" aria-label="Montantes e talões distribuídos por item">
                                        {alocacoesPorItem.map((item) => (
                                            <div className="sec-payment-legend-item" key={item.propina_taxa_id}>
                                                <span className="sec-payment-swatch" style={{ backgroundColor: item.color }} />
                                                <span className="sec-payment-branch">{item.nome}</span>
                                                <span className="sec-payment-values">
                                                    <strong>{item.quantidade_taloes} talão(ões)</strong>
                                                    <small>{formatarMoeda(item.montante)}</small>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <p className="sec-dashboard-state">Ainda não há talões associados a itens neste ano letivo.</p>
                            )}
                        </article>
                    </section>

                    <section className="sec-dashboard-activity-grid">
                        <article className="prof-card sec-calendar-panel">
                            <div className="prof-card-header">
                                <div>
                                    <h3>Calendário escolar</h3>
                                    <p>Os pontos assinalam atividade registada na escola</p>
                                </div>
                                <BsCalendar3 className="sec-dashboard-panel-icon" />
                            </div>
                            {calendarioMontado && dataCalendario && (
                                <Calendar
                                    className="sec-mini-calendar sec-clay-calendar"
                                    onChange={(value) => {
                                        setDataCalendario(value);
                                        setFiltrarPorData(true);
                                    }}
                                    value={dataCalendario}
                                    tileContent={tileContent}
                                />
                            )}
                            <div className="sec-calendar-footnote">
                                <span className="sec-calendar-dot" /> Atividade registada
                            </div>
                        </article>

                        <article className="prof-card activity-card sec-dashboard-activity">
                            <div className="prof-card-header">
                                <div>
                                    <h3>{filtrarPorData && dataCalendario ? 'Atividade do dia' : 'Atividade recente da escola'}</h3>
                                    <p>
                                        {filtrarPorData && dataCalendario
                                            ? dataCalendario.toLocaleDateString('pt-PT')
                                            : 'Registos reais de matrículas, pagamentos, documentos e turmas'}
                                    </p>
                                </div>
                                {filtrarPorData && (
                                    <button type="button" className="sec-activity-reset" onClick={() => setFiltrarPorData(false)}>
                                        Mais recentes
                                    </button>
                                )}
                            </div>
                            {atividadesExibidas.length ? (
                                <div className="prof-activity-list">
                                    {atividadesExibidas.map((item) => (
                                        <article className="prof-activity-item" key={`${item.categoria}:${item.id}`}>
                                            <div className="activity-type-indicator">{iconeCategoria(item.categoria)}</div>
                                            <div className="activity-body">
                                                <div className="activity-top-row">
                                                    <strong>{item.titulo}</strong>
                                                    <time className="activity-hour" dateTime={item.data_hora || undefined}>
                                                        {formatarData(item.data_hora)}
                                                    </time>
                                                </div>
                                                <p>{item.mensagem}</p>
                                            </div>
                                            <span className={`sec-activity-category ${item.categoria}`}>{nomeCategoria(item.categoria)}</span>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <p className="sec-dashboard-state">
                                    {filtrarPorData ? 'Não há atividade registada nesta data.' : 'Não há atividade registada neste ano letivo.'}
                                </p>
                            )}
                            <Link href="/dashboard/secretaria/notificacoes" className="sec-activity-more">
                                Ver mais atividades <BsArrowUpRight aria-hidden="true" />
                            </Link>
                        </article>
                    </section>
                </>
            )}
        </>
    );
}
