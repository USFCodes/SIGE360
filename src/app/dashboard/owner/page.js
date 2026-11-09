'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { format, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { PiStudent } from 'react-icons/pi';
import { BiFilterAlt, BiServer, BiBuildingHouse, BiGroup } from 'react-icons/bi';
import { BsArrowUpRight, BsBellFill, BsCalendarEvent, BsEye, BsInfoCircle, BsReceipt, BsX} from 'react-icons/bs';
import { TIPOS_GESTAO } from '../../../utils/constantes';
import AdminHeader from '@/components/adminHeader';
import DashboardFeedback from '@/components/dashboardFeedback';
import useDashboardSWR from '@/hooks/useDashboardSWR';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_OVERVIEW = `${API_BASE}/api/v1/owner/operations/overview`;
const CHART_COLORS = ['#4b5d8b', '#f5b025', '#38a169', '#bc79ec'];
const PAYMENT_FILTERS = [
  { value: 'Todos', label: 'Todos' },
  { value: 'registado', label: 'Registados' },
  { value: 'pendente', label: 'Pendentes' },
  { value: 'flagged', label: 'Atenção' },
  { value: 'rejeitado', label: 'Rejeitados' }
];

function formatNumber(value) {return new Intl.NumberFormat('pt-PT').format(Number(value) || 0);}

function formatCurrency(value) { return `${formatNumber(value)} XOF`;}

function formatDate(value, withTime = false) {
  if (typeof value !== 'string' || !value) return '—';
  try {
    const date = parseISO(value);
    if (Number.isNaN(date.getTime())) return '—';
    return format(date, withTime ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy');
  } catch {
    return '—';
  }
}

function paymentLabel(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'aprovado' || value === 'registado') return 'Registado';
  if (value === 'flagged') return 'Atenção';
  if (value.startsWith('pendente')) return 'Pendente';
  if (value === 'rejeitado') return 'Rejeitado';
  return value.replaceAll('_', ' ') || '—';
}

function paymentStatusClass(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'aprovado' || value === 'registado') return 'aprovado';
  if (value === 'flagged') return 'pendente';
  if (value.startsWith('pendente')) return 'pendente';
  return value;
}

function displayTitle(value) { return String(value || 'Atividade').replaceAll('_', ' ');}

