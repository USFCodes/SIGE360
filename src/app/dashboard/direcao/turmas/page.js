'use client';

import '@/styles/a4.css';
import React, { useState, useEffect, useCallback } from 'react';
import { BsPlusLg, BsSearch, BsPencilSquare, BsEye, BsCheckCircle, BsExclamationTriangle, BsBook, BsPeople, BsPersonBadge, BsTrash, BsCalendarEvent, BsXCircle } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");
const API_URL = `${API_BASE}/api/v1`;
const API_URL_ESCOLAS = `${API_URL}/escolas`;

const lerRespostaApi = async (response) => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error(`O backend devolveu uma resposta inesperada (HTTP ${response.status}).`);
    }
    const data = await response.json();
    if (!response.ok || data.success === false) {
        throw new Error(data.message || `Falha na comunicação com o backend (HTTP ${response.status}).`);
    }
    return data;
};

export default function GestaoTurmas({ escolaIdProp }) {
    const [escolaId, setEscolaId] = useState(escolaIdProp || "");
    const [escolaInfo, setEscolaInfo] = useState({ nome: "", sigla: "" });
    const [turmas, setTurmas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [salvando, setSalvando] = useState(false);
    const [search, setSearch] = useState("");
    const [mensagem, setMensagem] = useState({ texto: "", tipo: "" });
    const [erroCarregamento, setErroCarregamento] = useState("");

    // Anos letivos associados à escola ativa
    const [anosLetivos, setAnosLetivos] = useState([]);
    const [anoLetivoSelecionado, setAnoLetivoSelecionado] = useState("");

    // Dados auxiliares
    const [polos, setPolos] = useState([]);
    const [professores, setProfessores] = useState([]);
    const [disciplinasBase, setDisciplinasBase] = useState([]);

    // Estados dos Modais
    const [isModalOpen, setIsModalOpen] = useState(false); // Criar / Editar Turma
    const [isDetalhesOpen, setIsDetalhesOpen] = useState(false); // Ver Turma
    const [isEditMode, setIsEditMode] = useState(false);
    const [turmaSelecionada, setTurmaSelecionada] = useState(null);
    const [detalhesCompletos, setDetalhesCompletos] = useState(null);

    // Formulário de Turma
    const [formData, setFormData] = useState({ 
        nome: "", polo_id: "", classe: "", turno: "Manhã", sala: "", capacidade: 45, ano_letivo_id: "" 
    });
    
    const [diretorId, setDiretorId] = useState("");
    const [formDisciplina, setFormDisciplina] = useState({ disciplina_id: "", professor_id: "", carga_horaria: 3 });

    const carregarAnosLetivos = useCallback(async (idEscola, anoAtual = "") => {
        if (!idEscola) return "";
        const res = await fetch(
            `${API_URL_ESCOLAS}/escolas/${encodeURIComponent(idEscola)}/anos-letivos`,
            { credentials: 'include', cache: 'no-store' }
        );
        const data = await lerRespostaApi(res);
        const lista = Array.isArray(data.dados) ? data.dados : [];
        setAnosLetivos(lista);

        const atualExiste = lista.find((ano) => ano.ano_letivo_id === anoAtual);
        const selecionado = atualExiste?.ano_letivo_id
            || lista.find((ano) => ano.ativo)?.ano_letivo_id
            || lista[0]?.ano_letivo_id
            || "";
        setAnoLetivoSelecionado(selecionado);
        return selecionado;
    }, []);

    const carregarDadosTurmas = useCallback(async (idEscola, anoLetivo) => {
        if (!idEscola) return;
        try {
            setLoading(true);
            setErroCarregamento("");
            const opcoesFetch = { credentials: 'include', cache: 'no-store' };

            const urlTurmas = anoLetivo
                ? `${API_URL_ESCOLAS}/${encodeURIComponent(idEscola)}/turmas?ano_letivo_id=${encodeURIComponent(anoLetivo)}`
                : `${API_URL_ESCOLAS}/${encodeURIComponent(idEscola)}/turmas`;

            const [resTurmas, resPolos, resProfessores, resDisciplinas, resAuth] = await Promise.all([
                fetch(urlTurmas, opcoesFetch),
                fetch(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(idEscola)}/polos`, opcoesFetch),
                fetch(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(idEscola)}/funcionarios`, opcoesFetch),
                fetch(`${API_URL_ESCOLAS}/disciplinas`, opcoesFetch),
                fetch(`${API_URL}/auth/me`, opcoesFetch)
            ]);

            const [dataTurmas, dataPolos, dataProfessores, dataDisciplinas, dataAuth] = await Promise.all([
                lerRespostaApi(resTurmas),
                lerRespostaApi(resPolos),
                lerRespostaApi(resProfessores),
                lerRespostaApi(resDisciplinas),
                lerRespostaApi(resAuth)
            ]);

            setTurmas(Array.isArray(dataTurmas.data) ? dataTurmas.data : []);
            setPolos(Array.isArray(dataPolos.data) ? dataPolos.data : []);
            setProfessores((Array.isArray(dataProfessores.data) ? dataProfessores.data : [])
                .filter((f) => f.papel?.toLowerCase() === 'professor' && f.status_ativo === true));
            setDisciplinasBase(Array.isArray(dataDisciplinas.data) ? dataDisciplinas.data : []);

            if (dataAuth?.data?.conta_ativa) {
                setEscolaInfo({
                    nome: dataAuth.data.conta_ativa.escola_nome || "",
                    sigla: dataAuth.data.conta_ativa.escola_sigla || ""
                });
            }

        } catch (err) {
            console.error("Erro ao carregar dados:", err);
            setErroCarregamento(err.message || "Não foi possível carregar as turmas.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let ativo = true;
        const inicializar = async () => {
            try {
                let idAtivo = escolaIdProp;
                if (!idAtivo) {
                    const resposta = await fetch(`${API_URL}/auth/me`, { credentials: 'include', cache: 'no-store' });
                    const data = await lerRespostaApi(resposta);
                    idAtivo = data?.data?.conta_ativa?.escola_id;
                }
                if (!idAtivo) throw new Error("Escola ativa não encontrada.");
                if (ativo) setEscolaId(idAtivo);

                const anoInicial = await carregarAnosLetivos(idAtivo);
                if (ativo) await carregarDadosTurmas(idAtivo, anoInicial);
            } catch (err) {
                if (ativo) {
                    setErroCarregamento(err.message);
                    setLoading(false);
                }
            }
        };
        inicializar();
        return () => { ativo = false; };
    }, [escolaIdProp, carregarDadosTurmas, carregarAnosLetivos]);

    const handleRefreshGeral = async () => {
        if (escolaId) {
            try {
                const ano = await carregarAnosLetivos(escolaId, anoLetivoSelecionado);
                await carregarDadosTurmas(escolaId, ano);
            } catch (err) {
                setMensagem({ texto: err.message || "Erro ao atualizar dados.", tipo: "erro" });
            }
        }
    };

    const handleMudancaAnoLetivo = async (e) => {
        const novoAno = e.target.value;
        setAnoLetivoSelecionado(novoAno);
        await carregarDadosTurmas(escolaId, novoAno);
    };

    const handleSubmeterTurma = async (e) => {
        e.preventDefault();
        setSalvando(true);
        try {
            const endpoint = isEditMode 
                ? `${API_URL_ESCOLAS}/turmas/${turmaSelecionada.id}`
                : `${API_URL_ESCOLAS}/${escolaId}/turmas`;
            
            const method = isEditMode ? 'PUT' : 'POST';

            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ 
                    ...formData, 
                    capacidade: Number(formData.capacidade),
                    diretor_turma_id: diretorId || null
                })
            });
            const data = await lerRespostaApi(res);
            setMensagem({ texto: data.message || "Operação efetuada com sucesso!", tipo: "sucesso" });
            setIsModalOpen(false);
            setIsEditMode(false);
            await carregarDadosTurmas(escolaId, anoLetivoSelecionado);
        } catch (err) {
            setMensagem({ texto: err.message || "Erro ao guardar turma.", tipo: "erro" });
        } finally {
            setSalvando(false);
        }
    };

    const handleApagarTurma = async (idTurma) => {
        if (!window.confirm("Tem certeza de que pretende desativar esta turma? O histórico académico será preservado e não será possível desativá-la enquanto houver alunos ativos.")) return;
        try {
            setSalvando(true);
            const res = await fetch(`${API_URL_ESCOLAS}/turmas/${idTurma}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await lerRespostaApi(res);
            setMensagem({ texto: data.message || "Turma desativada com sucesso.", tipo: "sucesso" });
            setIsModalOpen(false);
            setIsDetalhesOpen(false);
            await carregarDadosTurmas(escolaId, anoLetivoSelecionado);
        } catch (err) {
            setMensagem({ texto: err.message || "Erro ao apagar turma.", tipo: "erro" });
        } finally {
            setSalvando(false);
        }
    };

    const abrirDetalhesTurma = async (turma) => {
        setTurmaSelecionada(turma);
        try {
            const res = await fetch(`${API_URL_ESCOLAS}/turmas/${turma.id}/completa`, { credentials: 'include' });
            const data = await lerRespostaApi(res);
            setDetalhesCompletos(data.data);
            setDiretorId(data.data.diretor_turma?.professor_id || "");
        } catch (err) {
            setMensagem({ texto: err.message || "Erro ao carregar detalhes.", tipo: "erro" });
            setDetalhesCompletos(null);
        }
        setIsDetalhesOpen(true);
    };

    const carregarDetalhesCompletos = async (turmaId) => {
        const res = await fetch(`${API_URL_ESCOLAS}/turmas/${turmaId}/completa`, {
            credentials: 'include',
            cache: 'no-store'
        });
        const data = await lerRespostaApi(res);
        setDetalhesCompletos(data.data);
        return data.data;
    };

    const abrirModalCriar = () => {
        if (!anoLetivoSelecionado) {
            setMensagem({
                texto: "Configure um ano letivo para esta escola antes de criar turmas.",
                tipo: "erro"
            });
            return;
        }
        setIsEditMode(false);
        setTurmaSelecionada(null);
        setDetalhesCompletos(null);
        setFormData({ nome: "", polo_id: "", classe: "", turno: "Manhã", sala: "", capacidade: 45, ano_letivo_id: anoLetivoSelecionado });
        setDiretorId("");
        setIsModalOpen(true);
    };

    const abrirModalEditarDireto = async (turma) => {
        setTurmaSelecionada(turma);
        setIsEditMode(true);
        setFormDisciplina({ disciplina_id: "", professor_id: "", carga_horaria: 3 });
        setFormData({
            nome: turma.nome || "",
            polo_id: turma.polo_id || "",
            classe: turma.classe || "",
            turno: turma.turno || "Manhã",
            sala: turma.sala || "",
            capacidade: turma.capacidade || 45,
            ano_letivo_id: turma.ano_letivo_id || anoLetivoSelecionado
        });
        
        try {
            const detalhes = await carregarDetalhesCompletos(turma.id);
            setDiretorId(detalhes.diretor_turma?.professor_id || "");
        } catch (err) {
            setMensagem({ texto: err.message || "Não foi possível carregar os dados para edição.", tipo: "erro" });
            return;
        }

        setIsModalOpen(true);
    };

    const handleAtribuirDisciplina = async (e) => {
        e?.preventDefault();
        const cargaHoraria = Number(formDisciplina.carga_horaria);
        if (!formDisciplina.disciplina_id || !formDisciplina.professor_id ||
            !Number.isInteger(cargaHoraria) || cargaHoraria < 1) {
            setMensagem({ texto: "Selecione uma disciplina, um professor e indique horas semanais válidas.", tipo: "erro" });
            return;
        }
        setSalvando(true);
        try {
            const res = await fetch(`${API_URL_ESCOLAS}/turmas/${turmaSelecionada.id}/disciplinas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ disciplinas: [formDisciplina] })
            });
            const data = await lerRespostaApi(res);
            setMensagem({ texto: data.message || "Disciplina atribuída com sucesso!", tipo: "sucesso" });
            setFormDisciplina({ disciplina_id: "", professor_id: "", carga_horaria: 3 });
            await carregarDetalhesCompletos(turmaSelecionada.id);
        } catch (err) {
            setMensagem({ texto: err.message || "Erro ao atribuir disciplina.", tipo: "erro" });
        } finally {
            setSalvando(false);
        }
    };

    const handleRemoverProfessorDisciplina = async (atribuicaoId) => {
        if (!window.confirm("Pretende retirar este professor da turma?")) return;
        try {
            setSalvando(true);
            const res = await fetch(`${API_URL_ESCOLAS}/turmas/disciplinas/${atribuicaoId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await lerRespostaApi(res);
            setMensagem({ texto: data.message || "Professor retirado com sucesso.", tipo: "sucesso" });
            if (isDetalhesOpen && turmaSelecionada) await abrirDetalhesTurma(turmaSelecionada);
            else if (isModalOpen && turmaSelecionada) await carregarDetalhesCompletos(turmaSelecionada.id);
        } catch (err) {
            setMensagem({ texto: err.message || "Erro ao remover professor.", tipo: "erro" });
        } finally {
            setSalvando(false);
        }
    };

    const turmasFiltradas = turmas.filter(t => 
        (t.nome || '').toLowerCase().includes(search.toLowerCase()) || 
        (t.classe || '').toLowerCase().includes(search.toLowerCase()) || 
        (t.polo_nome || '').toLowerCase().includes(search.toLowerCase())
    );

    const poloSelecionado = polos.find((p) => p.id === formData.polo_id);
    const classesDisponiveis = poloSelecionado?.classes || [];

    return (
        <div className="owner-users-page direcao-usuarios-page">
            <AdminHeader 
                titulo="Gestão de Turmas e Pedagogical" 
                descricao={`Organização de turmas da ${escolaInfo.sigla || ''} - ${escolaInfo.nome || ''}`} 
                modalBtn={abrirModalCriar}
                modalBtnText="Nova Turma"
                escolaIdLogada={escolaId}
                onRefresh={handleRefreshGeral}
                loading={loading}
            />

            {mensagem.texto && (
                <div className={`owner-users-alert ${mensagem.tipo === 'sucesso' ? 'success' : 'error'}`} role="alert">
                    {mensagem.tipo === 'sucesso' ? <BsCheckCircle size={18} /> : <BsExclamationTriangle size={18} />}
                    <span>{mensagem.texto}</span>
                    <button type="button" className="owner-users-alert-close" onClick={() => setMensagem({ texto: "", tipo: "" })} aria-label="Fechar mensagem">×</button>
                </div>
            )}

            {/* BARRA DE SELEÇÃO DE ANO LETIVO E PESQUISA */}
            <section className="owner-users-panel">
                <header className="owner-users-panel-header">
                    <div className="owner-users-title-group">
                        <h2>Turmas</h2>
                        <p>Consulte e organize as turmas da escola por ano letivo.</p>
                    </div>
                    <div className="owner-users-tools">
                      <div className="filter-select-group">
                        <label htmlFor="turmas-ano-letivo"><BsCalendarEvent aria-hidden="true" /> Ano letivo</label>
                        <select id="turmas-ano-letivo" className="ce-select" value={anoLetivoSelecionado} onChange={handleMudancaAnoLetivo}>
                        {anosLetivos.length > 0 ? (
                            anosLetivos.map(a => {
                                const id = a.ano_letivo_id || a.id;
                                return <option key={id} value={id}>{a.ano_nome || a.ano || a.nome || id}</option>;
                            })
                        ) : (
                            <option value={anoLetivoSelecionado}>{anoLetivoSelecionado || 'Carregando...'}</option>
                        )}
                        </select>
                      </div>
                    </div>
                </header>

            {/* Tabela de Turmas */}
            {loading ? (
                <div className="owner-users-empty-state" role="status"><span>A carregar turmas...</span></div>
            ) : erroCarregamento ? (
                <div className="owner-users-empty-state" role="alert">
                    <strong>Não foi possível carregar as turmas</strong>
                    <span>{erroCarregamento}</span>
                    <button type="button" className="owner-users-empty-action" onClick={() => carregarDadosTurmas(escolaId, anoLetivoSelecionado)}>Tentar novamente</button>
                </div>
            ) : turmasFiltradas.length > 0 ? (
                <div className="owner-users-table-wrap">
                    <table className="owner-users-table">
                        <thead>
                            <tr>
                                <th>Nome da Turma</th>
                                <th>Classe</th>
                                <th>Turno / Sala</th>
                                <th>Polo / Ramo</th>
                                <th>Alunos Matriculados</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {turmasFiltradas.map((t) => (
                                <tr key={t.id}>
                                    <td className="owner-users-name-cell">{t.nome}</td>
                                    <td>{t.classe}</td>
                                    <td><span className="owner-users-role">{t.turno || 'Manhã'}</span> {t.sala ? `(${t.sala})` : ''}</td>
                                    <td>{t.polo_nome || 'Sede Principal'}</td>
                                    <td>
                                        <span className="owner-users-status active">
                                            {t.total_alunos ?? t.alunos_count ?? 0}
                                        </span> / {t.capacidade ?? 45} alunos
                                    </td>
                                    <td>
                                        <div className="owner-users-actions">
                                            <button type="button" className="owner-users-action" onClick={() => abrirDetalhesTurma(t)}>
                                                <BsEye size={13} /> Ver Turma
                                            </button>
                                            <button type="button" className="owner-users-action" onClick={() => abrirModalEditarDireto(t)}>
                                                <BsPencilSquare size={13} /> Editar
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="owner-users-empty-state">
                    <strong>{anoLetivoSelecionado ? "Nenhuma turma registada para este ano letivo." : "Não há anos letivos configurados para esta escola."}</strong>
                </div>
            )}
            </section>

            {/* MODAL: CRIAR OU EDITAR TURMA (Com Diretor e Apagar com aviso forte) */}
            {isModalOpen && (
                <div className="modal-admin-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-admin-box" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-admin-header">
                            <h2>{isEditMode ? "Editar Dados da Turma" : "Criar Nova Turma"}</h2>
                            <button type="button" className="btn-modal-close" onClick={() => setIsModalOpen(false)}>✕</button>
                        </div>
                        
                        <form onSubmit={handleSubmeterTurma} className="modal-admin-body">
                            <div className="ce-field-group">
                                <label>Nome da Turma *</label>
                                <input type="text" required value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} className="ce-input" placeholder="Ex: 10ª Classe A" />
                            </div>

                            <div className="modal-grid-2">
                                <div className="ce-field-group">
                                    <label>Polo / Ramo *</label>
                                    <select required value={formData.polo_id} onChange={(e) => setFormData({ ...formData, polo_id: e.target.value, classe: "" })} className="ce-select">
                                        <option value="">-- Selecionar --</option>
                                        {polos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                                    </select>
                                </div>
                                <div className="ce-field-group">
                                    <label>Classe / Ano *</label>
                                    <select required value={formData.classe} onChange={(e) => setFormData({ ...formData, classe: e.target.value })} className="ce-select" disabled={!formData.polo_id}>
                                        <option value="">-- Selecionar --</option>
                                        {classesDisponiveis.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="modal-grid-2">
                                <div className="ce-field-group">
                                    <label>Turno *</label>
                                    <select required value={formData.turno} onChange={(e) => setFormData({ ...formData, turno: e.target.value })} className="ce-select">
                                        <option value="Manhã">Manhã</option>
                                        <option value="Tarde">Tarde</option>
                                        <option value="Noite">Noite / Pós-laboral</option>
                                        <option value="Regime Integral">Regime Integral</option>
                                    </select>
                                </div>
                                <div className="ce-field-group">
                                    <label>Ano Letivo *</label>
                                    <select required value={formData.ano_letivo_id} onChange={(e) => setFormData({ ...formData, ano_letivo_id: e.target.value })} className="ce-select">
                                        <option value="">-- Selecionar ano letivo --</option>
                                        {anosLetivos.map((ano) => {
                                            const id = ano.ano_letivo_id || ano.id;
                                            return <option key={id} value={id}>{ano.ano_nome || ano.ano || ano.nome}</option>;
                                        })}
                                    </select>
                                </div>
                            </div>

                            <div className="modal-grid-2">
                                <div className="ce-field-group">
                                    <label>Sala</label>
                                    <input type="text" value={formData.sala} onChange={(e) => setFormData({ ...formData, sala: e.target.value })} className="ce-input" placeholder="Ex: Sala 04" />
                                </div>
                                <div className="ce-field-group">
                                    <label>Lotação Máxima</label>
                                    <input type="number" min="1" value={formData.capacidade} onChange={(e) => setFormData({ ...formData, capacidade: e.target.value })} className="ce-input" />
                                </div>
                            </div>

                            {isEditMode && (
                                <>
                                    <div className="ce-field-group">
                                        <label>Diretor de Turma (Opcional)</label>
                                        <select value={diretorId} onChange={(e) => setDiretorId(e.target.value)} className="ce-select">
                                            <option value="">-- Sem Diretor de Turma atribuído --</option>
                                            {professores.map(p => <option key={p.funcionario_id} value={p.funcionario_id}>{p.nome}</option>)}
                                        </select>
                                        {!diretorId && (
                                            <small className="owner-users-list-message">
                                                ⚠️ Nota: É recomendável atribuir um Diretor de Turma para acompanhamento pedagógico.
                                            </small>
                                        )}
                                    </div>

                                    {/* Gestão rápida de professores lecionantes na edição */}
                                    <div className="ficha-info-box">
                                        <strong>Professores Lecionantes na Turma</strong>
                                        {detalhesCompletos?.disciplinas?.length > 0 ? (
                                            <div className="owner-users-table-wrap">
                                                {detalhesCompletos.disciplinas.map(d => (
                                                    <div key={d.id} className="ficha-header-badge">
                                                        <span><strong>{d.disciplina_nome}</strong>: {d.professor_nome || 'Não atribuído'}</span>
                                                        <button type="button" className="owner-users-action is-deactivate" onClick={() => handleRemoverProfessorDisciplina(d.id)}>
                                                            Retirar
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="owner-users-list-message">Nenhum professor atribuído ainda.</p>
                                        )}
                                        <div className="modal-grid-2">
                                            <div className="ce-field-group">
                                                <label htmlFor="editar-turma-disciplina">Disciplina</label>
                                                <select
                                                    id="editar-turma-disciplina"
                                                    className="ce-select"
                                                    value={formDisciplina.disciplina_id}
                                                    onChange={(e) => setFormDisciplina({ ...formDisciplina, disciplina_id: e.target.value })}
                                                >
                                                    <option value="">-- Selecionar disciplina --</option>
                                                    {disciplinasBase.map((disciplina) => (
                                                        <option key={disciplina.id} value={disciplina.id}>{disciplina.nome}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="ce-field-group">
                                                <label htmlFor="editar-turma-professor">Professor lecionante</label>
                                                <select
                                                    id="editar-turma-professor"
                                                    className="ce-select"
                                                    value={formDisciplina.professor_id}
                                                    onChange={(e) => setFormDisciplina({ ...formDisciplina, professor_id: e.target.value })}
                                                >
                                                    <option value="">-- Selecionar professor --</option>
                                                    {professores.map((professor) => (
                                                        <option key={professor.funcionario_id} value={professor.funcionario_id}>{professor.nome}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="ce-field-group">
                                                <label htmlFor="editar-turma-carga-horaria">Horas por semana</label>
                                                <input
                                                    id="editar-turma-carga-horaria"
                                                    type="number"
                                                    min="1"
                                                    className="ce-input"
                                                    value={formDisciplina.carga_horaria}
                                                    onChange={(e) => setFormDisciplina({ ...formDisciplina, carga_horaria: e.target.value })}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                className="ce-btn-submit"
                                                onClick={(event) => void handleAtribuirDisciplina(event)}
                                                disabled={salvando || !professores.length || !disciplinasBase.length}
                                            >
                                                {salvando ? 'A guardar...' : 'Atribuir professor à turma'}
                                            </button>
                                            {(!professores.length || !disciplinasBase.length) && (
                                                <p className="owner-users-list-message" role="status">
                                                    {!professores.length
                                                        ? 'Não há professores ativos disponíveis nesta escola.'
                                                        : 'Não há disciplinas ativas disponíveis para atribuição.'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="modal-footer-actions">
                                {isEditMode ? (
                                    <button type="button" onClick={() => handleApagarTurma(turmaSelecionada.id)} className="owner-users-action is-deactivate">
                                        <BsTrash size={14} /> APAGAR TURMA ⚠️
                                    </button>
                                ) : <div />}

                                <div className="owner-users-actions">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="ce-btn-back">Cancelar</button>
                                    <button type="submit" className="ce-btn-submit" disabled={salvando}>
                                        {salvando ? 'A guardar...' : (isEditMode ? 'Guardar Alterações' : 'Criar Turma')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: VER TURMA (Diretor em cima, Professores a meio, Alunos em baixo) */}
            {isDetalhesOpen && turmaSelecionada && (
                <div className="modal-admin-overlay" onClick={() => setIsDetalhesOpen(false)}>
                    <div className="modal-admin-box" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-admin-header">
                            <div>
                                <h2>Turma: {turmaSelecionada.nome} ({turmaSelecionada.classe})</h2>
                                <span>Turno: {turmaSelecionada.turno} | Sala: {turmaSelecionada.sala || 'N/D'} | Ano Letivo: {detalhesCompletos?.ano_letivo || turmaSelecionada.ano_letivo || anoLetivoSelecionado}</span>
                            </div>
                            <div className="owner-users-actions">
                                <button type="button" onClick={() => { setIsDetalhesOpen(false); abrirModalEditarDireto(turmaSelecionada); }} className="owner-users-action">
                                    <BsPencilSquare size={14} /> Editar Turma
                                </button>
                                <button type="button" className="btn-modal-close" onClick={() => setIsDetalhesOpen(false)}>✕</button>
                            </div>
                        </div>

                        <div className="modal-admin-body">
                            
                            {/* 1. DIRETOR DE TURMA EM CIMA */}
                            <div className="ficha-info-box">
                                <h4><BsPersonBadge size={16} /> Diretor de Turma (Responsável)</h4>
                                {detalhesCompletos?.diretor_turma ? (
                                    <div className="owner-users-name-cell">
                                        <div className="owner-users-photo">
                                            {detalhesCompletos.diretor_turma.professor_foto ? (
                                                <img src={detalhesCompletos.diretor_turma.professor_foto} alt="" />
                                            ) : (
                                                <span>{detalhesCompletos.diretor_turma.professor_nome?.charAt(0)}</span>
                                            )}
                                        </div>
                                        <div>
                                            <strong>{detalhesCompletos.diretor_turma.professor_nome}</strong>
                                            <small>{detalhesCompletos.diretor_turma.professor_email || 'Sem email'} | {detalhesCompletos.diretor_turma.professor_telefone || 'Sem telefone'}</small>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="owner-users-alert error" role="status">
                                        <p>Nenhum Diretor de Turma atribuído atualmente.</p>
                                    </div>
                                )}
                            </div>

                            {/* 2. PROFESSORES A MEIO */}
                            <div className="ficha-info-box">
                                <h4><BsBook size={16} /> Grade Curricular & Professores</h4>

                                {detalhesCompletos?.disciplinas?.length > 0 ? (
                                    <div className="modal-grid-2">
                                        {detalhesCompletos.disciplinas.map(d => (
                                            <div key={d.id} className="ficha-info-box">
                                                <div className="owner-users-name-cell">
                                                  <div className="owner-users-photo">
                                                    {d.professor_foto ? (
                                                        <img src={d.professor_foto} alt="" />
                                                    ) : (
                                                        <span>{d.professor_nome?.charAt(0) || '?'} </span>
                                                    )}
                                                  </div>
                                                  <div>
                                                    <strong>{d.disciplina_nome}</strong>
                                                    <small>Prof: {d.professor_nome || 'Não atribuído'}</small>
                                                  </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="owner-users-list-message">Nenhuma disciplina ou professor configurado para esta turma.</p>
                                )}

                                <form
                                    onSubmit={handleAtribuirDisciplina}
                                    className="modal-grid-2"
                                >
                                    <div className="ce-field-group">
                                        <label htmlFor="turma-disciplina">Disciplina</label>
                                        <select
                                            id="turma-disciplina"
                                            className="ce-select"
                                            value={formDisciplina.disciplina_id}
                                            onChange={(e) => setFormDisciplina({ ...formDisciplina, disciplina_id: e.target.value })}
                                            required
                                        >
                                            <option value="">-- Selecionar disciplina --</option>
                                            {disciplinasBase.map((disciplina) => (
                                                <option key={disciplina.id} value={disciplina.id}>{disciplina.nome}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="ce-field-group">
                                        <label htmlFor="turma-professor">Professor</label>
                                        <select
                                            id="turma-professor"
                                            className="ce-select"
                                            value={formDisciplina.professor_id}
                                            onChange={(e) => setFormDisciplina({ ...formDisciplina, professor_id: e.target.value })}
                                            required
                                        >
                                            <option value="">-- Selecionar professor --</option>
                                            {professores.map((professor) => (
                                                <option key={professor.funcionario_id} value={professor.funcionario_id}>{professor.nome}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="ce-field-group">
                                        <label htmlFor="turma-carga-horaria">Horas por semana</label>
                                        <input
                                            id="turma-carga-horaria"
                                            type="number"
                                            min="1"
                                            className="ce-input"
                                            value={formDisciplina.carga_horaria}
                                            onChange={(e) => setFormDisciplina({ ...formDisciplina, carga_horaria: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <button type="submit" className="ce-btn-submit" disabled={salvando}>
                                        {salvando ? 'A guardar...' : 'Atribuir disciplina'}
                                    </button>
                                </form>
                            </div>

                            {/* 3. ALUNOS EMBAIXO */}
                            <div className="ficha-info-box">
                                <h4>
                                    <BsPeople size={16} /> Alunos da turma ({detalhesCompletos?.alunos?.filter((aluno) => aluno.estado_matricula === 'ativa').length || 0} matriculados
                                    {detalhesCompletos?.alunos?.some((aluno) => aluno.estado_matricula === 'pendente')
                                        ? ` · ${detalhesCompletos.alunos.filter((aluno) => aluno.estado_matricula === 'pendente').length} pendentes`
                                        : ''})
                                </h4>

                                {detalhesCompletos?.alunos?.length > 0 ? (
                                    <div className="modal-grid-2">
                                        {detalhesCompletos.alunos.map(al => (
                                            <div key={al.id || al.aluno_id} className="ficha-info-box">
                                                <div className="owner-users-name-cell">
                                                  <div className="owner-users-photo">
                                                    {al.aluno_foto ? (
                                                        <img src={al.aluno_foto} alt="" />
                                                    ) : (
                                                        <span>{al.aluno_nome?.charAt(0)}</span>
                                                    )}
                                                  </div>
                                                  <div>
                                                    <strong>{al.numero_chamada ? `${al.numero_chamada}. ` : ''}{al.aluno_nome}</strong>
                                                    <small>{al.aluno_login}</small>
                                                    {al.estado_matricula === 'pendente' && <small>A aguardar decisão da Direção</small>}
                                                  </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="owner-users-list-message">Nenhum aluno matriculado nesta turma de momento.</p>
                                )}
                            </div>

                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}