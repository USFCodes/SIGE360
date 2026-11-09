'use client';

import { useState } from 'react';
import Link from 'next/link';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BsBell, BsBook, BsCalendar3, BsCheck2Circle, BsClock, BsGeoAlt, BsMortarboard, BsPeople } from 'react-icons/bs';
import DashboardFeedback from '@/components/dashboardFeedback';
import { useTeacherDashboard, useTeacherPageHeader } from '@/components/teacher-dashboard-shell';
import useDashboardSWR from '@/hooks/useDashboardSWR';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_PROFESSORES = `${API_BASE}/api/v1/professores`;

const ICONES_KPI = {
  'Turmas Atribuídas': BsMortarboard,
  'Total de Alunos': BsPeople,
  'Aulas Lecionadas': BsBook,
  'Média de Assiduidade': BsCheck2Circle
};

const CORES_GRAFICO = ['#1677a8', '#e08b36', '#2f9b72', '#8a62b5', '#d65768', '#4389b5'];
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

async function lerRespostaApi(response) {
  const texto = await response.text();
  let data;
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Resposta inválida da API (HTTP ${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Erro no servidor (HTTP ${response.status}).`);
  }
  return data;
}

export default function TeacherDashboard() {
  const { anoLetivoId } = useTeacherDashboard();
  const [dataSelecionada, setDataSelecionada] = useState(null);

  const buscarDadosPainel = async () => {
    const parametros = new URLSearchParams();
    if (anoLetivoId) parametros.set('ano_letivo_id', anoLetivoId);
    const query = parametros.toString();
    const url = `${API_PROFESSORES}/meu-painel/dados${query ? `?${query}` : ''}`;
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const data = await lerRespostaApi(response);
    if (!data.data) throw new Error('A API devolveu dados incompletos para o painel do Professor.');
    return { dashboard: data.data, atualizadoEm: new Date().toISOString() };
  };

  const { data: dashboardData, error, isLoading, isValidating, mutate } = useDashboardSWR(
    anoLetivoId === null ? null : ['professor-dashboard', anoLetivoId],
    buscarDadosPainel,
    { revalidateIfStale: true, revalidateOnFocus: true }
  );

  const teacherData = dashboardData?.dashboard || null;
  const turmas = teacherData?.turmasLecionadas || [];
  const horarios = teacherData?.horarios || [];
  const avisos = teacherData?.avisosPedagogicos || [];
  const graficoNotas = teacherData?.graficoNotas || [];
  const seriesNotas = teacherData?.seriesNotas || [];

  const diasComAula = new Set(horarios.map((horario) => horario.dia_semana?.toLowerCase()));
  const atualizarDashboard = () => mutate().catch((err) => console.error(err));
  useTeacherPageHeader({
    title: 'PAINEL DO PROFESSOR',
    description: 'Acompanhe o seu desempenho, horário, turmas e avisos pedagógicos.',
    onRefresh: atualizarDashboard,
    actions: [{
      label: 'Registar presenças',
      href: '/dashboard/professor/presencas',
      icon: <BsCheck2Circle />
    }]
  });

  return (
    <div className="teacher-dashboard-container">
      <DashboardFeedback 
        dashboard={teacherData} 
        error={error} 
        isLoading={isLoading || anoLetivoId === null}
        isValidating={isValidating} 
        onRetry={atualizarDashboard} 
        loadingMessage="A carregar o seu painel pedagógico..." 
      />

      {teacherData && (
        <main className="teacher-home">
          
          {/* KPI CARDS */}
          <section className="teacher-kpi-row">
            {(teacherData.kpiRows || []).map((item) => {
              const Icone = ICONES_KPI[item.nome] || BsBook;
              return (
                <article className="teacher-kpi-card" key={item.nome}>
                  <div className={`teacher-kpi-icon teacher-kpi-icon-${item.color}`}>
                    <Icone />
                  </div>
                  <div className="teacher-kpi-content">
                    <span className="teacher-kpi-label">{item.nome}</span>
                    <strong className="teacher-kpi-value">{item.value}</strong>
                  </div>
                </article>
              );
            })}
          </section>

          {/* GRELHA: PLANEAMENTO E COMUNICAÇÃO PARTILHAM UM PAINEL */}
          <div className="teacher-balanced-grid">
            
            {/* LINHA 1: DESEMPENHO */}
            <section className="teacher-panel">
              <div className="teacher-panel-heading">
                <div>
                  <span className="teacher-section-kicker">Desempenho</span>
                  <h2>Evolução das notas</h2>
                  <p>Média final por período letivo.</p>
                </div>
                <BsBook className="teacher-heading-icon" />
              </div>

              {graficoNotas.length && seriesNotas.length ? (
                <div className="teacher-grades-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={graficoNotas} margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="periodo" tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis domain={[0, teacherData.cotacaoMaxima || 20]} tick={{ fill: '#64748b', fontSize: 10 }} width={25} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 10, paddingTop: 5 }} />
                      {seriesNotas.map((serie, index) => (
                        <Line key={serie.dataKey} type="monotone" dataKey={serie.dataKey} name={serie.nome} stroke={CORES_GRAFICO[index % CORES_GRAFICO.length]} strokeWidth={2.5} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="teacher-inline-empty">
                  <BsBook />
                  <p>Ainda não há notas finais registadas.</p>
                </div>
              )}
            </section>

            {/* PLANEAMENTO E COMUNICAÇÃO */}
            <section className="teacher-panel teacher-panel-planning-communication">
              <div className="teacher-panel-heading">
                <div>
                  <span className="teacher-section-kicker">Planeamento & Comunicação</span>
                  <h2>Calendário e avisos</h2>
                  <p>Agenda letiva e avisos pedagógicos.</p>
                </div>
                <BsCalendar3 className="teacher-heading-icon" />
              </div>
              <div className="teacher-planning-communication-content">
                <div className="teacher-calendar-section">
                  <span className="teacher-section-kicker">Planeamento</span>
                  <Calendar
                    locale="pt-PT"
                    value={dataSelecionada || new Date()}
                    onChange={setDataSelecionada}
                    tileClassName={({ date, view }) => (
                      view === 'month' && diasComAula.has(DIAS_SEMANA[date.getDay()]) ? 'teacher-calendar-class-day' : undefined
                    )}
                    className="teacher-calendar-widget"
                  />
                </div>
                <div className="teacher-notices-section">
                  <div className="teacher-notices-heading">
                    <div>
                      <span className="teacher-section-kicker">Comunicação</span>
                      <h3>Avisos pedagógicos</h3>
                      <p>{avisos.length} avisos ativos.</p>
                    </div>
                    <BsBell className="teacher-heading-icon" />
                  </div>
                  {avisos.length > 0 ? (
                    <div className="teacher-mini-notice">
                      <BsBell />
                      <div>
                        <strong>{avisos[0].title}</strong>
                        <p>{avisos[0].mensagem}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="teacher-inline-empty">
                      <BsBell />
                      <p>Não há avisos pedagógicos ativos.</p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* LINHA 2: ORGANIZAÇÃO */}
            <section className="teacher-panel">
              <div className="teacher-panel-heading">
                <div>
                  <span className="teacher-section-kicker">Organização</span>
                  <h2>Horário letivo</h2>
                  <p>Aulas programadas.</p>
                </div>
                <BsClock className="teacher-heading-icon" />
              </div>
              {horarios.length ? (
                <div className="teacher-schedule-list">
                  {horarios.map((horario) => (
                    <article className="teacher-schedule-item" key={horario.id}>
                      <div className="teacher-schedule-time">
                        <strong>{horario.hora_inicio?.slice(0, 5)}</strong>
                        <span>{horario.hora_fim?.slice(0, 5)}</span>
                      </div>
                      <div className="teacher-schedule-info">
                        <strong>{horario.disciplina}</strong>
                        <span>{horario.dia_semana} · {horario.nome_turma}</span>
                        <span>{horario.sala || 'Sala não definida'}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="teacher-inline-empty">
                  <BsClock />
                  <p>Ainda não há horários associados.</p>
                </div>
              )}
            </section>

            {/* LINHA 2: ENSINO */}
            <section className="teacher-panel teacher-panel-teaching">
              <div className="teacher-panel-heading">
                <div>
                  <span className="teacher-section-kicker">Ensino</span>
                  <h2>Turmas</h2>
                  <p>{turmas.length} turmas atribuídas.</p>
                </div>
                <BsMortarboard className="teacher-heading-icon" />
              </div>
              {turmas.length > 0 ? (
                <div className="teacher-class-list-compact">
                  {turmas.slice(0, 2).map((turma) => (
                    <div className="teacher-class-row-mini" key={turma.id}>
                      <div>
                        <strong>{turma.nome}</strong>
                        <span>{turma.disciplinas} ({turma.alunos} alunos)</span>
                      </div>
                      <div className="teacher-mini-actions">
                        <Link href="/dashboard/professor/presencas">Presenças</Link>
                        <Link href="/dashboard/professor/notas">Notas</Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="teacher-inline-empty">
                  <BsMortarboard />
                  <p>Ainda não há turmas atribuídas.</p>
                </div>
              )}
            </section>

          </div>

        </main>
      )}
    </div>
  );
}