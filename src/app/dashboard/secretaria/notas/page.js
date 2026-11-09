'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BsBuilding, BsFilePdf, BsSearch } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import '@/styles/s3.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_AUTH = `${API_BASE}/api/v1/auth`;
const API_ESCOLAS = `${API_BASE}/api/v1/escolas`;
const API_PROFESSORES = `${API_BASE}/api/v1/professores`;
const API_NOTAS = `${API_BASE}/api/v1/notas`;

async function lerRespostaApi(response) {
    const texto = await response.text();
    let data;
    try {
        data = texto ? JSON.parse(texto) : {};
    } catch {
        throw new Error(`A API respondeu com conteúdo inválido (HTTP ${response.status}).`);
    }
    if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Falha no pedido à API (HTTP ${response.status}).`);
    }
    return data;
}

export default function SecretariaBroadsheetPage() {
    const [escolaId, setEscolaId] = useState('');
    const [escola, setEscola] = useState(null);
    const [anosLetivos, setAnosLetivos] = useState([]);
    const [anoLetivoId, setAnoLetivoId] = useState('');
    const [polos, setPolos] = useState([]);
    const [poloId, setPoloId] = useState('');
    const [trimestres, setTrimestres] = useState([]);
    const [trimestreId, setTrimestreId] = useState('');
    
    const [turmas, setTurmas] = useState([]);
    const [turmaId, setTurmaId] = useState('');
    
    const [disciplinas, setDisciplinas] = useState([]);
    const [turmaDisciplinaId, setTurmaDisciplinaId] = useState('');
    const [dadosTurma, setDadosTurma] = useState(null);
    const [dataEmissao, setDataEmissao] = useState('');

    const [termoPesquisa, setTermoPesquisa] = useState('');
    const [filtroDesempenho, setFiltroDesempenho] = useState('todos');

    // Dados da Pauta
    const [pautaAlunos, setPautaAlunos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const filtroPedidoAtual = useRef(0);
    const pautaPedidoAtual = useRef(0);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDataEmissao(new Date().toLocaleDateString('pt-PT'));
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    const carregarTrimestres = async (anoId, pedido) => {
        if (!anoId) {
            setTrimestres([]);
            setTrimestreId('');
            return;
        }
        try {
            const params = new URLSearchParams({ ano_letivo_id: anoId });
            const res = await fetch(`${API_NOTAS}/trimestres?${params}`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            if (pedido !== filtroPedidoAtual.current) return;
            const lista = Array.isArray(data.dados) ? data.dados : [];
            setTrimestres(lista);
            setTrimestreId(lista[0]?.id || '');
        } catch (err) {
            console.error('Erro ao carregar trimestres:', err);
            if (pedido !== filtroPedidoAtual.current) return;
            setTrimestres([]);
            setTrimestreId('');
            setErrorMsg(err.message || 'Não foi possível carregar os períodos letivos.');
        }
    };

    const carregarTurmasEscola = async (idEscola, anoId, ramoId, pedido) => {
        if (!idEscola || !anoId) {
            setTurmas([]);
            setTurmaId('');
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            setDadosTurma(null);
            setPautaAlunos([]);
            return;
        }
        try {
            const params = new URLSearchParams({ ano_letivo_id: anoId });
            if (ramoId) params.set('polo_id', ramoId);
            const res = await fetch(`${API_ESCOLAS}/${encodeURIComponent(idEscola)}/turmas?${params}`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            if (pedido !== filtroPedidoAtual.current) return;
            const lista = Array.isArray(data.data) ? data.data : [];
            setTurmas(lista);
            setTurmaId(lista[0]?.id || '');
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            setPautaAlunos([]);
        } catch (err) {
            console.error('Erro ao carregar turmas:', err);
            if (pedido !== filtroPedidoAtual.current) return;
            setTurmas([]);
            setTurmaId('');
            setErrorMsg(err.message || 'Não foi possível carregar as turmas da escola.');
        }
    };

    const carregarDisciplinasTurma = async (tId) => {
        if (!tId) {
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            setDadosTurma(null);
            return;
        }
        try {
            const res = await fetch(`${API_ESCOLAS}/turmas/${encodeURIComponent(tId)}/completa`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            const lista = Array.isArray(data.data?.disciplinas) ? data.data.disciplinas.map((disciplina) => ({
                turma_disciplina_id: disciplina.id,
                nome: disciplina.disciplina_nome,
                professor_nome: disciplina.professor_nome || ''
            })) : [];
            setDadosTurma({
                ...data.data?.turma,
                diretor_turma: data.data?.diretor_turma || null
            });
            setDisciplinas(lista);
            setTurmaDisciplinaId((atual) => lista.some((disciplina) => disciplina.turma_disciplina_id === atual)
                ? atual
                : (lista[0]?.turma_disciplina_id || ''));
        } catch (err) {
            console.error('Erro ao carregar disciplinas:', err);
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            setDadosTurma(null);
            setErrorMsg(err.message || 'Não foi possível carregar as disciplinas e o professor da turma.');
        }
    };

    const carregarPautaGeral = async (tId, tdId, trId) => {
        if (!tId || !tdId || !trId) return;
        const pedido = ++pautaPedidoAtual.current;
        try {
            setLoading(true);
            setErrorMsg('');
            const params = new URLSearchParams({ turma_id: tId, turma_disciplina_id: tdId, trimestre_id: trId });
            const res = await fetch(`${API_PROFESSORES}/pauta-geral?${params}`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            if (pedido !== pautaPedidoAtual.current) return;
            setPautaAlunos(Array.isArray(data.dados) ? data.dados : []);
        } catch (err) {
            console.error('Erro ao carregar pauta geral:', err);
            if (pedido !== pautaPedidoAtual.current) return;
            setPautaAlunos([]);
            setErrorMsg(err.message || 'Erro ao carregar dados da pauta.');
        } finally {
            if (pedido === pautaPedidoAtual.current) setLoading(false);
        }
    };

    useEffect(() => {
        let ativo = true;
        const carregarDadosIniciais = async () => {
            try {
                const res = await fetch(`${API_AUTH}/me`, { credentials: 'include', cache: 'no-store' });
                const data = await lerRespostaApi(res);
                const contaAtiva = data.data?.conta_ativa;
                const idEscola = contaAtiva?.escola_id;
                if (!idEscola) throw new Error('Não foi encontrada uma escola ativa para esta conta.');
                const [resAnos, resPolos] = await Promise.all([
                    fetch(`${API_NOTAS}/anos-letivos`, { credentials: 'include', cache: 'no-store' }),
                    fetch(`${API_ESCOLAS}/escolas/${encodeURIComponent(idEscola)}/polos`, { credentials: 'include', cache: 'no-store' })
                ]);
                const [dadosAnos, dadosPolos] = await Promise.all([
                    lerRespostaApi(resAnos),
                    lerRespostaApi(resPolos)
                ]);
                if (!ativo) return;
                const listaAnos = Array.isArray(dadosAnos.dados) ? dadosAnos.dados : [];
                const listaPolos = Array.isArray(dadosPolos.data) ? dadosPolos.data.filter((polo) => polo.ativo) : [];
                setEscola(contaAtiva);
                setEscolaId(idEscola);
                setAnosLetivos(listaAnos);
                setPolos(listaPolos);
                setAnoLetivoId(
                    listaAnos.find((ano) => ano.ativo)?.id
                    || listaAnos[0]?.id
                    || ''
                );
                setPoloId('');
            } catch (err) {
                console.error('Erro ao carregar dados iniciais da pauta:', err);
                if (ativo) setErrorMsg(err.message || 'Não foi possível identificar a escola ativa.');
            }
        };

        const timer = window.setTimeout(() => void carregarDadosIniciais(), 0);
        return () => {
            ativo = false;
            window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        if (!escolaId || !anoLetivoId) return undefined;
        let ativo = true;
        const pedido = ++filtroPedidoAtual.current;
        pautaPedidoAtual.current += 1;
        const timer = window.setTimeout(() => {
            setErrorMsg('');
            setTrimestres([]);
            setTrimestreId('');
            setTurmas([]);
            setTurmaId('');
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            setDadosTurma(null);
            setPautaAlunos([]);
            void Promise.all([
                carregarTrimestres(anoLetivoId, pedido),
                carregarTurmasEscola(escolaId, anoLetivoId, poloId, pedido)
            ]).catch((err) => {
                if (ativo && pedido === filtroPedidoAtual.current) setErrorMsg(err.message || 'Não foi possível carregar os dados do ano letivo.');
            });
        }, 0);
        return () => {
            ativo = false;
            window.clearTimeout(timer);
            if (pedido === filtroPedidoAtual.current) filtroPedidoAtual.current += 1;
        };
    }, [escolaId, anoLetivoId, poloId]);

    useEffect(() => {
        if (!turmaId) return undefined;
        const timer = window.setTimeout(() => void carregarDisciplinasTurma(turmaId), 0);
        return () => window.clearTimeout(timer);
    }, [turmaId]);

    useEffect(() => {
        if (!turmaId || !turmaDisciplinaId || !trimestreId) {
            pautaPedidoAtual.current += 1;
            const timer = window.setTimeout(() => setLoading(false), 0);
            return () => window.clearTimeout(timer);
        }
        const timer = window.setTimeout(
            () => void carregarPautaGeral(turmaId, turmaDisciplinaId, trimestreId),
            0
        );
        return () => window.clearTimeout(timer);
    }, [turmaId, turmaDisciplinaId, trimestreId]);

    // Lógica para aplicar os filtros de busca no frontend
    const alunosFiltrados = pautaAlunos.filter(aluno => {
        const nomeCompleto = `${aluno.nome} ${aluno.apelido || ''}`.toLowerCase();
        const matricula = (aluno.numero_matricula || '').toLowerCase();
        const termo = termoPesquisa.toLowerCase();

        const correspondePesquisa = nomeCompleto.includes(termo) || matricula.includes(termo);

        const temNotaFinal = aluno.mf !== null && aluno.mf !== undefined && String(aluno.mf).trim() !== '';
        if (filtroDesempenho === 'aprovados') return correspondePesquisa && temNotaFinal && Number(aluno.mf) >= 10;
        if (filtroDesempenho === 'negativas') return correspondePesquisa && temNotaFinal && Number(aluno.mf) < 10;

        return correspondePesquisa;
    });

    const turmaSelecionada = turmas.find((turma) => turma.id === turmaId);
    const disciplinaSelecionada = disciplinas.find((disciplina) => disciplina.turma_disciplina_id === turmaDisciplinaId);
    const anoSelecionado = anosLetivos.find((ano) => ano.id === anoLetivoId);
    const trimestreSelecionado = trimestres.find((trimestre) => trimestre.id === trimestreId);
    const professorSelecionado = disciplinaSelecionada?.professor_nome
        || dadosTurma?.diretor_turma?.professor_nome
        || 'Não atribuído';
    const resultadosComNota = pautaAlunos.filter((aluno) => (
        aluno.mf !== null
        && aluno.mf !== undefined
        && String(aluno.mf).trim() !== ''
        && Number.isFinite(Number(aluno.mf))
    ));
    const aprovados = resultadosComNota.filter((aluno) => Number(aluno.mf) >= 10).length;
    const mediaTurma = resultadosComNota.length
        ? (resultadosComNota.reduce((total, aluno) => total + Number(aluno.mf), 0) / resultadosComNota.length).toFixed(1)
        : '—';
    const formatarNota = (nota) => nota === null || nota === undefined || String(nota).trim() === '' ? '—' : nota;

    return (
        <>
            <AdminHeader titulo="Pauta geral da escola" descricao="Consulte e exporte as avaliações por turma, disciplina e período." >
                <span className="secretary-broadsheet-school-chip">
                    <BsBuilding aria-hidden="true" />
                    {escola?.escola_nome || 'Escola ativa'}
                </span>
                <button type="button" className="secretary-broadsheet-export" onClick={() => window.print()} disabled={loading || pautaAlunos.length === 0} >
                    <BsFilePdf aria-hidden="true" /> Exportar pauta / PDF
                </button>
            </AdminHeader>

            <main className="sec-broadsheet-page">
                {errorMsg && <div className="secretary-broadsheet-alert" role="alert">{errorMsg}</div>}

                <section className="secretary-broadsheet-filters" aria-label="Filtros da pauta">
                    <label className="secretary-broadsheet-filter">
                        <span>Ano letivo</span>
                        <select value={anoLetivoId} onChange={(event) => setAnoLetivoId(event.target.value)} disabled={anosLetivos.length === 0}>
                            {anosLetivos.length
                                ? anosLetivos.map((ano) => <option key={ano.id} value={ano.id}>{ano.ano_nome}{ano.ativo ? ' (Atual)' : ''}</option>)
                                : <option value="">Sem anos letivos</option>}
                        </select>
                    </label>

                    <label className="secretary-broadsheet-filter">
                        <span>Ramo / polo</span>
                        <select value={poloId} onChange={(event) => setPoloId(event.target.value)}>
                            <option value="">Todos os ramos</option>
                            {polos.map((polo) => <option key={polo.id} value={polo.id}>{polo.nome}</option>)}
                        </select>
                    </label>

                    <label className="secretary-broadsheet-filter">
                        <span>Trimestre / período</span>
                        <select value={trimestreId} onChange={(event) => setTrimestreId(event.target.value)} disabled={trimestres.length === 0}>
                            {trimestres.length
                                ? trimestres.map((trimestre) => <option key={trimestre.id} value={trimestre.id}>{trimestre.ano_nome ? `${trimestre.ano_nome} · ` : ''}{trimestre.nome}</option>)
                                : <option value="">Sem períodos</option>}
                        </select>
                    </label>

                    <label className="secretary-broadsheet-filter">
                        <span>Classe e turma</span>
                        <select value={turmaId} onChange={(event) => {
                            setTurmaId(event.target.value);
                            setDisciplinas([]);
                            setTurmaDisciplinaId('');
                            setDadosTurma(null);
                            setPautaAlunos([]);
                        }}>
                            {turmas.length
                                ? turmas.map((turma) => <option key={turma.id} value={turma.id}>{turma.polo_nome ? `${turma.polo_nome} · ` : ''}{turma.nome} ({turma.classe})</option>)
                                : <option value="">Sem turmas neste ano e ramo</option>}
                        </select>
                    </label>

                    <label className="secretary-broadsheet-filter">
                        <span>Disciplina</span>
                        <select value={turmaDisciplinaId} onChange={(event) => setTurmaDisciplinaId(event.target.value)}>
                            {disciplinas.length
                                ? disciplinas.map((disciplina) => <option key={disciplina.turma_disciplina_id} value={disciplina.turma_disciplina_id}>{disciplina.nome}</option>)
                                : <option value="">Nenhuma disciplina</option>}
                        </select>
                    </label>

                    <label className="secretary-broadsheet-filter secretary-broadsheet-search">
                        <span>Pesquisar aluno</span>
                        <span className="secretary-broadsheet-search-input">
                            <BsSearch aria-hidden="true" />
                            <input
                                type="search"
                                placeholder="Nome ou matrícula..."
                                value={termoPesquisa}
                                onChange={(event) => setTermoPesquisa(event.target.value)}
                            />
                        </span>
                    </label>

                    <label className="secretary-broadsheet-filter">
                        <span>Desempenho</span>
                        <select value={filtroDesempenho} onChange={(event) => setFiltroDesempenho(event.target.value)}>
                            <option value="todos">Todos os alunos</option>
                            <option value="aprovados">Aprovados (≥ 10)</option>
                            <option value="negativas">Com negativa (&lt; 10)</option>
                        </select>
                    </label>
                </section>

                <section className="secretary-broadsheet-summary" aria-label="Resumo da turma">
                    <article><span>Alunos na pauta</span><strong>{pautaAlunos.length}</strong></article>
                    <article><span>Com nota final</span><strong>{resultadosComNota.length}</strong></article>
                    <article><span>Aprovados</span><strong>{aprovados}</strong></article>
                    <article><span>Média da turma</span><strong>{mediaTurma}</strong></article>
                </section>

                <section className="secretary-broadsheet-screen-card">
                    <header className="secretary-broadsheet-card-header">
                        <div>
                            <span className="secretary-broadsheet-eyebrow">Registo académico</span>
                            <h2>Broadsheet de avaliações</h2>
                            <p>A mostrar {alunosFiltrados.length} de {pautaAlunos.length} alunos</p>
                        </div>
                        <span className="secretary-broadsheet-period-badge">{trimestreSelecionado?.nome || 'Período por selecionar'}</span>
                    </header>

                    {loading ? (
                        <div className="secretary-broadsheet-empty" role="status">A carregar pauta da turma...</div>
                    ) : pautaAlunos.length > 0 ? (
                        <div className="secretary-broadsheet-table-scroll">
                            <table className="secretary-broadsheet-table">
                                <thead>
                                    <tr>
                                        <th>Aluno</th>
                                        <th>Matrícula</th>
                                        <th>N1</th><th>N2</th><th>N3</th><th>N4</th>
                                        <th>MAC</th><th>Prova final</th><th>MF</th><th>Posição</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {alunosFiltrados.length ? alunosFiltrados.map((aluno) => (
                                        <tr key={aluno.matricula_id}>
                                            <td>
                                                <strong>{aluno.nome} {aluno.apelido}</strong>
                                                {aluno.encarregado_nome && <small>Enc.: {aluno.encarregado_nome}</small>}
                                            </td>
                                            <td className="secretary-broadsheet-matricula">{aluno.numero_matricula || '—'}</td>
                                            <td>{formatarNota(aluno.n1)}</td><td>{formatarNota(aluno.n2)}</td>
                                            <td>{formatarNota(aluno.n3)}</td><td>{formatarNota(aluno.n4)}</td>
                                            <td className="secretary-broadsheet-mac">{formatarNota(aluno.mac)}</td>
                                            <td>{formatarNota(aluno.prova_final)}</td>
                                            <td className={`secretary-broadsheet-final ${aluno.mf !== null && aluno.mf !== undefined ? (Number(aluno.mf) >= 10 ? 'passed' : 'failed') : ''}`}>
                                                {formatarNota(aluno.mf)}
                                            </td>
                                            <td>{aluno.posicao_turma ?? '—'}</td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan="10" className="secretary-broadsheet-no-results">Nenhum aluno corresponde aos filtros aplicados.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="secretary-broadsheet-empty">
                            <strong>{turmaId && turmaDisciplinaId && trimestreId ? 'A pauta ainda não tem alunos ou avaliações.' : 'Selecione turma, disciplina e período.'}</strong>
                            <span>Os resultados aparecerão aqui assim que os dados estiverem disponíveis.</span>
                        </div>
                    )}
                </section>

                <section className="secretary-broadsheet-print-report" aria-label="Pauta escolar para impressão">
                    <header className="secretary-broadsheet-print-header">
                        <div className="secretary-broadsheet-school-mark" aria-hidden="true">
                            {(escola?.escola_sigla || escola?.escola_nome || 'E').slice(0, 3)}
                        </div>
                        <div className="secretary-broadsheet-print-school">
                            <p className="secretary-broadsheet-print-kicker">Documento académico</p>
                            <h1>{escola?.escola_nome || 'Escola'}</h1>
                            <p>{escola?.escola_sigla || 'Pauta de avaliação da turma'}</p>
                        </div>
                        <div className="secretary-broadsheet-print-ref">
                            <span>PAUTA</span>
                            <strong>{trimestreSelecionado?.nome || 'Avaliações'}</strong>
                        </div>
                    </header>

                    <div className="secretary-broadsheet-print-title">
                        <h2>Broadsheet de avaliações</h2>
                        <p>Registo de aproveitamento e classificação dos alunos</p>
                    </div>

                    <dl className="secretary-broadsheet-print-meta">
                        <div><dt>Ano letivo</dt><dd>{anoSelecionado?.ano_nome || '—'}</dd></div>
                        <div><dt>Período</dt><dd>{trimestreSelecionado?.nome || '—'}</dd></div>
                        <div><dt>Classe</dt><dd>{turmaSelecionada?.classe || dadosTurma?.classe || '—'}</dd></div>
                        <div><dt>Turma</dt><dd>{turmaSelecionada?.nome || dadosTurma?.nome || '—'}</dd></div>
                        <div><dt>Disciplina</dt><dd>{disciplinaSelecionada?.nome || '—'}</dd></div>
                        <div><dt>Professor</dt><dd>{professorSelecionado}</dd></div>
                        <div><dt>Ramo / polo</dt><dd>{turmaSelecionada?.polo_nome || dadosTurma?.polo_nome || '—'}</dd></div>
                        <div><dt>Emitido em</dt><dd>{dataEmissao || '—'}</dd></div>
                    </dl>

                    <div className="secretary-broadsheet-print-table-wrap">
                        <table className="secretary-broadsheet-print-table">
                            <thead>
                                <tr>
                                    <th className="print-col-order">N.º</th>
                                    <th className="print-col-name">Nome completo do aluno</th>
                                    <th className="print-col-matricula">N.º matrícula</th>
                                    <th>N1</th><th>N2</th><th>N3</th><th>N4</th>
                                    <th>MAC</th><th>Prova final</th><th>MF</th><th>Posição</th><th>Resultado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pautaAlunos.map((aluno, index) => {
                                    const temNotaFinal = aluno.mf !== null
                                        && aluno.mf !== undefined
                                        && String(aluno.mf).trim() !== ''
                                        && Number.isFinite(Number(aluno.mf));
                                    const aprovado = temNotaFinal && Number(aluno.mf) >= 10;
                                    return (
                                        <tr key={aluno.matricula_id}>
                                            <td>{index + 1}</td>
                                            <td className="print-student-name">{aluno.nome} {aluno.apelido}</td>
                                            <td>{aluno.numero_matricula || '—'}</td>
                                            <td>{formatarNota(aluno.n1)}</td><td>{formatarNota(aluno.n2)}</td>
                                            <td>{formatarNota(aluno.n3)}</td><td>{formatarNota(aluno.n4)}</td>
                                            <td>{formatarNota(aluno.mac)}</td><td>{formatarNota(aluno.prova_final)}</td>
                                            <td className="print-final-grade">{formatarNota(aluno.mf)}</td>
                                            <td>{aluno.posicao_turma ?? '—'}</td>
                                            <td>{temNotaFinal ? (aprovado ? 'Aprovado' : 'Não aprovado') : 'Sem nota'}</td>
                                        </tr>
                                    );
                                })}
                                {pautaAlunos.length === 0 && (
                                    <tr><td colSpan="12" className="secretary-broadsheet-print-empty">Não existem registos para os critérios selecionados.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="secretary-broadsheet-print-summary">
                        <div><span>Total de alunos</span><strong>{pautaAlunos.length}</strong></div>
                        <div><span>Com classificação final</span><strong>{resultadosComNota.length}</strong></div>
                        <div><span>Aprovados</span><strong>{aprovados}</strong></div>
                        <div><span>Média da turma</span><strong>{mediaTurma}</strong></div>
                    </div>

                    <p className="secretary-broadsheet-print-legend">
                        <strong>Legenda:</strong> N1–N4 — avaliações contínuas; MAC — média das avaliações contínuas; MF — média final.
                        Resultado aprovado quando MF ≥ 10 valores.
                    </p>

                    <footer className="secretary-broadsheet-signatures">
                        <div><span>O(a) professor(a)</span><i>{professorSelecionado}</i></div>
                        <div><span>A Direção</span><i /></div>
                        <div><span>Data</span><i /></div>
                    </footer>
                    <div className="secretary-broadsheet-print-footer">
                        <span>{escola?.escola_nome || 'Escola'} · Documento gerado pelo SIGE360</span>
                        <span>Folha de avaliações · {anoSelecionado?.ano_nome || ''}</span>
                    </div>
                </section>
            </main>
        </>
    );
}