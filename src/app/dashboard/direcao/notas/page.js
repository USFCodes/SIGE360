'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    BsSearch, BsEye, BsCheckCircleFill,
    BsExclamationTriangleFill, BsXCircleFill, BsCheckSquare, BsSquare
} from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import '@/styles/s3.css';
import '@/styles/direcao-inline-notas.css';
import '@/styles/adm-notas.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_AUTH = `${API_BASE}/api/v1/auth`;
const API_DIRECAO = `${API_BASE}/api/v1/direcao`;

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

const AVALIACOES_FICHA = [
    { key: 'n1', label: 'N1' },
    { key: 'n2', label: 'N2' },
    { key: 'n3', label: 'N3' },
    { key: 'n4', label: 'N4' },
    { key: 'mac', label: 'MAC' },
    { key: 'prova_final', label: 'PF' },
    { key: 'mf', label: 'MF' }
];

function agruparHistoricoPorPeriodo(historico) {
    const periodos = new Map();

    historico.forEach((nota) => {
        const periodoId = nota.trimestre_id || nota.trimestre_nome || 'periodo';
        const periodoKey = `${nota.ano_nome || ''}-${periodoId}`;
        if (!periodos.has(periodoKey)) {
            periodos.set(periodoKey, {
                key: periodoKey,
                anoNome: nota.ano_nome || '',
                nome: nota.trimestre_nome || 'Trimestre',
                numero: Number(nota.trimestre_numero) || 0,
                disciplinas: new Map()
            });
        }

        const periodo = periodos.get(periodoKey);
        const disciplinaKey = nota.turma_disciplina_id || nota.disciplina_nome || nota.disciplina || 'disciplina';
        if (!periodo.disciplinas.has(disciplinaKey)) {
            periodo.disciplinas.set(disciplinaKey, {
                key: disciplinaKey,
                nome: nota.disciplina_nome || nota.disciplina || 'Disciplina',
                nota
            });
        }
    });

    return [...periodos.values()]
        .sort((a, b) => a.anoNome.localeCompare(b.anoNome) || a.numero - b.numero || a.nome.localeCompare(b.nome))
        .map((periodo) => ({
            ...periodo,
            label: [periodo.anoNome, periodo.nome].filter(Boolean).join(' · '),
            disciplinas: [...periodo.disciplinas.values()].sort((a, b) => a.nome.localeCompare(b.nome))
        }));
}

function TabelaFichaNotasHorizontal({ periodos, aluno, className = '' }) {
    const nomeAluno = `${aluno.nome} ${aluno.apelido || ''}`.trim();

    return (
        <table className={`direcao-ficha-horizontal-table ${className}`.trim()}>
            <thead>
                <tr>
                    <th rowSpan={3} className="direcao-ficha-student-column">ALUNO</th>
                    {periodos.map((periodo) => (
                        <th key={periodo.key} colSpan={periodo.disciplinas.length * AVALIACOES_FICHA.length} className="direcao-ficha-period-heading">
                            {periodo.label}
                        </th>
                    ))}
                </tr>
                <tr>
                    {periodos.flatMap((periodo) => periodo.disciplinas.map((disciplina) => (
                        <th key={`${periodo.key}-${disciplina.key}`} colSpan={AVALIACOES_FICHA.length} className="direcao-ficha-discipline-heading">
                            {disciplina.nome}
                        </th>
                    )))}
                </tr>
                <tr>
                    {periodos.flatMap((periodo) => periodo.disciplinas.flatMap((disciplina) => (
                        AVALIACOES_FICHA.map((avaliacao) => (
                            <th key={`${periodo.key}-${disciplina.key}-${avaliacao.key}`} className="direcao-ficha-assessment-heading">
                                {avaliacao.label}
                            </th>
                        ))
                    )))}
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td className="direcao-ficha-student-name">{nomeAluno}</td>
                    {periodos.flatMap((periodo) => periodo.disciplinas.flatMap((disciplina) => (
                        AVALIACOES_FICHA.map((avaliacao) => {
                            const valor = disciplina.nota[avaliacao.key];
                            return (
                                <td key={`${periodo.key}-${disciplina.key}-${avaliacao.key}`} className={avaliacao.key === 'mf' ? 'direcao-ficha-final-grade' : ''}>
                                    {valor === null || valor === undefined
                                        ? '—'
                                        : avaliacao.key === 'mf'
                                            ? <span className={`mf-badge ${Number(valor) >= 10 ? 'pass' : 'fail'}`}>{valor}</span>
                                            : valor}
                                </td>
                            );
                        })
                    )))}
                </tr>
            </tbody>
        </table>
    );
}

