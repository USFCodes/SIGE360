'use client';

import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import GuineaBissauPhoneInput, { formatGuineaBissauPhone } from '@/components/GuineaBissauPhoneInput';
import { BsPlusLg, BsSearch, BsPencilSquare, BsEnvelope, BsTelephone, BsCheckCircle, BsExclamationTriangle, BsGeoAlt, BsToggleOn, BsToggleOff, BsPeople, BsPersonDash } from 'react-icons/bs';
import AdminHeader from '@/components/adminHeader';
import '../../../../styles/a4.css';
import '../../../../styles/direcao-inline-usuarios.css';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_URL = `${API_BASE}/api/v1`;
const API_URL_ESCOLAS = `${API_URL}/escolas`;

const MINISTERIOS_EMISSORES = [
    "Ministério do Interior",
    "Ministério da Justiça e dos Direitos Humanos",
    "Direcção dos Serviços de Migração e Fronteiras (GMN)",
    "Outra Entidade Oficial"
];

const PAISES_CEDEAO = [
    "Guiné-Bissau", "Senegal", "Gâmbia", "Guiné-Conacri", "Mali", 
    "Costa do Marfim", "Gana", "Cabo Verde", "Serra Leoa", "Libéria", 
    "Nigéria", "Burquina Faso", "Níger", "Togo", "Benim"
];

const NIVEIS_ESTUDO = [
    "Doutoramento", "Mestrado", "Licenciatura", "Formação Profissional", 
    "12º Ano / Ensino Secundário", "Ensino Básico", "Outros"
];

const CODIGOS_POLO_LOGIN = { SEDE: 0, JARD: 1, RAM1: 2, RAM2: 3, RAM3: 4, RAML: 5, FORM: 6 };

function prefixoLoginFuncionario(papel, siglaEscola, codigoPolo) {
    const sigla = String(siglaEscola || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 2);
    if (sigla.length !== 2) return '';

    const codigo = codigoPolo || 'SEDE';
    const atribuicao = Object.prototype.hasOwnProperty.call(CODIGOS_POLO_LOGIN, codigo)
        ? CODIGOS_POLO_LOGIN[codigo]
        : codigo === 'SEDE' ? 0 : 7;
    if (papel === 'secretaria') return `${atribuicao}A1${sigla}`;
    if (papel === 'tesouraria') return `${atribuicao}A2${sigla}`;
    return `P${atribuicao}${sigla}`;
}

const fetcher = async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Erro ao comunicar com a API.");
    return data.data;
};

