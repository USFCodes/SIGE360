'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
    BsArrowLeft,
    BsCheckCircle,
    BsExclamationTriangle,
    BsInfoCircle,
    BsShieldLock
} from 'react-icons/bs';
import '@/styles/tesouraria-configuracao.css';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_TESOURARIA = `${API_BASE}/api/v1/tesouraria`;
const API_ESCOLAS = `${API_BASE}/api/v1/escolas`;

const TIPOS = {
    propina: 'Propina',
    matricula: 'Matrícula',
    inscricao: 'Inscrição',
    exame: 'Exame',
    transporte: 'Transporte',
    alimentacao: 'Alimentação',
    outro: 'Outro'
};

const PERIODICIDADES = {
    unica: 'Única',
    mensal: 'Mensal',
    trimestral: 'Trimestral',
    anual: 'Anual'
};

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

function formatarValor(valor) {
    return `${Number(valor || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} CFA`;
}

function CampoSenha({ label, value, onChange, autoComplete }) {
    return (
        <label className="tc-password-field">
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

function Detalhe({ label, children }) {
    return (
        <div className="tc-info-detail">
            <span>{label}</span>
            <strong>{children}</strong>
        </div>
    );
}

export default function ConfiguracaoTesourariaPage() {
    const [config, setConfig] = useState({ niveis: [], itens: [], polos: [] });
    const [loading, setLoading] = useState(true);
    const [erroCarregamento, setErroCarregamento] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [senhaAtual, setSenhaAtual] = useState('');
    const [novaSenha, setNovaSenha] = useState('');
    const [confirmarSenha, setConfirmarSenha] = useState('');
    const [salvandoSenha, setSalvandoSenha] = useState(false);

    const carregar = useCallback(async () => {
        setLoading(true);
        setErroCarregamento('');
        try {
            const result = await lerRespostaApi(await fetch(`${API_TESOURARIA}/configuracoes`, {
                credentials: 'include',
                cache: 'no-store'
            }));
            const dados = result.dados || {};
            setConfig({
                niveis: Array.isArray(dados.niveis) ? dados.niveis : [],
                itens: Array.isArray(dados.itens) ? dados.itens : [],
                polos: Array.isArray(dados.polos) ? dados.polos : []
            });
        } catch (error) {
            console.error('Erro ao carregar informação da tesouraria:', error);
            setErroCarregamento(error.message || 'Não foi possível carregar os preços definidos pela Direção.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void Promise.resolve().then(carregar);
    }, [carregar]);

    const alterarSenha = async (event) => {
        event.preventDefault();
        setFeedback(null);
        if (novaSenha !== confirmarSenha) {
            setFeedback({ tipo: 'erro', texto: 'A nova senha e a confirmação não coincidem.' });
            return;
        }
        if (novaSenha.length < 6 || novaSenha.length > 128) {
            setFeedback({ tipo: 'erro', texto: 'A nova senha deve ter entre 6 e 128 caracteres.' });
            return;
        }

        setSalvandoSenha(true);
        try {
            const result = await lerRespostaApi(await fetch(`${API_ESCOLAS}/utilizadores/alterar-senha`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha_atual: senhaAtual, nova_senha: novaSenha })
            }));
            setFeedback({ tipo: 'sucesso', texto: result.message || 'A senha foi alterada com sucesso.' });
            setSenhaAtual('');
            setNovaSenha('');
            setConfirmarSenha('');
        } catch (error) {
            console.error('Erro ao alterar senha da conta:', error);
            setFeedback({ tipo: 'erro', texto: error.message || 'Não foi possível alterar a senha.' });
        } finally {
            setSalvandoSenha(false);
        }
    };

    const nomeNivel = (nivelId) => config.niveis.find((nivel) => nivel.id === nivelId)?.nome;

    return (
        <main className="tc-page">
            <header className="tc-header">
                <div>
                    <span className="tc-kicker">TESOURARIA</span>
                    <h1>Informações da Tesouraria</h1>
                    <p>Consulte os preços definidos pela Direção e altere a senha da sua conta.</p>
                </div>
                <Link className="tc-back-link" href="/dashboard/tesouraria">
                    <BsArrowLeft aria-hidden="true" /> Voltar
                </Link>
            </header>

            {feedback && (
                <div className={`tc-feedback ${feedback.tipo}`} role={feedback.tipo === 'erro' ? 'alert' : 'status'}>
                    {feedback.tipo === 'sucesso' ? <BsCheckCircle aria-hidden="true" /> : <BsExclamationTriangle aria-hidden="true" />}
                    {feedback.texto}
                </div>
            )}

            <section className="tc-card tc-password-card">
                <div className="tc-section-heading">
                    <span className="tc-section-icon"><BsShieldLock aria-hidden="true" /></span>
                    <div>
                        <h2>Segurança da conta</h2>
                        <p>Para alterar a senha, confirme a senha atual e introduza a nova.</p>
                    </div>
                </div>
                <form className="tc-password-form" onSubmit={alterarSenha}>
                    <CampoSenha
                        label="Senha atual"
                        value={senhaAtual}
                        onChange={setSenhaAtual}
                        autoComplete="current-password"
                    />
                    <CampoSenha
                        label="Nova senha"
                        value={novaSenha}
                        onChange={setNovaSenha}
                        autoComplete="new-password"
                    />
                    <CampoSenha
                        label="Confirmar nova senha"
                        value={confirmarSenha}
                        onChange={setConfirmarSenha}
                        autoComplete="new-password"
                    />
                    <button className="tc-primary-button" type="submit" disabled={salvandoSenha}>
                        <BsShieldLock aria-hidden="true" />
                        {salvandoSenha ? 'A alterar senha…' : 'Alterar minha senha'}
                    </button>
                </form>
            </section>

            <section className="tc-card tc-prices-card">
                <div className="tc-section-heading">
                    <span className="tc-section-icon"><BsInfoCircle aria-hidden="true" /></span>
                    <div>
                        <h2>Preços e regras de cobrança</h2>
                        <p>Informação de consulta. Os valores e regras são definidos e alterados pela Direção.</p>
                    </div>
                </div>

                {loading ? (
                    <p className="tc-state-message">A carregar os preços registados…</p>
                ) : erroCarregamento ? (
                    <div className="tc-state-message tc-state-error" role="alert">
                        <span>{erroCarregamento}</span>
                        <button type="button" className="tc-secondary-button" onClick={() => void carregar()}>
                            Tentar novamente
                        </button>
                    </div>
                ) : config.itens.length ? (
                    <div className="tc-info-list">
                        {config.itens.map((item) => {
                            const niveis = (item.nivel_ids || []).map(nomeNivel).filter(Boolean);
                            const precosClasse = item.classe_precos || [];
                            return (
                                <article className={`tc-info-item ${item.ativa ? '' : 'inactive'}`} key={item.id}>
                                    <header className="tc-info-item-heading">
                                        <div>
                                            <span className="tc-info-category">{TIPOS[item.tipo] || item.tipo || 'Pagamento'}</span>
                                            <h3>{item.nome || TIPOS[item.tipo] || 'Item de pagamento'}</h3>
                                        </div>
                                        <span className={`tc-info-status ${item.ativa ? 'active' : ''}`}>
                                            {item.ativa ? 'Ativo' : 'Inativo'}
                                        </span>
                                    </header>

                                    {precosClasse.length ? (
                                        <div className="tc-polo-prices">
                                            <h4>Preços por classe e ano letivo</h4>
                                            {precosClasse.map((preco, index) => (
                                                <div
                                                    className="tc-polo-price-row"
                                                    key={`${preco.classe}-${preco.ano_letivo_id || index}`}
                                                >
                                                    <span>{preco.classe}</span>
                                                    <span>{preco.ano_nome || 'Ano letivo'}</span>
                                                    <strong>{formatarValor(preco.valor)}</strong>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="tc-info-details">
                                            <Detalhe label="Preço">{formatarValor(item.valor)}</Detalhe>
                                            <Detalhe label="Periodicidade">{PERIODICIDADES[item.periodicidade] || item.periodicidade || '—'}</Detalhe>
                                        </div>
                                    )}

                                    <div className="tc-info-meta">
                                        <span>{item.obrigatorio ? 'Cobrança obrigatória' : 'Cobrança opcional'}</span>
                                        <span>
                                            {niveis.length
                                                ? `Aplicável a: ${niveis.join(', ')}`
                                                : 'Aplicável a todos os níveis'}
                                        </span>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                ) : (
                    <p className="tc-state-message">Ainda não existem preços ou regras de cobrança registados.</p>
                )}
            </section>
        </main>
    );
}
