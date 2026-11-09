'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { format } from 'date-fns';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { BsReceipt, BsCalendarEvent, BsEye, BsArrowUpRight, BsChevronRight, BsGear, BsArrowDownCircleFill, BsArrowUpCircleFill } from 'react-icons/bs';
import '../../../styles/tesouraria-dashboard.css';
import AdminHeader from '@/components/adminHeader';
import DashboardFeedback from '@/components/dashboardFeedback';
import useDashboardSWR from '@/hooks/useDashboardSWR';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1`;
const EMPTY_PAYMENTS = [];

const STATUS_LABELS = {
  aprovado: 'Registado',
  flagged: 'Atenção',
  pendente_aprovacao: 'Pendente de aprovação'
};

async function lerRespostaApi(response) {
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Falha ao carregar o dashboard (HTTP ${response.status}).`);
  }
  return data;
}

function nomePagador(item) {
  if (item.tipo === 'movimento_manual') return item.destinatario || 'Não especificado';
  if (item.tipo_registo === 'aluno_registado') {
    return [item.aluno_nome, item.aluno_apelido].filter(Boolean).join(' ') || 'Aluno não identificado';
  }
  return item.nome_candidato || 'Candidato não identificado';
}

function formatarData(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleDateString();
}

function formatarHora(valor) {
  if (!valor) return '—';
  if (/^\d{2}:\d{2}$/.test(valor)) return valor;
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? '—'
    : data.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

async function buscarDadosDashboard([, anoLetivoId]) {
  const params = new URLSearchParams();
  if (anoLetivoId) params.set('ano_letivo_id', anoLetivoId);
  const query = params.size ? `?${params.toString()}` : '';
  const result = await lerRespostaApi(await fetch(`${API_URL}/tesouraria/dashboard${query}`, { credentials: 'include', cache: 'no-store' }));
  return { dashboard: result.dados, atualizadoEm: new Date().toISOString() };
}

export default function SmartDashboardOverview() {
  const [selectedAnoId, setSelectedAnoId] = useState('');
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [date, setDate] = useState(null);
  const [isMounted, setIsMounted] = useState(false);
  const [selectedDay, setSelectedDay] = useState('');

  const { data: dashboardData, error, isLoading, isValidating, mutate } = useDashboardSWR(
    ['tesouraria-dashboard', selectedAnoId],
    buscarDadosDashboard,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  const dashboard = dashboardData?.dashboard || null;
  const loading = isLoading;

  const atualizarDashboard = () => mutate().catch((refreshError) => {
    console.error('Erro ao atualizar dashboard de tesouraria:', refreshError);
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDate(new Date());
      setIsMounted(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const pagamentos = dashboard?.pagamentos || EMPTY_PAYMENTS;
  const movimentos = dashboard?.movimentos || EMPTY_PAYMENTS;
  const taloesUsados = dashboard?.taloes_usados || EMPTY_PAYMENTS;

  const totalEntradas = Number(dashboard?.total_entradas || 0);
  const totalSaidas = Number(dashboard?.total_saidas || 0);
  const balancoLiquido = Number(dashboard?.saldo_liquido || 0);

  const registosRecentes = useMemo(() => [
    ...pagamentos,
    ...movimentos.map((item) => ({
      ...item,
      tipo: 'movimento_manual',
      tipo_movimento: item.tipo,
      referencia_banco: item.referencia,
      valor: item.valor,
      estado: 'registado',
      criado_em: item.criado_em || item.data_movimento
    }))
  ].sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0)), [pagamentos, movimentos]);
  const entradasRecentes = useMemo(() => [
    ...pagamentos.filter((item) => item.estado === 'aprovado'),
    ...movimentos.filter((item) => item.tipo === 'entrada').map((item) => ({
      ...item,
      tipo: 'movimento_manual',
      referencia_banco: item.referencia,
      criado_em: item.criado_em || item.data_movimento
    }))
  ].sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0)).slice(0, 4), [pagamentos, movimentos]);
  const saidasRecentes = movimentos.filter((item) => item.tipo === 'saida').slice(0, 4);

  const activitiesByDate = useMemo(() => Object.fromEntries(
    (dashboard?.atividades || []).map((activity) => [activity.data, activity.quantidade])
  ), [dashboard?.atividades]);

  const dateKey = date ? format(date, 'yyyy-MM-dd') : '';
  const activityCount = selectedDay ? activitiesByDate[selectedDay] || 0 : 0;

  const tileContent = ({ date: tileDate, view }) => {
    if (view !== 'month') return null;
    const key = format(tileDate, 'yyyy-MM-dd');
    return activitiesByDate[key] ? <div className="tdp-calendar-dot" title={`${activitiesByDate[key]} pagamentos`} /> : null;
  };

  const abrirDetalhesPagamento = (item) => setSelectedPayment(item);

  return (
    <>
      <AdminHeader
        titulo={dashboard?.escola_nome || (isLoading ? 'A carregar escola...' : 'Dashboard da Tesouraria')}
        descricao="Resumo de pagamentos, matrículas e atividade financeira."
        dashboard={dashboard}
        atualizadoEm={dashboardData?.atualizadoEm}
        anoVal={selectedAnoId || dashboard?.ano_letivo?.id || ''}
        mudarAnoLetivo={(event) => setSelectedAnoId(event.target.value)}
        loading={isValidating}
        onRefresh={atualizarDashboard}
      >
        <Link href="/dashboard/tesouraria/configuracao" className="tdp-header-config" title="Configuração da tesouraria">
          <BsGear aria-hidden="true" /> Configuração
        </Link>
      </AdminHeader>

      <DashboardFeedback
        dashboard={dashboard}
        error={error}
        isLoading={isLoading}
        isValidating={isValidating}
        onRetry={atualizarDashboard}
        loadingMessage="A carregar dados reais da tesouraria..."
      />

      {dashboard && (
        <>
          {/* TESOURARIA RESUMO GRID (COM BRILHO SUAVE) */}
          <div className="tesouraria-resumo-grid">
            <div className="resumo-card">
              <span>Horário de Caixa</span>
              <div className="valor" style={{ fontSize: '0.95rem', color: '#334155' }}>
                Estado: {dashboard.caixa?.estado === 'aberto' ? 'Aberto' : 'Fechado'}
                <br />
                Abertura: {formatarHora(dashboard.caixa?.aberto_hora || dashboard.caixa?.aberto_em)} | Fecho: {formatarHora(dashboard.caixa?.fechado_hora || dashboard.caixa?.fechado_em)}
              </div>
            </div>
            <div className="resumo-card">
              <span>Total Entradas</span>
              <div className="valor valor-entrada">+ {totalEntradas.toLocaleString('pt-PT')} CFA</div>
            </div>
            <div className="resumo-card">
              <span>Total Saídas</span>
              <div className="valor valor-saida">- {totalSaidas.toLocaleString('pt-PT')} CFA</div>
            </div>
            <div className="resumo-card">
              <span>Balanço Líquido</span>
              <div className={`valor ${balancoLiquido >= 0 ? 'valor-entrada' : 'valor-saida'}`}>
                {balancoLiquido.toLocaleString('pt-PT')} CFA
              </div>
            </div>
          </div>

          <div className="tdp-grid-main">
            
            {/* LINHA 1: PAGAMENTOS POR POLO AO LADO DE ALERTAS DE PAGAMENTO */}
            <div className="tdp-row-dupla">
              <section className="tdp-card tdp-chart-card">
                <div className="tdp-card-header">
                  <div>
                    <h2>Pagamentos por polo</h2>
                    <p>Pagamentos e talões alocados por polo no ano letivo.</p>
                  </div>
                </div>
                <div className="tdp-recharts-container">
                  {!loading && dashboard?.polos?.length ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={dashboard.polos} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 12 }} axisLine={{ stroke: '#cbd5e1' }} />
                        <YAxis tick={{ fill: '#475569', fontSize: 12 }} axisLine={{ stroke: '#cbd5e1' }} />
                        <Tooltip contentStyle={{ background: '#0f172a', borderRadius: '8px', border: 'none', color: '#fff' }} formatter={(value) => [`${Number(value).toLocaleString()} CFA`]} />
                        <Bar dataKey="receita" name="Pagamentos registados" fill="#0284c7" radius={[6, 6, 0, 0]} barSize={32} />
                        <Bar dataKey="pendente" name="Pagamentos sinalizados" fill="#f59e0b" radius={[6, 6, 0, 0]} barSize={32} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="tdp-empty-text">{loading ? 'A carregar dados...' : 'Sem polos ativos ou pagamentos neste ano letivo.'}</p>
                  )}
                </div>
              </section>

              <div className="tdp-card tdp-notif-card">
                <div className="tdp-card-header">
                  <div className="tdp-notif-title-box">
                    <BsReceipt className="tdp-bell-icon" />
                    <h2>Talões usados pela Secretaria</h2>
                  </div>
                  <span className="tdp-notif-count">{dashboard?.total_taloes_usados || 0}</span>
                </div>
                <div className="tdp-notif-list">
                  {taloesUsados.map((item) => (
                    <article key={`${item.origem}-${item.id}`} className="tdp-notif-item info">
                      <div className="tdp-notif-icon">
                        <BsReceipt />
                      </div>
                      <div className="tdp-notif-body">
                        <div className="tdp-notif-top">
                          <strong>{item.nome_secretaria || 'Secretaria'} usou um talão</strong>
                          <small>{formatarData(item.criado_em)}</small>
                        </div>
                        <p><strong>{item.codigo_talao}</strong> · {item.nome_aluno || 'Aluno'}{item.classe ? ` · ${item.classe}` : ''} · {Number(item.valor_alocado || 0).toLocaleString()} CFA</p>
                        {item.itens && <p>{item.itens}</p>}
                      </div>
                    </article>
                  ))}
                  {!loading && taloesUsados.length === 0 && (
                    <p className="tdp-empty-text">Ainda não há talões usados pela Secretaria neste ano letivo.</p>
                  )}
                </div>
                <div className="tdp-notif-footer">
                  <Link href="/dashboard/tesouraria/recibos">
                    Abrir recibos <BsChevronRight />
                  </Link>
                </div>
              </div>
            </div>

            {/* LINHA 2: CALENDÁRIO AO LADO DE PAGAMENTOS RECENTES */}
            <div className="tdp-middle-row">
              <div className="tdp-card tdp-calendar-card">
                <div className="tdp-card-header">
                  <h2><BsCalendarEvent /> Atividade de pagamentos</h2>
                  <span className="tdp-badge-tag">Datas com registos</span>
                </div>
                <div className="tdp-calendar-layout">
                  {isMounted && date && (
                    <Calendar
                      onChange={setDate}
                      value={date}
                      onClickDay={(selectedDate) => setSelectedDay(format(selectedDate, 'yyyy-MM-dd'))}
                      tileContent={tileContent}
                      className="tdp-custom-calendar"
                    />
                  )}
                </div>
                {selectedDay && (
                  <p className="tdp-calendar-selection">
                    {format(dateKey === selectedDay ? date : new Date(`${selectedDay}T00:00:00`), 'dd/MM/yyyy')}: {activityCount} pagamento(s) registado(s).
                  </p>
                )}
              </div>

              <section className="tdp-card tdp-table-card">
                <div className="tdp-card-header">
                  <div>
                    <h2><BsReceipt /> Movimentos recentes</h2>
                    <p>Registos associados ao ano letivo.</p>
                  </div>
                </div>
                <div className="tdp-table-wrapper" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  <table className="tdp-table">
                    <thead>
                      <tr>
                        <th>Referência</th>
                        <th>Origem / destinatário</th>
                        <th>Valor</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan="4" className="tdp-empty-td">A carregar...</td></tr>
                      ) : registosRecentes.slice(0, 5).map((item) => (
                        <tr key={item.id}>
                          <td><code className="tdp-code">{item.referencia_banco || '—'}</code></td>
                          <td>
                            <strong>{nomePagador(item)}</strong>
                            {item.classe && <small>Classe {item.classe}</small>}
                          </td>
                          <td className="tdp-val">{Number(item.valor || 0).toLocaleString()} CFA</td>
                          <td>
                            <span className={`tdp-status ${item.estado || ''}`}>
                              {item.tipo === 'movimento_manual'
                                ? (item.tipo_movimento === 'saida' ? 'Saída registada' : 'Entrada registada')
                                : STATUS_LABELS[item.estado] || item.estado || 'Desconhecido'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!registosRecentes.length && !loading && (
                        <tr><td colSpan="4" className="tdp-empty-td">Sem registos.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {/* LINHA 3: TABELAS DE ENTRADAS E SAÍDAS LADO A LADO (ESTILO CONTABILISTA) */}
            <div className="tdp-tabelas-duplas">
              
              {/* TABELA DE ENTRADAS (AZUL) */}
              <section className="tdp-card" style={{ borderTop: '4px solid #0284c7' }}>
                <div className="tdp-card-header" style={{ display: 'flex', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ color: '#0284c7', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <BsArrowDownCircleFill /> Entradas Recentes
                    </h2>
                    <p>Receitas e créditos contabilizados.</p>
                  </div>
                </div>
                <div className="tdp-table-wrapper">
                  <table className="tdp-table">
                    <thead>
                      <tr>
                        <th>Ref / Recibo</th>
                        <th>Origem / Pagou</th>
                        <th style={{ textAlign: 'right' }}>Montante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entradasRecentes.map((item) => (
                        <tr key={item.id}>
                          <td><code>{item.referencia_banco}</code></td>
                          <td>
                            {nomePagador(item)}
                            {item.classe && <small> · {item.classe}</small>}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#059669' }}>
                            + {Number(item.valor || 0).toLocaleString()} CFA
                          </td>
                        </tr>
                      ))}
                      {!entradasRecentes.length && (
                        <tr><td colSpan="3" className="tdp-empty-td">Nenhuma entrada recente.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* TABELA DE SAÍDAS (VERMELHO) */}
              <section className="tdp-card" style={{ borderTop: '4px solid #dc2626' }}>
                <div className="tdp-card-header" style={{ display: 'flex', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ color: '#dc2626', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <BsArrowUpCircleFill /> Saídas Recentes
                    </h2>
                    <p>Despesas e débitos de caixa.</p>
                  </div>
                </div>
                <div className="tdp-table-wrapper">
                  <table className="tdp-table">
                    <thead>
                      <tr>
                        <th>Ref / Recibo</th>
                        <th>Destinatário</th>
                        <th style={{ textAlign: 'right' }}>Montante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saidasRecentes.map((item) => (
                        <tr key={item.id}>
                          <td><code>{item.referencia}</code></td>
                          <td>{item.destinatario} ({item.descricao})</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#dc2626' }}>
                            - {Number(item.valor || 0).toLocaleString('pt-PT')} CFA
                          </td>
                        </tr>
                      ))}
                      {!saidasRecentes.length && (
                        <tr><td colSpan="3" className="tdp-empty-td">Nenhuma saída registada neste ano letivo.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

            </div>

          </div>

          {selectedPayment && (
            <div className="tdp-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPayment(null); }}>
              <section className="tdp-modal-card" role="dialog" aria-modal="true" aria-labelledby="tdp-payment-title">
                <div className="tdp-modal-header">
                  <h3 id="tdp-payment-title">Detalhes do pagamento</h3>
                  <button type="button" aria-label="Fechar" onClick={() => setSelectedPayment(null)}>×</button>
                </div>
                <dl className="tdp-payment-details">
                  <div><dt>Aluno / Candidato</dt><dd>{nomePagador(selectedPayment)}</dd></div>
                  <div><dt>Referência bancária</dt><dd>{selectedPayment.referencia_banco || '—'}</dd></div>
                  <div><dt>TAL ID</dt><dd>{selectedPayment.codigo_talao || '—'}</dd></div>
                  <div><dt>Item de pagamento</dt><dd>{selectedPayment.item_nome || 'Item removido'}</dd></div>
                  {selectedPayment.classe && <div><dt>Classe</dt><dd>{selectedPayment.classe}</dd></div>}
                  <div><dt>Valor</dt><dd>{Number(selectedPayment.valor || 0).toLocaleString()} CFA</dd></div>
                  <div><dt>Banco</dt><dd>{selectedPayment.banco_origem || '—'}</dd></div>
                  <div><dt>Estado</dt><dd>{STATUS_LABELS[selectedPayment.estado] || selectedPayment.estado || 'Desconhecido'}</dd></div>
                  <div><dt>Registado em</dt><dd>{selectedPayment.criado_em ? new Date(selectedPayment.criado_em).toLocaleString() : '—'}</dd></div>
                </dl>
                <Link className="tdp-payment-link" href="/dashboard/tesouraria/recibos">
                  Abrir recibos e detalhes <BsArrowUpRight />
                </Link>
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}