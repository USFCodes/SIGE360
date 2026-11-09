'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BsEye, BsPrinter } from 'react-icons/bs';
import { useTeacherPageHeader } from '@/components/teacher-dashboard-shell';
import '@/styles/adm-alunos.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_NOTAS = `${API_BASE}/api/v1/notas`;
const API_PROFESSORES = `${API_BASE}/api/v1/professores`;

async function lerRespostaApi(response) {
    const texto = await response.text();
    let data;
    try {
        data = texto ? JSON.parse(texto) : {};
    } catch {
        throw new Error(`A API de notas respondeu com conteúdo inválido (HTTP ${response.status}).`);
    }
    if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Falha no pedido à API de notas (HTTP ${response.status}).`);
    }
    return data;
}

export default function GestaoNotasUnificadaPage() {
    const router = useRouter();
    const [turmas, setTurmas] = useState([]);
    const [anosLetivos, setAnosLetivos] = useState([]);
    const [anoLetivoId, setAnoLetivoId] = useState('');
    const [turmaId, setTurmaId] = useState('');
    const turmasDisponiveis = turmas.filter((turma) => turma.ano_letivo_id === anoLetivoId);
    const [disciplinas, setDisciplinas] = useState([]);
    const [turmaDisciplinaId, setTurmaDisciplinaId] = useState('');
    const [trimestres, setTrimestres] = useState([]);
    const [trimestreId, setTrimestreId] = useState('');

    const [listaNotas, setListaNotas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const disciplinasPedidoAtual = useRef(0);
    const grelhaPedidoAtual = useRef(0);
    const trimestresPedidoAtual = useRef(0);

    const carregarTurmas = async () => {
        try {
            setErrorMsg('');
            const res = await fetch(`${API_PROFESSORES}/meu-painel/turmas`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            const todas = [...(data.turmasDiretor || []), ...(data.turmasLecionadas || [])];
            const unicas = Array.from(new Map(todas.map((turma) => [turma.turma_id, turma])).values());
            setTurmas(unicas);
        } catch (err) {
            console.error('Erro ao carregar turmas:', err);
            setTurmas([]);
            setTurmaId('');
            setErrorMsg(err.message || 'Não foi possível carregar as suas turmas.');
        }
    };

    const carregarAnosLetivos = async () => {
        try {
            const res = await fetch(`${API_NOTAS}/anos-letivos`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            const lista = Array.isArray(data.dados) ? data.dados : [];
            setAnosLetivos(lista);
            setAnoLetivoId((atual) => lista.some((ano) => ano.id === atual)
                ? atual
                : (lista.find((ano) => ano.ativo)?.id || lista[0]?.id || ''));
            if (lista.length === 0) setErrorMsg('Não há anos letivos associados à escola.');
        } catch (err) {
            console.error('Erro ao carregar anos letivos:', err);
            setAnosLetivos([]);
            setAnoLetivoId('');
            setErrorMsg(err.message || 'Não foi possível carregar os anos letivos.');
        }
    };

    const carregarDisciplinas = async (tId, pedidoId) => {
        try {
            setErrorMsg('');
            const res = await fetch(`${API_NOTAS}/turmas/${encodeURIComponent(tId)}/disciplinas`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            if (pedidoId !== disciplinasPedidoAtual.current) return;
            const lista = Array.isArray(data.dados) ? data.dados : [];
            setDisciplinas(lista);
            setTurmaDisciplinaId((atual) => lista.some((d) => d.turma_disciplina_id === atual) ? atual : (lista[0]?.turma_disciplina_id || ''));
        } catch (err) {
            if (pedidoId !== disciplinasPedidoAtual.current) return;
            console.error('Erro ao carregar disciplinas:', err);
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            setErrorMsg(err.message || 'Não foi possível carregar as disciplinas desta turma.');
        }
    };

    const carregarTrimestres = async (anoId, pedidoId) => {
        try {
            const params = new URLSearchParams({ ano_letivo_id: anoId });
            const res = await fetch(`${API_NOTAS}/trimestres?${params}`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            if (pedidoId !== trimestresPedidoAtual.current) return;
            const lista = Array.isArray(data.dados) ? data.dados : [];
            setTrimestres(lista);
            setTrimestreId(lista[0]?.id || '');
            if (lista.length === 0) setErrorMsg('Não há períodos disponíveis neste ano letivo.');
        } catch (err) {
            if (pedidoId !== trimestresPedidoAtual.current) return;
            console.error('Erro ao carregar trimestres:', err);
            setTrimestres([]);
            setTrimestreId('');
            setErrorMsg(err.message || 'Não foi possível carregar os períodos letivos.');
        }
    };

    const carregarGrelhaNotas = async (tId, tdId, trId, pedidoId) => {
        if (!tId || !tdId || !trId || pedidoId !== grelhaPedidoAtual.current) return;
        try {
            setLoading(true);
            setErrorMsg('');
            const params = new URLSearchParams({ turma_id: tId, turma_disciplina_id: tdId, trimestre_id: trId });
            const res = await fetch(`${API_NOTAS}/grelha?${params}`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            if (pedidoId !== grelhaPedidoAtual.current) return;
            
            let alunos = Array.isArray(data.dados) ? data.dados : [];

            // Ordenar alunos por Média Final (mf) decrescente para calcular a posição na turma
            alunos.sort((a, b) => (Number(b.mf) || 0) - (Number(a.mf) || 0));

            alunos = alunos.map((aluno, index) => ({
                ...aluno,
                posicao_turma: `${index + 1}ª`
            }));

            setListaNotas(alunos);
        } catch (err) {
            if (pedidoId !== grelhaPedidoAtual.current) return;
            console.error('Erro ao carregar grelha de notas:', err);
            setListaNotas([]);
            setErrorMsg(err.message || 'Não foi possível carregar as notas da turma.');
        } finally {
            if (pedidoId === grelhaPedidoAtual.current) setLoading(false);
        }
    };

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void Promise.all([carregarTurmas(), carregarAnosLetivos()]);
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        const disponiveis = anoLetivoId ? turmas.filter((turma) => turma.ano_letivo_id === anoLetivoId) : [];
        if (disponiveis.some((turma) => turma.turma_id === turmaId)) return;
        disciplinasPedidoAtual.current += 1;
        grelhaPedidoAtual.current += 1;
        setListaNotas([]);
        setDisciplinas([]);
        setTurmaDisciplinaId('');
        setTurmaId(disponiveis[0]?.turma_id || '');
    }, [anoLetivoId, turmas, turmaId]);

    useEffect(() => {
        const pedidoId = ++trimestresPedidoAtual.current;
        setTrimestres([]);
        setTrimestreId('');
        if (!anoLetivoId) return undefined;
        void carregarTrimestres(anoLetivoId, pedidoId);
        return () => {
            if (trimestresPedidoAtual.current === pedidoId) trimestresPedidoAtual.current += 1;
        };
    }, [anoLetivoId]);

    useEffect(() => {
        const pedidoId = ++disciplinasPedidoAtual.current;
        setDisciplinas([]);
        setTurmaDisciplinaId('');
        if (!turmaId) return undefined;
        const timer = window.setTimeout(() => {
            void carregarDisciplinas(turmaId, pedidoId);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            if (disciplinasPedidoAtual.current === pedidoId) disciplinasPedidoAtual.current += 1;
        };
    }, [turmaId]);

    useEffect(() => {
        const pedidoId = ++grelhaPedidoAtual.current;
        setListaNotas([]);
        if (!turmaId || !turmaDisciplinaId || !trimestreId) {
            setLoading(false);
            return undefined;
        }
        const timer = window.setTimeout(() => {
            void carregarGrelhaNotas(turmaId, turmaDisciplinaId, trimestreId, pedidoId);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            if (grelhaPedidoAtual.current === pedidoId) grelhaPedidoAtual.current += 1;
        };
    }, [turmaId, turmaDisciplinaId, trimestreId]);

    useTeacherPageHeader({
        title: 'CONSULTA DA PAUTA TRIMESTRAL',
        description: 'Consulte as notas e médias da turma organizadas por disciplina e período.',
        onRefresh: async () => {
            const pedidoId = ++grelhaPedidoAtual.current;
            disciplinasPedidoAtual.current += 1;
            trimestresPedidoAtual.current += 1;
            await Promise.all([carregarTurmas(), carregarAnosLetivos()]);
            if (turmaId && turmaDisciplinaId && trimestreId) {
                await carregarGrelhaNotas(turmaId, turmaDisciplinaId, trimestreId, pedidoId);
            }
        },
        actions: [{
            label: 'Imprimir pauta',
            icon: <BsPrinter />,
            onClick: () => window.print()
        }]
    });

    return (
        <div className="admin-page-layout">
            {errorMsg && <p role="alert" style={{ color: '#b91c1c', marginBottom: '16px', padding: '10px', background: '#fee2e2', borderRadius: '8px' }}>{errorMsg}</p>}

            {/* FILTROS GLOBAIS DE CONTEXTO */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px', background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '6px' }}>ANO LETIVO</label>
                    <select value={anoLetivoId} onChange={(e) => {
                        disciplinasPedidoAtual.current += 1;
                        grelhaPedidoAtual.current += 1;
                        setListaNotas([]);
                        setDisciplinas([]);
                        setTurmaDisciplinaId('');
                        setTurmaId('');
                        setTrimestres([]);
                        setTrimestreId('');
                        setAnoLetivoId(e.target.value);
                    }} style={{ width: '100%', height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        {anosLetivos.length ? anosLetivos.map((ano) => <option key={ano.id} value={ano.id}>{ano.ano_nome}</option>) : <option value="">Nenhum ano letivo</option>}
                    </select>
                </div>
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '6px' }}>TURMA</label>
                    <select value={turmaId} onChange={(e) => {
                        disciplinasPedidoAtual.current += 1;
                        grelhaPedidoAtual.current += 1;
                        setDisciplinas([]);
                        setTurmaDisciplinaId('');
                        setListaNotas([]);
                        setLoading(false);
                        setTurmaId(e.target.value);
                    }} style={{ width: '100%', height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        {turmasDisponiveis.length ? turmasDisponiveis.map(t => <option key={t.turma_id} value={t.turma_id}>{t.nome_turma} ({t.classe})</option>) : <option value="">Nenhuma turma neste ano letivo</option>}
                    </select>
                </div>
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '6px' }}>DISCIPLINA</label>
                    <select value={turmaDisciplinaId} onChange={(e) => {
                        grelhaPedidoAtual.current += 1;
                        setListaNotas([]);
                        setLoading(false);
                        setTurmaDisciplinaId(e.target.value);
                    }} style={{ width: '100%', height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        {disciplinas.length ? disciplinas.map(d => <option key={d.turma_disciplina_id} value={d.turma_disciplina_id}>{d.nome}</option>) : <option value="">{turmas.length ? 'Nenhuma disciplina associada a esta turma' : 'Nenhuma turma atribuída'}</option>}
                    </select>
                </div>
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '6px' }}>TRIMESTRE</label>
                    <select value={trimestreId} onChange={(e) => {
                        grelhaPedidoAtual.current += 1;
                        setListaNotas([]);
                        setLoading(false);
                        setTrimestreId(e.target.value);
                    }} style={{ width: '100%', height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        {trimestres.length ? trimestres.map(tr => <option key={tr.id} value={tr.id}>{tr.nome}</option>) : <option value="">Nenhum trimestre neste ano letivo</option>}
                    </select>
                </div>
            </section>

            {/* LISTA OFICIAL DE NOTAS */}
            <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '24px' }}>
                <div style={{ marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '14px' }}>
                    <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#0f172a' }}>Ficha de Avaliações</h2>
                </div>

                <div className="table-responsive-wrapper" style={{ overflowX: 'auto' }}>
                    {loading ? (
                        <p style={{ textAlign: 'center', padding: '30px' }}>A carregar lista de notas...</p>
                    ) : (
                        <table className="admin-data-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: '950px' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', fontSize: '12px' }}>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>ALUNO</th>
                                    <th style={{ padding: '10px', textAlign: 'center', width: '70px' }}>N1</th>
                                    <th style={{ padding: '10px', textAlign: 'center', width: '70px' }}>N2</th>
                                    <th style={{ padding: '10px', textAlign: 'center', width: '70px' }}>N3</th>
                                    <th style={{ padding: '10px', textAlign: 'center', width: '70px' }}>N4</th>
                                    <th style={{ padding: '10px', textAlign: 'center', width: '80px', background: '#f1f5f9' }}>MAC</th>
                                    <th style={{ padding: '10px', textAlign: 'center', width: '90px' }}>PFL</th>
                                    <th style={{ padding: '10px', textAlign: 'center', width: '80px', background: '#e2e8f0' }}>MF</th>
                                    <th style={{ padding: '10px', textAlign: 'center', width: '150px' }}>POSIÇÃO NA TURMA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {listaNotas.length > 0 ? (
                                    listaNotas.map((aluno) => (
                                        <tr key={aluno.matricula_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '12px 10px' }}>
                                                <strong>{aluno.nome} {aluno.apelido}</strong>
                                                <div style={{ fontSize: '11px', color: '#64748b' }}>{aluno.numero_matricula}</div>
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'center', fontWeight: '500' }}>{aluno.n1 ?? '-'}</td>
                                            <td style={{ padding: '10px', textAlign: 'center', fontWeight: '500' }}>{aluno.n2 ?? '-'}</td>
                                            <td style={{ padding: '10px', textAlign: 'center', fontWeight: '500' }}>{aluno.n3 ?? '-'}</td>
                                            <td style={{ padding: '10px', textAlign: 'center', fontWeight: '500' }}>{aluno.n4 ?? '-'}</td>
                                            <td style={{ padding: '10px', textAlign: 'center', background: '#f8fafc', fontWeight: 'bold', color: '#0284c7' }}>
                                                {aluno.mac ?? '-'}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'center', fontWeight: '500' }}>{aluno.prova_final ?? '-'}</td>
                                            <td style={{ padding: '10px', textAlign: 'center', background: '#edf2f7', fontWeight: 'bold', color: '#166534' }}>
                                                {aluno.mf ?? '-'}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'center', fontWeight: 'bold', color: '#b45309', background: '#fffbeb' }}>
                                                {aluno.posicao_turma}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan="10" style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>Nenhum registo de notas encontrado para esta disciplina e período.</td></tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}