async function buscarDadosDashboard() {
  const response = await fetch(API_OVERVIEW, {
    credentials: 'include',
    cache: 'no-store'
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true || !result.data) {
    throw new Error(result.message || `Não foi possível carregar o painel (HTTP ${response.status}).`);
  }

  const nextData = result.data;
  const eventsMap = {};
  for (const event of nextData.agenda_eventos || []) {
    if (typeof event.data_evento !== 'string') continue;
    const eventDate = parseISO(event.data_evento);
    if (Number.isNaN(eventDate.getTime())) continue;
    const key = format(eventDate, 'yyyy-MM-dd');
    eventsMap[key] = [...(eventsMap[key] || []), displayTitle(event.titulo)];
  }

  return {
    dashboard: { ...nextData, eventsMap },
    atualizadoEm: new Date().toISOString()
  };
}

export default function GodOverview() {
  const { data: dashboardData, error, isLoading, isValidating, mutate } = useDashboardSWR('owner-dashboard', buscarDadosDashboard);
  const ownerData = dashboardData?.dashboard || null;
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [date, setDate] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterPayment, setFilterPayment] = useState('Todos');
  const [selectedPayment, setSelectedPayment] = useState(null);

  useEffect(() => {
    if (typeof ownerData?.data_atual !== 'string') return;
    const currentDate = parseISO(ownerData.data_atual);
    if (!Number.isNaN(currentDate.getTime())) setDate(currentDate);
  }, [ownerData?.data_atual]);

  const atualizarDashboard = () => mutate().catch((refreshError) => {
    console.error('Erro ao atualizar dashboard do Owner:', refreshError);
  });

  const notifications = useMemo(() => (ownerData?.atividade_recente || []).map((activity) => ({
    id: activity.id,
    title: displayTitle(activity.acao),
    time: formatDate(activity.criado_em, true),
    type: 'info',
    school: activity.escola_nome || 'Plataforma',
    actor: activity.actor_nome || 'Conta removida',
    ipAddress: activity.ip_address || 'Não registado',
    entity: activity.entidade || 'Registo',
    entityId: activity.entidade_id || '—'
  })), [ownerData]);

  const categories = useMemo(() => (ownerData?.escolas_por_categoria || []).map((item) => {
    const categoryId = Number(item.categoria);
    return {
      label: categoryId > 0 ? TIPOS_GESTAO[categoryId]?.nome || `Categoria ${categoryId}` : 'Sem categoria',
      value: Number(item.total) || 0
    };
  }), [ownerData]);

  const payments = useMemo(() => (ownerData?.pagamentos_recentes || []).filter((item) => {
    if (filterPayment === 'Todos') return true;
    if (filterPayment === 'pendente') return String(item.estado || '').startsWith('pendente');
    if (filterPayment === 'registado') return ['aprovado', 'registado'].includes(String(item.estado || '').toLowerCase());
    return item.estado === filterPayment;
  }), [ownerData, filterPayment]);

  const dateKey = date ? format(date, 'yyyy-MM-dd') : '';
  const eventsOnDate = dateKey ? ownerData?.eventsMap?.[dateKey] || [] : [];
  const uptimeSeconds = Number(ownerData?.backend_uptime_segundos) || 0;
  const uptimeLabel = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`;
  const indicators = ownerData ? [
    { title: 'Escolas ativas', value: `${formatNumber(ownerData.escolas?.ativas)} / ${formatNumber(ownerData.escolas?.total)}`, color: 'purple', icon: <BiBuildingHouse /> },
    { title: 'Alunos na rede', value: formatNumber(ownerData.alunos?.total), color: 'yellow', icon: <PiStudent /> },
    { title: 'N.º de funcionários', value: formatNumber(ownerData.funcionarios?.total), color: 'green', icon: <BiGroup /> },
    { title: 'Ocorrências de suporte', value: formatNumber(ownerData.tickets_total), color: 'pink', icon: <BiServer /> }
  ] : [];

  const tileContent = ({ date: tileDate, view }) => {
    if (view !== 'month') return null;
    const key = format(tileDate, 'yyyy-MM-dd');
    return ownerData.eventsMap[key]?.length ? <div className="calendar-event-dot" /> : null;
  };

  return (
    <>
      <AdminHeader titulo="Painel de Controlo (GS-TIC)" descricao="Resumo real das escolas, atividade e pagamentos." dashboard={ownerData} atualizadoEm={dashboardData?.atualizadoEm} loading={isValidating} onRefresh={atualizarDashboard} >
        {ownerData && (
            <span className="above500 top-ano">
              <BiServer aria-hidden="true" />
              <span>Backend ativo · {uptimeLabel}</span>
            </span>
          )}
          <Link href="/dashboard/owner/escolas" className="view-all-btn above500" title="Gerir escolas">
            <span>Escolas</span><BsArrowUpRight aria-hidden="true" />
          </Link>
      </AdminHeader>
      <DashboardFeedback dashboard={ownerData} error={error} isLoading={isLoading} isValidating={isValidating} onRetry={atualizarDashboard} loadingMessage="A carregar dados reais do painel..." />

      {ownerData && (
        <>
      <section className="kpi-row" aria-label="Indicadores reais da plataforma">
        {indicators.map((item) => (
          <article className={`kpi-card ${item.color}`} key={item.title}>
            <div className={`icon-box ${item.color}`}>{item.icon}</div>
            <div className="line" />
            <div className="kpi-data">
              <span className="kpi-label">{item.title}</span>
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
              <h2>Agenda da Plataforma</h2>
            </div>
            {date && (
              <Calendar
                onChange={(value) => setDate(Array.isArray(value) ? value[0] : value)}
                value={date}
                onClickDay={(selectedDate) => {
                  setDate(selectedDate);
                  setIsModalOpen(true);
                }}
                tileContent={tileContent}
                className="calendar"
              />
            )}
            {isModalOpen && date && (
              <div className="cale-modal" onClick={() => setIsModalOpen(false)}>
                <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                  <div className="modal-header">
                    <h3>Atividade em {format(date, 'dd/MM/yyyy', { locale: pt })}</h3>
                    <button type="button" onClick={() => setIsModalOpen(false)} className="modal-close-btn" aria-label="Fechar">
                      <BsX size={22} />
                    </button>
                  </div>
                  <div className="modal-events-list">
                    {eventsOnDate.length ? eventsOnDate.map((event, index) => (
                      <div className="modal-event-item" key={`${event}-${index}`}>{event}</div>
                    )) : <p className="modal-empty-text">Nenhuma ocorrência ou ação auditada nesta data.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="notif-wrapper">
            <div className="card-header">
              <BsBellFill className="card-icon" />
              <h2>Atividade recente</h2>
              <span className="notif-badge">{notifications.length}</span>
            </div>
            <div className="notif-list">
              {notifications.length ? notifications.map((item) => (
                <button type="button" key={item.id} className={`notif-card ${item.type}`} onClick={() => setSelectedNotification(item)} >
                  <span className="notif-card-icon"><BsInfoCircle /></span>
                  <span className="notif-card-body">
                    <span className="notif-top">
                      <strong className="notif-title">{item.title}</strong>
                      <small className="notif-time">{item.time}</small>
                    </span>
                    <span className="notif-desc">{item.school}</span>
                  </span>
                </button>
              )) : <p className="modal-empty-text">Sem atividade de auditoria registada.</p>}
            </div>
            <Link href="/dashboard/owner/atividades" className="dashboard-view-link">
              <span className="its900">Ver todas as atividades</span>
            </Link>
            {selectedNotification && (
              <div className="cale-modal" onClick={() => setSelectedNotification(null)}>
                <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                  <div className="modal-header">
                    <h3>{selectedNotification.title}</h3>
                    <button type="button" onClick={() => setSelectedNotification(null)} className="modal-close-btn" aria-label="Fechar">
                      <BsX size={22} />
                    </button>
                  </div>
                  <div className="payment-receipt-content">
                    <div className="receipt-row"><span>Escola:</span><strong>{selectedNotification.school}</strong></div>
                    <div className="receipt-row"><span>Responsável:</span><strong>{selectedNotification.actor}</strong></div>
                    <div className="receipt-row"><span>Endereço IP:</span><strong>{selectedNotification.ipAddress}</strong></div>
                    <div className="receipt-row"><span>Registo:</span><strong>{selectedNotification.entity} · {selectedNotification.entityId}</strong></div>
                    <div className="receipt-row"><span>Data:</span><strong>{selectedNotification.time}</strong></div>
                  </div>
                  
                  <Link href="/dashboard/owner/notificacoes" className="dashboard-view-link">
                    <span className="its900">Ver todas as atividades</span>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </article>

        <article className="stage-card">
          <div className="card-header">
            <h2>Distribuição das Escolas</h2>
            <span className="card-sub-info">Por tipo de gestão registado</span>
          </div>
          {categories.length ? (
            <div className="stage-3d-layout">
              <div className="stage-legend-list">
                {categories.map((category, index) => (
                  <div className="stage-legend-item" key={`${category.label}-${index}`}>
                    <span className="stage-dot" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                    <div className="stage-info">
                      <strong className="stage-name">{category.label}</strong>
                      <span className="stage-count">{category.value} {category.value === 1 ? 'escola' : 'escolas'}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="chart-container-3d">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categories} margin={{ top: 8, right: 12, left: -18, bottom: 8 }}>
                    <XAxis dataKey="label" hide />
                    <YAxis allowDecimals={false} stroke="#bbb" fontSize={11} />
                    <Tooltip formatter={(value) => [`${value} escolas`, 'Total']} />
                    <Bar dataKey="value" barSize={32} radius={[4, 4, 0, 0]}>
                      {categories.map((category, index) => (
                        <Cell key={`${category.label}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : <p className="modal-empty-text">Sem categorias de gestão registadas.</p>}
        </article>
      </section>

      <section className="bottom-row">
        <article className="podium-section-wrapper">
          <div className="podium-header-row">
            <h2>Maiores Escolas <span className="its900">em matrículas ativas</span></h2>
            <Link href="/dashboard/owner/escolas" className="view-all-btn">
              <span className="its900">Ver todas</span><BsArrowUpRight size={12} />
            </Link>
          </div>
          <div className="podium-cards-container">
            {ownerData.escolas_com_alunos?.length ? ownerData.escolas_com_alunos.slice(0, 3).map((school, index) => (
              <article className={`podium-card ${['green-podium', 'purple-podium', 'yellow-podium'][index]}`} key={school.id}>
                <div className="student-avatar-wrap">
                  <span className="student-name">{String(school.nome || 'E').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                </div>
                <h3 className="student-name">{school.nome}</h3>
                <span className="student-turma">{school.local || 'Local não indicado'}</span>
                <strong className="student-score">{formatNumber(school.alunos)} {Number(school.alunos) === 1 ? 'aluno' : 'alunos'}</strong>
                <span className="podium-rank-badge">#{index + 1}</span>
              </article>
            )) : <p className="modal-empty-text">Ainda não há matrículas ativas.</p>}
          </div>
        </article>

        <article className="smart-card glass-payments-card">
          <div className="payments-header">
            <div>
              <h2><BsReceipt /> Pagamentos e entradas recentes</h2>
              <p className="payments-subtext">Não representa faturação de licenciamento da plataforma.</p>
            </div>
            <div className="payment-stand">
              <div className="payments-filter-group">
                <BiFilterAlt className="filter-icon" />
                {PAYMENT_FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.value}
                    className={`filter-btn ${filterPayment === filter.value ? 'active' : ''}`}
                    onClick={() => setFilterPayment(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="payments-table-container">
            <table className="glass-table">
              <thead>
                <tr><th>Talão</th><th>Escola</th><th>Registado por</th><th>Valor</th><th>Data</th><th>Estado</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {payments.map((item) => (
                  <tr key={item.id}>
                    <td><span className="trx-code">{item.codigo_talao || item.id?.slice(0, 8) || '—'}</span></td>
                    <td><strong className="student-cell-name">{item.escola_nome || '—'}</strong></td>
                    <td>{item.registado_por_nome || '—'}</td>
                    <td><strong className="amount-text">{formatCurrency(item.valor)}</strong></td>
                    <td>{formatDate(item.data_pagamento)}</td>
                    <td><span className={`status-badge ${paymentStatusClass(item.estado)}`}>{paymentLabel(item.estado)}</span></td>
                    <td><button type="button" className="btn-view-receipt" onClick={() => setSelectedPayment(item)} title="Ver pagamento"><BsEye /> Ver</button></td>
                  </tr>
                ))}
                {!payments.length && <tr><td colSpan="7" className="modal-empty-text">Sem pagamentos para este filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          {selectedPayment && (
            <div className="glass-modal-overlay" onClick={() => setSelectedPayment(null)}>
              <div className="glass-modal-card payment-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                <div className="modal-header">
                  <h3>Detalhes do pagamento</h3>
                  <button type="button" onClick={() => setSelectedPayment(null)} className="modal-close-btn" aria-label="Fechar"><BsX size={22} /></button>
                </div>
                <div className="payment-receipt-content">
                  <div className="receipt-row"><span>Talão:</span><strong>{selectedPayment.codigo_talao || selectedPayment.id}</strong></div>
                  <div className="receipt-row"><span>Escola:</span><strong>{selectedPayment.escola_nome || '—'}</strong></div>
                  <div className="receipt-row"><span>Registado por:</span><strong>{selectedPayment.registado_por_nome || '—'}</strong></div>
                  <div className="receipt-row"><span>Tipo:</span><strong>{String(selectedPayment.tipo_registo || '—').replaceAll('_', ' ')}</strong></div>
                  <div className="receipt-row"><span>Valor:</span><strong>{formatCurrency(selectedPayment.valor)}</strong></div>
                  <div className="receipt-row"><span>Data:</span><strong>{formatDate(selectedPayment.data_pagamento)}</strong></div>
                  <div className="receipt-row"><span>Estado:</span><strong>{paymentLabel(selectedPayment.estado)}</strong></div>
                </div>
                <p className="payments-subtext">Consulta apenas. A aprovação é feita nos módulos financeiros da escola.</p>
              </div>
            </div>
          )}
        </article>
      </section>
        </>
      )}
    </>
  );
}