export default function DirecaoUsuarios() {
    const [poloSelecionado, setPoloSelecionado] = useState(null);
    const [abaAtiva, setAbaAtiva] = useState("secretaria");
    const [searchFuncionario, setSearchFuncionario] = useState("");
    const [searchPolo, setSearchPolo] = useState("");
    const [modalStep, setModalStep] = useState(1);
    
    const [salvando, setSalvando] = useState(false);
    const [fotoCarregando, setFotoCarregando] = useState(false);
    const [erroDetalhe, setErroDetalhe] = useState("");
    const [mensagem, setMensagem] = useState({ texto: "", tipo: "" });

    useEffect(() => {
        if (mensagem.texto) {
            const timer = setTimeout(() => setMensagem({ texto: "", tipo: "" }), 7000);
            return () => clearTimeout(timer);
        }
    }, [mensagem]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [currentUserId, setCurrentUserId] = useState(null);
    
    const [formData, setFormData] = useState({
        nome: "", email: "", telefone: "", papel: "secretaria", polo_id: "", 
        genero: "Masculino", morada: "", bairro: "", regiao: "Bissau", 
        bi_ou_passaporte: "", nif_pessoal: "", data_nascimento: "", data_admissao: "",
        data_validade_bi: "", entidade_emissao_bi: MINISTERIOS_EMISSORES[0],
        nacionalidade: "Guiné-Bissau", estado_civil: "Solteiro(a)", numero_filhos: 0,
        iban: "", nivel_estudo: "Licenciatura", area_estudo: "", cargo: "", observacoes: "",
        escola_estudio_prof: "", anos_experiencia_prof: "", campo_estudo_prof: "", nota_final_prof: "",
        foto_url: ""
    });

    const [isPoloModalOpen, setIsPoloModalOpen] = useState(false);
    const [formPolo, setFormPolo] = useState({ nome: "", codigo: "", endereco: "", local: "", telefone: "", ativo: true });

    // SWR Hooks
    const { data: authData, isLoading: loadingAuth } = useSWR(`${API_URL}/auth/me`, fetcher, { revalidateOnFocus: false });
    const contaAtiva = authData?.conta_ativa;
    const escolaIdLogada = contaAtiva?.escola_id || null;
    const escolaAtual = escolaIdLogada ? { id: escolaIdLogada, nome: contaAtiva.escola_nome, sigla: contaAtiva.escola_sigla } : null;

    const { data: polos = [], isLoading: loadingPolos, mutate: mutatePolos } = useSWR(
        escolaIdLogada ? `${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaIdLogada)}/polos` : null,
        fetcher
    );

    const { data: funcionarios = [], isLoading: loadingFuncionarios, isValidating: validatingFuncionarios, mutate: mutateFuncionarios } = useSWR(
        escolaIdLogada ? `${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaIdLogada)}/funcionarios` : null,
        fetcher
    );

    const handleRefreshGeral = async () => {
        await Promise.all([mutatePolos(), mutateFuncionarios()]);
    };

    const handleCriarPolo = async (e) => {
        e.preventDefault();
        setErroDetalhe("");
        if (!escolaIdLogada) return;
        try {
            setSalvando(true);
            const res = await fetch(`${API_URL_ESCOLAS}/escolas/${encodeURIComponent(escolaIdLogada)}/polos`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ ...formPolo, nome: formPolo.nome.trim(), codigo: formPolo.codigo.trim().toUpperCase() })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || "Erro ao criar polo.");
            
            setIsPoloModalOpen(false);
            setFormPolo({ nome: "", codigo: "", endereco: "", local: "", telefone: "", ativo: true });
            setMensagem({ texto: "Polo criado com sucesso.", tipo: "sucesso" });
            mutatePolos();
        } catch (err) {
            setErroDetalhe(err.message);
            setMensagem({ texto: err.message, tipo: "erro" });
        } finally {
            setSalvando(false);
        }
    };

    const abrirModalCriar = () => {
        setEditMode(false);
        setCurrentUserId(null);
        setModalStep(1);
        setFormData({
            nome: "", email: "", telefone: "", papel: abaAtiva, polo_id: poloSelecionado || "", 
            genero: "Masculino", morada: "", bairro: "", regiao: "Bissau", bi_ou_passaporte: "", 
            nif_pessoal: "", data_nascimento: "", data_admissao: "", data_validade_bi: "", 
            entidade_emissao_bi: MINISTERIOS_EMISSORES[0], nacionalidade: "Guiné-Bissau", 
            estado_civil: "Solteiro(a)", numero_filhos: 0, iban: "", nivel_estudo: "Licenciatura", 
            area_estudo: "", cargo: "", observacoes: "", escola_estudio_prof: "", anos_experiencia_prof: "", 
            campo_estudo_prof: "", nota_final_prof: "", foto_url: ""
        });
        setIsModalOpen(true);
        setErroDetalhe("");
    };

    const abrirModalEditar = async (user) => {
        setEditMode(true);
        setCurrentUserId(user.id);
        setModalStep(1);
        setErroDetalhe("");
        try {
            const res = await fetch(`${API_URL_ESCOLAS}/funcionarios/${encodeURIComponent(user.id)}`, { credentials: 'include' });
            const data = await res.json();
            if (!res.ok || !data.success || !data.data) throw new Error(data.message || "Erro ao carregar dados.");
            const d = data.data;
            
            const telLimpo = formatGuineaBissauPhone(d.telefone);

            setFormData({
                nome: d.nome || "", email: d.email || "", telefone: telLimpo, papel: d.papel || abaAtiva,
                polo_id: d.polo_id || "", genero: d.genero || "Masculino", morada: d.morada || "",
                bairro: d.bairro || "", regiao: d.regiao || "Bissau", bi_ou_passaporte: d.bi_ou_passaporte || "",
                nif_pessoal: d.nif_pessoal || "", data_nascimento: d.data_nascimento ? d.data_nascimento.split('T')[0] : "",
                data_admissao: d.data_admissao ? d.data_admissao.split('T')[0] : "",
                data_validade_bi: d.data_validade_bi ? d.data_validade_bi.split('T')[0] : "",
                entidade_emissao_bi: d.entidade_emissao_bi || MINISTERIOS_EMISSORES[0],
                nacionalidade: d.nacionalidade || "Guiné-Bissau", estado_civil: d.estado_civil || "Solteiro(a)",
                numero_filhos: d.numero_filhos ?? 0, iban: d.iban || "", nivel_estudo: d.nivel_estudo || "Licenciatura",
                area_estudo: d.area_estudo || "", cargo: d.cargo || "", observacoes: d.observacoes || "",
                escola_estudio_prof: d.escola_estudio_prof || "", anos_experiencia_prof: d.anos_experiencia_prof ?? "",
                campo_estudo_prof: d.campo_estudo_prof || "", nota_final_prof: d.nota_final_prof || "",
                foto_url: d.foto_url || ""
            });
            setIsModalOpen(true);
        } catch (err) {
            setMensagem({ texto: err.message, tipo: "erro" });
        }
    };

    const handleFotoChange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            setErroDetalhe("A fotografia original deve ter no máximo 10 MB.");
            return;
        }

        try {
            setErroDetalhe("");
            setFotoCarregando(true);
            const formDataFoto = new FormData();
            formDataFoto.append("foto", file);
            const res = await fetch(`${API_URL_ESCOLAS}/funcionarios/foto`, {
                method: "POST",
                credentials: "include",
                body: formDataFoto
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Não foi possível processar a fotografia.");
            }

            setFormData((prev) => ({ ...prev, foto_url: data.data.foto_url }));
        } catch (err) {
            setErroDetalhe(err.message || "Não foi possível processar a fotografia.");
        } finally {
            setFotoCarregando(false);
        }
    };

    const handleSalvarRegisto = async (e) => {
        e.preventDefault();
        if (salvando || (!editMode && modalStep !== 3)) return;
        if (!escolaIdLogada || !escolaAtual?.sigla) return;
        try {
            setErroDetalhe("");
            setSalvando(true);

            const telefoneFormatado = formatGuineaBissauPhone(formData.telefone);
            const payload = {
                escola_id: escolaIdLogada,
                sigla_escola: escolaAtual.sigla,
                ...formData,
                telefone: telefoneFormatado,
                numero_filhos: formData.numero_filhos !== "" ? parseInt(formData.numero_filhos, 10) : 0,
                anos_experiencia_prof: formData.anos_experiencia_prof !== "" ? parseInt(formData.anos_experiencia_prof, 10) : null
            };

            let endpoint = `${API_URL_ESCOLAS}/funcionarios`;
            let method = editMode ? "PUT" : "POST";
            if (editMode) endpoint = `${API_URL_ESCOLAS}/funcionarios/${currentUserId}`;

            const res = await fetch(endpoint, {
                method, headers: { "Content-Type": "application/json" },
                credentials: 'include', body: JSON.stringify(payload),
            });
            const data = await res.json();

            if (res.ok && data.success) {
                setMensagem({
                    texto: editMode ? "Funcionário atualizado com sucesso!" : `Criado com sucesso! Login: ${data.data?.login_id}`,
                    tipo: "sucesso"
                });
                setIsModalOpen(false);
                mutateFuncionarios();
            } else {
                throw new Error(data.message || "Erro desconhecido ao guardar dados.");
            }
        } catch (err) {
            setErroDetalhe(err.message);
        } finally {
            setSalvando(false);
        }
    };

    const handleToggleStatus = async (userId, statusAtual) => {
        try {
            const res = await fetch(`${API_URL_ESCOLAS}/funcionarios/${userId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ status_ativo: !statusAtual })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || "Erro ao alterar estado.");
            
            setMensagem({ texto: data.message, tipo: "sucesso" });
            mutateFuncionarios();
        } catch (err) {
            setMensagem({ texto: err.message, tipo: "erro" });
        }
    };

    const funcionariosFiltrados = funcionarios.filter((u) => {
        const matchPapel = (u.papel || '').toLowerCase() === abaAtiva.toLowerCase();
        const matchPolo = poloSelecionado === null ? true : (u.polo_id === poloSelecionado || u.polo_id === null);
        const matchSearch = (u.nome || '').toLowerCase().includes(searchFuncionario.toLowerCase()) || 
                            (u.email || '').toLowerCase().includes(searchFuncionario.toLowerCase()) || 
                            (u.login_id || '').toLowerCase().includes(searchFuncionario.toLowerCase());
        return matchPapel && matchPolo && matchSearch;
    });

    const polosFiltrados = polos.filter(p => (p.nome || '').toLowerCase().includes(searchPolo.toLowerCase()));
    const funcionariosDoPolo = funcionarios.filter((funcionario) => (
        poloSelecionado === null || funcionario.polo_id === poloSelecionado || funcionario.polo_id === null
    ));
    const totalAtivosDoPolo = funcionariosDoPolo.filter((funcionario) => funcionario.status_ativo).length;
    const poloDoFormulario = polos.find((polo) => polo.id === formData.polo_id);
    const prefixoLoginPrevisto = prefixoLoginFuncionario(
        formData.papel,
        escolaAtual?.sigla,
        poloDoFormulario?.codigo
    );

    if (loadingAuth || (!escolaAtual && loadingAuth)) {
        return (
            <div className="owner-users-loading" role="status">
                <p>A carregar painel institucional...</p>
            </div>
        );
    }

    return (
        <div className="owner-users-page direcao-usuarios-page">
            <AdminHeader titulo='Gestão Institucional de Pessoal' descricao={`Gestão de Pessoal da ${escolaAtual?.sigla || ''} - ${escolaAtual?.nome || ''}`} modalBtn={abrirModalCriar} modalBtnText="Novo funcionário" escolaIdLogada={escolaIdLogada} onRefresh={handleRefreshGeral} loading={validatingFuncionarios || loadingPolos} />

            {mensagem.texto && (
                <div className={`owner-users-alert ${mensagem.tipo === 'sucesso' ? 'success' : 'error'}`} role="alert">
                    {mensagem.tipo === 'sucesso' ? <BsCheckCircle size={18} /> : <BsExclamationTriangle size={18} />}
                    <span>{mensagem.texto}</span>
                    <button type="button" className="owner-users-alert-close" onClick={() => setMensagem({ texto: "", tipo: "" })} aria-label="Fechar mensagem">×</button>
                </div>
            )}

            <div className="owner-layout direcao-users-layout">
                <aside className="owner-users-sidebar">
                    <div className="owner-users-sidebar-heading">
                        <div>
                            <span className="owner-users-eyebrow">Organização</span>
                            <h2>Polos da escola</h2>
                        </div>
                        <span className="owner-users-school-count">{polos.length}</span>
                    </div>
                    <Link href='/dashboard/direcao/configuracao#polo' className="owner-users-empty-action direcao-add-branch">
                        <BsPlusLg /> Novo polo
                    </Link>
                    <label className="owner-users-search">
                        <BsSearch aria-hidden="true" />
                        <input
                            type="search"
                            placeholder="Pesquisar polo..."
                            value={searchPolo}
                            onChange={(e) => setSearchPolo(e.target.value)}
                            aria-label="Pesquisar polos"
                        />
                    </label>
                    <div className="owner-users-school-list">
                        <button
                            type="button"
                            onClick={() => setPoloSelecionado(null)}
                            className={`owner-users-school-item ${poloSelecionado === null ? 'selected' : ''}`}
                            aria-pressed={poloSelecionado === null}
                        >
                            <span className="owner-users-school-badge"><BsPeople /></span>
                            <span className="owner-users-school-info">
                                <strong>Todos os polos</strong>
                                <span>Visão geral da escola</span>
                            </span>
                            <span className="owner-users-school-arrow" aria-hidden="true">›</span>
                        </button>
                        {loadingPolos ? (
                            <p className="owner-users-list-message" role="status">A carregar polos...</p>
                        ) : polosFiltrados.length > 0 ? (
                            polosFiltrados.map((polo) => (
                                <button
                                    type="button"
                                    key={polo.id}
                                    onClick={() => setPoloSelecionado(polo.id)}
                                    className={`owner-users-school-item ${poloSelecionado === polo.id ? 'selected' : ''}`}
                                    aria-pressed={poloSelecionado === polo.id}
                                >
                                    <span className="owner-users-school-badge">{polo.codigo || 'POLO'}</span>
                                    <span className="owner-users-school-info">
                                        <strong>{polo.nome}</strong>
                                        <span><BsGeoAlt aria-hidden="true" /> {polo.local || 'Sede'}</span>
                                    </span>
                                    <span className="owner-users-school-arrow" aria-hidden="true">›</span>
                                </button>
                            ))
                        ) : (
                            <p className="owner-users-list-message">
                                {polos.length ? 'Nenhum polo corresponde à pesquisa.' : 'Nenhum polo registado.'}
                            </p>
                        )}
                    </div>
                </aside>

                <main className="owner-users-panel">
                    <header className="owner-users-panel-header">
                        <div className="owner-users-title-group">
                            <span className="owner-users-eyebrow">Equipa da escola</span>
                            <h2>{escolaAtual?.sigla} <span aria-hidden="true">/</span> {escolaAtual?.nome}</h2>
                            <p>
                                {funcionariosDoPolo.length} colaborador{funcionariosDoPolo.length === 1 ? '' : 'es'} · {totalAtivosDoPolo} acesso{totalAtivosDoPolo === 1 ? '' : 's'} ativo{totalAtivosDoPolo === 1 ? '' : 's'}
                                {poloSelecionado !== null && ` · ${polos.find((polo) => polo.id === poloSelecionado)?.nome || 'Polo selecionado'}`}
                            </p>
                        </div>
                        <div className="owner-users-tools">
                            <label className="owner-users-search owner-users-staff-search">
                                <BsSearch aria-hidden="true" />
                                <input
                                    type="search"
                                    placeholder="Pesquisar nome, email ou login..."
                                    value={searchFuncionario}
                                    onChange={(e) => setSearchFuncionario(e.target.value)}
                                    aria-label="Pesquisar funcionários"
                                />
                            </label>
                            <div className="owner-users-tabs" role="tablist" aria-label="Filtrar por função">
                                {[
                                    ['secretaria', 'Secretaria'],
                                    ['professor', 'Professores'],
                                    ['tesouraria', 'Tesouraria']
                                ].map(([papel, titulo]) => (
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={abaAtiva === papel}
                                        key={papel}
                                        onClick={() => setAbaAtiva(papel)}
                                        className={abaAtiva === papel ? 'active' : ''}
                                    >
                                        {titulo}
                                        <span>{funcionariosDoPolo.filter((user) => (user.papel || '').toLowerCase() === papel).length}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </header>

                    {loadingFuncionarios ? (
                        <div className="owner-users-empty-state" role="status">
                            <span className="owner-users-empty-icon"><BsPeople /></span>
                            <strong>A carregar a equipa</strong>
                            <span>Estamos a obter os funcionários desta escola.</span>
                        </div>
                    ) : funcionariosFiltrados.length > 0 ? (
                        <div className="owner-users-table-wrap">
                            <table className="owner-users-table">
                                <thead>
                                    <tr>
                                        <th>Nome completo</th>
                                        <th>Cargo / Polo</th>
                                        <th>Contactos</th>
                                        <th>Login ID</th>
                                        <th>Estado</th>
                                        <th>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {funcionariosFiltrados.map((user) => (
                                        <tr key={user.id}>
                                            <td className="owner-users-name-cell">
                                                <span className="owner-users-avatar owner-users-photo">
                                                    {user.foto_url ? (
                                                        <img src={user.foto_url} alt="" />
                                                    ) : (
                                                        <span>{user.nome?.charAt(0) || '?'}</span>
                                                    )}
                                                </span>
                                                <span>{user.nome}</span>
                                            </td>
                                            <td>
                                                <span className="owner-users-role">{user.papel}</span>
                                                <span className="owner-users-polo">{user.polo_nome || 'Central / Geral'}</span>
                                            </td>
                                            <td className="owner-users-contact-cell">
                                                <span><BsEnvelope /> {user.email || 'Sem email'}</span>
                                                <span><BsTelephone /> {user.telefone ? formatGuineaBissauPhone(user.telefone) : 'N/D'}</span>
                                            </td>
                                            <td><code className="owner-users-login">{user.login_id || 'N/D'}</code></td>
                                            <td><span className={`owner-users-status ${user.status_ativo ? 'active' : 'inactive'}`}>{user.status_ativo ? 'Ativo' : 'Inativo'}</span></td>
                                            <td>
                                                <div className="owner-users-actions">
                                                    <button type="button" className="owner-users-action" onClick={() => abrirModalEditar(user)} title="Editar funcionário">
                                                        <BsPencilSquare /> <span>Editar</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`owner-users-action ${user.status_ativo ? 'is-deactivate' : 'is-activate'}`}
                                                        onClick={() => handleToggleStatus(user.id, user.status_ativo)}
                                                        title={user.status_ativo ? "Desativar conta" : "Ativar conta"}
                                                        aria-label={user.status_ativo ? `Desativar conta de ${user.nome}` : `Ativar conta de ${user.nome}`}
                                                    >
                                                        {user.status_ativo ? <BsToggleOff /> : <BsToggleOn />}
                                                        <span>{user.status_ativo ? 'Desativar' : 'Ativar'}</span>
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
                            <span className="owner-users-empty-icon"><BsPersonDash /></span>
                            <strong>Nenhum funcionário encontrado</strong>
                            <span>Experimente mudar o polo ou a pesquisa, ou adicione alguém a esta equipa.</span>
                            <button type="button" className="owner-users-empty-action" onClick={abrirModalCriar}>Adicionar funcionário</button>
                        </div>
                    )}
                </main>
            </div>

            {/* MODAL CRIAR POLO */}
            {isPoloModalOpen && (
                <div className="modal-admin-overlay" onClick={() => setIsPoloModalOpen(false)}>
                    <div className="direcao-usuarios-dd5527d0a modal-admin-box" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-admin-header">
                            <h2>Criar Novo Polo</h2>
                            <button type="button" className="btn-modal-close" onClick={() => setIsPoloModalOpen(false)}>✕</button>
                        </div>
                        <form onSubmit={handleCriarPolo} className="direcao-usuarios-c8d0b9e50 modal-admin-body">
                            {erroDetalhe && <div role="alert" className="direcao-usuarios-71e717dcf" style={{ color: '#dc2626', background: '#fef2f2', padding: '10px', borderRadius: '6px', marginBottom: '10px' }}>{erroDetalhe}</div>}
                            <div className="ce-field-group"><label>Nome do Polo *</label><input type="text" required value={formPolo.nome} onChange={(e) => setFormPolo({ ...formPolo, nome: e.target.value })} className="ce-input" /></div>
                            <div className="ce-field-group"><label>Código do Polo *</label><input type="text" required value={formPolo.codigo} onChange={(e) => setFormPolo({ ...formPolo, codigo: e.target.value.toUpperCase() })} className="ce-input" /></div>
                            <div className="direcao-usuarios-7e6272e5c">
                                <button type="button" onClick={() => setIsPoloModalOpen(false)} className="ce-btn-back">Cancelar</button>
                                <button type="submit" className="ce-btn-submit" disabled={salvando}>{salvando ? "A criar..." : "Criar Polo"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL DE CRIAÇÃO / EDIÇÃO DE FUNCIONÁRIO */}
            {isModalOpen && (
                <div className="modal-admin-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="direcao-usuarios-1b49fc0d1 modal-admin-box" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-admin-header">
                            <h2>{editMode ? "Editar Ficha do Funcionário" : "Registar Novo Colaborador (Ficha Institucional)"}</h2>
                            <button type="button" className="btn-modal-close" onClick={() => setIsModalOpen(false)}>✕</button>
                        </div>

                        <form onSubmit={handleSalvarRegisto} className="direcao-usuarios-0228182dc modal-admin-body">
                            
                            {erroDetalhe && (
                                <div role="alert" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '12px', borderRadius: '6px', marginBottom: '15px', fontWeight: 500, fontSize: '13px' }}>
                                    ⚠️ <strong>Erro:</strong> {erroDetalhe}
                                </div>
                            )}

                            {!editMode && (
                                <div className="ficha-steps-header" aria-label="Etapas do registo">
                                    <div className={`ficha-step-item ${modalStep === 1 ? 'active' : modalStep > 1 ? 'completed' : ''}`} aria-current={modalStep === 1 ? 'step' : undefined}>
                                        <span className="ficha-step-number">1</span>
                                        <span className="ficha-step-copy"><strong>Dados pessoais</strong><small>Identificação e contacto</small></span>
                                    </div>
                                    <div className={`ficha-step-item ${modalStep === 2 ? 'active' : modalStep > 2 ? 'completed' : ''}`} aria-current={modalStep === 2 ? 'step' : undefined}>
                                        <span className="ficha-step-number">2</span>
                                        <span className="ficha-step-copy"><strong>Documentação</strong><small>Dados civis e morada</small></span>
                                    </div>
                                    <div className={`ficha-step-item ${modalStep === 3 ? 'active' : ''}`} aria-current={modalStep === 3 ? 'step' : undefined}>
                                        <span className="ficha-step-number">3</span>
                                        <span className="ficha-step-copy"><strong>Cargo e acesso</strong><small>Polo, função e habilitações</small></span>
                                    </div>
                                </div>
                            )}

                            <div className="ficha-wizard-container">

                                {/* FASE 1 */}
                                {(editMode || modalStep === 1) && (
                                    <div className="ficha-section">
                                        <h3 className="ficha-section-title">Fotografia e identificação principal</h3>
                                        
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', background: '#f8fafc', border: '1px dashed #cbd5e1', padding: '15px', borderRadius: '10px', marginBottom: '16px' }}>
                                            <div style={{ width: '80px', height: '100px', borderRadius: '6px', background: '#e2e8f0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #cbd5e1', flexShrink: 0 }}>
                                                {formData.foto_url ? (
                                                    <img src={formData.foto_url} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <span style={{ fontSize: '10px', color: '#64748b', textAlign: 'center', padding: '4px' }}>Foto Passe</span>
                                                )}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px', color: '#334155' }}>
                                                    Fotografia do Funcionário (Tipo Passe)
                                                </label>
                                                <input type="file" accept="image/png, image/jpeg, image/webp" onChange={handleFotoChange} disabled={fotoCarregando} style={{ fontSize: '12px' }} />
                                                <small style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: '#64748b' }}>
                                                    {fotoCarregando ? "A comprimir fotografia..." : "A fotografia será reduzida para no máximo 100 KB (original até 10 MB)."}
                                                </small>
                                            </div>
                                        </div>

                                        <div className="ce-field-group">
                                            <label>Nome Completo *</label>
                                            <input type="text" required value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} className="ce-input" placeholder="Ex: Carlos Alberto Mendes" />
                                        </div>

                                        <div className="ce-grid-2">
                                            <div className="ce-field-group">
                                                <label>Email Institucional</label>
                                                <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="ce-input" placeholder="carlos@escola.gw" />
                                            </div>
                                            <div className="ce-field-group">
                                                <label>Contacto Telefónico (+245) *</label>
                                                <GuineaBissauPhoneInput required value={formData.telefone} onChange={(value) => setFormData((current) => ({ ...current, telefone: value }))} className="ce-input" placeholder="+245 95XXXXXX" />
                                            </div>
                                        </div>

                                        <div className="ce-grid-3">
                                            <div className="ce-field-group"><label>Data de Nascimento</label><input type="date" value={formData.data_nascimento} onChange={(e) => setFormData({ ...formData, data_nascimento: e.target.value })} className="ce-input" /></div>
                                            <div className="ce-field-group"><label>Género</label><select value={formData.genero} onChange={(e) => setFormData({ ...formData, genero: e.target.value })} className="ce-select"><option value="Masculino">Masculino</option><option value="Feminino">Feminino</option></select></div>
                                            <div className="ce-field-group"><label>Estado Civil</label><select value={formData.estado_civil} onChange={(e) => setFormData({ ...formData, estado_civil: e.target.value })} className="ce-select"><option value="Solteiro(a)">Solteiro(a)</option><option value="Casado(a)">Casado(a)</option><option value="Divorciado(a)">Divorciado(a)</option></select></div>
                                        </div>
                                    </div>
                                )}

                                {/* FASE 2 */}
                                {(editMode || modalStep === 2) && (
                                    <div className="ficha-section">
                                        <h3 className="ficha-section-title">Documentação civil e residência</h3>

                                        <div className="ce-grid-3">
                                            <div className="ce-field-group"><label>Nº BI / Passaporte</label><input type="text" value={formData.bi_ou_passaporte} onChange={(e) => setFormData({ ...formData, bi_ou_passaporte: e.target.value })} className="ce-input" /></div>
                                            <div className="ce-field-group"><label>Validade do BI</label><input type="date" value={formData.data_validade_bi} onChange={(e) => setFormData({ ...formData, data_validade_bi: e.target.value })} className="ce-input" /></div>
                                            <div className="ce-field-group">
                                                <label>Entidade Emissora</label>
                                                <select value={formData.entidade_emissao_bi} onChange={(e) => setFormData({ ...formData, entidade_emissao_bi: e.target.value })} className="ce-select">
                                                    {MINISTERIOS_EMISSORES.map(m => <option key={m} value={m}>{m}</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        <div className="ce-grid-3">
                                            <div className="ce-field-group">
                                                <label>Nacionalidade</label>
                                                <select value={formData.nacionalidade} onChange={(e) => setFormData({ ...formData, nacionalidade: e.target.value })} className="ce-select">
                                                    {PAISES_CEDEAO.map(p => <option key={p} value={p}>{p}</option>)}
                                                </select>
                                            </div>
                                            <div className="ce-field-group"><label>NIF Pessoal</label><input type="text" value={formData.nif_pessoal} onChange={(e) => setFormData({ ...formData, nif_pessoal: e.target.value })} className="ce-input" /></div>
                                            <div className="ce-field-group"><label>Nº de Filhos</label><input type="number" min="0" value={formData.numero_filhos} onChange={(e) => setFormData({ ...formData, numero_filhos: e.target.value })} className="ce-input" /></div>
                                        </div>

                                        <div className="ce-grid-3">
                                            <div className="ce-field-group"><label>Bairro</label><input type="text" value={formData.bairro} onChange={(e) => setFormData({ ...formData, bairro: e.target.value })} className="ce-input" /></div>
                                            <div className="ce-field-group"><label>Região / Sector</label><input type="text" value={formData.regiao} onChange={(e) => setFormData({ ...formData, regiao: e.target.value })} className="ce-input" /></div>
                                            <div className="ce-field-group"><label>Morada Completa</label><input type="text" value={formData.morada} onChange={(e) => setFormData({ ...formData, morada: e.target.value })} className="ce-input" /></div>
                                        </div>
                                    </div>
                                )}

                                {/* FASE 3 */}
                                {(editMode || modalStep === 3) && (
                                    <div className="ficha-section">
                                        <h3 className="ficha-section-title">Atribuição institucional e habilitações</h3>

                                        <div className="ce-grid-3">
                                            <div className="ce-field-group">
                                                <label>Cargo / Papel *</label>
                                                <select value={formData.papel} onChange={(e) => setFormData({ ...formData, papel: e.target.value })} className="ce-select">
                                                    <option value="secretaria">Secretaria</option>
                                                    <option value="professor">Professor</option>
                                                    <option value="tesouraria">Tesouraria</option>
                                                </select>
                                            </div>
                                            <div className="ce-field-group">
                                                <label>Atribuição de Polo</label>
                                                <select value={formData.polo_id} onChange={(e) => setFormData({ ...formData, polo_id: e.target.value })} className="ce-select">
                                                    <option value="">⭐ Central / Geral</option>
                                                    {polos.map((p) => (<option key={p.id} value={p.id}>{p.nome} ({p.codigo})</option>))}
                                                </select>
                                            </div>
                                            <div className="ce-field-group"><label>Data de Admissão</label><input type="date" value={formData.data_admissao} onChange={(e) => setFormData({ ...formData, data_admissao: e.target.value })} className="ce-input" /></div>
                                        </div>
                                        <div className="ce-grid-3">
                                            <div className="ce-field-group">
                                                <label>Nível de Estudo</label>
                                                <select value={formData.nivel_estudo} onChange={(e) => setFormData({ ...formData, nivel_estudo: e.target.value })} className="ce-select">
                                                    {NIVEIS_ESTUDO.map(n => <option key={n} value={n}>{n}</option>)}
                                                </select>
                                            </div>
                                            <div className="ce-field-group"><label>Área de Estudo</label><input type="text" value={formData.area_estudo} onChange={(e) => setFormData({ ...formData, area_estudo: e.target.value })} className="ce-input" /></div>
                                            <div className="ce-field-group"><label>IBAN Bancário</label><input type="text" value={formData.iban} onChange={(e) => setFormData({ ...formData, iban: e.target.value })} className="ce-input" placeholder="GW26 ..." /></div>
                                        </div>

                                        {formData.papel === 'professor' && (
                                            <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '15px' }}>
                                                <h4 style={{ marginBottom: '10px', fontSize: '14px', color: '#0284c7' }}>Detalhes Pedagógicos</h4>
                                                <div className="ce-grid-2">
                                                    <div className="ce-field-group"><label>Escola de Formação</label><input type="text" value={formData.escola_estudio_prof} onChange={(e) => setFormData({ ...formData, escola_estudio_prof: e.target.value })} className="ce-input" /></div>
                                                    <div className="ce-field-group"><label>Anos de Experiência</label><input type="number" min="0" value={formData.anos_experiencia_prof} onChange={(e) => setFormData({ ...formData, anos_experiencia_prof: e.target.value })} className="ce-input" /></div>
                                                </div>
                                                <div className="ce-grid-2" style={{ marginTop: '10px' }}>
                                                    <div className="ce-field-group"><label>Disciplina / Campo</label><input type="text" value={formData.campo_estudo_prof} onChange={(e) => setFormData({ ...formData, campo_estudo_prof: e.target.value })} className="ce-input" /></div>
                                                    <div className="ce-field-group"><label>Nota Final</label><input type="text" value={formData.nota_final_prof} onChange={(e) => setFormData({ ...formData, nota_final_prof: e.target.value })} className="ce-input" /></div>
                                                </div>
                                            </div>
                                        )}

                                        <div className="ce-field-group" style={{ marginTop: '15px' }}>
                                            <label>Observações Adicionais</label>
                                            <textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="ce-input" rows={2} />
                                        </div>
                                    </div>
                                )}

                            </div>

                            {/* BOTÕES DE NAVEGAÇÃO ENTRE FASES (Com type="button" explícito para evitar submissões acidentais) */}
                            <div className="ficha-footer-actions">
                                {editMode ? (
                                    <>
                                        <button type="button" onClick={() => setIsModalOpen(false)} className="ce-btn-back">Cancelar</button>
                                        <button type="submit" className="ce-btn-submit" disabled={salvando || fotoCarregando}>{fotoCarregando ? "A comprimir fotografia..." : salvando ? "A guardar..." : "Guardar Alterações"}</button>
                                    </>
                                ) : (
                                    <>
                                        {modalStep > 1 ? (
                                            <button type="button" onClick={() => setModalStep(s => s - 1)} className="ce-btn-back">Anterior</button>
                                        ) : <div />}

                                        {modalStep < 3 ? (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    if (modalStep === 1 && !e.currentTarget.form?.reportValidity()) return;
                                                    setModalStep((step) => step + 1);
                                                }}
                                                className="ce-btn-submit"
                                            >
                                                Seguinte
                                            </button>
                                        ) : (
                                            <button type="submit" className="ce-btn-submit" disabled={salvando || fotoCarregando}>{fotoCarregando ? "A comprimir fotografia..." : salvando ? "A criar registo..." : "Concluir e Gerar Acesso"}</button>
                                        )}
                                    </>
                                )}
                            </div>

                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}