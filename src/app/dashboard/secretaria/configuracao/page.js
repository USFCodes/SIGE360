'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    BsArrowClockwise, BsBuilding, BsCalendar3, BsCalendarCheck, BsGeoAltFill,
    BsGear, BsShieldCheck, BsShieldLock, BsSliders, BsPersonCircle,
    BsCheckCircleFill, BsExclamationTriangleFill, BsSearch
} from 'react-icons/bs';
import '../../../../styles/a7.css';
import '../../../../styles/secretaria-configuracoes.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${API_BASE}/api/v1`;

async function lerRespostaApi(response) {
    const texto = await response.text();
    let data;
    try {
        data = texto ? JSON.parse(texto) : {};
    } catch {
        throw new Error(`A API respondeu num formato inválido (HTTP ${response.status}).`);
    }
    if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Não foi possível concluir o pedido (HTTP ${response.status}).`);
    }
    return data;
}

function formatarData(data) {
    if (!data) return 'Não definida';
    const [ano, mes, dia] = String(data).slice(0, 10).split('-');
    return ano && mes && dia ? `${dia}/${mes}/${ano}` : String(data);
}

function CampoSenha({ label, value, onChange, autoComplete }) {
    return (
        <label className="sec-cfg-form-group">
            <span>{label}</span>
            <input
                type="password"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                autoComplete={autoComplete}
                minLength={6}
                maxLength={128}
                required
            />
        </label>
    );
}

const SECOES_CONFIGURACAO = [
    { id: 'geral', title: 'Dados gerais', description: 'Identidade institucional', icon: BsBuilding },
    { id: 'anos', title: 'Anos letivos', description: 'Calendário e matrículas', icon: BsCalendar3 },
    { id: 'polos', title: 'Polos', description: 'Unidades escolares', icon: BsGeoAltFill },
    { id: 'avaliacao', title: 'Avaliação', description: 'Períodos e notas', icon: BsSliders },
    { id: 'seguranca', title: 'Segurança', description: 'Palavras-passe', icon: BsShieldLock }
];

export default function SecretariaConfiguracoes() {
    const [activeSection, setActiveSection] = useState('geral');
    const [escolaId, setEscolaId] = useState('');
    const [dadosEscola, setDadosEscola] = useState(null);
    const [anosEscola, setAnosEscola] = useState([]);
    const [polos, setPolos] = useState([]);
    const [parametros, setParametros] = useState(null);
    const [loading, setLoading] = useState(true);
    const [erroCarregamento, setErroCarregamento] = useState('');
    const [mensagem, setMensagem] = useState({ texto: '', tipo: '' });
    const [salvandoSenha, setSalvandoSenha] = useState(false);
    const [senhaAtual, setSenhaAtual] = useState('');
    const [novaSenha, setNovaSenha] = useState('');
    const [confirmarNovaSenha, setConfirmarNovaSenha] = useState('');
    const [pesquisaAluno, setPesquisaAluno] = useState('');
    const [alunosEncontrados, setAlunosEncontrados] = useState([]);
    const [alunoSelecionadoId, setAlunoSelecionadoId] = useState('');
    const [buscandoAlunos, setBuscandoAlunos] = useState(false);
    const [novaSenhaAluno, setNovaSenhaAluno] = useState('');
    const [confirmarSenhaAluno, setConfirmarSenhaAluno] = useState('');
    const [salvandoSenhaAluno, setSalvandoSenhaAluno] = useState(false);
    const [pesquisaEncarregado, setPesquisaEncarregado] = useState('');
    const [encarregadosEncontrados, setEncarregadosEncontrados] = useState([]);
    const [encarregadoSelecionadoId, setEncarregadoSelecionadoId] = useState('');
    const [buscandoEncarregados, setBuscandoEncarregados] = useState(false);
    const [novaSenhaEncarregado, setNovaSenhaEncarregado] = useState('');
    const [confirmarSenhaEncarregado, setConfirmarSenhaEncarregado] = useState('');
    const [salvandoSenhaEncarregado, setSalvandoSenhaEncarregado] = useState(false);

    const carregarConfiguracoes = useCallback(async () => {
        setLoading(true);
        setErroCarregamento('');
        try {
            const sessao = await lerRespostaApi(await fetch(`${API_URL}/auth/me`, {
                credentials: 'include',
                cache: 'no-store'
            }));
            const idEscola = sessao.data?.conta_ativa?.escola_id;
            if (!idEscola) throw new Error('Não foi encontrada uma escola ativa para esta conta.');

            const [resEscola, resAnos, resPolos, resParametros] = await Promise.all([
                fetch(`${API_URL}/owner/escolas/${encodeURIComponent(idEscola)}/completa`, { credentials: 'include', cache: 'no-store' }),
                fetch(`${API_URL}/escolas/escolas/${encodeURIComponent(idEscola)}/anos-letivos`, { credentials: 'include', cache: 'no-store' }),
                fetch(`${API_URL}/escolas/escolas/${encodeURIComponent(idEscola)}/polos`, { credentials: 'include', cache: 'no-store' }),
                fetch(`${API_URL}/escolas/escolas/${encodeURIComponent(idEscola)}/parametros-avaliacao`, { credentials: 'include', cache: 'no-store' })
            ]);
            const [escola, anos, listaPolos, config] = await Promise.all([
                lerRespostaApi(resEscola),
                lerRespostaApi(resAnos),
                lerRespostaApi(resPolos),
                lerRespostaApi(resParametros)
            ]);

            setEscolaId(idEscola);
            setDadosEscola(escola.data || null);
            setAnosEscola(Array.isArray(anos.dados) ? anos.dados : []);
            setPolos(Array.isArray(listaPolos.data) ? listaPolos.data : []);
            setParametros(config.data || null);
        } catch (error) {
            console.error('Erro ao carregar configurações institucionais:', error);
            setErroCarregamento(error.message || 'Não foi possível carregar as configurações oficiais.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void carregarConfiguracoes();
    }, [carregarConfiguracoes]);

    const alterarMinhaSenha = async (event) => {
        event.preventDefault();
        if (novaSenha !== confirmarNovaSenha) {
            setMensagem({ texto: 'A nova senha e a confirmação não coincidem.', tipo: 'erro' });
            return;
        }
        setSalvandoSenha(true);
        setMensagem({ texto: '', tipo: '' });
        try {
            const resposta = await lerRespostaApi(await fetch(`${API_URL}/escolas/utilizadores/alterar-senha`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha_atual: senhaAtual, nova_senha: novaSenha })
            }));
            setMensagem({ texto: resposta.message || 'A sua senha foi alterada.', tipo: 'sucesso' });
            setSenhaAtual('');
            setNovaSenha('');
            setConfirmarNovaSenha('');
        } catch (error) {
            setMensagem({ texto: error.message || 'Não foi possível alterar a sua senha.', tipo: 'erro' });
        } finally {
            setSalvandoSenha(false);
        }
    };

    const pesquisarAlunos = async (event) => {
        event.preventDefault();
        const termo = pesquisaAluno.trim();
        if (termo.length < 2) {
            setMensagem({ texto: 'Pesquise por pelo menos 2 caracteres.', tipo: 'erro' });
            return;
        }
        setBuscandoAlunos(true);
        setMensagem({ texto: '', tipo: '' });
        try {
            const params = new URLSearchParams({ search: termo });
            const resposta = await lerRespostaApi(await fetch(
                `${API_URL}/alunos/${encodeURIComponent(escolaId)}/alunos?${params}`,
                { credentials: 'include', cache: 'no-store' }
            ));
            const lista = Array.isArray(resposta.data) ? resposta.data : [];
            setAlunosEncontrados(lista);
            setAlunoSelecionadoId(lista[0]?.aluno_id || '');
            if (!lista.length) setMensagem({ texto: 'Não foram encontrados alunos com esse termo.', tipo: 'erro' });
        } catch (error) {
            setAlunosEncontrados([]);
            setAlunoSelecionadoId('');
            setMensagem({ texto: error.message || 'Não foi possível pesquisar alunos.', tipo: 'erro' });
        } finally {
            setBuscandoAlunos(false);
        }
    };

    const redefinirSenhaAluno = async (event) => {
        event.preventDefault();
        if (!alunoSelecionadoId) {
            setMensagem({ texto: 'Pesquise e selecione um aluno.', tipo: 'erro' });
            return;
        }
        if (novaSenhaAluno !== confirmarSenhaAluno) {
            setMensagem({ texto: 'A nova senha e a confirmação não coincidem.', tipo: 'erro' });
            return;
        }
        const aluno = alunosEncontrados.find((item) => item.aluno_id === alunoSelecionadoId);
        if (!window.confirm(`Redefinir a senha de ${aluno?.nome || 'este aluno'} ${aluno?.apelido || ''}? As sessões abertas do aluno serão terminadas.`)) return;

        setSalvandoSenhaAluno(true);
        setMensagem({ texto: '', tipo: '' });
        try {
            const resposta = await lerRespostaApi(await fetch(
                `${API_URL}/alunos/${encodeURIComponent(escolaId)}/alunos/${encodeURIComponent(alunoSelecionadoId)}/senha`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nova_senha: novaSenhaAluno })
                }
            ));
            setMensagem({ texto: resposta.message || 'Senha do aluno alterada.', tipo: 'sucesso' });
            setNovaSenhaAluno('');
            setConfirmarSenhaAluno('');
        } catch (error) {
            setMensagem({ texto: error.message || 'Não foi possível alterar a senha do aluno.', tipo: 'erro' });
        } finally {
            setSalvandoSenhaAluno(false);
        }
    };

    const pesquisarEncarregados = async (event) => {
        event.preventDefault();
        const termo = pesquisaEncarregado.trim();
        if (termo.length < 2) {
            setMensagem({ texto: 'Pesquise por pelo menos 2 caracteres.', tipo: 'erro' });
            return;
        }
        setBuscandoEncarregados(true);
        setMensagem({ texto: '', tipo: '' });
        try {
            const params = new URLSearchParams({ termo });
            const resposta = await lerRespostaApi(await fetch(
                `${API_URL}/alunos/${encodeURIComponent(escolaId)}/encarregados/buscar?${params}`,
                { credentials: 'include', cache: 'no-store' }
            ));
            const lista = Array.isArray(resposta.dados) ? resposta.dados : [];
            setEncarregadosEncontrados(lista);
            setEncarregadoSelecionadoId(lista[0]?.encarregado_id || '');
            if (!lista.length) setMensagem({ texto: 'Não foram encontrados encarregados com esse termo.', tipo: 'erro' });
        } catch (error) {
            setEncarregadosEncontrados([]);
            setEncarregadoSelecionadoId('');
            setMensagem({ texto: error.message || 'Não foi possível pesquisar encarregados.', tipo: 'erro' });
        } finally {
            setBuscandoEncarregados(false);
        }
    };

    const redefinirSenhaEncarregado = async (event) => {
        event.preventDefault();
        if (!encarregadoSelecionadoId) {
            setMensagem({ texto: 'Pesquise e selecione um encarregado.', tipo: 'erro' });
            return;
        }
        if (novaSenhaEncarregado !== confirmarSenhaEncarregado) {
            setMensagem({ texto: 'A nova senha e a confirmação não coincidem.', tipo: 'erro' });
            return;
        }
        const encarregado = encarregadosEncontrados.find((item) => item.encarregado_id === encarregadoSelecionadoId);
        const nomeEncarregado = encarregado
            ? `${encarregado.encarregado_nome || ''} ${encarregado.encarregado_apelido || ''}`.trim()
            : 'este encarregado';
        if (!window.confirm(`Redefinir a senha de ${nomeEncarregado}? As sessões abertas serão terminadas.`)) return;

        setSalvandoSenhaEncarregado(true);
        setMensagem({ texto: '', tipo: '' });
        try {
            const resposta = await lerRespostaApi(await fetch(
                `${API_URL}/alunos/${encodeURIComponent(escolaId)}/encarregados/${encodeURIComponent(encarregadoSelecionadoId)}/senha`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nova_senha: novaSenhaEncarregado })
                }
            ));
            setMensagem({ texto: resposta.message || 'Senha do encarregado alterada.', tipo: 'sucesso' });
            setNovaSenhaEncarregado('');
            setConfirmarSenhaEncarregado('');
        } catch (error) {
            setMensagem({ texto: error.message || 'Não foi possível alterar a senha do encarregado.', tipo: 'erro' });
        } finally {
            setSalvandoSenhaEncarregado(false);
        }
    };

    return (
        <div className="owner-config-page secretaria-config-page">
            <header className="owner-config-header">
                <div>
                    <span className="owner-config-eyebrow">Gestão da escola</span>
                    <h1>Configurações da Secretaria</h1>
                    <p>{dadosEscola?.nome_escola || dadosEscola?.nome || 'Consulte as definições da instituição e gira as palavras-passe autorizadas.'}</p>
                </div>
                <div className="owner-config-header-actions">
                    <button className="owner-config-secondary-button" type="button" onClick={() => void carregarConfiguracoes()} disabled={loading}>
                        <BsArrowClockwise className={loading ? 'owner-config-refreshing' : ''} />
                        {loading ? 'A atualizar…' : 'Atualizar'}
                    </button>
                    <div className="owner-config-header-account">
                        <span className="owner-config-account-avatar"><BsPersonCircle /></span>
                        <span><strong>Secretaria</strong><small>Conta da Secretaria</small></span>
                        <BsShieldCheck className="owner-config-account-check" aria-label="Sessão autenticada" />
                    </div>
                </div>
            </header>

            {mensagem.texto && (
                <div role="status" className={`sec-cfg-alert ${mensagem.tipo}`}>
                    {mensagem.tipo === 'sucesso' ? <BsCheckCircleFill /> : <BsExclamationTriangleFill />}
                    <span>{mensagem.texto}</span>
                </div>
            )}

            {erroCarregamento && (
                <div role="alert" className="sec-cfg-alert erro">
                    <BsExclamationTriangleFill /><span>{erroCarregamento}</span>
                </div>
            )}

            <section className="owner-config-summary" aria-label="Resumo das configurações">
                <article className="owner-config-summary-card">
                    <span className="owner-config-summary-icon is-blue"><BsCalendar3 /></span>
                    <span><small>Anos letivos associados</small><strong>{loading ? '—' : anosEscola.length}</strong></span>
                </article>
                <article className="owner-config-summary-card">
                    <span className="owner-config-summary-icon is-violet"><BsGeoAltFill /></span>
                    <span><small>Polos registados</small><strong>{loading ? '—' : polos.length}</strong></span>
                </article>
                <article className="owner-config-summary-card">
                    <span className="owner-config-summary-icon is-green"><BsCalendarCheck /></span>
                    <span><small>Período de avaliação</small><strong>{loading ? '—' : parametros?.sistema_periodo || '—'}</strong></span>
                </article>
            </section>

            <div className="owner-config-workspace">
                <aside className="owner-config-sidebar">
                    <div className="owner-config-sidebar-heading">
                        <BsGear />
                        <div><strong>Centro de controlo</strong><small>Informações da instituição</small></div>
                    </div>
                    <nav className="owner-config-nav" aria-label="Configurações da Secretaria">
                        {SECOES_CONFIGURACAO.map((secao) => {
                            const Icon = secao.icon;
                            const ativa = activeSection === secao.id;
                            return (
                                <button
                                    key={secao.id}
                                    type="button"
                                    onClick={() => setActiveSection(secao.id)}
                                    className={`owner-config-nav-item${ativa ? ' is-active' : ''}`}
                                    aria-current={ativa ? 'page' : undefined}
                                >
                                    <span className="owner-config-nav-icon"><Icon /></span>
                                    <span><strong>{secao.title}</strong><small>{secao.description}</small></span>
                                    <span className="owner-config-nav-marker" />
                                </button>
                            );
                        })}
                    </nav>
                    <div className="owner-config-sidebar-note">
                        <BsShieldCheck />
                        <p>As definições institucionais são apenas para consulta. A Secretaria pode gerir as palavras-passe autorizadas.</p>
                    </div>
                </aside>

                <main className="owner-config-main">
                    {loading ? (
                        <section className="owner-config-panel">
                            <p className="sec-cfg-loading">A carregar configurações oficiais da escola...</p>
                        </section>
                    ) : !erroCarregamento && (
                        <>
                            {activeSection === 'geral' && (
                                <section className="owner-config-panel">
                                    <header className="owner-config-panel-heading">
                                        <div>
                                            <span className="owner-config-eyebrow">Configuração institucional</span>
                                            <h2>Identidade Institucional</h2>
                                            <p>Consulte os dados oficiais definidos pela Direção.</p>
                                        </div>
                                    </header>
                                    <div className="secretaria-config-data-grid">
                                        <div className="sec-cfg-info-group"><span>Nome da escola</span><strong>{dadosEscola?.nome_escola || dadosEscola?.nome || 'Não definido'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Sigla</span><strong>{dadosEscola?.sigla || 'Não definida'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Categoria</span><strong>{dadosEscola?.categoria || 'Não definida'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Localidade</span><strong>{dadosEscola?.local || dadosEscola?.localidade || 'Não definida'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Sector</span><strong>{dadosEscola?.sector || 'Não definido'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Endereço</span><strong>{dadosEscola?.endereco || 'Não definido'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Regime letivo</span><strong>{dadosEscola?.regime_periodo || 'Não definido'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Missão</span><strong>{dadosEscola?.missao || 'Não definida'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Valor</span><strong>{dadosEscola?.valor || 'Não definido'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Diretor(a)</span><strong>{dadosEscola?.diretor_nome || 'Não indicado'}</strong></div>
                                    </div>
                                </section>
                            )}

                            {activeSection === 'anos' && (
                                <section className="owner-config-panel">
                                    <header className="owner-config-panel-heading">
                                        <div>
                                            <span className="owner-config-eyebrow">Calendário escolar</span>
                                            <h2>Anos letivos e matrículas</h2>
                                            <p>Consulte os períodos letivos e os prazos de matrícula associados.</p>
                                        </div>
                                        <span className="owner-config-count">{anosEscola.length} ano(s)</span>
                                    </header>
                                    <div className="sec-cfg-list">
                                        {anosEscola.length ? anosEscola.map((ano) => (
                                            <article key={ano.ano_letivo_id || ano.id} className="sec-cfg-list-item">
                                                <strong>{ano.ano_nome}{ano.ativo ? ' · Atual' : ''}</strong>
                                                <small>Ano letivo: {formatarData(ano.data_inicio)} — {formatarData(ano.data_fim)}</small>
                                                <small>Período de matrícula: {formatarData(ano.matricula_data_inicio)} — {formatarData(ano.matricula_data_fim)}</small>
                                                <small>Estado: {ano.matricula_aberta ? 'Matrícula aberta' : 'Matrícula fechada'}</small>
                                            </article>
                                        )) : <p className="sec-cfg-empty">Nenhum ano letivo configurado.</p>}
                                    </div>
                                </section>
                            )}

                            {activeSection === 'polos' && (
                                <section className="owner-config-panel">
                                    <header className="owner-config-panel-heading">
                                        <div>
                                            <span className="owner-config-eyebrow">Unidades escolares</span>
                                            <h2>Polos e ramos</h2>
                                            <p>Consulte as unidades registadas para a escola.</p>
                                        </div>
                                        <span className="owner-config-count">{polos.length} polo(s)</span>
                                    </header>
                                    <div className="sec-cfg-list">
                                        {polos.length ? polos.map((polo) => (
                                            <article key={polo.id} className="sec-cfg-list-item">
                                                <strong>{polo.nome}{polo.codigo ? ` (${polo.codigo})` : ''}</strong>
                                                <small>{[polo.local, polo.endereco].filter(Boolean).join(' · ') || 'Sem localização indicada'}</small>
                                                {polo.telefone && <small>Telefone: {polo.telefone}</small>}
                                                <small>Estado: {polo.ativo ? 'Ativo' : 'Inativo'}</small>
                                            </article>
                                        )) : <p className="sec-cfg-empty">Nenhum ramo registado.</p>}
                                    </div>
                                </section>
                            )}

                            {activeSection === 'avaliacao' && (
                                <section className="owner-config-panel">
                                    <header className="owner-config-panel-heading">
                                        <div>
                                            <span className="owner-config-eyebrow">Configuração pedagógica</span>
                                            <h2>Parâmetros de avaliação</h2>
                                            <p>Consulte os critérios de avaliação definidos pela Direção.</p>
                                        </div>
                                    </header>
                                    <div className="secretaria-config-data-grid">
                                        <div className="sec-cfg-info-group"><span>Períodos</span><strong>{parametros?.sistema_periodo || 'Não definido'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Escala de notas</span><strong>{parametros?.escala_nota || 'Não definida'}</strong></div>
                                        <div className="sec-cfg-info-group"><span>Avaliação contínua</span><strong>{parametros?.racio_continua ?? '—'}%</strong></div>
                                        <div className="sec-cfg-info-group"><span>Avaliação fixa</span><strong>{parametros?.racio_fixo ?? '—'}%</strong></div>
                                    </div>
                                </section>
                            )}

                            {activeSection === 'seguranca' && (
                                <section className="owner-config-panel">
                                    <header className="owner-config-panel-heading">
                                        <div>
                                            <span className="owner-config-eyebrow">Acesso e proteção</span>
                                            <h2>Segurança</h2>
                                            <p>Altere a sua palavra-passe ou redefina as credenciais de alunos e encarregados.</p>
                                        </div>
                                    </header>
                                    <div className="secretaria-security-grid">
                                        <form className="secretaria-security-card" onSubmit={alterarMinhaSenha}>
                                            <h3>Alterar a minha senha</h3>
                                            <CampoSenha label="Senha atual" value={senhaAtual} onChange={setSenhaAtual} autoComplete="current-password" />
                                            <CampoSenha label="Nova senha (mínimo 6 caracteres)" value={novaSenha} onChange={setNovaSenha} autoComplete="new-password" />
                                            <CampoSenha label="Confirmar nova senha" value={confirmarNovaSenha} onChange={setConfirmarNovaSenha} autoComplete="new-password" />
                                            <button className="sec-cfg-btn-pri" type="submit" disabled={salvandoSenha}>
                                                {salvandoSenha ? 'A guardar...' : 'Alterar a minha senha'}
                                            </button>
                                        </form>

                                        <section className="secretaria-security-card">
                                            <h3>Redefinir senha de aluno</h3>
                                            <p className="sec-cfg-desc">Pesquise por nome, ID de acesso ou telemóvel. A nova senha terminará as sessões abertas do aluno.</p>
                                            <form onSubmit={pesquisarAlunos} className="secretaria-search-form">
                                                <label className="secretaria-search-field">
                                                    <BsSearch aria-hidden="true" />
                                                    <input
                                                        type="search"
                                                        value={pesquisaAluno}
                                                        onChange={(event) => {
                                                            setPesquisaAluno(event.target.value);
                                                            setAlunosEncontrados([]);
                                                            setAlunoSelecionadoId('');
                                                        }}
                                                        placeholder="Nome, ID ou telemóvel"
                                                        minLength={2}
                                                        maxLength={100}
                                                    />
                                                </label>
                                                <button className="sec-cfg-btn-sec" type="submit" disabled={buscandoAlunos}>
                                                    {buscandoAlunos ? 'A pesquisar...' : 'Pesquisar'}
                                                </button>
                                            </form>
                                            {alunosEncontrados.length > 0 && (
                                                <form onSubmit={redefinirSenhaAluno}>
                                                    <label className="sec-cfg-form-group">
                                                        <span>Aluno</span>
                                                        <select value={alunoSelecionadoId} onChange={(event) => setAlunoSelecionadoId(event.target.value)} required>
                                                            {alunosEncontrados.map((aluno) => (
                                                                <option key={aluno.aluno_id} value={aluno.aluno_id}>
                                                                    {aluno.nome} {aluno.apelido || ''} · {aluno.login_id}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <CampoSenha label="Nova senha do aluno" value={novaSenhaAluno} onChange={setNovaSenhaAluno} autoComplete="new-password" />
                                                    <CampoSenha label="Confirmar nova senha" value={confirmarSenhaAluno} onChange={setConfirmarSenhaAluno} autoComplete="new-password" />
                                                    <button className="sec-cfg-btn-pri" type="submit" disabled={salvandoSenhaAluno || !alunoSelecionadoId}>
                                                        {salvandoSenhaAluno ? 'A guardar...' : 'Redefinir senha do aluno'}
                                                    </button>
                                                </form>
                                            )}
                                        </section>

                                        <section className="secretaria-security-card">
                                            <h3>Redefinir senha de encarregado</h3>
                                            <p className="sec-cfg-desc">Pesquise por nome, ID de acesso, email ou telemóvel. A alteração termina as sessões abertas.</p>
                                            <form onSubmit={pesquisarEncarregados} className="secretaria-search-form">
                                                <label className="secretaria-search-field">
                                                    <BsSearch aria-hidden="true" />
                                                    <input
                                                        type="search"
                                                        value={pesquisaEncarregado}
                                                        onChange={(event) => {
                                                            setPesquisaEncarregado(event.target.value);
                                                            setEncarregadosEncontrados([]);
                                                            setEncarregadoSelecionadoId('');
                                                        }}
                                                        placeholder="Nome, ID, email ou telemóvel"
                                                        minLength={2}
                                                        maxLength={100}
                                                    />
                                                </label>
                                                <button className="sec-cfg-btn-sec" type="submit" disabled={buscandoEncarregados}>
                                                    {buscandoEncarregados ? 'A pesquisar...' : 'Pesquisar'}
                                                </button>
                                            </form>
                                            {encarregadosEncontrados.length > 0 && (
                                                <form onSubmit={redefinirSenhaEncarregado}>
                                                    <label className="sec-cfg-form-group">
                                                        <span>Encarregado</span>
                                                        <select value={encarregadoSelecionadoId} onChange={(event) => setEncarregadoSelecionadoId(event.target.value)} required>
                                                            {encarregadosEncontrados.map((encarregado) => (
                                                                <option key={encarregado.encarregado_id} value={encarregado.encarregado_id}>
                                                                    {encarregado.encarregado_nome} {encarregado.encarregado_apelido || ''} · {encarregado.encarregado_login_id || encarregado.encarregado_email || encarregado.encarregado_telefone}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <CampoSenha label="Nova senha do encarregado" value={novaSenhaEncarregado} onChange={setNovaSenhaEncarregado} autoComplete="new-password" />
                                                    <CampoSenha label="Confirmar nova senha" value={confirmarSenhaEncarregado} onChange={setConfirmarSenhaEncarregado} autoComplete="new-password" />
                                                    <button className="sec-cfg-btn-pri" type="submit" disabled={salvandoSenhaEncarregado || !encarregadoSelecionadoId}>
                                                        {salvandoSenhaEncarregado ? 'A guardar...' : 'Redefinir senha do encarregado'}
                                                    </button>
                                                </form>
                                            )}
                                        </section>
                                    </div>
                                </section>
                            )}
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
