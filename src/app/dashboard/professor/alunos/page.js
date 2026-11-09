'use strict';
'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import '@/styles/ficha-aluno.css';
import { BsArrowBarLeft, BsCheckCircle, BsExclamationCircle, BsPrinter } from 'react-icons/bs';
import { useTeacherPageHeader } from '@/components/teacher-dashboard-shell';

const API_BASE = 'http://localhost:5000';
const API_NOTAS = `${API_BASE}/api/v1/notas`;
const API_PROFESSORES = `${API_BASE}/api/v1/professores`;

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

export default function FichaAlunoPage() {
    return (
        <Suspense fallback={<div className="fa-loading-container">A carregar turmas...</div>}>
            <FichaAlunoConteudo />
        </Suspense>
    );
}

function FichaAlunoConteudo() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const alunoId = searchParams.get('aluno_id');
    const turmaId = searchParams.get('turma_id');
    const trimestreId = searchParams.get('trimestre_id');

    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState('');
    const [dadosFicha, setDadosFicha] = useState(null);
    const [turmas, setTurmas] = useState([]);
    const [turmaSelecionadaId, setTurmaSelecionadaId] = useState('');
    const [alunosTurma, setAlunosTurma] = useState([]);
    const [loadingTurmas, setLoadingTurmas] = useState(true);
    const [loadingAlunos, setLoadingAlunos] = useState(false);
    const [erroSelecao, setErroSelecao] = useState('');

    // O banco guarda observações na matrícula; as faltas são lidas dos registos de presença.
    const [observacoesProfessor, setObservacoesProfessor] = useState('');
    const [salvandoExtra, setSalvandoExtra] = useState(false);
    const [sucessoExtra, setSucessoExtra] = useState(false);

    useEffect(() => {
        if (!alunoId || !turmaId) return;
        let ativo = true;

        const carregarDadosFicha = async () => {
            try {
                setLoading(true);
                setErro('');
                const queryParams = new URLSearchParams({ turma_id: turmaId });
                if (trimestreId) queryParams.append('trimestre_id', trimestreId);

                const res = await fetch(`${API_NOTAS}/aluno/${encodeURIComponent(alunoId)}/ficha?${queryParams}`, {
                    credentials: 'include',
                    cache: 'no-store'
                });
                const data = await lerRespostaApi(res);
                if (ativo) {
                    setDadosFicha(data.dados);
                    setObservacoesProfessor(data.dados?.extras?.observacoes || '');
                }
            } catch (err) {
                console.error('Erro ao carregar ficha do aluno:', err);
                if (ativo) setErro(err.message || 'Não foi possível carregar a ficha académica.');
            } finally {
                if (ativo) setLoading(false);
            }
        };

        void carregarDadosFicha();
        return () => { ativo = false; };
    }, [alunoId, turmaId, trimestreId]);

    useEffect(() => {
        if (alunoId) return;
        let ativo = true;

        const carregarTurmas = async () => {
            try {
                setLoadingTurmas(true);
                setErroSelecao('');
                const res = await fetch(`${API_PROFESSORES}/meu-painel/turmas`, {
                    credentials: 'include', cache: 'no-store'
                });
                const data = await lerRespostaApi(res);
                const todas = [...(data.turmasDiretor || []), ...(data.turmasLecionadas || [])];
                const unicas = Array.from(new Map(todas.map((turma) => [turma.turma_id, turma])).values());
                if (!ativo) return;
                setTurmas(unicas);
                setTurmaSelecionadaId((atual) => unicas.some((turma) => turma.turma_id === atual)
                    ? atual
                    : (unicas.find((turma) => turma.turma_id === turmaId)?.turma_id || unicas[0]?.turma_id || ''));
            } catch (err) {
                if (ativo) {
                    setTurmas([]);
                    setErroSelecao(err.message || 'Não foi possível carregar as suas turmas.');
                }
            } finally {
                if (ativo) setLoadingTurmas(false);
            }
        };

        void carregarTurmas();
        return () => { ativo = false; };
    }, [alunoId, turmaId]);

    useEffect(() => {
        if (alunoId || !turmaSelecionadaId) return;
        let ativo = true;

        const carregarAlunos = async () => {
            try {
                setLoadingAlunos(true);
                setErroSelecao('');
                const res = await fetch(`${API_PROFESSORES}/turmas/${encodeURIComponent(turmaSelecionadaId)}/detalhes-alunos`, {
                    credentials: 'include', cache: 'no-store'
                });
                const data = await lerRespostaApi(res);
                if (ativo) setAlunosTurma(Array.isArray(data.dados) ? data.dados : []);
            } catch (err) {
                if (ativo) {
                    setAlunosTurma([]);
                    setErroSelecao(err.message || 'Não foi possível carregar os alunos desta turma.');
                }
            } finally {
                if (ativo) setLoadingAlunos(false);
            }
        };

        void carregarAlunos();
        return () => { ativo = false; };
    }, [alunoId, turmaSelecionadaId]);

    const handleSelecionarAluno = (aluno) => {
        const query = new URLSearchParams({ aluno_id: aluno.aluno_id, turma_id: turmaSelecionadaId });
        if (trimestreId) query.set('trimestre_id', trimestreId);
        router.push(`/dashboard/professor/alunos?${query}`);
    };

    const handleEscolherOutroAluno = () => router.push('/dashboard/professor/alunos');

    const handleSalvarExtras = async (e) => {
        e.preventDefault();
        try {
            setSalvandoExtra(true);
            setSucessoExtra(false);
            const res = await fetch(`${API_NOTAS}/aluno/${encodeURIComponent(alunoId)}/extras`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turma_id: turmaId,
                    observacoes: observacoesProfessor
                })
            });
            await lerRespostaApi(res);
            setDadosFicha((atual) => atual ? {
                ...atual,
                extras: { ...atual.extras, observacoes: observacoesProfessor }
            } : atual);
            setSucessoExtra(true);
            setTimeout(() => setSucessoExtra(false), 3000);
        } catch (err) {
            alert(err.message || 'Erro ao gravar informações complementares.');
        } finally {
            setSalvandoExtra(false);
        }
    };

    const imprimirCaderneta = () => {
        const classeImpressao = 'fa-print-caderneta';
        const limparModoImpressao = () => {
            document.body.classList.remove(classeImpressao);
            window.removeEventListener('afterprint', limparModoImpressao);
        };

        document.body.classList.add(classeImpressao);
        window.addEventListener('afterprint', limparModoImpressao);
        window.print();
    };

    useTeacherPageHeader({
        title: alunoId ? 'FICHA ACADÉMICA DO ALUNO' : 'TURMAS E ALUNOS',
        description: alunoId
            ? 'Consulte o percurso académico, a assiduidade e as informações complementares do aluno.'
            : 'Consulte as turmas atribuídas e selecione um aluno para abrir a sua ficha académica.',
        actions: alunoId ? [{
            label: 'Imprimir caderneta',
            icon: <BsPrinter />,
            disabled: loading || !dadosFicha,
            onClick: imprimirCaderneta
        }] : []
    });

    if (!alunoId) {
        return (
            <main className="fa-page-wrapper fa-selection-page">
                {erroSelecao && <p role="alert" className="fa-selection-error"><BsExclamationCircle /> {erroSelecao}</p>}
                <section className="fa-selection-card" aria-label="Selecionar turma e aluno">
                    <div className="fa-selection-heading">
                        <div>
                            <span className="fa-selection-eyebrow">CONSULTA ACADÉMICA</span>
                            <h2>Selecione uma turma e um aluno</h2>
                            <p>Abra a ficha académica para consultar notas, assiduidade e dados complementares.</p>
                        </div>
                        {!loadingTurmas && turmas.length > 0 && (
                            <span className="fa-selection-count">{alunosTurma.length} aluno(s)</span>
                        )}
                    </div>

                    {loadingTurmas ? (
                        <div className="fa-selection-state" role="status">A carregar as suas turmas…</div>
                    ) : turmas.length === 0 ? (
                        <div className="fa-selection-state">
                            <BsExclamationCircle aria-hidden="true" />
                            <p>Não há turmas associadas ao seu perfil.</p>
                        </div>
                    ) : (
                        <>
                            <div className="fa-selection-field">
                                <label htmlFor="turma-ficha">Turma</label>
                                <select
                                    id="turma-ficha"
                                    className="fa-selection-select"
                                    value={turmaSelecionadaId}
                                    onChange={(event) => {
                                        setTurmaSelecionadaId(event.target.value);
                                        setAlunosTurma([]);
                                    }}
                                >
                                    {turmas.map((turma) => (
                                        <option key={turma.turma_id} value={turma.turma_id}>
                                            {turma.nome_turma} {turma.classe ? `· ${turma.classe}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="fa-selection-list-heading">
                                <h3>Alunos da turma</h3>
                                {!loadingAlunos && <span>{alunosTurma.length} encontrados</span>}
                            </div>

                            {loadingAlunos ? (
                                <div className="fa-selection-state" role="status">A carregar alunos…</div>
                            ) : alunosTurma.length === 0 ? (
                                <div className="fa-selection-state">
                                    <p>Não há alunos ativos nesta turma.</p>
                                </div>
                            ) : (
                                <div className="fa-student-card-grid">
                                    {alunosTurma.map((aluno) => {
                                        const nomeCompleto = `${aluno.nome || ''} ${aluno.apelido || ''}`.trim() || 'Aluno sem nome';
                                        return (
                                            <article className="fa-student-selection-card" key={aluno.aluno_id}>
                                                <span className="fa-student-selection-avatar" aria-hidden="true">
                                                    {nomeCompleto.slice(0, 2).toLocaleUpperCase()}
                                                </span>
                                                <div className="fa-student-selection-info">
                                                    <strong>{nomeCompleto}</strong>
                                                    <span>Nº de matrícula</span>
                                                    <code>{aluno.numero_matricula || '—'}</code>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="fa-student-selection-action"
                                                    onClick={() => handleSelecionarAluno(aluno)}
                                                >
                                                    Abrir ficha
                                                </button>
                                            </article>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </section>
            </main>
        );
    }

    if (!turmaId) {
        return (
            <div className="fa-error-container">
                <BsExclamationCircle size={32} color="#b91c1c" />
                <p>Selecione uma turma válida para abrir a ficha deste aluno.</p>
                <button onClick={handleEscolherOutroAluno} className="fa-btn-voltar"><BsArrowBarLeft /> Voltar às Turmas</button>
            </div>
        );
    }

    if (loading) {
        return <div className="fa-loading-container">A carregar ficha académica oficial...</div>;
    }

    if (erro) {
        return (
            <div className="fa-error-container">
                <BsExclamationCircle size={32} color="#b91c1c" />
                <p>{erro}</p>
                <button onClick={handleEscolherOutroAluno} className="fa-btn-voltar"><BsArrowBarLeft /> Voltar às Turmas</button>
            </div>
        );
    }

    const escola = dadosFicha?.escola || {};
    const aluno = dadosFicha?.aluno || {};
    const turma = dadosFicha?.turma || {};
    const disciplinas = dadosFicha?.disciplinas || [];
    const extras = dadosFicha?.extras || {};
    const corPrimaria = escola.cor_primaria || '#0284c7';

    return (
        <div className="fa-page-wrapper">
            {/* Barra de Ações (Não sai na impressão) */}
            <div className="fa-actions-bar no-print">
                <button onClick={handleEscolherOutroAluno} className="fa-btn-voltar">
                    <BsArrowBarLeft /> Voltar às Turmas
                </button>
                <button onClick={imprimirCaderneta} className="fa-btn-imprimir" style={{ background: corPrimaria }}>
                    <BsPrinter /> Imprimir Caderneta Oficial
                </button>
            </div>

            {/* DOCUMENTO / CADEIRTE DE NOTAS (LETTERHEAD) */}
            <div className="fa-letterhead-sheet" style={{ '--escola-cor': corPrimaria }}>
                
                {/* CABEÇALHO INSTITUCIONAL */}
                <header className="fa-header">
                    <div className="fa-header-logo-side">
                        {escola.logo_url ? (
                            <img src={escola.logo_url} alt="Logo Escola" className="fa-escola-logo" />
                        ) : (
                            <div className="fa-escola-logo-placeholder" style={{ background: corPrimaria }}>
                                {escola.sigla || 'ESC'}
                            </div>
                        )}
                    </div>
                    <div className="fa-header-info-side">
                        <h1 className="fa-escola-nome">{escola.nome || 'Sistema de Gestão Escolar'}</h1>
                        <p className="fa-escola-motto">{escola.motto || 'República da Guiné-Bissau · Ministério da Educação Nacional'}</p>
                        <p className="fa-escola-detalhes">{escola.endereco || 'Bissau'} {escola.telefone ? `· Tel: ${escola.telefone}` : ''}</p>
                    </div>
                    <div className="fa-header-badge-side">
                        <div className="fa-doc-titulo-badge">FICHA ACADÉMICA</div>
                        <div className="fa-doc-data">{new Date().toLocaleDateString('pt-PT')}</div>
                    </div>
                </header>

                <div className="fa-divider-primary" style={{ background: corPrimaria }}></div>

                {/* IDENTIFICAÇÃO DO ALUNO E TURMA */}
                <section className="fa-section-identificacao">
                    <div className="fa-info-box">
                        <span className="fa-label">ESTUDANTE</span>
                        <strong className="fa-value-destaque">{aluno.nome} {aluno.apelido}</strong>
                        <span className="fa-subtext">Nº de Matrícula: <code>{aluno.numero_matricula || 'N/D'}</code></span>
                    </div>
                    <div className="fa-info-box">
                        <span className="fa-label">TURMA & CLASSE</span>
                        <strong className="fa-value">{turma.nome}</strong>
                        <span className="fa-subtext">Classe: {turma.classe} · Turno: {turma.turno || 'Normal'}</span>
                    </div>
                    <div className="fa-info-box">
                        <span className="fa-label">DIREÇÃO DE TURMA</span>
                        <strong className="fa-value">{turma.diretor_turma || 'Não atribuído'}</strong>
                        <span className="fa-subtext">Ano Letivo: {turma.ano_nome || 'Corrente'}</span>
                    </div>
                </section>

                {/* TABELA DE DISCIPLINAS E AVALIAÇÕES */}
                <section className="fa-section-tabela">
                    <h3 className="fa-section-title">DESEMPENHO CURRICULAR POR DISCIPLINA</h3>
                    <table className="fa-tabela-notas">
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left' }}>Disciplina</th>
                                <th>Período</th>
                                <th>N1</th>
                                <th>N2</th>
                                <th>N3</th>
                                <th>N4</th>
                                <th className="fa-col-destaque">MAC</th>
                                <th>Prova Final</th>
                                <th className="fa-col-destaque">Média Final (MF)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {disciplinas.length > 0 ? (
                                disciplinas.map((disc, idx) => (
                                    <tr key={idx}>
                                        <td className="fa-td-disciplina"><strong>{disc.nome}</strong></td>
                                        <td>{disc.ano_nome ? `${disc.ano_nome} · ` : ''}{disc.trimestre_nome || `Trimestre ${disc.trimestre_numero || ''}`}</td>
                                        <td>{disc.n1 ?? '-'}</td>
                                        <td>{disc.n2 ?? '-'}</td>
                                        <td>{disc.n3 ?? '-'}</td>
                                        <td>{disc.n4 ?? '-'}</td>
                                        <td className="fa-td-mac">{disc.mac ?? '-'}</td>
                                        <td>{disc.prova_final ?? '-'}</td>
                                        <td className="fa-td-mf"><strong>{disc.mf ?? '-'}</strong></td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="9" style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                                        Nenhum registo de notas encontrado para este período.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </section>

                {/* BLOCO INFERIOR: PRESENÇAS E OBSERVAÇÕES */}
                <section className="fa-section-inferior">
                    <div className="fa-coluna-estatisticas">
                        <h4 className="fa-sub-title">REGISTO DE ASSIDUIDADE</h4>
                        <div className="fa-stats-grid">
                            <div className="fa-stat-card">
                                <span className="fa-stat-label">Faltas Justificadas</span>
                                <span className="fa-stat-val">{extras.faltas_justificadas ?? 0}</span>
                            </div>
                            <div className="fa-stat-card">
                                <span className="fa-stat-label">Faltas Injustificadas</span>
                                <span className="fa-stat-val" style={{ color: '#b91c1c' }}>{extras.faltas_injustificadas ?? 0}</span>
                            </div>
                        </div>

                        {/* As observações são guardadas na matrícula ativa do aluno. */}
                        <form onSubmit={handleSalvarExtras} className="no-print fa-form-extras">
                            <div>
                                <label>Observações / Parecer do Diretor de Turma</label>
                                <textarea rows="3" value={observacoesProfessor} onChange={e => setObservacoesProfessor(e.target.value)} placeholder="Escreva aqui o parecer pedagógico..."></textarea>
                            </div>
                            <div className="fa-form-actions">
                                <button type="submit" disabled={salvandoExtra} className="fa-btn-salvar" style={{ background: corPrimaria }}>
                                    {salvandoExtra ? 'A guardar...' : 'Guardar observações'}
                                </button>
                                {sucessoExtra && <span className="fa-success-tag"><BsCheckCircle /> Guardado!</span>}
                            </div>
                        </form>
                    </div>

                    <div className="fa-coluna-parecer">
                        <h4 className="fa-sub-title">PARECER PEDAGÓGICO / OBSERVAÇÕES</h4>
                        <div className="fa-parecer-box">
                            <p>{observacoesProfessor || 'Nenhuma observação registada para este aluno no presente período letivo.'}</p>
                        </div>

                        {/* ASSINATURAS OFICIAIS */}
                        <div className="fa-assinaturas-area">
                            <div className="fa-assinatura-linha">
                                <div className="fa-linha-risco"></div>
                                <span>O(A) Diretor(a) de Turma</span>
                            </div>
                            <div className="fa-assinatura-linha">
                                <div className="fa-linha-risco"></div>
                                <span>A Direção Pedagógica</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* RODAPÉ DO DOCUMENTO IMPRESSO */}
                <footer className="fa-footer-print">
                    <p>Documento oficial gerado eletronicamente pelo Sistema de Gestão Escolar · Guiné-Bissau</p>
                </footer>
            </div>
        </div>
    );
}