'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BsJournalCheck, BsFileExcel, BsSave, BsDownload, BsUpload } from 'react-icons/bs';
import { useTeacherPageHeader } from '@/components/teacher-dashboard-shell';
import '@/styles/adm-alunos.css';
import '@/styles/direcao-inline-notas.css';

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
    const [subAba, setSubAba] = useState('ecra'); // 'ecra' ou 'excel'
    const [turmas, setTurmas] = useState([]);
    const [anosLetivos, setAnosLetivos] = useState([]);
    const [anoLetivoId, setAnoLetivoId] = useState('');
    const [turmaId, setTurmaId] = useState('');
    const turmasDisponiveis = turmas.filter((turma) => turma.ano_letivo_id === anoLetivoId);
    const [disciplinas, setDisciplinas] = useState([]);
    const [turmaDisciplinaId, setTurmaDisciplinaId] = useState('');
    const [trimestres, setTrimestres] = useState([]);
    const [trimestreId, setTrimestreId] = useState('');

    // Estados para Ecrã (Grelha)
    const [listaNotas, setListaNotas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Estados para Excel
    const [ficheiro, setFicheiro] = useState(null);
    const [loadingUpload, setLoadingUpload] = useState(false);
    const [loadingModelo, setLoadingModelo] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
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

    const carregarDisciplinas = async (tId, pedidoId = ++disciplinasPedidoAtual.current) => {
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

    const carregarGrelhaNotas = async (tId, tdId, trId, pedidoId = ++grelhaPedidoAtual.current) => {
        if (!tId || !tdId || !trId || pedidoId !== grelhaPedidoAtual.current) return;
        try {
            setLoading(true);
            setErrorMsg('');
            const params = new URLSearchParams({ turma_id: tId, turma_disciplina_id: tdId, trimestre_id: trId });
            const res = await fetch(`${API_NOTAS}/grelha?${params}`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            if (pedidoId !== grelhaPedidoAtual.current) return;
            setListaNotas(Array.isArray(data.dados) ? data.dados : []);
        } catch (err) {
            if (pedidoId !== grelhaPedidoAtual.current) return;
            console.error('Erro ao carregar grelha de notas:', err);
            setListaNotas([]);
            setErrorMsg(err.message || 'Não foi possível carregar as notas da turma.');
        } finally {
            if (pedidoId === grelhaPedidoAtual.current) setLoading(false);
        }
    };

    const handleAlterarNota = (matriculaId, campo, valor) => {
        setListaNotas(prev => prev.map(aluno => {
            if (aluno.matricula_id !== matriculaId) return aluno;
            const updated = { ...aluno, [campo]: valor };
            
            // Recálculo local visual dinâmico antes de salvar
            const n1 = parseFloat(updated.n1) || 0;
            const n2 = parseFloat(updated.n2) || 0;
            const n3 = parseFloat(updated.n3) || 0;
            const n4 = parseFloat(updated.n4) || 0;
            const pf = parseFloat(updated.prova_final) || 0;

            const preenc = [updated.n1, updated.n2, updated.n3, updated.n4].filter(v => v !== '' && v !== null && !isNaN(v));
            if (preenc.length > 0) {
                const soma = preenc.reduce((acc, curr) => acc + Number(curr), 0);
                updated.mac = Number((soma / preenc.length).toFixed(2));
            } else {
                updated.mac = '';
            }

            if (updated.mac !== '' && updated.prova_final !== '' && updated.prova_final !== null && !isNaN(updated.prova_final)) {
                updated.mf = Number(((updated.mac + pf) / 2).toFixed(2));
            } else if (updated.mac !== '') {
                updated.mf = updated.mac;
            } else {
                updated.mf = '';
            }

            return updated;
        }));
    };

    const handleSalvarEcra = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            setErrorMsg('');
            setSuccessMsg('');
            const payload = {
                turma_id: turmaId,
                turma_disciplina_id: turmaDisciplinaId,
                trimestre_id: trimestreId,
                notas: listaNotas.map(a => ({
                    matricula_id: a.matricula_id,
                    n1: a.n1 !== '' ? Number(a.n1) : null,
                    n2: a.n2 !== '' ? Number(a.n2) : null,
                    n3: a.n3 !== '' ? Number(a.n3) : null,
                    n4: a.n4 !== '' ? Number(a.n4) : null,
                    prova_final: a.prova_final !== '' ? Number(a.prova_final) : null
                }))
            };

            const res = await fetch(`${API_NOTAS}/salvar-grelha`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await lerRespostaApi(res);
            setSuccessMsg(data.message || 'Notas e médias gravadas com sucesso!');
            setTimeout(() => setSuccessMsg(''), 4000);
            await carregarGrelhaNotas(turmaId, turmaDisciplinaId, trimestreId);
        } catch (err) {
            setErrorMsg(err.message || 'Erro ao comunicar com o servidor.');
        } finally {
            setSaving(false);
        }
    };

    const handleBaixarModelo = async () => {
        if (!turmaId || !turmaDisciplinaId || !trimestreId) {
            setErrorMsg('Selecione a turma, a disciplina e o trimestre antes de baixar o modelo.');
            return;
        }
        try {
            setLoadingModelo(true);
            setErrorMsg('');
            const params = new URLSearchParams({ turma_id: turmaId, turma_disciplina_id: turmaDisciplinaId, trimestre_id: trimestreId });
            const response = await fetch(`${API_NOTAS}/exportar-modelo?${params}`, { credentials: 'include', cache: 'no-store' });
            if (!response.ok) await lerRespostaApi(response);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `pauta_notas_turma_${turmaId}.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            setErrorMsg(err.message || 'Não foi possível descarregar o modelo Excel.');
        } finally {
            setLoadingModelo(false);
        }
    };

    const handleUploadExcel = async (e) => {
        e.preventDefault();
        if (!ficheiro || !turmaId || !turmaDisciplinaId || !trimestreId) {
            setErrorMsg('Selecione o ficheiro e todos os filtros obrigatórios.');
            return;
        }
        try {
            setLoadingUpload(true);
            setErrorMsg('');
            setSuccessMsg('');
            const formData = new FormData();
            formData.append('ficheiro', ficheiro);
            formData.append('turma_id', turmaId);
            formData.append('turma_disciplina_id', turmaDisciplinaId);
            formData.append('trimestre_id', trimestreId);

            const res = await fetch(`${API_NOTAS}/importar-excel`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            const data = await lerRespostaApi(res);
            setSuccessMsg(data.message || 'Importação Excel concluída com sucesso!');
            setFicheiro(null);
            setSubAba('ecra');
        } catch (err) {
            setErrorMsg(err.message || 'Erro ao processar ficheiro Excel.');
        } finally {
            setLoadingUpload(false);
        }
    };

    useTeacherPageHeader({
        title: 'GESTÃO DE NOTAS TRIMESTRAIS',
        description: 'Registe e consulte as avaliações dos alunos por disciplina e período.',
        onRefresh: async () => {
            const pedidoId = ++grelhaPedidoAtual.current;
            const tarefas = [carregarTurmas(), carregarAnosLetivos()];
            if (turmaId && turmaDisciplinaId && trimestreId && subAba === 'ecra') {
                tarefas.push(carregarGrelhaNotas(turmaId, turmaDisciplinaId, trimestreId, pedidoId));
            }
            await Promise.all(tarefas);
        },
        actions: [
            {
                label: 'Guardar notas',
                icon: <BsSave />,
                disabled: saving || !listaNotas.length || subAba !== 'ecra',
                onClick: () => handleSalvarEcra({ preventDefault() {} })
            },
            {
                label: subAba === 'excel' ? 'Voltar à pauta' : 'Importar / exportar',
                icon: <BsFileExcel />,
                variant: 'secondary',
                onClick: () => setSubAba((current) => current === 'excel' ? 'ecra' : 'excel')
            }
        ]
    });

    useEffect(() => {
        void Promise.all([carregarTurmas(), carregarAnosLetivos()]);
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
        if (!turmaId) {
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            return undefined;
        }
        void carregarDisciplinas(turmaId, pedidoId);
        return () => {
            if (disciplinasPedidoAtual.current === pedidoId) disciplinasPedidoAtual.current += 1;
        };
    }, [turmaId]);

    useEffect(() => {
        const pedidoId = ++grelhaPedidoAtual.current;
        if (!turmaId || !turmaDisciplinaId || !trimestreId || subAba !== 'ecra') {
            setListaNotas([]);
            setLoading(false);
            return undefined;
        }
        void carregarGrelhaNotas(turmaId, turmaDisciplinaId, trimestreId, pedidoId);
        return () => {
            if (grelhaPedidoAtual.current === pedidoId) grelhaPedidoAtual.current += 1;
        };
    }, [turmaId, turmaDisciplinaId, trimestreId, subAba]);

    return (
        <div className="admin-page-layout">
            {errorMsg && <p role="alert" style={{ color: '#b91c1c', marginBottom: '16px', padding: '10px', background: '#fee2e2', borderRadius: '8px' }}>{errorMsg}</p>}
            {successMsg && <p style={{ color: '#166534', marginBottom: '16px', padding: '10px', background: '#dcfce7', borderRadius: '8px', fontWeight: 'bold' }}>{successMsg}</p>}

            {/* FILTROS GLOBAIS DE CONTEXTO */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px', background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '6px' }}>ANO LETIVO</label>
                    <select value={anoLetivoId} onChange={(e) => {
                        grelhaPedidoAtual.current += 1;
                        disciplinasPedidoAtual.current += 1;
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
                        grelhaPedidoAtual.current += 1;
                        disciplinasPedidoAtual.current += 1;
                        setListaNotas([]);
                        setDisciplinas([]);
                        setTurmaDisciplinaId('');
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
                        setTrimestreId(e.target.value);
                    }} style={{ width: '100%', height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        {trimestres.length ? trimestres.map(tr => <option key={tr.id} value={tr.id}>{tr.nome}</option>) : <option value="">Nenhum trimestre neste ano letivo</option>}
                    </select>
                </div>
            </section>

            {/* ABAS INTERNAS */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px' }}>
                <button onClick={() => setSubAba('ecra')} style={{ padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', background: subAba === 'ecra' ? '#0284c7' : '#fff', color: subAba === 'ecra' ? '#fff' : '#475569', border: '1px solid #cbd5e1', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <BsJournalCheck /> Lançamento no Ecrã
                </button>
                <button onClick={() => setSubAba('excel')} style={{ padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', background: subAba === 'excel' ? '#0284c7' : '#fff', color: subAba === 'excel' ? '#fff' : '#475569', border: '1px solid #cbd5e1', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <BsFileExcel /> Importar / Exportar Excel
                </button>
            </div>

            {/* ABA ECRÃ */}
            {subAba === 'ecra' && (
                <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '14px' }}>
                        <h2>Lançamento de Notas</h2>
                        <button onClick={handleSalvarEcra} disabled={saving || !listaNotas.length} className="admin-btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <BsSave /> {saving ? 'A gravar...' : 'Salvar Alterações'}
                        </button>
                    </div>

                    <div className="table-responsive-wrapper" style={{ overflowX: 'auto' }}>
                        {loading ? (
                            <p style={{ textAlign: 'center', padding: '30px' }}>A carregar pauta...</p>
                        ) : (
                            <table className="admin-data-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1050px' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', fontSize: '12px' }}>
                                        <th style={{ padding: '10px', textAlign: 'left' }}>ALUNO</th>
                                        <th style={{ padding: '10px', textAlign: 'center', width: '70px' }}>N1</th>
                                        <th style={{ padding: '10px', textAlign: 'center', width: '70px' }}>N2</th>
                                        <th style={{ padding: '10px', textAlign: 'center', width: '70px' }}>N3</th>
                                        <th style={{ padding: '10px', textAlign: 'center', width: '70px' }}>N4</th>
                                        <th style={{ padding: '10px', textAlign: 'center', width: '80px', background: '#f1f5f9' }}>MAC</th>
                                        <th style={{ padding: '10px', textAlign: 'center', width: '90px' }}>PROVA FINAL</th>
                                        <th style={{ padding: '10px', textAlign: 'center', width: '80px', background: '#e2e8f0' }}>MF</th>
                                        <th style={{ padding: '10px', textAlign: 'left', minWidth: '220px' }}>ESTADO DA DIREÇÃO / COMENTÁRIO</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {listaNotas.length > 0 ? (
                                        listaNotas.map((aluno) => (
                                            <tr key={aluno.matricula_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '10px' }}>
                                                    <strong>{aluno.nome} {aluno.apelido}</strong>
                                                    <div style={{ fontSize: '11px', color: '#64748b' }}>{aluno.numero_matricula}</div>
                                                </td>
                                                {['n1', 'n2', 'n3', 'n4'].map((campo) => (
                                                    <td key={campo} style={{ padding: '8px', textAlign: 'center' }}>
                                                        <input 
                                                            type="number" step="0.1" min="0" max="20" 
                                                            value={aluno[campo] ?? ''} 
                                                            onChange={(e) => handleAlterarNota(aluno.matricula_id, campo, e.target.value)} 
                                                            style={{ width: '60px', height: '36px', textAlign: 'center', fontWeight: 'bold', borderRadius: '6px', border: '1px solid #cbd5e1' }} 
                                                        />
                                                    </td>
                                                ))}
                                                <td style={{ padding: '8px', textAlign: 'center', background: '#f8fafc', fontWeight: 'bold', color: '#0284c7' }}>
                                                    {aluno.mac ?? '-'}
                                                </td>
                                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                                    <input 
                                                        type="number" step="0.1" min="0" max="20" 
                                                        value={aluno.prova_final ?? ''} 
                                                        onChange={(e) => handleAlterarNota(aluno.matricula_id, 'prova_final', e.target.value)} 
                                                        style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 'bold', borderRadius: '6px', border: '1px solid #cbd5e1' }} 
                                                    />
                                                </td>
                                                <td style={{ padding: '8px', textAlign: 'center', background: '#edf2f7', fontWeight: 'bold', color: '#166534' }}>
                                                    {aluno.mf ?? '-'}
                                                </td>
                                                <td style={{ padding: '8px' }}>
                                                    {aluno.nota_id ? (
                                                        <>
                                                            <span className={`status-tag ${aluno.estado_aprovacao_direcao || 'pendente'}`}>
                                                                {aluno.estado_aprovacao_direcao === 'aprovado'
                                                                    ? 'Aprovada'
                                                                    : aluno.estado_aprovacao_direcao === 'rejeitado'
                                                                        ? 'Devolvida ao professor'
                                                                        : 'Em análise'}
                                                            </span>
                                                            {aluno.comentario_direcao && <div className="user-subtext direcao-comentario">{aluno.comentario_direcao}</div>}
                                                        </>
                                                    ) : <span className="status-tag sem-submissao">Ainda não submetida</span>}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr><td colSpan="9" style={{ textAlign: 'center', padding: '30px' }}>Nenhum aluno encontrado para esta disciplina.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* ABA EXCEL */}
            {subAba === 'excel' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
                    <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <BsDownload color="#0284c7" /> 1. Descarregar pauta oficial
                        </h3>
                        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
                            Pauta simples com turma, disciplina, ano letivo, alunos e avaliações. Preencha N1–N4 e PF; MAC e MF são calculadas automaticamente.
                        </p>
                        <button onClick={handleBaixarModelo} disabled={loadingModelo || !turmaDisciplinaId} className="admin-btn btn-outline" style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
                            {loadingModelo ? 'A preparar ficheiro…' : 'Descarregar Excel simples'}
                        </button>
                    </div>

                    <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <BsUpload color="#166534" /> 2. Importar pauta preenchida
                        </h3>
                        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '6px' }}>
                            Ao importar, as médias são novamente calculadas e guardadas pelo sistema.
                        </p>
                        <form onSubmit={handleUploadExcel} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '6px' }}>SELECIONAR FICHEIRO .XLSX</label>
                                <input type="file" accept=".xlsx, .xls" onChange={(e) => setFicheiro(e.target.files[0])} required style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc' }} />
                            </div>
                            <button type="submit" disabled={loadingUpload} className="admin-btn btn-primary" style={{ justifyContent: 'center', padding: '12px' }}>
                                {loadingUpload ? 'A processar...' : 'Importar Notas do Excel'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}