export default function DirecaoBroadsheetPage() {
    const [escolaId, setEscolaId] = useState('');
    const [anosLetivos, setAnosLetivos] = useState([]);
    const [anoLetivoId, setAnoLetivoId] = useState('');
    const [trimestres, setTrimestres] = useState([]);
    const [trimestreId, setTrimestreId] = useState('');
    const [turmas, setTurmas] = useState([]);
    const [turmaId, setTurmaId] = useState('');
    const [disciplinas, setDisciplinas] = useState([]);
    const [turmaDisciplinaId, setTurmaDisciplinaId] = useState('');
    const [modoPauta, setModoPauta] = useState('disciplina');
    const [termoPesquisa, setTermoPesquisa] = useState('');
    const [filtroDesempenho, setFiltroDesempenho] = useState('todos');

    // Dados da Pauta e Estados
    const [pautaAlunos, setPautaAlunos] = useState([]);
    const [pautaTurma, setPautaTurma] = useState([]);
    const [estadosAprovacao, setEstadosAprovacao] = useState({});
    const [loading, setLoading] = useState(false);
    const [loadingAprovacao, setLoadingAprovacao] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [mensagemAcao, setMensagemAcao] = useState('');

    // Gestão de Seleção (Checkboxes por Aluno)
    const [alunosSelecionadosIds, setAlunosSelecionadosIds] = useState([]);

    // Modal "Ver Outros" (Todas as notas de um aluno específico)
    const [alunoSelecionadoOutros, setAlunoSelecionadoOutros] = useState(null);
    const [historicoNotasAluno, setHistoricoNotasAluno] = useState([]);
    const [loadingHistorico, setLoadingHistorico] = useState(false);
    const [erroHistorico, setErroHistorico] = useState('');
    const [acaoPendente, setAcaoPendente] = useState('');
    const [idsAcaoPendente, setIdsAcaoPendente] = useState([]);
    const [comentarioAcao, setComentarioAcao] = useState('');
    const [erroAcao, setErroAcao] = useState('');
    const [imprimirFichaAluno, setImprimirFichaAluno] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [dataEmissao, setDataEmissao] = useState('');
    const pautaRequestId = useRef(0);
    const historicoRequestId = useRef(0);
    const pesquisaInicialAplicada = useRef(false);
    const fichaNotasInicialAplicada = useRef(false);
    const periodosHistoricoAluno = useMemo(() => agruparHistoricoPorPeriodo(historicoNotasAluno), [historicoNotasAluno]);

    const carregarTrimestres = useCallback(async (anoId, signal) => {
        if (!anoId) {
            setTrimestres([]);
            setTrimestreId('');
            return;
        }
        try {
            const params = new URLSearchParams({ ano_letivo_id: anoId });
            const res = await fetch(`${API_DIRECAO}/notas/trimestres?${params}`, { credentials: 'include', cache: 'no-store', signal });
            const data = await lerRespostaApi(res);
            const lista = Array.isArray(data.dados) ? data.dados : [];
            setTrimestres(lista);
            const hoje = new Date().toISOString().slice(0, 10);
            const trimestreAtual = lista.find((trimestre) =>
                (!trimestre.data_inicio || trimestre.data_inicio <= hoje)
                && (!trimestre.data_fim || trimestre.data_fim >= hoje)
            );
            setTrimestreId((current) => lista.some((trimestre) => trimestre.id === current)
                ? current
                : trimestreAtual?.id || lista[0]?.id || '');
        } catch (err) {
            if (signal?.aborted) return;
            console.error('Erro ao carregar trimestres:', err);
            setErrorMsg(err.message || 'Não foi possível carregar os períodos letivos.');
        }
    }, []);

    const carregarTurmasEscola = useCallback(async (idEscola, anoId, signal, turmaPreferida) => {
        if (!idEscola || !anoId) {
            setTurmas([]);
            setTurmaId('');
            return;
        }
        try {
            const params = new URLSearchParams({ ano_letivo_id: anoId });
            const res = await fetch(`${API_DIRECAO}/notas/turmas?${params}`, { credentials: 'include', cache: 'no-store', signal });
            const data = await lerRespostaApi(res);
            const lista = Array.isArray(data.dados) ? data.dados : [];
            setTurmas(lista);
            setTurmaId((current) => lista.find((turma) => turma.id === current)?.id
                || lista.find((turma) => turma.id === turmaPreferida)?.id
                || lista[0]?.id
                || '');
        } catch (err) {
            if (signal?.aborted) return;
            console.error('Erro ao carregar turmas:', err);
            setErrorMsg(err.message || 'Não foi possível carregar as turmas da escola.');
        }
    }, []);

    const carregarDisciplinasTurma = useCallback(async (tId, anoId, signal) => {
        if (!tId || !anoId) {
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            return;
        }
        try {
            const params = new URLSearchParams({ ano_letivo_id: anoId });
            const res = await fetch(`${API_DIRECAO}/notas/turmas/${encodeURIComponent(tId)}/disciplinas?${params}`, { credentials: 'include', cache: 'no-store', signal });
            const data = await lerRespostaApi(res);
            const lista = Array.isArray(data.dados) ? data.dados.map((disciplina) => ({
                turma_disciplina_id: disciplina.id,
                nome: disciplina.disciplina_nome
            })) : [];
            setDisciplinas(lista);
            setTurmaDisciplinaId(lista[0]?.turma_disciplina_id || '');
        } catch (err) {
            if (signal?.aborted) return;
            console.error('Erro ao carregar disciplinas:', err);
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            setErrorMsg(err.message || 'Não foi possível carregar as disciplinas da turma.');
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const turmaPreferida = new URLSearchParams(window.location.search).get('turma_id');
        const timer = window.setTimeout(() => {
            setTurmas([]);
            setTurmaId('');
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            setTrimestres([]);
            setTrimestreId('');
            setPautaAlunos([]);
            setPautaTurma([]);
            setAlunosSelecionadosIds([]);
            void carregarTrimestres(anoLetivoId, controller.signal);
            void carregarTurmasEscola(escolaId, anoLetivoId, controller.signal, turmaPreferida);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [anoLetivoId, carregarTrimestres, carregarTurmasEscola, escolaId]);

    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setDisciplinas([]);
            setTurmaDisciplinaId('');
            void carregarDisciplinasTurma(turmaId, anoLetivoId, controller.signal);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [anoLetivoId, carregarDisciplinasTurma, turmaId]);

    const carregarPautaGeral = useCallback(async (yearId, tId, tdId, trId, signal) => {
        const requestId = ++pautaRequestId.current;
        if (!yearId || !tId || !tdId || !trId) {
            setPautaAlunos([]);
            setPautaTurma([]);
            setEstadosAprovacao({});
            setAlunosSelecionadosIds([]);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            setErrorMsg('');
            setMensagemAcao('');
            const params = new URLSearchParams({ ano_letivo_id: yearId, turma_id: tId, turma_disciplina_id: tdId, trimestre_id: trId });
            const [resultadoPauta, resultadoAprovacoes] = await Promise.allSettled([
                fetch(`${API_DIRECAO}/notas/pauta-geral?${params}`, { credentials: 'include', cache: 'no-store', signal })
                    .then(lerRespostaApi),
                fetch(`${API_DIRECAO}/notas/aprovacoes?${params}`, { credentials: 'include', cache: 'no-store', signal })
                    .then(lerRespostaApi)
            ]);
            if (signal?.aborted || requestId !== pautaRequestId.current) return;
            if (resultadoPauta.status === 'rejected') throw resultadoPauta.reason;
            setPautaAlunos(Array.isArray(resultadoPauta.value.dados) ? resultadoPauta.value.dados : []);
            if (resultadoAprovacoes.status === 'fulfilled') {
                setEstadosAprovacao(Object.fromEntries(
                    (Array.isArray(resultadoAprovacoes.value.dados) ? resultadoAprovacoes.value.dados : [])
                        .map((item) => [item.matricula_id, { estado: item.estado, comentario: item.comentario || '' }])
                ));
            } else {
                console.error('Erro ao carregar estados de aprovação:', resultadoAprovacoes.reason);
                setEstadosAprovacao({});
                setErrorMsg(resultadoAprovacoes.reason.message || 'Não foi possível carregar os estados de aprovação.');
            }
            setAlunosSelecionadosIds([]);
        } catch (err) {
            if (signal?.aborted || requestId !== pautaRequestId.current) return;
            console.error('Erro ao carregar pauta geral:', err);
            setPautaAlunos([]);
            setEstadosAprovacao({});
            setErrorMsg(err.message || 'Erro ao carregar dados da pauta.');
        } finally {
            if (!signal?.aborted && requestId === pautaRequestId.current) setLoading(false);
        }
    }, []);

    const carregarPautaPorTurma = useCallback(async (yearId, tId, trId, signal) => {
        const requestId = ++pautaRequestId.current;
        if (!yearId || !tId || !trId) {
            setPautaTurma([]);
            setPautaAlunos([]);
            setEstadosAprovacao({});
            setAlunosSelecionadosIds([]);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            setErrorMsg('');
            setMensagemAcao('');
            const params = new URLSearchParams({ ano_letivo_id: yearId, turma_id: tId, trimestre_id: trId });
            const res = await fetch(`${API_DIRECAO}/notas/pauta-turma?${params}`, {
                credentials: 'include',
                cache: 'no-store',
                signal
            });
            const data = await lerRespostaApi(res);
            if (signal?.aborted || requestId !== pautaRequestId.current) return;
            setPautaTurma(Array.isArray(data.dados) ? data.dados : []);
            setPautaAlunos([]);
            setEstadosAprovacao({});
            setAlunosSelecionadosIds([]);
        } catch (err) {
            if (signal?.aborted || requestId !== pautaRequestId.current) return;
            console.error('Erro ao carregar pauta por turma:', err);
            setPautaTurma([]);
            setErrorMsg(err.message || 'Não foi possível carregar a pauta da turma.');
        } finally {
            if (!signal?.aborted && requestId === pautaRequestId.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            if (modoPauta === 'turma') {
                void carregarPautaPorTurma(anoLetivoId, turmaId, trimestreId, controller.signal);
            } else {
                void carregarPautaGeral(anoLetivoId, turmaId, turmaDisciplinaId, trimestreId, controller.signal);
            }
        }, 0);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [anoLetivoId, carregarPautaGeral, carregarPautaPorTurma, modoPauta, refreshKey, turmaId, turmaDisciplinaId, trimestreId]);

    useEffect(() => {
        const controller = new AbortController();
        const carregarDadosIniciais = async () => {
            try {
                const res = await fetch(`${API_AUTH}/me`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
                const data = await lerRespostaApi(res);
                const idEscola = data.data?.conta_ativa?.escola_id;
                if (!idEscola) throw new Error('Não foi encontrada uma escola ativa para esta conta.');
                setEscolaId(idEscola);
                const turmaPreferida = new URLSearchParams(window.location.search).get('turma_id');
                const [resAnos, resTurmas] = await Promise.all([
                    fetch(`${API_DIRECAO}/notas/anos-letivos`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
                    fetch(`${API_DIRECAO}/notas/turmas`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
                ]);
                const [dataAnos, dataTurmas] = await Promise.all([lerRespostaApi(resAnos), lerRespostaApi(resTurmas)]);
                const listaAnos = Array.isArray(dataAnos.dados) ? dataAnos.dados : [];
                const listaTurmas = Array.isArray(dataTurmas.dados) ? dataTurmas.dados : [];
                const parametrosPagina = new URLSearchParams(window.location.search);
                const anoPreferido = parametrosPagina.get('ano_letivo_id');
                const turmaInicial = listaTurmas.find((turma) => turma.id === turmaPreferida);
                const anoInicial = listaAnos.find((ano) => ano.id === anoPreferido)
                    || listaAnos.find((ano) => ano.id === turmaInicial?.ano_letivo_id)
                    || listaAnos.find((ano) => ano.ativo)
                    || listaAnos[0];
                setAnosLetivos(listaAnos);
                if (!anoInicial) {
                    setErrorMsg('Não há anos letivos configurados para esta escola.');
                    return;
                }
                setAnoLetivoId(anoInicial.id);
            } catch (err) {
                if (controller.signal.aborted) return;
                console.error('Erro ao carregar dados iniciais:', err);
                setErrorMsg(err.message || 'Não foi possível identificar a escola ativa.');
            }
        };
        void carregarDadosIniciais();
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (pesquisaInicialAplicada.current || pautaAlunos.length === 0) return;
            const alunoId = new URLSearchParams(window.location.search).get('aluno_id');
            if (!alunoId) return;
            const aluno = pautaAlunos.find((item) => item.aluno_id === alunoId);
            if (aluno) {
                setTermoPesquisa(`${aluno.nome} ${aluno.apelido || ''}`.trim());
                pesquisaInicialAplicada.current = true;
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [pautaAlunos]);

    const alunosPautaTurma = Array.from(pautaTurma.reduce((alunos, registo) => {
        let aluno = alunos.get(registo.matricula_id);
        if (!aluno) {
            aluno = {
                matricula_id: registo.matricula_id,
                aluno_id: registo.aluno_id,
                numero_matricula: registo.numero_matricula,
                nome: registo.nome,
                apelido: registo.apelido,
                turma_nome: registo.turma_nome,
                classe: registo.classe,
                notas: {}
            };
            alunos.set(registo.matricula_id, aluno);
        }
        aluno.notas[registo.turma_disciplina_id] = registo;
        return alunos;
    }, new Map()).values());

    const alunosTurmaFiltrados = alunosPautaTurma.filter((aluno) => {
        const nomeCompleto = `${aluno.nome} ${aluno.apelido || ''}`.toLowerCase();
        const matricula = (aluno.numero_matricula || '').toLowerCase();
        const termo = termoPesquisa.trim().toLocaleLowerCase();
        const correspondePesquisa = nomeCompleto.includes(termo) || matricula.includes(termo);
        const notasComMedia = Object.values(aluno.notas).filter((nota) =>
            nota.mf !== null && nota.mf !== undefined && String(nota.mf).trim() !== '' && Number.isFinite(Number(nota.mf))
        );
        if (filtroDesempenho === 'aprovados') {
            return correspondePesquisa && notasComMedia.some((nota) => Number(nota.mf) >= 10);
        }
        if (filtroDesempenho === 'negativas') {
            return correspondePesquisa && notasComMedia.some((nota) => Number(nota.mf) < 10);
        }
        return correspondePesquisa;
    });

    const alunosFiltrados = pautaAlunos.filter(aluno => {
        const nomeCompleto = `${aluno.nome} ${aluno.apelido || ''}`.toLowerCase();
        const matricula = (aluno.numero_matricula || '').toLowerCase();
        const termo = termoPesquisa.trim().toLocaleLowerCase();

        const correspondePesquisa = nomeCompleto.includes(termo) || matricula.includes(termo);

        const temNota = aluno.mf !== null && aluno.mf !== undefined
            && String(aluno.mf).trim() !== '' && Number.isFinite(Number(aluno.mf));
        if (filtroDesempenho === 'aprovados') return correspondePesquisa && temNota && Number(aluno.mf) >= 10;
        if (filtroDesempenho === 'negativas') return correspondePesquisa && temNota && Number(aluno.mf) < 10;
        return correspondePesquisa;
    });

    const idsFiltrados = alunosFiltrados
        .filter((aluno) => aluno.nota_id)
        .map((aluno) => aluno.matricula_id)
        .filter(Boolean);
    const todosSelecionados = idsFiltrados.length > 0 && idsFiltrados.every(id => alunosSelecionadosIds.includes(id));

    const handleMarcarTodos = () => {
        setAlunosSelecionadosIds((selecionados) => todosSelecionados
            ? selecionados.filter((id) => !idsFiltrados.includes(id))
            : [...new Set([...selecionados, ...idsFiltrados])]);
    };

    const handleMarcarUnico = (id) => {
        setAlunosSelecionadosIds((selecionados) => selecionados.includes(id)
            ? selecionados.filter((item) => item !== id)
            : [...selecionados, id]);
    };

    const idsDaAcao = alunosSelecionadosIds.length > 0
        ? alunosSelecionadosIds
        : idsFiltrados;
    const estadosVisiveis = idsDaAcao.map((id) => estadosAprovacao[id]?.estado || 'pendente');
    const statusAprovacaoGlobal = estadosVisiveis.length === 0
        ? 'pendente'
        : estadosVisiveis.every((estado) => estado === estadosVisiveis[0])
            ? estadosVisiveis[0]
            : 'misto';

    const abrirAcaoAprovacao = (novoStatus) => {
        setAcaoPendente(novoStatus);
        setIdsAcaoPendente([...new Set(idsDaAcao)]);
        setComentarioAcao('');
        setErroAcao('');
    };

    const executarAcaoAprovacao = async () => {
        const ids = idsAcaoPendente;
        if (ids.length === 0) {
            setErrorMsg('Não há alunos para atualizar com os filtros atuais.');
            return;
        }
        if (acaoPendente !== 'aprovado' && !comentarioAcao.trim()) {
            setErroAcao('Indique o motivo para devolver as notas ao professor.');
            return;
        }

        setLoadingAprovacao(true);
        setErrorMsg('');
        setMensagemAcao('');
        try {
            const res = await fetch(`${API_DIRECAO}/notas/aprovacoes`, {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turma_id: turmaId,
                    turma_disciplina_id: turmaDisciplinaId,
                    trimestre_id: trimestreId,
                    ano_letivo_id: anoLetivoId,
                    matricula_ids: ids,
                    estado: acaoPendente,
                    comentario: comentarioAcao.trim()
                })
            });
            const data = await lerRespostaApi(res);
            setEstadosAprovacao((atuais) => {
                const atualizados = { ...atuais };
                ids.forEach((id) => {
                    atualizados[id] = { estado: acaoPendente, comentario: comentarioAcao.trim() };
                });
                return atualizados;
            });
            setAlunosSelecionadosIds((atuais) => atuais.filter((id) => !ids.includes(id)));
            setMensagemAcao(data.message || `Estado atualizado para ${ids.length} aluno(s).`);
            setAcaoPendente('');
            setIdsAcaoPendente([]);
        } catch (err) {
            console.error('Erro ao atualizar aprovação das notas:', err);
            setErroAcao(err.message || 'Não foi possível atualizar o estado das notas.');
        } finally {
            setLoadingAprovacao(false);
        }
    };

    const abrirVerOutros = useCallback(async (aluno) => {
        setAlunoSelecionadoOutros(aluno);
        setLoadingHistorico(true);
        setHistoricoNotasAluno([]);
        setErroHistorico('');
        const requestId = ++historicoRequestId.current;
        try {
            const idAluno = aluno.aluno_id;
            const params = new URLSearchParams({ ano_letivo_id: anoLetivoId });
            const res = await fetch(`${API_DIRECAO}/notas/aluno/${encodeURIComponent(idAluno)}/historico?${params}`, { credentials: 'include', cache: 'no-store' });
            const data = await lerRespostaApi(res);
            if (requestId !== historicoRequestId.current) return;
            setHistoricoNotasAluno(Array.isArray(data.dados) ? data.dados : (Array.isArray(data.data) ? data.data : []));
        } catch (err) {
            if (requestId !== historicoRequestId.current) return;
            console.error('Erro ao carregar histórico:', err);
            setErroHistorico(err.message || 'Não foi possível carregar o histórico de notas.');
        } finally {
            if (requestId === historicoRequestId.current) setLoadingHistorico(false);
        }
    }, [anoLetivoId]);

    const abrirFichaAluno = (aluno) => () => {
        void abrirVerOutros(aluno);
    };

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (fichaNotasInicialAplicada.current || !anoLetivoId || pautaAlunos.length === 0) return;
            const parametros = new URLSearchParams(window.location.search);
            const alunoId = parametros.get('aluno_id');
            if (!alunoId) return;
            const aluno = pautaAlunos.find((item) => item.aluno_id === alunoId);
            if (!aluno) return;
            fichaNotasInicialAplicada.current = true;
            setTermoPesquisa(`${aluno.nome} ${aluno.apelido || ''}`.trim());
            pesquisaInicialAplicada.current = true;
            void abrirVerOutros(aluno);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [anoLetivoId, abrirVerOutros, pautaAlunos]);

    const fecharHistorico = () => {
        historicoRequestId.current += 1;
        setAlunoSelecionadoOutros(null);
        setLoadingHistorico(false);
    };

    const fecharAcaoAprovacao = () => {
        if (loadingAprovacao) return;
        setAcaoPendente('');
        setIdsAcaoPendente([]);
        setErroAcao('');
    };

    const imprimirFicha = () => {
        setImprimirFichaAluno(true);
        window.setTimeout(() => window.print(), 50);
    };

    useEffect(() => {
        const terminarImpressao = () => setImprimirFichaAluno(false);
        window.addEventListener('afterprint', terminarImpressao);
        return () => window.removeEventListener('afterprint', terminarImpressao);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => setDataEmissao(new Date().toLocaleDateString('pt-PT')), 0);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <div className="admin-page-layout sec-broadsheet-page direcao-broadsheet-page">
            <AdminHeader
                titulo="PAUTA GERAL DA ESCOLA (BROADSHEET)"
                descricao="Consulte, aprove ou devolva as notas por turma, disciplina ou aluno"
                escolaIdLogada={escolaId}
                onRefresh={() => setRefreshKey((current) => current + 1)}
                loading={loading || loadingAprovacao}
                onPrint={() => window.print()}
                printText={imprimirFichaAluno ? 'Imprimir ficha do aluno' : 'Imprimir pauta'}
            />

            {errorMsg && <p role="alert" className="direcao-notas-alert-error">{errorMsg}</p>}
            {mensagemAcao && <p role="status" className="direcao-notas-alert-success">{mensagemAcao}</p>}

            <section className="direcao-notas-view-switch" aria-label="Tipo de pauta">
                <div>
                    <span className="secretary-broadsheet-eyebrow">Modo de consulta</span>
                    <h2>Escolha como consultar as notas</h2>
                </div>
                <div role="group" aria-label="Visualização da pauta">
                    <button type="button" className={modoPauta === 'turma' ? 'active' : ''} onClick={() => setModoPauta('turma')}>
                        Por turma <small>Alunos × disciplinas</small>
                    </button>
                    <button type="button" className={modoPauta === 'disciplina' ? 'active' : ''} onClick={() => setModoPauta('disciplina')}>
                        Por disciplina <small>Notas e aprovação</small>
                    </button>
                </div>
            </section>

            {/* FILTROS DA PAUTA */}
            <section className="direcao-notas-filters-grid">
                <div>
                    <label className="filter-label" htmlFor="filtro-ano-letivo">1. ANO LETIVO</label>
                    <select id="filtro-ano-letivo" value={anoLetivoId} onChange={(e) => setAnoLetivoId(e.target.value)} className="ce-select" disabled={loadingAprovacao || Boolean(acaoPendente)}>
                        {anosLetivos.length ? anosLetivos.map((ano) => (
                            <option key={ano.id} value={ano.id}>{ano.ano_nome}{ano.ativo ? ' · Atual' : ''}</option>
                        )) : <option value="">Sem anos letivos</option>}
                    </select>
                </div>

                <div>
                    <label className="filter-label" htmlFor="filtro-trimestre">2. TRIMESTRE</label>
                    <select id="filtro-trimestre" value={trimestreId} onChange={(e) => setTrimestreId(e.target.value)} className="ce-select" disabled={loadingAprovacao || Boolean(acaoPendente) || !trimestres.length}>
                        {trimestres.length ? trimestres.map(tr => <option key={tr.id} value={tr.id}>{tr.ano_nome ? `${tr.ano_nome} · ` : ''}{tr.nome}</option>) : <option value="">Sem períodos</option>}
                    </select>
                </div>

                <div>
                    <label className="filter-label" htmlFor="filtro-turma">3. CLASSE & TURMA</label>
                    <select id="filtro-turma" value={turmaId} onChange={(e) => { setTurmaId(e.target.value); setPautaAlunos([]); }} className="ce-select" disabled={loadingAprovacao || Boolean(acaoPendente) || !turmas.length}>
                        {turmas.length ? turmas.map(t => <option key={t.id} value={t.id}>{t.nome} ({t.classe})</option>) : <option value="">Sem turmas</option>}
                    </select>
                </div>

                {modoPauta === 'disciplina' && (
                    <div>
                        <label className="filter-label" htmlFor="filtro-disciplina">4. DISCIPLINA</label>
                        <select id="filtro-disciplina" value={turmaDisciplinaId} onChange={(e) => setTurmaDisciplinaId(e.target.value)} className="ce-select" disabled={loadingAprovacao || Boolean(acaoPendente) || !disciplinas.length}>
                            {disciplinas.length ? disciplinas.map(d => <option key={d.turma_disciplina_id} value={d.turma_disciplina_id}>{d.nome}</option>) : <option value="">Nenhuma disciplina</option>}
                        </select>
                    </div>
                )}

                <div>
                    <label className="filter-label" htmlFor="filtro-pesquisa-aluno">{modoPauta === 'disciplina' ? '5.' : '4.'} PESQUISAR ALUNO</label>
                    <div className="search-input-group">
                        <BsSearch className="search-icon-input" />
                        <input id="filtro-pesquisa-aluno" type="search" placeholder="Nome ou Matrícula..." value={termoPesquisa} onChange={(e) => setTermoPesquisa(e.target.value)} className="ce-input" />
                    </div>
                </div>

                <div>
                    <label className="filter-label" htmlFor="filtro-desempenho">{modoPauta === 'disciplina' ? '6.' : '5.'} FILTRAR NOTA</label>
                    <select id="filtro-desempenho" value={filtroDesempenho} onChange={(e) => setFiltroDesempenho(e.target.value)} className="ce-select">
                        <option value="todos">Todos os Alunos</option>
                        <option value="aprovados">Aprovados (≥ 10)</option>
                        <option value="negativas">Com Negativa (&lt; 10)</option>
                    </select>
                </div>
            </section>

            {/* BARRA DE APROVAÇÃO E GESTÃO EM LOTE */}
            {modoPauta === 'disciplina' ? <div className="direcao-aprovacao-bar">
                <div className="direcao-aprovacao-status">
                    <span>Estado Global: </span>
                    <strong className={`status-tag ${statusAprovacaoGlobal}`}>
                        {statusAprovacaoGlobal === 'aprovado' && <><BsCheckCircleFill color="#16a34a" /> Aprovada</>}
                        {statusAprovacaoGlobal === 'rejeitado' && <><BsXCircleFill color="#dc2626" /> Rejeitada</>}
                        {statusAprovacaoGlobal === 'misto' && <><BsExclamationTriangleFill color="#64748b" /> Mista</>}
                        {statusAprovacaoGlobal === 'pendente' && <><BsExclamationTriangleFill color="#d97706" /> Pendente</>}
                    </strong>
                    <span className="selecao-contador-info">
                        {alunosSelecionadosIds.length > 0
                            ? `(${alunosSelecionadosIds.length} selecionados)`
                            : `(${idsFiltrados.length} alunos com notas na pauta filtrada)`}
                    </span>
                </div>
                <div className="direcao-aprovacao-acoes">
                    <button type="button" className="btn-dir-aprovar" onClick={() => abrirAcaoAprovacao('aprovado')} disabled={loading || loadingAprovacao || idsDaAcao.length === 0}>
                        <BsCheckCircleFill /> {loadingAprovacao ? 'A atualizar...' : alunosSelecionadosIds.length > 0 ? 'Aprovar Selecionados' : 'Aprovar Notas Filtradas'}
                    </button>
                    <button type="button" className="btn-dir-rever" onClick={() => abrirAcaoAprovacao('pendente')} disabled={loading || loadingAprovacao || idsDaAcao.length === 0}>
                        Rever
                    </button>
                    <button type="button" className="btn-dir-rejeitar" onClick={() => abrirAcaoAprovacao('rejeitado')} disabled={loading || loadingAprovacao || idsDaAcao.length === 0}>
                        Rejeitar
                    </button>
                </div>
            </div> : (
                <p className="direcao-matrix-approval-hint">
                    Para aprovar, rejeitar ou pedir revisão, use <strong>Por disciplina</strong> e selecione os alunos dessa disciplina.
                </p>
            )}

            <div className="direcao-notas-counter-bar">
                {modoPauta === 'disciplina' ? (
                    <span>A mostrar <strong>{alunosFiltrados.length}</strong> de <strong>{pautaAlunos.length}</strong> alunos · <strong>{idsFiltrados.length}</strong> com notas submetidas{alunosSelecionadosIds.length > 0 && ` | ${alunosSelecionadosIds.length} selecionado(s)`}</span>
                ) : (
                    <span>A mostrar <strong>{alunosTurmaFiltrados.length}</strong> de <strong>{alunosPautaTurma.length}</strong> alunos · <strong>{disciplinas.length}</strong> disciplinas</span>
                )}
            </div>

            {/* TABELA BROADSHEET COM CHECKBOXES */}
            <div className="escolas-table-card">
                <div className="table-header-box">
                    <h2>Pauta de notas dos alunos</h2>
                </div>
                <div className="table-responsive-wrapper">
                    {loading ? (
                        <p className="loading-text">A carregar pauta geral...</p>
                    ) : modoPauta === 'disciplina' ? (
                        <table className="escolas-custom-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', textAlign: 'center' }}>
                                        <button type="button" onClick={handleMarcarTodos} className="btn-checkbox-header" title="Marcar/Desmarcar os alunos com notas submetidas" aria-label="Marcar ou desmarcar todos os alunos com notas submetidas" aria-pressed={todosSelecionados} disabled={loading || idsFiltrados.length === 0}>
                                            {todosSelecionados ? <BsCheckSquare size={16} color="#0284c7" /> : <BsSquare size={16} color="#94a3b8" />}
                                        </button>
                                    </th>
                                    <th>ALUNO</th>
                                    <th>N1</th>
                                    <th>N2</th>
                                    <th>N3</th>
                                    <th>N4</th>
                                    <th>MAC</th>
                                    <th>PROVA FINAL</th>
                                    <th>MF</th>
                                    <th>POSIÇÃO</th>
                                    <th>ESTADO DA DIREÇÃO</th>
                                    <th className="text-right">AÇÕES / OUTROS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {alunosFiltrados.length > 0 ? (
                                    alunosFiltrados.map((aluno) => {
                                        const idUnico = aluno.matricula_id || aluno.aluno_id;
                                        const isChecked = alunosSelecionadosIds.includes(idUnico);

                                        return (
                                            <tr key={idUnico} className={isChecked ? 'tr-row-selected' : ''}>
                                                <td style={{ textAlign: 'center' }}>
                                                    <button type="button" onClick={() => handleMarcarUnico(idUnico)} className="btn-checkbox-header" aria-label={`${isChecked ? 'Desmarcar' : 'Selecionar'} ${aluno.nome} ${aluno.apelido || ''}`} aria-pressed={isChecked} disabled={!aluno.nota_id || loading}>
                                                        {isChecked ? <BsCheckSquare size={16} color="#0284c7" /> : <BsSquare size={16} color="#cbd5e1" />}
                                                    </button>
                                                </td>
                                                <td>
                                                    <strong>{aluno.nome} {aluno.apelido || ''}</strong>
                                                    <div className="user-subtext">Mat: {aluno.numero_matricula}</div>
                                                </td>
                                                <td>{aluno.n1 ?? '-'}</td>
                                                <td>{aluno.n2 ?? '-'}</td>
                                                <td>{aluno.n3 ?? '-'}</td>
                                                <td>{aluno.n4 ?? '-'}</td>
                                                <td><strong>{aluno.mac ?? '-'}</strong></td>
                                                <td>{aluno.prova_final ?? '-'}</td>
                                                <td>{aluno.mf === null || aluno.mf === undefined ? '-' : <span className={`mf-badge ${Number(aluno.mf) >= 10 ? 'pass' : 'fail'}`}>{aluno.mf}</span>}</td>
                                                <td><strong>{aluno.posicao_turma ? `${aluno.posicao_turma}º` : '—'}</strong></td>
                                                <td>
                                                    {aluno.nota_id ? (
                                                        <>
                                                            <span className={`status-tag ${estadosAprovacao[idUnico]?.estado || 'pendente'}`} title={estadosAprovacao[idUnico]?.comentario || undefined}>
                                                                {estadosAprovacao[idUnico]?.estado === 'aprovado' ? 'Aprovada' : estadosAprovacao[idUnico]?.estado === 'rejeitado' ? 'Rejeitada' : 'Pendente'}
                                                            </span>
                                                            {estadosAprovacao[idUnico]?.comentario && <div className="user-subtext direcao-comentario">{estadosAprovacao[idUnico].comentario}</div>}
                                                        </>
                                                    ) : <span className="status-tag sem-submissao">Sem notas submetidas</span>}
                                                </td>
                                                <td className="text-right">
                                                    <button
                                                        type="button"
                                                        className="btn-tb-act info"
                                                        onClick={() => abrirVerOutros(aluno)}
                                                        title="Ver histórico completo"
                                                        aria-label={`Ver histórico de notas de ${aluno.nome} ${aluno.apelido || ''}`}
                                                    >
                                                        <BsEye /> Ficha de Notas
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr><td colSpan="12" className="empty-table-row">{loading ? 'A carregar pauta geral...' : errorMsg ? 'Não foi possível carregar a pauta.' : 'Nenhum aluno encontrado com os filtros aplicados.'}</td></tr>
                                )}
                            </tbody>
                        </table>
                    ) : (
                        <table className="escolas-custom-table direcao-matrix-table">
                            <thead>
                                <tr>
                                    <th>N.º</th>
                                    <th>ALUNO</th>
                                    <th>MATRÍCULA</th>
                                    {disciplinas.map((disciplina) => (
                                        <th key={disciplina.turma_disciplina_id}>
                                            <span>{disciplina.nome}</span>
                                            <button
                                                type="button"
                                                className="direcao-matrix-manage"
                                                onClick={() => {
                                                    setTurmaDisciplinaId(disciplina.turma_disciplina_id);
                                                    setModoPauta('disciplina');
                                                }}
                                                title={`Gerir aprovação de ${disciplina.nome}`}
                                            >
                                                Gerir notas
                                            </button>
                                        </th>
                                    ))}
                                    <th>FICHA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {alunosTurmaFiltrados.length ? alunosTurmaFiltrados.map((aluno, index) => (
                                    <tr key={aluno.matricula_id}>
                                        <td>{index + 1}</td>
                                        <td><strong>{aluno.nome} {aluno.apelido || ''}</strong></td>
                                        <td>{aluno.numero_matricula || '—'}</td>
                                        {disciplinas.map((disciplina) => {
                                            const nota = aluno.notas[disciplina.turma_disciplina_id];
                                            return (
                                                <td key={disciplina.turma_disciplina_id}>
                                                    {nota?.nota_id ? (
                                                        <span className="direcao-matrix-grade">
                                                            <strong className={nota.mf === null || nota.mf === undefined ? '' : Number(nota.mf) >= 10 ? 'passed' : 'failed'}>
                                                                {nota.mf ?? '—'}
                                                            </strong>
                                                            <small className={`status-tag ${nota.estado_aprovacao || 'pendente'}`}>
                                                                {nota.estado_aprovacao === 'aprovado' ? 'Aprovada' : nota.estado_aprovacao === 'rejeitado' ? 'Rejeitada' : 'Pendente'}
                                                            </small>
                                                        </span>
                                                    ) : <span className="direcao-matrix-no-grade">—</span>}
                                                </td>
                                            );
                                        })}
                                        <td>
                                            <button type="button" className="btn-tb-act info" onClick={abrirFichaAluno(aluno)}>
                                                <BsEye /> Ficha de Notas
                                            </button>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={disciplinas.length + 4} className="empty-table-row">
                                            {loading ? 'A carregar pauta da turma...' : errorMsg ? 'Não foi possível carregar a pauta.' : 'Nenhum aluno encontrado com os filtros aplicados.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* MODAL: VER OUTROS */}
            {alunoSelecionadoOutros && (
                <div className="modal-admin-overlay" onClick={fecharHistorico}>
                    <div className="modal-admin-box modal-wide direcao-ficha-horizontal-modal" role="dialog" aria-modal="true" aria-labelledby="historico-notas-titulo" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-admin-header">
                            <h2 id="historico-notas-titulo">FICHA DE NOTAS: {alunoSelecionadoOutros.nome} {alunoSelecionadoOutros.apelido || ''}</h2>
                            <button type="button" className="btn-modal-close" onClick={fecharHistorico} aria-label="Fechar histórico">✕</button>
                        </div>

                        <div className="modal-admin-body">
                            <p className="direcao-ficha-contexto">
                                Ano letivo: {anosLetivos.find((ano) => ano.id === anoLetivoId)?.ano_nome || '—'}
                                {' · Todos os trimestres · Cursos da turma no ano selecionado'}
                            </p>
                            {loadingHistorico ? (
                                <p className="loading-text">A carregar histórico do aluno...</p>
                            ) : erroHistorico ? (
                                <p role="alert" className="direcao-notas-alert-error">{erroHistorico}</p>
                            ) : historicoNotasAluno.length > 0 ? (
                                <div className="table-responsive-wrapper direcao-ficha-horizontal-scroll">
                                    <TabelaFichaNotasHorizontal periodos={periodosHistoricoAluno} aluno={alunoSelecionadoOutros} />
                                </div>
                            ) : (
                                <p className="empty-table-row">Não há cursos associados à turma deste aluno no ano letivo selecionado.</p>
                            )}

                            <div className="modal-form-buttons" style={{ marginTop: '20px' }}>
                                <button type="button" className="admin-btn btn-primary" onClick={imprimirFicha} disabled={loadingHistorico || Boolean(erroHistorico) || historicoNotasAluno.length === 0}>
                                    Imprimir ficha
                                </button>
                                <button type="button" className="admin-btn btn-primary" onClick={fecharHistorico}>Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {acaoPendente && (
                <div className="modal-admin-overlay" onClick={fecharAcaoAprovacao}>
                    <div className="modal-admin-box modal-wide" role="dialog" aria-modal="true" aria-labelledby="aprovacao-notas-titulo" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-admin-header">
                            <h2 id="aprovacao-notas-titulo">
                                {acaoPendente === 'aprovado' ? 'Aprovar notas' : acaoPendente === 'rejeitado' ? 'Devolver notas ao professor' : 'Solicitar revisão das notas'}
                            </h2>
                            <button type="button" className="btn-modal-close" onClick={fecharAcaoAprovacao} aria-label="Fechar" disabled={loadingAprovacao}>✕</button>
                        </div>
                        <div className="modal-admin-body">
                            <p>
                                {acaoPendente === 'aprovado'
                                    ? `Confirma a aprovação das notas de ${idsAcaoPendente.length} aluno(s)?`
                                    : `As notas de ${idsAcaoPendente.length} aluno(s) serão devolvidas ao professor para correção.`}
                            </p>
                            <label className="filter-label" htmlFor="comentario-aprovacao">
                                Comentário para o professor{acaoPendente !== 'aprovado' ? ' (obrigatório)' : ' (opcional)'}
                            </label>
                            <textarea
                                id="comentario-aprovacao"
                                className="ce-input"
                                rows={4}
                                maxLength={2000}
                                placeholder="Escreva orientações ou observações sobre as notas..."
                                value={comentarioAcao}
                                onChange={(e) => setComentarioAcao(e.target.value)}
                                disabled={loadingAprovacao}
                            />
                            <div className="direcao-comentario-contador">{comentarioAcao.length}/2000</div>
                            {erroAcao && <p role="alert" className="direcao-notas-alert-error">{erroAcao}</p>}
                            <div className="modal-form-buttons" style={{ marginTop: '20px' }}>
                                <button type="button" className="admin-btn" onClick={fecharAcaoAprovacao} disabled={loadingAprovacao}>Cancelar</button>
                                <button type="button" className="admin-btn btn-primary" onClick={executarAcaoAprovacao} disabled={loadingAprovacao}>
                                    {loadingAprovacao ? 'A guardar...' : 'Confirmar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <section className={`secretary-broadsheet-print-report${imprimirFichaAluno ? ' direcao-ficha-print-report' : ''}`} aria-label="Pauta de notas para impressão">
                <header className="secretary-broadsheet-print-header">
                    <div className="secretary-broadsheet-school-mark" aria-hidden="true">SIGE</div>
                    <div className="secretary-broadsheet-print-school">
                        <p className="secretary-broadsheet-print-kicker">Documento académico · Direção</p>
                        <h1>Pauta geral da escola</h1>
                        <p>Relatório de avaliações e acompanhamento</p>
                    </div>
                    <div className="secretary-broadsheet-print-ref">
                        <span>{imprimirFichaAluno ? 'FICHA DO ALUNO' : 'PAUTA'}</span>
                        <strong>{trimestres.find((item) => item.id === trimestreId)?.nome || 'Avaliações'}</strong>
                    </div>
                </header>

                <div className="secretary-broadsheet-print-title">
                    <h2>{imprimirFichaAluno && alunoSelecionadoOutros
                        ? `Ficha de notas: ${alunoSelecionadoOutros.nome} ${alunoSelecionadoOutros.apelido || ''}`
                        : modoPauta === 'turma' ? 'Pauta de notas por turma' : `Pauta por disciplina · ${disciplinas.find((item) => item.turma_disciplina_id === turmaDisciplinaId)?.nome || ''}`}
                    </h2>
                    <p>Registo oficial de aproveitamento escolar</p>
                </div>

                <dl className="secretary-broadsheet-print-meta">
                    <div><dt>Ano letivo</dt><dd>{anosLetivos.find((item) => item.id === anoLetivoId)?.ano_nome || '—'}</dd></div>
                    <div><dt>Período</dt><dd>{imprimirFichaAluno ? 'Todos os trimestres' : trimestres.find((item) => item.id === trimestreId)?.nome || '—'}</dd></div>
                    <div><dt>Classe</dt><dd>{turmas.find((item) => item.id === turmaId)?.classe || '—'}</dd></div>
                    <div><dt>Turma</dt><dd>{turmas.find((item) => item.id === turmaId)?.nome || '—'}</dd></div>
                    <div><dt>Disciplina</dt><dd>{imprimirFichaAluno ? 'Todas as disciplinas' : modoPauta === 'disciplina' ? disciplinas.find((item) => item.turma_disciplina_id === turmaDisciplinaId)?.nome || '—' : 'Todas'}</dd></div>
                    <div><dt>Aluno</dt><dd>{imprimirFichaAluno && alunoSelecionadoOutros ? `${alunoSelecionadoOutros.nome} ${alunoSelecionadoOutros.apelido || ''}` : 'Todos os alunos filtrados'}</dd></div>
                    <div><dt>Emitido por</dt><dd>Direção</dd></div>
                    <div><dt>Emitido em</dt><dd>{dataEmissao || '—'}</dd></div>
                </dl>

                {imprimirFichaAluno && alunoSelecionadoOutros ? (
                    <div className="secretary-broadsheet-print-table-wrap">
                        <TabelaFichaNotasHorizontal
                            periodos={periodosHistoricoAluno}
                            aluno={alunoSelecionadoOutros}
                            className="secretary-broadsheet-print-table direcao-history-print-table"
                        />
                    </div>
                ) : modoPauta === 'turma' ? (
                    <div className="secretary-broadsheet-print-table-wrap">
                        <table className="secretary-broadsheet-print-table direcao-matrix-print-table">
                            <thead><tr>
                                <th className="print-col-order">N.º</th><th className="print-col-name">Aluno</th><th className="print-col-matricula">Matrícula</th>
                                {disciplinas.map((disciplina) => <th key={disciplina.turma_disciplina_id}>{disciplina.nome}</th>)}
                            </tr></thead>
                            <tbody>
                                {alunosTurmaFiltrados.map((aluno, index) => (
                                    <tr key={aluno.matricula_id}>
                                        <td>{index + 1}</td><td className="print-student-name">{aluno.nome} {aluno.apelido || ''}</td>
                                        <td>{aluno.numero_matricula || '—'}</td>
                                        {disciplinas.map((disciplina) => {
                                            const nota = aluno.notas[disciplina.turma_disciplina_id];
                                            return (
                                                <td key={disciplina.turma_disciplina_id}>
                                                    {nota?.mf ?? '—'}
                                                    {nota?.nota_id && (
                                                        <small className={`direcao-print-approval ${nota.estado_aprovacao}`}>
                                                            {nota.estado_aprovacao === 'aprovado' ? 'Aprovada' : nota.estado_aprovacao === 'rejeitado' ? 'Rejeitada' : 'Pendente'}
                                                        </small>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="secretary-broadsheet-print-table-wrap">
                        <table className="secretary-broadsheet-print-table direcao-discipline-print-table">
                            <thead><tr>
                                <th className="print-col-order">N.º</th><th className="print-col-name">Aluno</th><th className="print-col-matricula">Matrícula</th>
                                <th>N1</th><th>N2</th><th>N3</th><th>N4</th><th>MAC</th><th>Prova final</th><th>MF</th><th>Posição</th><th>Estado da Direção</th>
                            </tr></thead>
                            <tbody>
                                {alunosFiltrados.map((aluno, index) => {
                                    const estado = estadosAprovacao[aluno.matricula_id]?.estado || 'pendente';
                                    return (
                                        <tr key={aluno.matricula_id}>
                                            <td>{index + 1}</td><td className="print-student-name">{aluno.nome} {aluno.apelido || ''}</td>
                                            <td>{aluno.numero_matricula || '—'}</td><td>{aluno.n1 ?? '—'}</td><td>{aluno.n2 ?? '—'}</td><td>{aluno.n3 ?? '—'}</td>
                                            <td>{aluno.n4 ?? '—'}</td><td>{aluno.mac ?? '—'}</td><td>{aluno.prova_final ?? '—'}</td><td className="print-final-grade">{aluno.mf ?? '—'}</td>
                                            <td>{aluno.posicao_turma || '—'}</td><td>{aluno.nota_id ? estado : 'Sem submissão'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <footer className="secretary-broadsheet-print-footer">
                    <span>SIGE360 · Direção</span><span>Documento gerado automaticamente</span>
                </footer>
            </section>
        </div>
    );
}