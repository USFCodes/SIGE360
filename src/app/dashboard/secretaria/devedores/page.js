'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BsArrowClockwise, BsExclamationTriangle, BsGear, BsSearch } from 'react-icons/bs';
import '@/styles/tesouraria-devedores.css';
import AdminHeader from '@/components/adminHeader';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1/tesouraria`;

function dataAtualLocal() {
    const data = new Date();
    const localDate = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
}

function formatarData(valor) {
    if (!valor) return '—';
    const data = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
    return Number.isNaN(data.getTime()) ? '—' : data.toLocaleDateString();
}

async function lerRespostaApi(response) {
    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
    }
    if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Falha ao carregar dívidas (HTTP ${response.status}).`);
    }
    return data;
}

export default function TesourariaDevedoresPage() {
    const [ate, setAte] = useState('');
    const [hoje, setHoje] = useState('');
    const [nivelId, setNivelId] = useState('');
    const [poloId, setPoloId] = useState('');
    const [turmaId, setTurmaId] = useState('');
    const [anoLetivoId, setAnoLetivoId] = useState('');
    const [opcoes, setOpcoes] = useState(null);
    const [dados, setDados] = useState(null);
    const [loading, setLoading] = useState(false);
    const [carregandoOpcoes, setCarregandoOpcoes] = useState(true);
    const [erro, setErro] = useState('');

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const data = dataAtualLocal();
            setHoje(data);
            setAte(data);
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const carregarOpcoes = async () => {
            try {
                const result = await lerRespostaApi(await fetch(`${API_URL}/devedores/opcoes`, {
                    credentials: 'include',
                    cache: 'no-store',
                    signal: controller.signal
                }));
                const dadosOpcoes = result.dados;
                setOpcoes(dadosOpcoes);
                setAnoLetivoId(dadosOpcoes.ano_letivo_id);
                const primeiraTurma = dadosOpcoes.turmas?.[0];
                if (primeiraTurma) {
                    setPoloId(primeiraTurma.polo_id);
                    setTurmaId(primeiraTurma.id);
                }
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error('Erro ao carregar turmas para consulta de atrasos:', error);
                setErro(error.message || 'Não foi possível carregar as turmas.');
            } finally {
                if (!controller.signal.aborted) setCarregandoOpcoes(false);
            }
        };
        void carregarOpcoes();
        return () => controller.abort();
    }, []);

    const carregar = useCallback(async () => {
        if (!ate || !anoLetivoId || !turmaId) {
            setDados(null);
            return;
        }
        try {
            setLoading(true);
            setErro('');
            setDados(null);
            const params = new URLSearchParams({ ate, ano_letivo_id: anoLetivoId, turma_id: turmaId });
            if (nivelId) params.set('nivel_id', nivelId);
            if (poloId) params.set('polo_id', poloId);
            const result = await lerRespostaApi(await fetch(`${API_URL}/devedores?${params}`, {
                credentials: 'include',
                cache: 'no-store'
            }));
            setDados(result.dados);
        } catch (error) {
            console.error('Erro ao consultar pagamentos em atraso:', error);
            setDados(null);
            setErro(error.message || 'Não foi possível calcular os pagamentos em atraso.');
        } finally {
            setLoading(false);
        }
    }, [ate, anoLetivoId, nivelId, poloId, turmaId]);

    useEffect(() => {
        if (ate && anoLetivoId && turmaId) void Promise.resolve().then(carregar);
    }, [ate, anoLetivoId, turmaId, carregar]);

    const formatarValor = (valor) => `${Number(valor || 0).toLocaleString()} CFA`;
    const turmasDisponiveis = (opcoes?.turmas || []).filter((turma) => !poloId || turma.polo_id === poloId);
    const itensEmAtraso = (dados?.itens || []).filter((item) =>
        dados.alunos?.some((aluno) => aluno.cobrancas?.some((cobranca) =>
            cobranca.item_id === item.id && cobranca.classe === item.classe && cobranca.situacao === 'em_atraso'
        ))
    );

    return (
        <main className="td-page">
            <AdminHeader titulo='Pagamentos em atraso' descricao='Consulte cada cobrança obrigatória por aluno, classe e turma no ano letivo ativo.'/>

            <section className="td-filters">
                <label>Calcular até
                    <input type="date" value={ate} max={hoje} onChange={(event) => setAte(event.target.value)} />
                </label>
                <label>Nível de ensino
                    <select value={nivelId} onChange={(event) => setNivelId(event.target.value)}>
                        <option value="">Todos os níveis</option>
                        {(opcoes?.niveis || []).map((nivel) => <option key={nivel.id} value={nivel.id}>{nivel.nome}</option>)}
                    </select>
                </label>
                <label>Polo para filtrar
                    <select value={poloId} onChange={(event) => {
                        const novoPoloId = event.target.value;
                        const primeiraTurma = (opcoes?.turmas || []).find((turma) => !novoPoloId || turma.polo_id === novoPoloId);
                        setPoloId(novoPoloId);
                        setTurmaId(primeiraTurma?.id || '');
                    }}>
                        <option value="">Todos os ramos</option>
                        {(opcoes?.polos || []).map((polo) => <option key={polo.id} value={polo.id}>{polo.nome}</option>)}
                    </select>
                </label>
                <label>Turma
                    <select value={turmaId} onChange={(event) => setTurmaId(event.target.value)} disabled={carregandoOpcoes || !turmasDisponiveis.length}>
                        <option value="">{carregandoOpcoes ? 'A carregar turmas...' : 'Selecione uma turma'}</option>
                        {turmasDisponiveis.map((turma) => (
                            <option key={turma.id} value={turma.id}>{turma.nome}{turma.classe ? ` · ${turma.classe}` : ''}</option>
                        ))}
                    </select>
                </label>
                <button type="button" onClick={() => void carregar()} disabled={loading || carregandoOpcoes || !ate || !turmaId}>
                    {loading ? <BsArrowClockwise className="td-spinning" /> : <BsSearch />}
                    {loading ? 'A calcular...' : 'Consultar'}
                </button>
                {!carregandoOpcoes && !turmasDisponiveis.length && (
                    <p role="status">Não há turmas ativas para o ano letivo e ramo selecionados.</p>
                )}
            </section>

            {erro && (
                <div className="td-alert" role="alert">
                    <BsExclamationTriangle aria-hidden="true" />
                    <span>{erro} {erro.includes('ano letivo') && <Link href="/dashboard/direcao/configuracao">Corrigir ano letivo</Link>}</span>
                </div>
            )}

            {dados && (
                <>
                    <div className="td-summary">
                        <article><span>Ano letivo</span><strong>{dados.ano_letivo || '—'}</strong></article>
                        <article><span>Alunos avaliados</span><strong>{dados.total_alunos}</strong></article>
                        <article><span>Alunos em atraso</span><strong>{dados.alunos_com_divida}</strong></article>
                        <article><span>Total em atraso</span><strong>{formatarValor(dados.total_em_divida)}</strong></article>
                    </div>

                    <div className="td-table-wrap">
                        <table className="td-table">
                            <thead>
                                <tr>
                                    <th>Aluno</th>
                                    <th>Matrícula</th>
                                    <th>Classe</th>
                                    <th>Vencimento mais antigo</th>
                                    {itensEmAtraso.map((item) => (
                                        <th key={`${item.id}-${item.classe}`}>
                                            {item.nome}
                                            <small>{item.classe} · {formatarValor(item.valor)} / {item.periodicidade}</small>
                                        </th>
                                    ))}
                                    <th>Saldo vencido</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td className="td-empty" colSpan={itensEmAtraso.length + 5}>A atualizar cálculo...</td></tr>
                                ) : dados.alunos?.length ? dados.alunos.map((aluno) => (
                                    <tr key={aluno.matricula_id}>
                                        <td><strong>{[aluno.aluno_nome, aluno.aluno_apelido].filter(Boolean).join(' ')}</strong></td>
                                        <td>{aluno.numero_matricula || '—'}</td>
                                        <td>{aluno.turma_nome || aluno.classe || '—'}</td>
                                        <td className="td-due-date">{formatarData(aluno.primeiro_vencimento)}</td>
                                        {itensEmAtraso.map((item) => {
                                            const cobranca = aluno.cobrancas?.find((linha) =>
                                                linha.item_id === item.id && linha.classe === item.classe
                                            );
                                            return (
                                                <td key={`${aluno.matricula_id}-${item.id}-${item.classe}`}>
                                                    {cobranca?.situacao === 'em_atraso' ? (
                                                        <div className="td-matrix-overdue">
                                                            {cobranca.parcelas.map((parcela) => (
                                                                <span key={parcela.vencimento}>
                                                                    {formatarData(parcela.vencimento)}: <strong>{formatarValor(parcela.em_falta)}</strong>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : <span>—</span>}
                                                </td>
                                            );
                                        })}
                                        <td className="td-amount">{formatarValor(aluno.divida_total)}</td>
                                    </tr>
                                )) : (
                                    <tr><td className="td-empty" colSpan={itensEmAtraso.length + 5}>Não há alunos com cobranças vencidas e por pagar para os filtros escolhidos.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </main>
    );
}